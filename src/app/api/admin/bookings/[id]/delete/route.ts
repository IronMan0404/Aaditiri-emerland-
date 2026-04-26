import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/admin-audit';

// Admin-only: hard-delete a booking. Used to prune past bookings or
// remove erroneous duplicates. The audit log preserves the row's
// last-known state so this is recoverable from a forensic point of
// view (the row itself is gone).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeletePayload { reason?: string }

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Booking id required' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('bookings')
    .select('*, profiles(full_name, flat_number)')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as DeletePayload;
  const reason = (body.reason ?? '').trim().slice(0, 500) || null;

  // `.select()` makes Supabase return the deleted rows so we can
  // verify the delete actually happened. Without this, a missing
  // RLS DELETE policy used to silently affect 0 rows, the route
  // returned ok:true, and the audit log got an entry for a row
  // that was still in the table. See migration
  // 20260505_bookings_delete_policy.sql.
  const { data: deleted, error: delErr } = await supabase
    .from('bookings')
    .delete()
    .eq('id', id)
    .select('id');
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json(
      {
        error:
          'Delete blocked by row-level security. Apply migration 20260505_bookings_delete_policy.sql.',
      },
      { status: 500 },
    );
  }

  const flat = (existing.profiles as { flat_number?: string | null } | null)?.flat_number ?? '?';
  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'delete',
    targetType: 'booking',
    targetId: id,
    targetLabel: `${existing.facility} on ${existing.date} ${existing.time_slot} (Flat ${flat})`,
    reason,
    before: existing,
    after: null,
    request: req,
  });

  return NextResponse.json({ ok: true, id });
}
