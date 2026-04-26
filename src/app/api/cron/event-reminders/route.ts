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
// Each invocation runs three independent passes:
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
// All three failures are logged but don't abort sibling passes — a
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

  const [events, passes, subs] = await Promise.all([
    runEventReminders(admin),
    runPassExpiry(admin),
    runSubscriptionTransitions(admin),
  ]);

  return NextResponse.json({
    events,
    passes,
    subscriptions: subs,
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
