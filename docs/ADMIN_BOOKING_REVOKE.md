# Admin: revoke / reject approved bookings

Admins can act on a booking after it's been approved.

## What the buttons do

| Status | Buttons available to admin | Outcome |
|---|---|---|
| `pending` | **Approve** / **Reject** | Approve emails the booker an `.ics`. Reject opens the reason modal. |
| `approved` | **Revoke** / **Reject** | Both open the reason modal. Revoke → status `cancelled`. Reject → status `rejected`. |
| `cancelled` / `rejected` | (none) | Terminal states. |

Both Revoke and Reject **require a typed reason** (max 500 chars). The Submit button stays disabled until there's text.

## What happens on submit

1. The booking's `status` flips to `cancelled` / `rejected`.
2. The reason is **appended** to `booking.notes` as an audit line:
   ```
   [Revoked by admin · 18 Apr 2026, 14:37] Clubhouse is under repair that day
   ```
3. The resident is **auto-notified via the Aaditri Bot inbox** (re-uses the bot-message system). They get a message like:
   > Your approved booking for *Clubhouse on 18 Apr 2026 (6:00 PM - 8:00 PM)* was revoked by the admin.
   >
   > Reason: *…*
   >
   > If this is a mistake, please contact the admin team.
4. If WhatsApp is configured (see [`MSG91_WHATSAPP.md`](./MSG91_WHATSAPP.md)), the resident also receives the message on WhatsApp.

The notification is a side-effect — if it fails, the status change still succeeds.

## Why no `.ics` cancellation?

Today we don't send a `METHOD:CANCEL` `.ics` when a booking is revoked. The resident sees the cancellation in the bot inbox and the in-app booking list. If you want the calendar entry to auto-disappear, we can extend `src/lib/ics.ts` to emit `METHOD:CANCEL` and have the approve API send a follow-up email. ~30 minutes of work.
