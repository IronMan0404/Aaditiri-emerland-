import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { notifyAfter } from '@/lib/notify';
import { mailBookingInviteAfter } from '@/lib/booking-email';
import type { DecisionActor, DecisionResult } from '@/lib/decisions/registrations';

// ============================================================
// Shared booking decision helpers.
//
// Mirrors the registration / subscription helpers. Both
// /api/admin/bookings/[id]/approve and the Telegram callback
// runner go through these. As of 2026-04-26 the calendar invite
// email lives here too: a CONFIRMED update on approve and a
// CANCEL on reject, dispatched via Next's after() so neither path
// blocks on Brevo. Same UID as the TENTATIVE invite mailed at
// submit, so calendar apps treat the three messages as a single
// event whose status transitions over time instead of three
// duplicates.
// ============================================================

interface BookingRow {
  id: string;
  user_id: string;
  facility: string;
  date: string;
  time_slot: string;
  status: string;
  notes: string | null;
}

interface BookingRowWithRequester extends BookingRow {
  requester_name:  string | null;
  requester_email: string | null;
}

async function readBooking(id: string): Promise<BookingRowWithRequester | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('bookings')
    .select(
      'id, user_id, facility, date, time_slot, status, notes, profiles:user_id(full_name, email)',
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const profile = (data as unknown as {
    profiles?: { full_name?: string | null; email?: string | null } | null;
  }).profiles;
  return {
    id:         data.id,
    user_id:    data.user_id,
    facility:   data.facility,
    date:       data.date,
    time_slot:  data.time_slot,
    status:     data.status,
    notes:      data.notes ?? null,
    requester_name:  profile?.full_name ?? null,
    requester_email: profile?.email ?? null,
  };
}

function originFromRequest(request: DecisionActor['request']): string {
  // Telegram callbacks pass `request: undefined` (no inbound HTTP).
  // Fall back to the public site URL env if available so the email
  // CTA still links to the deployed app rather than localhost.
  if (request && 'headers' in request) {
    const origin = request.headers.get('origin');
    if (origin) return origin;
    try {
      const reqAny = request as unknown as { url?: string };
      if (reqAny.url) return new URL(reqAny.url).origin;
    } catch {
      // ignore
    }
  }
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    'https://aaditiri-emerland.vercel.app'
  );
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

  notifyAfter('booking_decided', bookingId, {
    bookingId,
    requesterId: before.user_id,
    approved: true,
  });

  // Calendar invite UPDATE — same UID as the TENTATIVE one mailed
  // at submit, with sequence=1 and STATUS:CONFIRMED. The resident's
  // calendar collapses these into a single entry that flips from
  // tentative → confirmed in place.
  mailBookingInviteAfter({
    phase: 'approve',
    origin: originFromRequest(actor.request),
    bookingId,
    facility:  before.facility,
    date:      before.date,
    timeSlot:  before.time_slot,
    notes:     before.notes,
    resident:  { name: before.requester_name, email: before.requester_email },
  });

  return {
    ok: true,
    status: 'approved',
    label: `Approved by ${actor.fullName ?? 'admin'}`,
    booking: after as unknown as BookingRow,
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

  notifyAfter('booking_decided', bookingId, {
    bookingId,
    requesterId: before.user_id,
    approved: false,
  });

  // Calendar CANCEL — same UID, sequence=2, METHOD:CANCEL,
  // STATUS:CANCELLED. Calendar apps remove the previously-tentative
  // entry from the resident's calendar instead of leaving it sitting
  // there indefinitely.
  mailBookingInviteAfter({
    phase: 'reject',
    origin: originFromRequest(actor.request),
    bookingId,
    facility:  before.facility,
    date:      before.date,
    timeSlot:  before.time_slot,
    notes:     before.notes,
    resident:  { name: before.requester_name, email: before.requester_email },
    reason:    cleanReason,
  });

  return {
    ok: true,
    status: 'rejected',
    label: `Rejected by ${actor.fullName ?? 'admin'}`,
  };
}
