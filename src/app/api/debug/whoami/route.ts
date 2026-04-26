import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DEV-ONLY diagnostic endpoint. Returns exactly what the proxy sees:
 *  - the user_id from the session cookie
 *  - the email from auth.users
 *  - the role + is_approved from public.profiles
 *
 * Hard-fails outside development so it can never be hit in prod.
 * Delete this file once we've finished debugging.
 */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) {
    return NextResponse.json({ stage: 'getUser', error: authErr.message });
  }
  const user = authData?.user;
  if (!user) {
    return NextResponse.json({ stage: 'getUser', user: null, note: 'No session — not signed in' });
  }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_approved, is_bot, flat_number, created_at')
    .eq('id', user.id)
    .maybeSingle();

  return NextResponse.json({
    auth_user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      email_confirmed_at: user.email_confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
    },
    profile,
    profile_error: profileErr?.message ?? null,
    proxy_decision: profile?.role === 'admin'
      ? 'allow_admin_and_dashboard'
      : profile?.is_approved
      ? 'allow_dashboard_only'
      : 'redirect_to_auth_pending',
  });
}
