import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { buildBookingInvite } from '@/lib/ics';

// GET /api/bookings/[id]/ics
//
// Returns the .ics calendar attachment for one booking. Used by the
// "Add to calendar" button on /dashboard/bookings so residents can
// re-download an invite even if they cleared their email or never
// got the welcome email (e.g. Brevo not configured).
//
// Authorisation:
//   - The requester (booking.user_id === auth.uid()) can download.
//   - Admins can download any booking.
//   - Anyone else gets 403.
//
// We ALWAYS read the row through the user's session client (RLS
// enforces the auth check too), and return the file with the
// browser-friendly filename. Status of the .ics is derived from the
// booking row:
//   - status='pending'   → TENTATIVE (sequence 0)
//   - status='approved'  → CONFIRMED (sequence 1)
//   - status='rejected'  → CANCELLED (sequence 2) — still
//     downloadable so the resident can update an existing calendar
//     entry from a stale link.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BookingRow {
  id: string;
  user_id: string;
  facility: string;
  date: string;
  time_slot: string;
  status: string;
  notes: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

export async function GET(
  _req: Request,
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
    .select('role')
    .eq('id', user.id)
    .single();

  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, user_id, facility, date, time_slot, status, notes, profiles:user_id(full_name, email)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const booking = data as unknown as BookingRow;
  const isOwner = booking.user_id === user.id;
  const isAdmin = me?.role === 'admin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const phase: 'tentative' | 'confirmed' | 'cancelled' =
    booking.status === 'approved'
      ? 'confirmed'
      : booking.status === 'rejected'
        ? 'cancelled'
        : 'tentative';

  const invite = buildBookingInvite({
    bookingId: booking.id,
    facility:  booking.facility,
    date:      booking.date,
    timeSlot:  booking.time_slot,
    notes:     booking.notes,
    resident: {
      name:  booking.profiles?.full_name ?? 'Resident',
      email: booking.profiles?.email ?? `${booking.user_id}@aaditri-emerland.local`,
    },
    phase,
  });

  if (!invite.ics) {
    return NextResponse.json(
      { error: `Cannot build calendar entry — time slot "${booking.time_slot}" did not parse.` },
      { status: 422 },
    );
  }

  // Pretty filename so saved files are findable later. Strip
  // characters that break Content-Disposition.
  const safeFacility = booking.facility.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40);
  const filename = `${safeFacility}-${booking.date}.ics`;

  return new NextResponse(invite.ics, {
    status: 200,
    headers: {
      'content-type': invite.contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      // Don't cache — the file's status changes when the booking
      // moves between pending/approved/rejected.
      'cache-control': 'private, no-store',
    },
  });
}
