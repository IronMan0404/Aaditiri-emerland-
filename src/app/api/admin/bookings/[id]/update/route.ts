import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/admin-audit';

// Admin-only: modify a booking. Lets the admin fix a wrong date/slot,
// change status, or rewrite notes for a row a resident submitted with
// errors. Existing approve / revoke / reject flows still go through
// their dedicated routes so notification side-effects stay there.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface UpdatePayload {
  date?: string;
  time_slot?: string;
  status?: string;
  notes?: string | null;
  facility?: string;
  reason?: string;
}

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

  const body = (await req.json().catch(() => ({}))) as UpdatePayload;
  const patch: Record<string, unknown> = {};

  if (body.date !== undefined) {
    if (!DATE_RE.test(body.date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    patch.date = body.date;
  }
  if (body.time_slot !== undefined) {
    const slot = String(body.time_slot).trim();
    if (slot.length === 0 || slot.length > 200) {
      return NextResponse.json({ error: 'time_slot must be 1-200 chars' }, { status: 400 });
    }
    patch.time_slot = slot;
  }
  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `status must be one of ${Array.from(ALLOWED_STATUSES).join(', ')}` },
        { status: 400 },
      );
    }
    patch.status = body.status;
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > 4000)) {
      return NextResponse.json({ error: 'notes must be a string up to 4000 chars or null' }, { status: 400 });
    }
    patch.notes = body.notes;
  }
  if (body.facility !== undefined) {
    const fac = String(body.facility).trim();
    if (fac.length === 0 || fac.length > 200) {
      return NextResponse.json({ error: 'facility must be 1-200 chars' }, { status: 400 });
    }
    patch.facility = fac;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data: before, error: fetchErr } = await supabase
    .from('bookings')
    .select('*, profiles(full_name, flat_number)')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const { data: after, error: updErr } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', id)
    .select('*, profiles(full_name, flat_number)')
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const flat = (before.profiles as { flat_number?: string | null } | null)?.flat_number ?? '?';
  const reason = (body.reason ?? '').trim().slice(0, 500) || null;
  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'update',
    targetType: 'booking',
    targetId: id,
    targetLabel: `${before.facility} on ${before.date} ${before.time_slot} (Flat ${flat})`,
    reason,
    before,
    after,
    request: req,
  });

  return NextResponse.json({ ok: true, id, after });
}
