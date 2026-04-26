import 'server-only';
import { after } from 'next/server';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import {
  buildBookingInvite,
  googleCalendarUrl,
  outlookCalendarUrl,
} from '@/lib/ics';

// ============================================================
// Booking → calendar invite email.
//
// Centralises the subject/body/attachments we send to a resident at
// each phase of a booking's lifecycle:
//
//   - submit  → "Booking received"     (TENTATIVE ICS, sequence 0)
//   - approve → "Booking approved"     (CONFIRMED ICS, sequence 1, UPDATE)
//   - reject  → "Booking not approved" (CANCELLED ICS, sequence 2, CANCEL)
//
// All three keep the same UID so a calendar app collapses them into
// a single event entry that updates as the status moves.
//
// Behaviour:
//   - If email isn't configured, returns { ok: false, skipped: ... }
//     and the caller's response stays a success — email is best-effort.
//   - If the time slot can't be parsed, we still send the email but
//     drop the .ics attachment and the "Add to calendar" buttons.
//
// Convenience: `mailBookingInviteAfter()` schedules the send via
// Next's `after()` so the resident's request path doesn't pay the
// Brevo round-trip latency. Prefer it over awaiting `mailBooking
// Invite()` directly unless you want to surface the result in the
// HTTP response.
// ============================================================

export type BookingMailPhase = 'submit' | 'approve' | 'reject';

const PHASE_TO_INVITE: Record<BookingMailPhase, 'tentative' | 'confirmed' | 'cancelled'> = {
  submit:  'tentative',
  approve: 'confirmed',
  reject:  'cancelled',
};

export interface BookingMailParams {
  phase: BookingMailPhase;
  origin: string;
  bookingId: string;
  facility: string;
  date: string;
  timeSlot: string;
  notes?: string | null;
  resident: { name: string | null; email: string | null };
  /** Reason text — only used on reject. */
  reason?: string | null;
}

export type BookingMailResult =
  | { ok: true; sent: true; id: string | null; phase: BookingMailPhase }
  | { ok: false; sent: false; skipped: true; reason: string }
  | { ok: false; sent: false; error: string };

export async function mailBookingInvite(p: BookingMailParams): Promise<BookingMailResult> {
  const toEmail = (p.resident.email ?? '').trim();
  if (!toEmail) {
    return { ok: false, sent: false, skipped: true, reason: 'no_email' };
  }
  if (!isEmailConfigured()) {
    return { ok: false, sent: false, skipped: true, reason: 'provider_disabled' };
  }

  const firstName = (p.resident.name ?? 'Resident').split(' ')[0] || 'Resident';
  const bookingLink = `${p.origin.replace(/\/$/, '')}/dashboard/bookings`;

  const invite = buildBookingInvite({
    bookingId: p.bookingId,
    facility:  p.facility,
    date:      p.date,
    timeSlot:  p.timeSlot,
    notes:     p.notes ?? null,
    resident:  { name: p.resident.name ?? 'Resident', email: toEmail },
    phase:     PHASE_TO_INVITE[p.phase],
  });

  const attachments = invite.ics
    ? [{
        filename: invite.filename,
        contentType: invite.contentType,
        content: invite.ics,
      }]
    : undefined;

  const googleUrl = invite.schedulable
    ? googleCalendarUrl({
        title: `${p.facility} — Booking`,
        description: p.notes ?? undefined,
        location: p.facility,
        startUtc: invite.startUtc!,
        endUtc:   invite.endUtc!,
      })
    : null;
  const outlookUrl = invite.schedulable
    ? outlookCalendarUrl({
        title: `${p.facility} — Booking`,
        description: p.notes ?? undefined,
        location: p.facility,
        startUtc: invite.startUtc!,
        endUtc:   invite.endUtc!,
      })
    : null;

  const dateLabel = `${p.date} · ${p.timeSlot}`;
  const subject =
    p.phase === 'submit'  ? `🗓️ Booking received: ${p.facility} on ${p.date}`  :
    p.phase === 'approve' ? `✅ Booking approved: ${p.facility} on ${p.date}`  :
                            `❌ Booking not approved: ${p.facility} on ${p.date}`;

  const html = buildBookingEmailHtml({
    phase: p.phase,
    firstName,
    facility: p.facility,
    dateLabel,
    notes:   p.notes ?? null,
    reason:  p.reason ?? null,
    googleUrl,
    outlookUrl,
    bookingLink,
    hasSchedule: invite.schedulable,
  });

  const textIntro =
    p.phase === 'submit'
      ? `we've received your booking request for ${p.facility} on ${p.date} (${p.timeSlot}). It is currently pending admin approval. We've attached a tentative calendar entry — your calendar will update automatically once it's approved.`
      : p.phase === 'approve'
        ? `your booking for ${p.facility} on ${p.date} (${p.timeSlot}) has been approved.`
        : `your booking for ${p.facility} on ${p.date} (${p.timeSlot}) was not approved${p.reason ? `:\n\nReason: ${p.reason}` : '.'}`;

  const result = await sendEmail({
    to: toEmail,
    subject,
    html,
    text: `Hi ${firstName},\n\n${textIntro}\n\nOpen in app: ${bookingLink}\n\n— Aaditri Emerland Management`,
    attachments,
  });

  if (result.ok) {
    return { ok: true, sent: true, id: result.id, phase: p.phase };
  }
  if ('skipped' in result && result.skipped) {
    return { ok: false, sent: false, skipped: true, reason: result.reason };
  }
  return { ok: false, sent: false, error: result.error };
}

/**
 * Schedule a calendar email through Next's `after()` so the
 * resident's HTTP response returns immediately. Errors are logged
 * but never thrown.
 */
export function mailBookingInviteAfter(p: BookingMailParams): void {
  after(async () => {
    try {
      const r = await mailBookingInvite(p);
      if (!r.ok && !('skipped' in r && r.skipped)) {
        console.error('[booking-email] send failed', p.phase, p.bookingId, r);
      }
    } catch (err) {
      console.error('[booking-email] crashed', p.phase, p.bookingId, err);
    }
  });
}

// ---------- Email body builder ---------------------------------------

interface BodyParams {
  phase: BookingMailPhase;
  firstName: string;
  facility: string;
  dateLabel: string;
  notes:  string | null;
  reason: string | null;
  googleUrl:  string | null;
  outlookUrl: string | null;
  bookingLink: string;
  hasSchedule: boolean;
}

function buildBookingEmailHtml(p: BodyParams): string {
  const headerCopy =
    p.phase === 'submit'  ? { headline: 'Booking received', strapline: 'Awaiting admin approval', accent: '#92400E', accentBg: '#FFF7ED' } :
    p.phase === 'approve' ? { headline: 'Booking approved', strapline: 'See you there', accent: '#1B5E20', accentBg: '#F0FDF4' } :
                            { headline: 'Booking not approved', strapline: 'See reason below', accent: '#991B1B', accentBg: '#FEF2F2' };

  const intro =
    p.phase === 'submit'
      ? `Your booking is currently <strong>pending admin approval</strong>. We've attached a <strong>tentative</strong> calendar entry — your calendar will update automatically once it's approved or release the slot if it isn't.`
      : p.phase === 'approve'
        ? `Your booking is now <strong>confirmed</strong>. The calendar attachment is updated to reflect the confirmed slot.`
        : `Your booking has been declined. The previously-tentative calendar entry has been cancelled.`;

  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:#1B5E20;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600;margin-right:8px;margin-top:8px">${label}</a>`;
  const btnSecondary = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;border:1px solid #1B5E20;color:#1B5E20;padding:9px 17px;border-radius:10px;text-decoration:none;font-weight:600;margin-right:8px;margin-top:8px">${label}</a>`;

  const ctas =
    p.phase !== 'reject' && p.hasSchedule && p.googleUrl && p.outlookUrl
      ? `${btn(p.googleUrl, 'Add to Google Calendar')}${btnSecondary(p.outlookUrl, 'Add to Outlook')}`
      : '';

  const reasonBlock =
    p.phase === 'reject' && p.reason
      ? `<div style="background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;padding:14px 16px;margin-top:14px;color:#7F1D1D"><div style="font-weight:600;margin-bottom:4px">Reason from admin</div><div>${escapeHtml(p.reason)}</div></div>`
      : '';

  const notesBlock = p.notes
    ? `<div style="margin-top:6px;color:#666;font-size:13px"><em>Your note:</em> ${escapeHtml(p.notes)}</div>`
    : '';

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F5F5F5;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
      <div style="background:${headerCopy.accent};color:#fff;padding:20px 24px">
        <div style="font-size:12px;opacity:0.85">Aaditri Emerland Community</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${headerCopy.headline}</div>
        <div style="font-size:13px;opacity:0.9;margin-top:2px">${headerCopy.strapline}</div>
      </div>
      <div style="padding:22px 24px;color:#333;line-height:1.55;font-size:14px">
        <p style="margin:0 0 12px">Hi ${escapeHtml(p.firstName)},</p>
        <p style="margin:0 0 16px">${intro}</p>
        <div style="background:${headerCopy.accentBg};border-left:4px solid ${headerCopy.accent};border-radius:8px;padding:14px 16px;margin-bottom:16px">
          <div style="font-size:16px;font-weight:700;color:${headerCopy.accent}">${escapeHtml(p.facility)}</div>
          <div style="margin-top:6px;color:#444">🕒 ${escapeHtml(p.dateLabel)}</div>
          ${notesBlock}
        </div>
        ${reasonBlock}
        ${
          p.phase !== 'reject' && p.hasSchedule
            ? `<p style="margin:14px 0 4px;font-weight:600">Add to your calendar:</p><div>${ctas}</div><p style="margin:14px 0 0;color:#888;font-size:12px">The attached <code>booking.ics</code> file works with Outlook, Apple Mail, and any standards-based calendar app.</p>`
            : p.phase !== 'reject' && !p.hasSchedule
              ? `<p style="margin:14px 0 0;color:#b45309;font-size:13px">⚠️ We couldn't build an automatic calendar entry from the time slot. Please add it to your calendar manually.</p>`
              : ''
        }
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0" />
        ${btnSecondary(p.bookingLink, 'View in app')}
      </div>
      <div style="padding:12px 24px;background:#FAFAFA;color:#999;font-size:12px;text-align:center">
        Sent by Aaditri Emerland Management · Please do not reply
      </div>
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
