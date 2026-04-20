import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from './supabase-server';

// Shared admin-gate helper used by every /api/admin/funds/* route. Mirrors
// the pattern in src/app/api/admin/users/[id]/update/route.ts but factored
// into one place so we don't repeat 12 lines across ~15 routes.
export async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, flat_number, email')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    return { ok: false as const, response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) };
  }
  return { ok: true as const, supabase, user, profile };
}

export async function requireAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, flat_number, email, resident_type, is_approved, inviter_id')
    .eq('id', user.id)
    .single();
  if (!profile) {
    return { ok: false as const, response: NextResponse.json({ error: 'Profile not found' }, { status: 403 }) };
  }
  return { ok: true as const, supabase, user, profile };
}
