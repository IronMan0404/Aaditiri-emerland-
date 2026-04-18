import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { sendPushToAllResidents } from '@/lib/push';

interface BroadcastPushBody {
  broadcastId?: string;
}

// Triggered by an admin right after they insert a broadcast row from the
// browser. We could move the broadcast insert here too, but doing it this
// way keeps the optimistic UX (the row appears instantly) and makes the
// push fan-out a fire-and-forget step that the user doesn't have to wait on.
//
// Authorisation: must be an admin profile. Anyone else gets 403.
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

  let body: BroadcastPushBody;
  try {
    body = (await request.json()) as BroadcastPushBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.broadcastId) {
    return NextResponse.json({ error: 'broadcastId is required' }, { status: 400 });
  }

  const { data: bc, error } = await supabase
    .from('broadcasts')
    .select('id, title, message')
    .eq('id', body.broadcastId)
    .single();
  if (error || !bc) {
    return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
  }

  const result = await sendPushToAllResidents({
    title: bc.title,
    // Push notification bodies should stay short; longer content lives in-app.
    body: bc.message.length > 140 ? `${bc.message.slice(0, 137)}…` : bc.message,
    url: '/dashboard/broadcasts',
    tag: `broadcast:${bc.id}`,
  });

  return NextResponse.json(result);
}
