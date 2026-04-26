import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { notify } from '@/lib/notify';

// Fires push + Telegram fan-out after an admin client-inserts a
// new event. The /api/admin/events/invite endpoint already sends
// the email calendar invites; this is the channel-companion for
// PWA + Telegram.
//
// Auth: admin only. Anyone else gets 403.

interface Body {
  eventId?: string;
}

function formatWhen(date: string | null, time: string | null): string {
  if (!date) return 'Date TBD';
  // Build a user-readable label without locale flicker. We render
  // server-side and the date column is already a stable ISO date,
  // so toLocaleDateString in en-IN is safe here.
  const d = new Date(`${date}T${time ?? '00:00'}`);
  if (Number.isNaN(d.getTime())) return date;
  const dateLabel = d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return time ? `${dateLabel} \u2022 ${time}` : dateLabel;
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
  }

  const { data: ev, error } = await supabase
    .from('events')
    .select('id, title, date, time')
    .eq('id', body.eventId)
    .single();
  if (error || !ev) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const result = await notify('event_published', ev.id, {
    eventId: ev.id,
    title: ev.title,
    whenLabel: formatWhen(ev.date, ev.time),
  });

  return NextResponse.json({
    audienceSize: result.audienceSize,
    push: result.pushOutcome,
    telegram: result.telegramOutcome,
  });
}
