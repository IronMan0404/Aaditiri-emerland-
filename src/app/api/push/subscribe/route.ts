import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  userAgent?: string;
}

// Persist a fresh push subscription for the signed-in user. Browsers re-issue
// new endpoints after a key rotation or expiry, so this endpoint is upserted
// keyed on the unique `endpoint` URL.
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'endpoint and keys.p256dh/keys.auth are required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: body.userAgent ?? null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
