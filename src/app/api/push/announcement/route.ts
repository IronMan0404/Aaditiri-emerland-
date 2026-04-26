import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { notify } from '@/lib/notify';

// Fires push + Telegram fan-out after an admin client-inserts an
// announcement. Mirrors /api/push/broadcast: the row is the in-app
// surface, this endpoint just reaches the other channels.
//
// Auth: admin only. Anyone else gets 403.

interface Body {
  announcementId?: string;
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
  if (!body.announcementId) {
    return NextResponse.json({ error: 'announcementId is required' }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from('announcements')
    .select('id, title, content')
    .eq('id', body.announcementId)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
  }

  // Push body / Telegram preview both want a short tease, not the
  // full content (which can be paragraphs of HTML/text).
  const preview = (row.content ?? '').replace(/\s+/g, ' ').slice(0, 200);

  const result = await notify('announcement_published', row.id, {
    announcementId: row.id,
    title: row.title,
    preview,
  });

  return NextResponse.json({
    audienceSize: result.audienceSize,
    push: result.pushOutcome,
    telegram: result.telegramOutcome,
  });
}
