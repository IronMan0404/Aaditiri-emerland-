import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { notify } from '@/lib/notify';

interface BroadcastPushBody {
  broadcastId?: string;
}

// Triggered by an admin right after they insert a broadcast row from
// the browser. The broadcast row is the in-app surface; this endpoint
// fans the same content out over web push and Telegram via the
// dispatcher.
//
// Migrated to `notify('broadcast_sent', ...)` (April 2026). The
// response shape stays backwards-compatible with the previous
// sendPushToAllResidents result so the broadcasts page UI keeps
// working unchanged: { sent, attempted, failed } at the top level
// reflect push, and a parallel `telegram` block reports the second
// channel.
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
    .select('id, title, message, created_by')
    .eq('id', body.broadcastId)
    .single();
  if (error || !bc) {
    return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
  }

  // Resolve the sender's display name so residents see "From <Name>"
  // attribution in both push and Telegram. Best-effort — if the
  // creator's profile was deleted, the renderer falls back to a
  // generic "Aaditri Emerland Admin" label.
  let senderName: string | null = null;
  if (bc.created_by) {
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', bc.created_by)
      .maybeSingle();
    senderName = senderProfile?.full_name ?? null;
  }

  const result = await notify('broadcast_sent', bc.id, {
    broadcastId: bc.id,
    title: bc.title,
    body: bc.message,
    authoredById: bc.created_by ?? null,
    senderName,
  });

  return NextResponse.json({
    // Back-compat surface for src/app/dashboard/broadcasts/page.tsx.
    attempted: result.pushOutcome.attempted,
    sent: result.pushOutcome.sent,
    failed: result.pushOutcome.failed,
    skipped: result.pushOutcome.skipped,
    // New: Telegram + audience metadata.
    audienceSize: result.audienceSize,
    telegram: result.telegramOutcome,
  });
}
