import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { approveBooking } from '@/lib/decisions/bookings';

// Web admin route: flips a booking to 'approved' via the shared
// decision helper.
//
// The calendar-invite email (CONFIRMED ICS update with the same UID
// as the TENTATIVE one mailed at submit) is now dispatched inside
// `approveBooking()` itself, so both the web admin path and the
// Telegram inline-button path send the same email. This route only
// has to gate on auth + delegate.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const decision = await approveBooking(id, {
    id: me.id,
    fullName: me.full_name,
    email: me.email,
    via: 'web',
    request: req,
  });
  if (!decision.ok) {
    const status = decision.label.startsWith('Cannot') ? 409 : 400;
    return NextResponse.json({ error: decision.label }, { status });
  }

  return NextResponse.json({
    ok: true,
    approved: true,
    booking: decision.booking,
  });
}
