import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

interface UnsubscribeBody {
  endpoint?: string;
}

// Remove a single push subscription (the one tied to the device the user is
// signing out from). RLS scopes the delete to the caller's own rows.
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: UnsubscribeBody;
  try {
    body = (await request.json()) as UnsubscribeBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', body.endpoint)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
