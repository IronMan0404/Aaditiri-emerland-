import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { buildIcs, googleCalendarUrl, outlookCalendarUrl, parseTimeRange, istDateToUtc } from '@/lib/ics';
import { approveBooking } from '@/lib/decisions/bookings';

// Web admin route: flips a booking to 'approved' via the shared
// decision helper (DB write + audit + notify) and additionally
// sends a calendar-invite email with an ICS attachment. The
// Telegram callback path uses the same helper but skips the email.

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

  // Re-fetch the booking with the resident's profile join so we can
  // build the email after the helper has applied the status change.
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('id, user_id, facility, date, time_slot, notes, status, profiles(full_name, email)')
    .eq('id', id)
    .single();
  if (bookingErr || !booking) {
    return NextResponse.json({ error: `Booking not found: ${bookingErr?.message ?? 'missing'}` }, { status: 404 });
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

  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: true, approved: true, email: { sent: false, reason: 'provider_disabled' } });
  }

  const resident = (booking.profiles as { full_name?: string | null; email?: string | null } | null);
  const toEmail = resident?.email?.trim();
  if (!toEmail) {
    return NextResponse.json({ ok: true, approved: true, email: { sent: false, reason: 'no_email' } });
  }

  const range = parseTimeRange(booking.time_slot);
  const startUtc = range ? istDateToUtc(booking.date, range.start) : null;
  const endUtc = range ? istDateToUtc(booking.date, range.end) : null;
  const hasSchedule = Boolean(startUtc && endUtc);

  const firstName = (resident?.full_name ?? 'Resident').split(' ')[0] || 'Resident';
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  const bookingLink = `${origin}/dashboard/bookings`;

  const attachments = hasSchedule
    ? [{
        filename: 'booking.ics',
        contentType: 'text/calendar; method=REQUEST; charset=utf-8',
        content: buildIcs({
          uid: `booking-${booking.id}@aaditri-emerland`,
          title: `${booking.facility} — Booking`,
          description: booking.notes ?? undefined,
          location: booking.facility,
          startUtc: startUtc!,
          endUtc: endUtc!,
          organizer: { name: 'Aaditri Emerland', email: 'noreply@aaditri-emerland.local' },
          attendee: { name: resident?.full_name ?? 'Resident', email: toEmail },
          method: 'REQUEST',
        }),
      }]
    : undefined;

  const googleUrl = hasSchedule
    ? googleCalendarUrl({ title: `${booking.facility} — Booking`, description: booking.notes ?? undefined, location: booking.facility, startUtc: startUtc!, endUtc: endUtc! })
    : null;
  const outlookUrl = hasSchedule
    ? outlookCalendarUrl({ title: `${booking.facility} — Booking`, description: booking.notes ?? undefined, location: booking.facility, startUtc: startUtc!, endUtc: endUtc! })
    : null;

  const sendResult = await sendEmail({
    to: toEmail,
    subject: `✅ Booking approved: ${booking.facility} on ${booking.date}`,
    html: buildBookingEmailHtml({
      firstName,
      facility: booking.facility,
      dateLabel: `${booking.date} · ${booking.time_slot}`,
      googleUrl, outlookUrl, bookingLink, hasSchedule,
    }),
    text: `Hi ${firstName},\n\nYour booking for ${booking.facility} on ${booking.date} (${booking.time_slot}) has been approved.\n\nOpen in app: ${bookingLink}\n\n— Aaditri Emerland Management`,
    attachments,
  });

  return NextResponse.json({
    ok: true,
    approved: true,
    email: sendResult.ok
      ? { sent: true, id: sendResult.id }
      : 'skipped' in sendResult && sendResult.skipped
        ? { sent: false, reason: sendResult.reason }
        : { sent: false, error: sendResult.error },
  });
}

function buildBookingEmailHtml(p: {
  firstName: string; facility: string; dateLabel: string;
  googleUrl: string | null; outlookUrl: string | null; bookingLink: string; hasSchedule: boolean;
}): string {
  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:#1B5E20;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600;margin-right:8px;margin-top:8px">${label}</a>`;
  const btnSecondary = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;border:1px solid #1B5E20;color:#1B5E20;padding:9px 17px;border-radius:10px;text-decoration:none;font-weight:600;margin-right:8px;margin-top:8px">${label}</a>`;
  const ctas = p.hasSchedule && p.googleUrl && p.outlookUrl
    ? `${btn(p.googleUrl, 'Add to Google Calendar')}${btnSecondary(p.outlookUrl, 'Add to Outlook')}`
    : '';
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F5F5F5;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
      <div style="background:#1B5E20;color:#fff;padding:20px 24px">
        <div style="font-size:12px;opacity:0.85">Aaditri Emerland Community</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">Booking approved</div>
      </div>
      <div style="padding:22px 24px;color:#333;line-height:1.55;font-size:14px">
        <p style="margin:0 0 12px">Hi ${escapeHtml(p.firstName)},</p>
        <p style="margin:0 0 16px">Your booking has been approved:</p>
        <div style="background:#F5F5F5;border-left:4px solid #1B5E20;border-radius:8px;padding:14px 16px;margin-bottom:16px">
          <div style="font-size:16px;font-weight:700;color:#1B5E20">${escapeHtml(p.facility)}</div>
          <div style="margin-top:6px;color:#444">🕒 ${escapeHtml(p.dateLabel)}</div>
        </div>
        ${p.hasSchedule
          ? `<p style="margin:0 0 4px;font-weight:600">Add to your calendar:</p><div>${ctas}</div>
             <p style="margin:14px 0 0;color:#888;font-size:12px">The attached <code>booking.ics</code> file works with Outlook, Apple Mail, and any standards-based calendar.</p>`
          : `<p style="margin:0;color:#b45309;font-size:13px">⚠️ We couldn't build an automatic calendar entry from the time slot. Please add it to your calendar manually.</p>`}
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
