import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';

// /api/staff/residents
//
// GET ?q=&page=&pageSize=
//   Returns a privacy-preserving projection of approved residents
//   (full_name, flat_number, phone, resident_type, is_approved)
//   for staff and admin clients. Backed by the
//   public.staff_visible_residents() SECURITY DEFINER function,
//   which is also gated to role IN (staff, admin) at the DB level.
//
// We additionally enforce the role check at the API layer so
// that a curious non-staff caller gets a clean 403 (instead of an
// empty result set, which would be confusing).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // Role check via service-role client so that a stale RLS
  // context (or a deactivated staff_profiles row in the rare
  // race) is still detected.
  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || (profile.role !== 'staff' && profile.role !== 'admin')) {
    return NextResponse.json(
      { error: 'Staff access required' },
      { status: 403 },
    );
  }

  // For staff (not admins) also confirm they're active in
  // staff_profiles. Admins skip this — they don't have a
  // staff_profiles row.
  if (profile.role === 'staff') {
    const { data: staffRow } = await admin
      .from('staff_profiles')
      .select('id, is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (!staffRow || !staffRow.is_active) {
      return NextResponse.json(
        { error: 'Your staff account is inactive. Contact admin.' },
        { status: 403 },
      );
    }
  }

  const url = req.nextUrl;
  const rawQ = url.searchParams.get('q') ?? '';
  const q = rawQ.trim().slice(0, 80) || null;

  const rawPage = parseInt(url.searchParams.get('page') ?? '0', 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 0;

  const rawPageSize = parseInt(
    url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE),
    10,
  );
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize > 0
      ? Math.min(rawPageSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  // We call the SECURITY DEFINER function with the *user* client
  // (not the admin client) so the in-function `auth.uid()` check
  // sees the real caller. The function itself bypasses RLS on
  // profiles, but it re-checks role IN (staff, admin) using
  // auth.uid() — the API gate above is a redundant safety net.
  const { data, error } = await supabase.rpc('staff_visible_residents', {
    search_query: q,
    page_size: pageSize,
    page_offset: page * pageSize,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    residents: data ?? [],
    page,
    pageSize,
    hasMore: (data?.length ?? 0) === pageSize,
  });
}
