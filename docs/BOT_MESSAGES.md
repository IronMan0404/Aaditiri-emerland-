# Bot Messages

The "Bot Messages" feature lets an admin send a single message that is delivered, as **Aaditri Bot**, to every approved resident. Each recipient gets it in their personal inbox and (optionally) on WhatsApp.

## Where it lives in the UI

- Admin → `/admin/messages`: compose + send + history with per-message read stats.
- Resident → `/dashboard/messages`: chronological inbox with unread badges in the sidebar and bottom nav.

## Data model

Two tables in `supabase/schema.sql`:

| Table | Purpose |
|---|---|
| `public.bot_messages` | one row per message authored by an admin |
| `public.bot_message_recipients` | one row per recipient × message; tracks `read_at`, plus WhatsApp delivery status (`pending`/`sent`/`failed`/`skipped_*`) |

Row Level Security:

- Residents can read only **their own** recipient rows (and the message body it points at).
- Only admins can insert/delete bot messages and fan out recipients.

A user's profile carries `is_bot boolean` plus a partial-unique index `profiles_single_bot_idx` so at most one resident can be tagged as the bot at a time.

## How sending works

1. Admin types a message and hits **Send to all residents** on `/admin/messages`.
2. Browser POSTs to `/api/admin/messages/send`.
3. The API route:
   - Verifies the caller is an admin.
   - Loads every approved, non-bot profile.
   - Inserts a row in `bot_messages`, then bulk-inserts recipient rows.
   - For each recipient, calls MSG91 in parallel (concurrency 5) if WhatsApp is configured. Failures are logged in the recipient row's `whatsapp_status` + `whatsapp_error` so the admin can see what happened.

## How reading works

- Each `/dashboard/messages` page load fetches the user's `bot_message_recipients` rows.
- Tapping a row sets `read_at = now()` (optimistic UI). "Mark all read" sets it for every unread row in one update.
- The unread count badge in `Sidebar.tsx` and `MobileNav.tsx` polls every 30 seconds.

## How to tag a resident as the bot

`/admin/users` → edit a resident → toggle **Tag as Aaditri Bot**. Setting a new bot automatically clears any previous bot row before save (single-bot invariant). Tagging the bot is optional — without one, the system still works; bot messages just don't have a "sender profile" to point at and are labelled as "Aaditri Bot" in the inbox UI.

## Migration step

Re-run `supabase/schema.sql` in the SQL Editor whenever you pull this code for the first time. The schema is idempotent.
