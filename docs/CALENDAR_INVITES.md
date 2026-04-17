# Calendar invites

When an admin creates an event or approves a booking, the app emails an iCalendar invite so residents can add it to Google Calendar / Outlook / Apple Calendar in one click.

## When emails go out

| Trigger | Recipients | Subject line example |
|---|---|---|
| Admin creates an event on `/dashboard/events` | All approved residents with an email | `📅 Diwali Celebration — 2026-11-12 at 18:30` |
| Admin approves a booking on `/dashboard/bookings` | Just the booker | `✅ Booking approved: Clubhouse on 2026-04-20` |

Both are non-blocking with respect to the underlying action: if email fails, the event/booking is still created or approved. The admin sees a toast that explains what happened.

## Email contents

Each email contains:

- A friendly HTML body with the event/booking details.
- An **`.ics` attachment** (`invite.ics` / `booking.ics`) — recognized by Gmail, Outlook, Apple Mail, etc.
- Two **deep-link buttons**: "Add to Google Calendar" and "Add to Outlook" — one-tap on mobile.
- A "View in app" link back to the dashboard.

## Time-zone handling

Events and bookings store loosely-typed time strings (e.g. `"10:00 AM"` or `"18:30"`). `src/lib/ics.ts` parses them with `parseTimeString()` / `parseTimeRange()`, treats the wall-clock time as **IST (Asia/Kolkata)**, and converts to UTC for the `.ics` `DTSTART` / `DTEND` fields. If parsing fails, the email still goes out — just without an attached `.ics`.

Default event duration is **2 hours** (events don't store an end time today).

## Provider

Brevo. See [`BREVO_EMAIL.md`](./BREVO_EMAIL.md) for setup. The two API routes that send invites are:

- `POST /api/admin/events/invite`
- `POST /api/admin/bookings/[id]/approve`

Both run with the admin's session cookie + admin RLS check; no service-role key is used.

## Graceful degradation

If `BREVO_API_KEY` or `EMAIL_FROM_ADDRESS` is missing, `isEmailConfigured()` returns false and the API routes return `{ skipped: true }`. The admin toast says "Approved (email not configured)" — no error noise.
