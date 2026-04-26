import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { isPushConfigured } from '@/lib/push';
import { notify } from '@/lib/notify';

// Daily housekeeping + reminders cron.
//
// Schedule this on Vercel by adding to vercel.json:
//   { "crons": [{ "path": "/api/cron/event-reminders", "schedule": "30 3 * * *" }] }
//
// Vercel Hobby plans only allow daily cron jobs, so we run once a day at
// 03:30 UTC (09:00 IST, matching the bom1 region). The endpoint is fully
// idempotent (see the dedupe ledgers below) so it's safe to invoke manually
// or to run on a more frequent schedule on paid Vercel plans.
//
// Vercel signs cron requests with `Authorization: Bearer <CRON_SECRET>` when
// CRON_SECRET is set in env, so we verify that header to keep the endpoint
// safe from random callers.
//
// Each invocation runs four independent passes:
//
//   1. Event reminders — finds events scheduled for the local "tomorrow"
//      (next 24-48h window), loads everyone who RSVP'd "going" or "maybe",
//      skips users we've already sent a reminder to (event_reminders_sent
//      ledger), then dispatches the notification (push + Telegram) and
//      records a row.
//
//   2. Clubhouse pass expiry — flips active passes whose valid_until is in
//      the past to status='expired'. The DB doesn't transition these on its
//      own; a daily sweep is good enough since the validate API also
//      computes the effective state on-the-fly.
//
//   3. Clubhouse subscription transitions — flips active subscriptions
//      whose end_date is yesterday-or-earlier to 'expired', flips ones
//      ending in the next 7 days to 'expiring', and dispatches a one-off
//      notice to each affected primary user. The
//      clubhouse_subscription_notices_sent ledger keeps the cron
//      idempotent across runs.
//
//   4. Scheduled reminders — dispatches admin-curated rows from
//      `public.scheduled_reminders` whose `fire_on` is today-or-earlier,
//      `send_until` is null or in-the-future, and `last_fired_on` is
//      not today. Single-fire rows (send_until = null) flip to 'sent'
//      after a successful fire; repeating rows stay 'pending' until the
//      cron processes the day where today >= send_until. Per-day dedup
//      key (refId = "${row.id}:${YYYY-MM-DD}") ensures notify()'s
//      telegram_notifications_sent ledger doesn't collapse tomorrow's
//      fire into today's. Same-day cron retries are still idempotent.
//
// All four failures are logged but don't abort sibling passes — a
// dropped push provider shouldn't stop us from updating subscription
// statuses.
//
// All notifications go through src/lib/notify.ts so push + Telegram are
// kept in sync.

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // No secret configured — only allow in non-production so local dev
    // can hit the endpoint manually for testing.
    return process.env.NODE_ENV !== 'production';
  }
  const header = request.headers.get('authorization');
  return header === `Bearer ${expected}`;
}

interface EventRow {
  id: string;
  title: string;
  date: string;
  time: string;
  location: string;
}

interface RsvpRow {
  event_id: string;
  user_id: string;
  status: string;
}

interface ReminderLedgerRow {
  event_id: string;
  user_id: string;
}

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const pushReady = isPushConfigured();

  const [events, passes, subs, reminders] = await Promise.all([
    runEventReminders(admin),
    runPassExpiry(admin),
    runSubscriptionTransitions(admin),
    runScheduledReminders(admin),
  ]);

  return NextResponse.json({
    events,
    passes,
    subscriptions: subs,
    scheduled_reminders: reminders,
    push_ready: pushReady,
  });
}

async function runEventReminders(admin: AdminClient) {
  // Window: events whose date is between today+1 and today+2 (i.e. roughly
  // 24-48h out). We keep a 24h window so a single missed run doesn't make
  // us silently skip a day's reminders.
  const today = new Date();
  const startDate = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: events, error: eventsErr } = await admin
    .from('events')
    .select('id, title, date, time, location')
    .gte('date', startDate)
    .lte('date', endDate);
  if (eventsErr) return { error: eventsErr.message };

  const eventList = (events ?? []) as EventRow[];
  if (eventList.length === 0) return { events: 0, dispatched: 0 };
  const eventIds = eventList.map((e) => e.id);

  const { data: rsvps } = await admin
    .from('event_rsvps')
    .select('event_id, user_id, status')
    .in('event_id', eventIds)
    .in('status', ['going', 'maybe']);
  const rsvpList = (rsvps ?? []) as RsvpRow[];

  const { data: alreadySent } = await admin
    .from('event_reminders_sent')
    .select('event_id, user_id')
    .in('event_id', eventIds);
  const sentSet = new Set(
    ((alreadySent ?? []) as ReminderLedgerRow[]).map((r) => `${r.event_id}:${r.user_id}`),
  );

  let dispatched = 0;

  for (const ev of eventList) {
    const recipients = rsvpList
      .filter((r) => r.event_id === ev.id && !sentSet.has(`${ev.id}:${r.user_id}`))
      .map((r) => r.user_id);
    if (recipients.length === 0) continue;

    // event_reminder is a per-user kind (audience resolver returns
    // [userId]) so we dispatch one notification per recipient.
    // Dispatcher's telegram_notifications_sent ledger gives us
    // per-user dedup on top of the application-level
    // event_reminders_sent ledger.
    for (const uid of recipients) {
      try {
        await notify('event_reminder', `${ev.id}:${uid}`, {
          eventId: ev.id,
          userId: uid,
          title: ev.title,
          whenLabel: `${ev.time} at ${ev.location}`,
        });
        dispatched += 1;
      } catch (err) {
        console.error('[cron] event reminder failed', ev.id, uid, err);
      }
    }

    // Mark every recipient as "reminded" — even ones whose dispatch
    // failed — so a transient delivery error doesn't cause us to keep
    // re-trying until the user receives 24 of the same notification.
    await admin
      .from('event_reminders_sent')
      .upsert(recipients.map((uid) => ({ event_id: ev.id, user_id: uid })));
  }

  return { events: eventList.length, dispatched };
}

async function runPassExpiry(admin: AdminClient) {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('clubhouse_passes')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('valid_until', nowIso)
    .select('id');
  if (error) return { error: error.message };
  return { expired: data?.length ?? 0 };
}

interface SubscriptionRow {
  id: string;
  flat_number: string;
  primary_user_id: string;
  end_date: string;
  status: 'pending_approval' | 'active' | 'expiring' | 'expired' | 'cancelled' | 'rejected';
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((a - b) / (24 * 60 * 60 * 1000)));
}

async function runSubscriptionTransitions(admin: AdminClient) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const sevenDaysIso = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 1. Active → expired (end_date strictly before today).
  const { data: justExpired } = await admin
    .from('clubhouse_subscriptions')
    .update({ status: 'expired' })
    .lt('end_date', todayIso)
    .in('status', ['active', 'expiring'])
    .select('id, flat_number, primary_user_id, end_date, status') as { data: SubscriptionRow[] | null };

  // 2. Active → expiring (end_date within next 7 days, exclusive of today
  // because a sub ending *today* is still active until midnight).
  const { data: nowExpiring } = await admin
    .from('clubhouse_subscriptions')
    .update({ status: 'expiring' })
    .gte('end_date', todayIso)
    .lte('end_date', sevenDaysIso)
    .eq('status', 'active')
    .select('id, flat_number, primary_user_id, end_date, status') as { data: SubscriptionRow[] | null };

  let dispatchedExpiring = 0;
  let dispatchedExpired = 0;

  const expiringList = nowExpiring ?? [];
  if (expiringList.length > 0) {
    const ids = expiringList.map((s) => s.id);
    const { data: alreadyNotified } = await admin
      .from('clubhouse_subscription_notices_sent')
      .select('subscription_id, notice_kind')
      .in('subscription_id', ids)
      .eq('notice_kind', 'expiring');
    const sentSet = new Set((alreadyNotified ?? []).map((r) => r.subscription_id));

    for (const sub of expiringList) {
      if (sentSet.has(sub.id)) continue;
      try {
        await notify('subscription_expiring', sub.id, {
          subscriptionId: sub.id,
          flatNumber: sub.flat_number,
          daysLeft: daysBetween(sub.end_date, todayIso),
        });
        dispatchedExpiring += 1;
      } catch (err) {
        console.error('[cron] subscription expiring notify failed', sub.id, err);
      }
      await admin
        .from('clubhouse_subscription_notices_sent')
        .upsert({ subscription_id: sub.id, notice_kind: 'expiring' });
    }
  }

  const expiredList = justExpired ?? [];
  if (expiredList.length > 0) {
    const ids = expiredList.map((s) => s.id);
    const { data: alreadyNotified } = await admin
      .from('clubhouse_subscription_notices_sent')
      .select('subscription_id, notice_kind')
      .in('subscription_id', ids)
      .eq('notice_kind', 'expired');
    const sentSet = new Set((alreadyNotified ?? []).map((r) => r.subscription_id));

    for (const sub of expiredList) {
      if (sentSet.has(sub.id)) continue;
      try {
        await notify('subscription_expired', sub.id, {
          subscriptionId: sub.id,
          flatNumber: sub.flat_number,
        });
        dispatchedExpired += 1;
      } catch (err) {
        console.error('[cron] subscription expired notify failed', sub.id, err);
      }
      await admin
        .from('clubhouse_subscription_notices_sent')
        .upsert({ subscription_id: sub.id, notice_kind: 'expired' });
    }
  }

  return {
    expired: justExpired?.length ?? 0,
    expiring: nowExpiring?.length ?? 0,
    dispatched_expiring: dispatchedExpiring,
    dispatched_expired: dispatchedExpired,
  };
}

interface ScheduledReminderCronRow {
  id: string;
  title: string;
  body: string;
  fire_on: string;
  send_until: string | null;
  last_fired_on: string | null;
  fired_count: number;
  created_by: string | null;
}

// Today's date in IST (UTC+5:30). The cron itself runs at 03:30 UTC
// = 09:00 IST so "today in IST" is well-defined for any invocation
// that lands inside the same wall-clock day. We add the offset
// explicitly rather than assuming the runtime's TZ.
function istTodayDate(): string {
  const nowMs = Date.now();
  const istMs = nowMs + (5 * 60 + 30) * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

async function runScheduledReminders(admin: AdminClient) {
  const todayIst = istTodayDate();

  // Eligible rows: status='pending' AND fire_on <= today AND
  // (send_until IS NULL OR send_until >= today). Rows we've
  // already fired today (last_fired_on = today) are filtered
  // in JS below — Supabase can't express IS DISTINCT FROM in a
  // chained .is/.eq, and the column may be NULL for first-fire.
  //
  // Rationale for the date logic:
  //   • single-fire row (send_until = NULL): first-pass fires it,
  //     post-fire we set status='sent' and we're done forever.
  //   • repeating row (send_until >= today): each daily run that
  //     finds last_fired_on < today fires it again, advances
  //     last_fired_on, and increments fired_count. The very last
  //     fire (where today >= send_until) ALSO flips status='sent'.
  //   • a row whose send_until has slipped past today without
  //     ever firing (e.g. cron was down) still gets a final fire
  //     because send_until is the END date, not a "must fire by"
  //     deadline; the admin's intent was "send it daily through
  //     X" and we honour that with a single catch-up fire.
  const { data: rows, error } = await admin
    .from('scheduled_reminders')
    .select('id, title, body, fire_on, send_until, last_fired_on, fired_count, created_by')
    .eq('status', 'pending')
    .lte('fire_on', todayIst)
    .or(`send_until.is.null,send_until.gte.${todayIst}`)
    .order('fire_on', { ascending: true });

  if (error) return { error: error.message };

  const allList = (rows ?? []) as ScheduledReminderCronRow[];
  // Filter out rows already fired today. Done in JS so we don't
  // need a partial unique index on (id, last_fired_on).
  const list = allList.filter(
    (r) => r.last_fired_on === null || r.last_fired_on < todayIst,
  );
  if (list.length === 0) return { found: 0, dispatched: 0, skipped_today: allList.length };

  // Pre-load creator names in one query so we don't hit `profiles`
  // once per reminder. Filter out nulls (deleted creators) before
  // querying.
  const creatorIds = Array.from(
    new Set(list.map((r) => r.created_by).filter((x): x is string => Boolean(x))),
  );
  let nameByCreator = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profs } = await admin
      .from('profiles')
      .select('id, full_name')
      .in('id', creatorIds);
    nameByCreator = new Map(
      (profs ?? []).map((p: { id: string; full_name: string | null }) => [
        p.id,
        p.full_name ?? '',
      ]),
    );
  }

  let dispatched = 0;
  let failed = 0;

  for (const row of list) {
    const senderName = row.created_by ? nameByCreator.get(row.created_by) ?? null : null;

    // Per-day dedup key: notify()'s telegram_notifications_sent
    // ledger is unique on (kind, refId, user). For a single-fire
    // row that's exactly what we want (idempotent retry).
    // For a repeating row we MUST vary the refId per day,
    // otherwise tomorrow's fire would be silently dedup'd as a
    // duplicate of today's. Suffixing :YYYY-MM-DD does the trick;
    // a same-day re-run still hits the same key.
    const dedupRefId = `${row.id}:${todayIst}`;

    // Is this the row's terminal fire? Yes if send_until is NULL
    // (single-fire) OR today is >= send_until (last day of the
    // window). After the fire we'll flip status='sent'.
    const isTerminalFire =
      row.send_until === null || todayIst >= row.send_until;

    try {
      await notify('scheduled_reminder', dedupRefId, {
        reminderId: row.id,
        title: row.title,
        body: row.body,
        senderName,
      });

      // Stamp the fire BEFORE deciding terminal status — that way
      // a partial failure leaves last_fired_on advanced and the
      // next cron pass treats it like any other fired-today row.
      await admin
        .from('scheduled_reminders')
        .update({
          // For terminal fires we transition to 'sent'. For
          // non-terminal fires we stay 'pending' so tomorrow's
          // cron picks the row up again.
          status: isTerminalFire ? 'sent' : 'pending',
          sent_at: isTerminalFire ? new Date().toISOString() : null,
          last_fired_on: todayIst,
          fired_count: (row.fired_count ?? 0) + 1,
          error_message: null,
        })
        .eq('id', row.id)
        .eq('status', 'pending');

      dispatched += 1;
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[cron] scheduled reminder failed', row.id, msg);
      // For repeating rows we DON'T flip to 'failed' on a single
      // missed day — that would orphan the rest of the schedule.
      // Single-fire rows still go to 'failed' so the admin can
      // retry from the UI. We bump fired_count + error_message
      // either way so the admin sees what's happening.
      const stayPending = row.send_until !== null && todayIst < row.send_until;
      await admin
        .from('scheduled_reminders')
        .update({
          status: stayPending ? 'pending' : 'failed',
          fired_count: (row.fired_count ?? 0) + 1,
          error_message: msg.slice(0, 500),
        })
        .eq('id', row.id)
        .eq('status', 'pending');
    }
  }

  return { found: list.length, dispatched, failed };
}
