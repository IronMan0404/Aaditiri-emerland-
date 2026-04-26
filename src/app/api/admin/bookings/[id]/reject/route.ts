import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { rejectBooking } from '@/lib/decisions/bookings';

// Admin-only: reject a pending booking with a reason.
// Implementation in src/lib/decisions/bookings.ts.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RejectBody {
  reason?: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Booking id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as RejectBody;
  const reason = (body.reason ?? '').trim();
  if (!reason) {
    return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 });
  }

  const result = await rejectBooking(id, reason, {
    id: me.id,
    fullName: me.full_name,
    email: me.email,
    via: 'web',
    request: req,
  });
  if (!result.ok) {
    const status = result.label.startsWith('Cannot') ? 409 : 400;
    return NextResponse.json({ error: result.label }, { status });
  }
  return NextResponse.json({ ok: true, id, status: result.status, label: result.label });
}
