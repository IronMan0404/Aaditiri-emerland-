/**
 * RFC 5545 .ics calendar builder + "Add to Google/Outlook" web-link helpers.
 *
 * Pure functions, no dependencies. Safe to import from both server and client
 * (we currently only use it server-side from API routes).
 */

export interface CalendarInvite {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startUtc: Date;
  endUtc: Date;
  organizer?: { name: string; email: string };
  attendee?: { name: string; email: string };
  method?: 'REQUEST' | 'CANCEL' | 'PUBLISH';
  sequence?: number;
  /**
   * RFC 5545 STATUS field. Defaults to CONFIRMED.
   *
   * - TENTATIVE: Booking submitted but not yet approved. Most calendar
   *   apps render this with hatched/grey shading so the resident can
   *   see "this slot is being requested" without it overwriting a
   *   confirmed event in the same window.
   * - CONFIRMED: Booking approved.
   * - CANCELLED: Booking rejected/withdrawn. Combined with method=
   *   CANCEL and a bumped SEQUENCE, calendar apps will remove the
   *   event from the resident's calendar instead of leaving a stale
   *   tentative entry.
   */
  status?: 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';
}

/**
 * Parse the loosely-typed `time` strings this app stores on events/bookings
 * into a {hours, minutes} 24-hour pair. Handles formats we've seen in the wild:
 *   "10:00 AM", "10:00am", "18:30", "6:00 PM - 8:00 PM" (takes the first token)
 * Returns null when the input can't be parsed.
 */
export function parseTimeString(raw: string | null | undefined): { hours: number; minutes: number } | null {
  if (!raw) return null;
  const first = raw.split(/\s*[–-]\s*/)[0].trim();
  const m = first.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toUpperCase();
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { hours: h, minutes: mm };
}

/**
 * Parse a booking `time_slot` like "6:00 PM - 8:00 PM" into start+end.
 * Returns null if we can't find both sides.
 */
export function parseTimeRange(raw: string | null | undefined): {
  start: { hours: number; minutes: number };
  end:   { hours: number; minutes: number };
} | null {
  if (!raw) return null;
  const parts = raw.split(/\s*[–-]\s*/);
  if (parts.length < 2) return null;
  const start = parseTimeString(parts[0]);
  const end = parseTimeString(parts[1]);
  if (!start || !end) return null;
  return { start, end };
}

/**
 * Build a UTC Date from a `YYYY-MM-DD` date string and a {hours, minutes} pair,
 * interpreting the wall time in IST (UTC+05:30) since this is an Indian society
 * app. Returns null if the date string is invalid.
 *
 * Rationale: we don't store timezone info on events/bookings, but we know the
 * community is in India. Hard-coding IST beats guessing from the browser TZ
 * of the admin who created the event.
 */
export function istDateToUtc(dateStr: string, hhmm: { hours: number; minutes: number }): Date | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  // IST = UTC + 5:30. Subtract 5h30m to convert the wall time to UTC.
  const utcMs = Date.UTC(y, mo - 1, d, hhmm.hours, hhmm.minutes) - (5 * 60 + 30) * 60 * 1000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatIcsDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ in UTC
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Fold a long line to ≤75 octets as RFC 5545 requires.
 * Lines that exceed are split with CRLF + single-space continuation.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (i === 0) {
      chunks.push(line.slice(i, i + 75));
      i += 75;
    } else {
      chunks.push(' ' + line.slice(i, i + 74));
      i += 74;
    }
  }
  return chunks.join('\r\n');
}

/**
 * Build a valid .ics file body (CRLF line endings, as required by RFC 5545).
 */
export function buildIcs(invite: CalendarInvite): string {
  const method = invite.method ?? 'REQUEST';
  const seq = invite.sequence ?? 0;

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Aaditri Emerland//Community App//EN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push(`METHOD:${method}`);
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${invite.uid}`);
  lines.push(`DTSTAMP:${formatIcsDate(new Date())}`);
  lines.push(`DTSTART:${formatIcsDate(invite.startUtc)}`);
  lines.push(`DTEND:${formatIcsDate(invite.endUtc)}`);
  lines.push(`SUMMARY:${escapeIcsText(invite.title)}`);
  if (invite.description) lines.push(`DESCRIPTION:${escapeIcsText(invite.description)}`);
  if (invite.location)    lines.push(`LOCATION:${escapeIcsText(invite.location)}`);
  if (invite.organizer)   lines.push(`ORGANIZER;CN=${escapeIcsText(invite.organizer.name)}:mailto:${invite.organizer.email}`);
  if (invite.attendee) {
    lines.push(
      `ATTENDEE;CN=${escapeIcsText(invite.attendee.name)};RSVP=TRUE:mailto:${invite.attendee.email}`,
    );
  }
  lines.push(`SEQUENCE:${seq}`);
  lines.push(`STATUS:${invite.status ?? 'CONFIRMED'}`);
  // TRANSP:TRANSPARENT for tentative requests means "doesn't block
  // free/busy" — appropriate while we're waiting for an admin to
  // approve. CONFIRMED + CANCELLED both go OPAQUE so the slot is
  // honoured (or removed) properly.
  lines.push(`TRANSP:${invite.status === 'TENTATIVE' ? 'TRANSPARENT' : 'OPAQUE'}`);
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------- Booking-specific helpers ---------------------------------
//
// The booking flow needs the same ICS three times — once on submit
// (TENTATIVE, sequence 0), once on approve (CONFIRMED, sequence 1,
// method=REQUEST so calendar apps treat it as an UPDATE), once on
// reject (CANCELLED, sequence 2, method=CANCEL). Centralising the
// shape here means the three call sites can't drift.

export interface BookingInviteParams {
  bookingId: string;
  facility: string;
  date: string;
  timeSlot: string;
  notes?: string | null;
  resident: { name: string; email: string };
  /** Phase determines status / method / sequence. */
  phase: 'tentative' | 'confirmed' | 'cancelled';
}

export interface BookingInviteResult {
  /** Set when the time slot couldn't be parsed; carry on without ICS in that case. */
  schedulable: boolean;
  startUtc: Date | null;
  endUtc:   Date | null;
  ics:      string | null;
  filename: string;
  contentType: string;
  /** Stable UID that survives across phases so calendar apps de-dup. */
  uid: string;
  method: 'REQUEST' | 'CANCEL';
  status: 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';
  sequence: number;
}

const BOOKING_PHASE_DEFAULTS = {
  tentative: { method: 'REQUEST' as const, status: 'TENTATIVE' as const, sequence: 0 },
  confirmed: { method: 'REQUEST' as const, status: 'CONFIRMED' as const, sequence: 1 },
  cancelled: { method: 'CANCEL'  as const, status: 'CANCELLED' as const, sequence: 2 },
};

/**
 * Build the calendar-invite payload for a booking. Returns
 * `schedulable=false` when the time slot can't be parsed (ICS file
 * is null in that case; caller should send the email without
 * attachment + skip the "add to calendar" buttons).
 */
export function buildBookingInvite(p: BookingInviteParams): BookingInviteResult {
  const range = parseTimeRange(p.timeSlot);
  const startUtc = range ? istDateToUtc(p.date, range.start) : null;
  const endUtc   = range ? istDateToUtc(p.date, range.end)   : null;
  const schedulable = Boolean(startUtc && endUtc);
  const phase = BOOKING_PHASE_DEFAULTS[p.phase];

  // UID stays constant across phases so when the resident's calendar
  // sees the CONFIRMED message after the TENTATIVE one, it updates
  // the existing entry instead of duplicating.
  const uid = `booking-${p.bookingId}@aaditri-emerland`;

  const ics = schedulable
    ? buildIcs({
        uid,
        title: `${p.facility} — Booking`,
        description: p.notes ?? undefined,
        location: p.facility,
        startUtc: startUtc!,
        endUtc:   endUtc!,
        organizer: { name: 'Aaditri Emerland', email: 'noreply@aaditri-emerland.local' },
        attendee:  { name: p.resident.name, email: p.resident.email },
        method:   phase.method,
        status:   phase.status,
        sequence: phase.sequence,
      })
    : null;

  return {
    schedulable,
    startUtc,
    endUtc,
    ics,
    filename: 'booking.ics',
    // method=REQUEST/CANCEL is part of the calendar MIME type so the
    // mail client routes it through its calendar pipeline. Outlook in
    // particular needs this header to render the "Accept/Tentative/
    // Decline" pill.
    contentType: `text/calendar; method=${phase.method}; charset=utf-8`,
    uid,
    method:   phase.method,
    status:   phase.status,
    sequence: phase.sequence,
  };
}

/**
 * One-click "Add to Google Calendar" URL.
 */
export function googleCalendarUrl(invite: Pick<CalendarInvite, 'title' | 'description' | 'location' | 'startUtc' | 'endUtc'>): string {
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    );
  };
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: invite.title,
    dates: `${fmt(invite.startUtc)}/${fmt(invite.endUtc)}`,
  });
  if (invite.description) params.set('details', invite.description);
  if (invite.location)    params.set('location', invite.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * One-click "Add to Outlook (web)" URL. Works for personal and work Outlook.
 */
export function outlookCalendarUrl(invite: Pick<CalendarInvite, 'title' | 'description' | 'location' | 'startUtc' | 'endUtc'>): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: invite.title,
    startdt: invite.startUtc.toISOString(),
    enddt:   invite.endUtc.toISOString(),
  });
  if (invite.description) params.set('body', invite.description);
  if (invite.location)    params.set('location', invite.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
