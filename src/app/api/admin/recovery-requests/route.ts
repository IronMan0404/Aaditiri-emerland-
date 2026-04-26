import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================
// Admin-only: list recovery requests for the /admin/users panel.
//
// Default returns the 50 most recent rows in any status, with
// the pending ones first. Admin UI shows pending in a separate
// "needs your attention" panel and renders resolved/cancelled
// ones in a "history" collapse.
//
// We always go through the service-role client because the
// table is RLS-locked deny-all (see migration 20260510). The
// caller's admin role is checked via the user-scoped client
// before that key is ever used.
// =============================================================

const STATUS_FILTER = new Set(['pending', 'resolved', 'cancelled', 'expired', 'all']);

export async function GET(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  if (!isAdminClientConfigured()) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status') ?? 'pending';
  if (!STATUS_FILTER.has(statusParam)) {
    return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200);

  const admin = createAdminSupabaseClient();

  // Embed enough profile context that the UI can render without a
  // second fetch — admins want the resident's name, flat, phone,
  // and email (so they can pick how to verify identity) right next
  // to the request row.
  let query = admin
    .from('admin_recovery_requests')
    .select(
      `id,
       status,
       contact_note,
       request_ip,
       resolution_note,
       resolved_at,
       created_at,
       updated_at,
       profile:profiles!admin_recovery_requests_profile_id_fkey (
         id,
         full_name,
         phone,
         email,
         flat_number,
         is_approved
       ),
       resolver:profiles!admin_recovery_requests_resolved_by_fkey (
         id,
         full_name
       )`,
    )
    .order('status', { ascending: true }) // 'pending' < 'cancelled' < 'expired' < 'resolved' alphabetically
    .order('created_at', { ascending: false })
    .limit(limit);

  if (statusParam !== 'all') {
    query = query.eq('status', statusParam);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    requests: data ?? [],
  });
}
