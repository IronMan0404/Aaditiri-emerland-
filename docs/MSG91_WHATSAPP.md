# MSG91 WhatsApp setup

The bot-message feature can also deliver each message as a WhatsApp template via [MSG91](https://msg91.com). Optional — if the env vars below are missing, sends silently degrade to in-app inbox only.

## One-time setup (real-world: 1–3 days, mostly waiting on Meta)

1. Sign up at https://msg91.com.
2. **WhatsApp** → connect a **WhatsApp Business number**. MSG91 walks you through Meta Business verification.
3. **WhatsApp → Templates** → submit a UTILITY template named `society_broadcast`:
   - Language: `en`
   - Body:
     ```
     Hello {{1}},

     A message from Aaditri Emerland management:

     {{2}}

     — Aaditri Bot
     ```
4. Copy your **Auth Key** from **Panel → API**.

## Environment variables

| Variable | Required | Example |
|---|---|---|
| `MSG91_AUTH_KEY` | yes | `464...xyz` |
| `MSG91_WHATSAPP_INTEGRATED_NUMBER` | yes | `919999999999` (E.164, digits-only, no `+`) |
| `MSG91_WHATSAPP_TEMPLATE_NAME` | yes | `society_broadcast` |
| `MSG91_WHATSAPP_LANGUAGE` | no | `en` |
| `MSG91_WHATSAPP_DEFAULT_COUNTRY_CODE` | no | `91` (prepended to 10-digit numbers) |

Server-side only. Add to Vercel env vars too.

## Per-resident opt-in

`profiles.whatsapp_opt_in boolean` defaults to `true`. Residents toggle it on `/dashboard/profile`. Opted-out recipients get `whatsapp_status = 'skipped_opt_out'`.

## How sending works

`POST /api/admin/messages/send` runs the bot-message fan-out, then for each recipient calls `sendWhatsAppTemplate()` (`src/lib/msg91.ts`) with `{ firstName, body }` as the two template variables. Concurrency 5. Results written to `bot_message_recipients.whatsapp_status` (one of `sent`, `failed`, `skipped_no_phone`, `skipped_opt_out`, `skipped_disabled`) so the admin sees per-message delivery stats on `/admin/messages`.

## Cost

UTILITY WhatsApp templates in India are ~₹0.10–0.40 per message at typical volumes. A broadcast to 100 residents is ~₹10–40.

## Failure modes

- **Template not approved** → `failed` with the Meta error in `whatsapp_error`.
- **Bad phone format** → `skipped_no_phone`. Phone normalisation is in `normalizePhone()` (`src/lib/msg91.ts`).
- **Resident opted out** → `skipped_opt_out`.
- **Env var missing** → `skipped_disabled` for everyone; the in-app inbox still works.

## Future webhook

MSG91 can push delivery/read receipts via webhook. Not wired yet — `whatsapp_status` only goes to `sent` when MSG91 accepts the payload. To extend: add `POST /api/webhooks/msg91/route.ts` and update `bot_message_recipients` rows by `whatsapp_message_id`.
