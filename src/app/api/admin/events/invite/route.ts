import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { buildIcs, googleCalendarUrl, outlookCalendarUrl, parseTimeString, istDateToUtc } from '@/lib/ics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const payload = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {});
  const eventId = typeof payload.eventId === 'string' ? payload.eventId : '';
  if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase.from('profiles').select('id, role').eq('id', user.id).single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { data: eventRow, error: eventErr } = await supabase
    .from('events')
    .select('id, title, description, date, time, location, created_by')
    .eq('id', eventId)
    .single();
  if (eventErr) return NextResponse.json({ error: `Event not found: ${eventErr.message}` }, { status: 404 });
  if (!eventRow) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = eventRow;

  if (!isEmailConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Email provider not configured (RESEND_API_KEY missing)',
      sent: 0, failed: 0,
    });
  }

  const { data: recipientsRaw } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .eq('is_approved', true)
    .eq('is_bot', false)
    .not('email', 'is', null);
  const recipients = (recipientsRaw ?? []).filter((p): p is { id: string; email: string; full_name: string | null } => Boolean(p.email));
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, note: 'No residents with email' });
  }

  const hhmm = parseTimeString(event.time);
  const startUtc = hhmm ? istDateToUtc(event.date, hhmm) : null;
  const endUtc   = startUtc ? new Date(startUtc.getTime() + 2 * 60 * 60 * 1000) : null; // 2h default
  const hasSchedule = Boolean(startUtc && endUtc);

  const origin = req.headers.get('origin') || new URL(req.url).origin;
  const eventLink = `${origin}/dashboard/events`;

  const summary = { sent: 0, failed: 0, skipped: 0 };
  const CONCURRENCY = 5;
  let cursor = 0;

  async function worker() {
    while (cursor < recipients.length) {
      const i = cursor++;
      const r = recipients[i];
      const firstName = (r.full_name ?? 'Resident').split(' ')[0] || 'Resident';

      const attachments = hasSchedule
        ? [{
            filename: 'invite.ics',
            contentType: 'text/calendar; method=REQUEST; charset=utf-8',
            content: buildIcs({
              uid: `event-${event.id}@aaditri-emerland`,
              title: event.title,
              description: event.description ?? undefined,
              location: event.location,
              startUtc: startUtc!,
              endUtc: endUtc!,
              organizer: { name: 'Aaditri Emerland', email: 'noreply@aaditri-emerland.local' },
              attendee: { name: r.full_name ?? 'Resident', email: r.email },
              method: 'REQUEST',
            }),
          }]
        : undefined;

      const googleUrl = hasSchedule
        ? googleCalendarUrl({ title: event.title, description: event.description ?? undefined, location: event.location, startUtc: startUtc!, endUtc: endUtc! })
        : null;
      const outlookUrl = hasSchedule
        ? outlookCalendarUrl({ title: event.title, description: event.description ?? undefined, location: event.location, startUtc: startUtc!, endUtc: endUtc! })
        : null;

      const result = await sendEmail({
        to: r.email,
        subject: `📅 ${event.title} — ${event.date} at ${event.time}`,
        html: buildEventEmailHtml({
          firstName,
          title: event.title,
          description: event.description ?? undefined,
          dateLabel: `${event.date} at ${event.time}`,
          location: event.location,
          googleUrl, outlookUrl, eventLink, hasSchedule,
        }),
        text: buildEventEmailText({
          firstName,
          title: event.title,
          description: event.description ?? undefined,
          dateLabel: `${event.date} at ${event.time}`,
          location: event.location,
          eventLink,
        }),
        attachments,
      });

      if (result.ok) summary.sent += 1;
      else if ('skipped' in result && result.skipped) summary.skipped += 1;
      else summary.failed += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, recipients.length) }, () => worker()));

  return NextResponse.json({ ok: true, eventId, ...summary, hasSchedule });
}

function buildEventEmailHtml(p: {
  firstName: string; title: string; description?: string; dateLabel: string; location: string;
  googleUrl: string | null; outlookUrl: string | null; eventLink: string; hasSchedule: boolean;
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
        <div style="font-size:20px;font-weight:700;margin-top:4px">You're invited</div>
      </div>
      <div style="padding:22px 24px;color:#333;line-height:1.55;font-size:14px">
        <p style="margin:0 0 12px">Hi ${escapeHtml(p.firstName)},</p>
        <p style="margin:0 0 16px">A new community event has been scheduled. Save the date:</p>
        <div style="background:#F5F5F5;border-left:4px solid #1B5E20;border-radius:8px;padding:14px 16px;margin-bottom:16px">
          <div style="font-size:16px;font-weight:700;color:#1B5E20">${escapeHtml(p.title)}</div>
          <div style="margin-top:6px;color:#444">📅 ${escapeHtml(p.dateLabel)}</div>
          <div style="margin-top:2px;color:#444">📍 ${escapeHtml(p.location)}</div>
          ${p.description ? `<div style="margin-top:10px;color:#555;font-size:13px">${escapeHtml(p.description)}</div>` : ''}
        </div>
        ${p.hasSchedule
          ? `<p style="margin:0 0 4px;font-weight:600">Add to your calendar:</p><div>${ctas}</div>
             <p style="margin:14px 0 0;color:#888;font-size:12px">The attached <code>invite.ics</code> file works with Outlook, Apple Mail, and any standards-based calendar.</p>`
          : `<p style="margin:0;color:#b45309;font-size:13px">⚠️ We couldn't build an automatic calendar entry because the event time wasn't in a standard format. You can still find event details in the app.</p>`}
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0" />
        ${btnSecondary(p.eventLink, 'Open in app')}
      </div>
      <div style="padding:12px 24px;background:#FAFAFA;color:#999;font-size:12px;text-align:center">
        Sent by Aaditri Emerland Management · Please do not reply
      </div>
    </div>
  </div>`;
}

function buildEventEmailText(p: {
  firstName: string; title: string; description?: string; dateLabel: string; location: string; eventLink: string;
}): string {
  return [
    `Hi ${p.firstName},`,
    '',
    `A new community event has been scheduled: ${p.title}`,
    `When: ${p.dateLabel}`,
    `Where: ${p.location}`,
    p.description ? `\n${p.description}` : '',
    '',
    `Open in app: ${p.eventLink}`,
    '',
    '— Aaditri Emerland Management',
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
