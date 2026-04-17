# Changelog

All notable changes to this project are recorded here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project does not yet follow strict semver — versions are per-deploy snapshots.

## [Unreleased] — 2026-04-18

### Added

- **Bot Messages** — admin-only `/admin/messages` to broadcast a single message as "Aaditri Bot". Per-user inbox at `/dashboard/messages` with read receipts, unread badges in sidebar + bottom nav. New tables `bot_messages` + `bot_message_recipients`. New column `profiles.is_bot` with a single-bot DB constraint. See [`docs/BOT_MESSAGES.md`](./docs/BOT_MESSAGES.md).
- **Multiple vehicles per resident** — new `vehicles` table replacing the single `profiles.vehicle_number` column. Reusable `<VehiclesEditor>` used in registration, profile, and the admin user-edit modal. Backwards-compat: legacy column kept and one-time backfilled. See [`docs/VEHICLES.md`](./docs/VEHICLES.md).
- **Calendar invites via email** — admin event creation broadcasts `.ics` invites to all residents; admin booking approval emails the booker. Includes Google + Outlook one-click web links. New `src/lib/ics.ts` (RFC 5545) and `src/lib/email.ts` (Brevo). See [`docs/CALENDAR_INVITES.md`](./docs/CALENDAR_INVITES.md) and [`docs/BREVO_EMAIL.md`](./docs/BREVO_EMAIL.md).
- **WhatsApp delivery via MSG91** — bot messages also fan out as WhatsApp template messages. Per-resident `whatsapp_opt_in` toggle on the profile page. Per-message delivery stats on `/admin/messages`. See [`docs/MSG91_WHATSAPP.md`](./docs/MSG91_WHATSAPP.md).
- **Admin booking lifecycle** — admin can now revoke or reject already-approved bookings. Both require a typed reason; resident is auto-notified via the bot inbox. See [`docs/ADMIN_BOOKING_REVOKE.md`](./docs/ADMIN_BOOKING_REVOKE.md).
- **Photo background** — community photo (`public/community.webp`) used as a hero on the dashboard and as a backdrop on every `/auth/*` screen via the new `<AuthShell>` component.
- **Native date/time picker** on event creation (was free-text fields).
- **Admin debug endpoint** `GET /api/_debug/email-status` — verifies email config without leaking the key. See [`docs/BREVO_EMAIL.md`](./docs/BREVO_EMAIL.md).
- **`docs/`** folder with one markdown per major feature, plus a top-level `SECURITY.md` covering the secret-rotation runbook.

### Changed

- Email provider switched **from Resend to Brevo**. Resend's free tier requires a verified domain to send to anyone other than the account owner — Brevo's doesn't, fitting our zero-cost goal. The two API routes (`events/invite`, `bookings/[id]/approve`) keep the same contract; only `src/lib/email.ts` was rewritten.
- **Admin sidebar layout** — uses `h-screen` + `min-h-0` on the inner nav so Sign Out stays pinned at the bottom of the viewport. Was previously cut off at 100% Chrome zoom on small laptop screens.
- **Auth screens** unified visually via `<AuthShell>`.
- **`/admin/users`** edit form now manages vehicles via the editor; bot-tagging toggle added.
- **`profiles`** schema: `is_bot`, `whatsapp_opt_in` columns added (idempotent migrations).

### Removed

- `resend` npm package — replaced by direct HTTP calls to Brevo's REST API in `src/lib/email.ts`.

### Security

- Two earlier Resend keys exposed during setup were revoked. Rotation runbook documented in `SECURITY.md`.
- New server-only modules (`src/lib/email.ts`, `src/lib/msg91.ts`) use `import 'server-only'` so accidental client imports fail the build.
