# Brevo email setup

The app uses [Brevo](https://www.brevo.com) (formerly Sendinblue) for transactional email — calendar invites, booking confirmations.

## Why Brevo

- **Free tier: 300 emails/day forever**, no card.
- Works **without owning a domain** — verify a single Gmail-style sender via a click-through email.
- Decent deliverability to Indian inboxes.

For a community of ~100 flats, the free tier covers ~3 broadcasts/day, which is plenty.

## One-time setup

1. Sign up at https://www.brevo.com → choose the **Free** plan (no card).
2. Dashboard → **Settings** → **SMTP & API** → **API Keys** → **Generate a new API key**. Keys start with `xkeysib-`.
3. Dashboard → **Senders & IP** → **Senders** → **Add a sender**:
   - Name: `Aaditri Emerland`
   - Email: your Gmail (e.g. `youraddress@gmail.com`)
   - Brevo emails you a verification link → click it.

Without step 3, sends will be rejected because Brevo requires the `from` address to be a verified sender.

## Environment variables

Server-side only. Do NOT use a `NEXT_PUBLIC_` prefix.

| Variable | Required | Example |
|---|---|---|
| `BREVO_API_KEY` | yes | `xkeysib-abc...` |
| `EMAIL_FROM_ADDRESS` | yes | `youraddress@gmail.com` (must match a verified sender) |
| `EMAIL_FROM_NAME` | no | `Aaditri Emerland Community` (default) |

Add the same variables in Vercel → Project Settings → Environment Variables (all environments) and redeploy.

## Verify without sending

While signed in as admin in dev or production:

```
GET /api/_debug/email-status
```

Returns:

```json
{
  "configured": true,
  "from": "Aaditri Emerland Community <youraddress@gmail.com>",
  "keyFingerprint": "xkey…12",
  "hints": {
    "keyRawLength": 69,
    "keyTrimmedLength": 69,
    "keyHasLeadingOrTrailingWhitespace": false,
    "keyStartsWithXkeysib": true,
    "keyContainsQuotes": false,
    "fromAddressPresent": true,
    "fromAddressLooksLikeEmail": true
  }
}
```

The key value itself is **never** in the response — only a 4-char + 2-char fingerprint and structural hints. Safe to paste into chat or screenshots.

The endpoint at `src/app/api/_debug/email-status/route.ts` is admin-gated and safe to leave in production, but trim it out if you want a smaller surface area.

## Migrating to your own domain later

Once you own e.g. `aaditri-emerland.in`:

1. Brevo → **Senders & IP** → **Domains** → Add domain → follow Brevo's DNS instructions on your registrar (Cloudflare, Namecheap, etc.).
2. Change `EMAIL_FROM_ADDRESS` to `noreply@aaditri-emerland.in`.
3. Redeploy.

No code changes needed.

## Cost ceiling

Brevo's paid tier is ~$9/month for 20k emails. For a community of 200 flats with daily activity that's enough headroom; free tier suffices for a society under ~100 flats.
