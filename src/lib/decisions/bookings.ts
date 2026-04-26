import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { notify } from '@/lib/notify';
import type { DecisionActor, DecisionResult } from '@/lib/decisions/registrations';

// ============================================================
// Shared booking decision helpers.
//
// Mirrors the registration / subscription helpers. Both
// /api/admin/bookings/[id]/approve and the Telegram callback
// runner go through these. Calendar invite (Brevo email + ICS) is
// intentionally NOT in here — it's a side effect of the web admin
// path only. The Telegram path delivers the same DB transition,
// audit log, and resident notification, just without the email
// niceties.
// ============================================================

interface BookingRow {
  id: string;
  user_id: string;
  facility: string;
  date: string;
  time_slot: string;
  status: string;
}

async function readBooking(id: string): Promise<BookingRow | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('bookings')
    .select('id, user_id, facility, date, time_slot, status')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as BookingRow | null;
}

export interface ApproveBookingResult extends DecisionResult {
  /** When ok=true, the canonical booking row after the update. */
  booking?: BookingRow;
}

export async function approveBooking(
  bookingId: string,
  actor: DecisionActor,
): Promise<ApproveBookingResult> {
  const before = await readBooking(bookingId);
  if (!before) return { ok: false, status: 'failed', label: 'Booking not found' };
  if (before.status === 'approved') {
    return { ok: true, status: 'noop', label: 'Already approved', booking: before };
  }
  if (before.status !== 'pending') {
    return {
      ok: false,
      status: 'failed',
      label: `Cannot approve a ${before.status} booking`,
    };
  }

  const admin = createAdminSupabaseClient();
  const { data: after, error } = await admin
    .from('bookings')
    .update({ status: 'approved' })
    .eq('id', bookingId)
    .select('id, user_id, facility, date, time_slot, status')
    .single();
  if (error || !after) {
    return { ok: false, status: 'failed', label: 'Update failed', error: error?.message };
  }

  await logAdminAction({
    actor: { id: actor.id, email: actor.email, name: actor.fullName },
    action: 'update',
    targetType: 'booking',
    targetId: bookingId,
    targetLabel: `${before.facility} on ${before.date} ${before.time_slot}${
      actor.via === 'telegram' ? ' (via Telegram)' : ''
    }`,
    reason: 'Approved booking',
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    request: actor.request,
  });

  notify('booking_decided', bookingId, {
    bookingId,
    requesterId: before.user_id,
    approved: true,
  }).catch(() => {});

  return {
    ok: true,
    status: 'approved',
    label: `Approved by ${actor.fullName ?? 'admin'}`,
    booking: after as BookingRow,
  };
}

export async function rejectBooking(
  bookingId: string,
  reason: string,
  actor: DecisionActor,
): Promise<DecisionResult> {
  const cleanReason = (reason ?? '').trim();
  if (!cleanReason) {
    return { ok: false, status: 'failed', label: 'Reason required' };
  }
  if (cleanReason.length > 500) {
    return { ok: false, status: 'failed', label: 'Reason must be 500 chars or fewer' };
  }

  const before = await readBooking(bookingId);
  if (!before) return { ok: false, status: 'failed', label: 'Booking not found' };
  if (before.status === 'rejected') {
    return { ok: true, status: 'noop', label: 'Already rejected' };
  }
  if (before.status !== 'pending') {
    return {
      ok: false,
      status: 'failed',
      label: `Cannot reject a ${before.status} booking`,
    };
  }

  const admin = createAdminSupabaseClient();
  const { data: after, error } = await admin
    .from('bookings')
    .update({ status: 'rejected' })
    .eq('id', bookingId)
    .select('id, user_id, facility, date, time_slot, status')
    .single();
  if (error || !after) {
    return { ok: false, status: 'failed', label: 'Update failed', error: error?.message };
  }

  await logAdminAction({
    actor: { id: actor.id, email: actor.email, name: actor.fullName },
    action: 'update',
    targetType: 'booking',
    targetId: bookingId,
    targetLabel: `${before.facility} on ${before.date} ${before.time_slot}${
      actor.via === 'telegram' ? ' (via Telegram)' : ''
    }`,
    reason: `Rejected: ${cleanReason}`,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    request: actor.request,
  });

  notify('booking_decided', bookingId, {
    bookingId,
    requesterId: before.user_id,
    approved: false,
  }).catch(() => {});

  return {
    ok: true,
    status: 'rejected',
    label: `Rejected by ${actor.fullName ?? 'admin'}`,
  };
}
