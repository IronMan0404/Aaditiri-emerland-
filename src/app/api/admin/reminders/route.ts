import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import type { ScheduledReminder, ScheduledReminderStatus } from '@/types';

// /api/admin/reminders
//
// GET  — list scheduled reminders. Optional ?status=pending|sent|cancelled|failed
//        filters; default returns everything ordered by fire_on asc,
//        created_at desc (so the next thing to fire is at the top of
//        each tab in the admin UI). Capped at 200 rows because the
//        admin UI doesn't paginate (this is a low-volume table).
//
// POST — create a new pending reminder. Body: { title, body, fire_on:
//        'YYYY-MM-DD', send_until?: 'YYYY-MM-DD' | null }. send_until,
//        when present, marks the row as repeating: the daily cron will
//        fire it once per day from fire_on through send_until inclusive.
//        Omit (or pass null) for a single-fire reminder.
//
//        Hard caps:
//          • send_until must be >= fire_on (DB also enforces this)
//          • send_until - fire_on <= MAX_REPEAT_DAYS (60). This is a
//            UX nudge to stop someone accidentally setting up a
//            year-long daily nag campaign.
//
//        We deliberately don't accept a custom `audience` or `kind`
//        here; until the engine supports more than 'custom' +
//        'all_residents', exposing them as inputs would just be
//        footguns.
//
// Both ops use the service-role client so we get a clean writer that
// also populates `created_by` from the authenticated admin without
// trusting client-supplied IDs.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreatePayload {
  title?: string;
  body?: string;
  fire_on?: string;
  send_until?: string | null;
}

const ALLOWED_STATUSES: ScheduledReminderStatus[] = [
  'pending',
  'sent',
  'cancelled',
  'failed',
];

// Max distance, in days, between fire_on and send_until. 60 days
// = "fine for a two-month nag campaign", which is the longest
// real-world use case we anticipate (e.g. AGM voting window). If
// you genuinely need longer, talk to engineering — chances are
// you actually want a reminder *kind* (recurring monthly), not a
// 365-row daily fan-out.
const MAX_REPEAT_DAYS = 60;

function isValidIsoDate(s: string): boolean {
  // Accept exactly YYYY-MM-DD. Don't trust JS's Date.parse leniency.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Days between two YYYY-MM-DD strings. Both dates are treated as
// UTC midnight for the subtraction, which is fine because we only
// care about the date difference, not the wall-clock duration.
function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const f = new Date(fromIso + 'T00:00:00Z').getTime();
  const t = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((t - f) / (24 * 60 * 60 * 1000));
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const status = ALLOWED_STATUSES.find((s) => s === statusParam);

  const adb = createAdminSupabaseClient();
  let q = adb
    .from('scheduled_reminders')
    .select('*')
    .order('fire_on', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) {
    console.error('[admin/reminders] list failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    reminders: (data ?? []) as ScheduledReminder[],
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as CreatePayload;
  const title = (body.title ?? '').trim();
  const text = (body.body ?? '').trim();
  const fireOn = (body.fire_on ?? '').trim();
  // Treat empty string and null identically — both mean "no end date".
  const rawSendUntil = body.send_until;
  const sendUntil =
    typeof rawSendUntil === 'string' && rawSendUntil.trim() !== ''
      ? rawSendUntil.trim()
      : null;

  if (title.length < 1 || title.length > 120) {
    return NextResponse.json({ error: 'Title must be 1-120 characters.' }, { status: 400 });
  }
  if (text.length < 1 || text.length > 1500) {
    return NextResponse.json({ error: 'Body must be 1-1500 characters.' }, { status: 400 });
  }
  if (!isValidIsoDate(fireOn)) {
    return NextResponse.json(
      { error: 'fire_on must be a YYYY-MM-DD date.' },
      { status: 400 },
    );
  }
  if (sendUntil !== null) {
    if (!isValidIsoDate(sendUntil)) {
      return NextResponse.json(
        { error: 'send_until must be a YYYY-MM-DD date or null.' },
        { status: 400 },
      );
    }
    if (sendUntil < fireOn) {
      return NextResponse.json(
        { error: 'send_until cannot be before fire_on.' },
        { status: 400 },
      );
    }
    const span = daysBetweenIsoDates(fireOn, sendUntil);
    if (span > MAX_REPEAT_DAYS) {
      return NextResponse.json(
        {
          error: `send_until is ${span} days after fire_on; the maximum is ${MAX_REPEAT_DAYS} days.`,
        },
        { status: 400 },
      );
    }
  }

  const adb = createAdminSupabaseClient();
  const { data, error } = await adb
    .from('scheduled_reminders')
    .insert({
      title,
      body: text,
      fire_on: fireOn,
      send_until: sendUntil,
      created_by: auth.user.id,
      last_actor: auth.user.id,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[admin/reminders] create failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reminder: data as ScheduledReminder }, { status: 201 });
}
