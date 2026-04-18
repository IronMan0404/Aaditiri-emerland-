import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { sendPushToUsers, isPushConfigured } from '@/lib/push';

// 24-hour event reminder cron.
//
// Schedule this on Vercel by adding to vercel.json:
//   { "crons": [{ "path": "/api/cron/event-reminders", "schedule": "0 * * * *" }] }
//
// Vercel signs cron requests with `Authorization: Bearer <CRON_SECRET>` when
// CRON_SECRET is set in env, so we verify that header to keep the endpoint
// safe from random callers.
//
// Each invocation:
//   1. Finds events scheduled for the local "tomorrow" (next 24-48h window).
//   2. Loads everyone who RSVP'd "going" or "maybe" for those events.
//   3. Skips users we've already sent a reminder to (event_reminders_sent
//      table is the dedupe ledger), then sends a push and records a row.
//
// Running hourly with a 24-48h window means each user gets exactly one
// reminder per event regardless of how many times the cron fires.

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

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ skipped: 'push_not_configured', sent: 0 });
  }

  const admin = createAdminSupabaseClient();

  // Window: events whose date is between today+1 and today+2 (i.e. roughly
  // 24-48h out). We keep a 24h window so the hourly cron has overlap and a
  // single missed run doesn't make us silently skip a day's reminders.
  const today = new Date();
  const startDate = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + 48 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const { data: events, error: eventsErr } = await admin
    .from('events')
    .select('id, title, date, time, location')
    .gte('date', startDate)
    .lte('date', endDate);
  if (eventsErr) {
    return NextResponse.json({ error: eventsErr.message }, { status: 500 });
  }
  const eventList = (events ?? []) as EventRow[];
  if (eventList.length === 0) {
    return NextResponse.json({ events: 0, sent: 0 });
  }
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
    ((alreadySent ?? []) as ReminderLedgerRow[]).map((r) => `${r.event_id}:${r.user_id}`)
  );

  let totalSent = 0;
  let totalAttempted = 0;

  for (const ev of eventList) {
    const recipients = rsvpList
      .filter((r) => r.event_id === ev.id && !sentSet.has(`${ev.id}:${r.user_id}`))
      .map((r) => r.user_id);
    if (recipients.length === 0) continue;

    const result = await sendPushToUsers(recipients, {
      title: `Tomorrow: ${ev.title}`,
      body: `${ev.time} at ${ev.location}`,
      url: '/dashboard/events',
      tag: `event-reminder:${ev.id}`,
    });
    totalSent += result.sent;
    totalAttempted += result.attempted;

    // Mark every recipient as "reminded" — even ones whose push failed —
    // so a transient delivery error doesn't cause us to keep re-trying
    // until the user receives 24 of the same notification.
    if (recipients.length > 0) {
      await admin
        .from('event_reminders_sent')
        .upsert(recipients.map((uid) => ({ event_id: ev.id, user_id: uid })));
    }
  }

  return NextResponse.json({
    events: eventList.length,
    attempted: totalAttempted,
    sent: totalSent,
  });
}
