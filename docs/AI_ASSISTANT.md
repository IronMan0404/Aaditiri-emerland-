# AI Assistant

The Aaditri Emerland app ships a community AI assistant that residents can use
to ask questions, summarise activity, and (with confirmation) **draft writes**
on their behalf — submit a booking, raise an issue.

- `GET /api/ai/assistant` — status/config probe
- `POST /api/ai/assistant` — chat turn (model + tool-call loop)
- `POST /api/ai/confirm` — execute an AI-drafted action after user taps Confirm
- `GET /dashboard/assistant` — resident UI

## Provider

The assistant is provider-agnostic. Set these env vars to enable it:

```bash
AI_PROVIDER=groq           # or: openai | gemini
AI_API_KEY=<provider key>
AI_MODEL=<optional override>
```

| Provider | Default model | Free-tier key | Tool-calling |
|---|---|---|---|
| `groq`   | `llama-3.1-8b-instant` | <https://console.groq.com/keys> | ✅ |
| `openai` | `gpt-4o-mini`          | <https://platform.openai.com>   | ✅ |
| `gemini` | `gemini-2.0-flash`     | <https://aistudio.google.com/app/apikey> | ❌ (chat only) |

> **Tool-calling is supported only on Groq and OpenAI.** Gemini's tool-call wire
> format is different enough that we haven't wired it in yet — if you set
> `AI_PROVIDER=gemini` the assistant works for plain Q&A but cannot draft
> bookings or issues. Use Groq if you want the full feature set; it is free
> and reliable in India.

If `AI_PROVIDER` is missing or `AI_API_KEY` is blank the route returns 503
with a clear "not configured" message, and the chat UI renders a graceful
fallback hint.

## Tool-calling: what the AI can and cannot do

The assistant is **create-only** for writes. There is no update tool, no
delete tool, and the registry of write tools cannot be extended at runtime
without a code change.

### Read tools (run server-side immediately)

| Tool | Purpose |
|---|---|
| `list_facilities` | Returns active clubhouse facilities (name, slug, requires_subscription). |
| `list_my_subscription` | Returns the resident's active tier + included facilities. |
| `list_my_bookings` | Latest 10 bookings for the caller. |
| `list_my_issues` | Latest 10 issues raised by the caller. |

Read tools execute on the server with the resident's session-bound Supabase
client, so RLS protects access. The model receives the JSON output as the
next turn and uses it to ground its reply (e.g. picking a real facility name
before drafting a booking).

### Write tools (drafted, never executed automatically)

| Tool | Effect |
|---|---|
| `create_booking` | Drafts a `bookings` row (facility/date/time_slot/notes). |
| `create_issue`   | Drafts an `issues` row (title/description/category/priority). |

When the model calls a write tool, the route does **not** execute the write.
Instead it:

1. Validates the arguments (date format, length limits, enum values, etc.).
2. Mints a short-lived HMAC-signed token (5-minute TTL) capturing the
   action kind, args, user id, and expiry.
3. Returns the token + a human-readable summary as a `pending_action` to
   the chat UI.
4. The UI renders an inline **Confirm / Cancel** card.
5. Only when the user taps **Confirm** does the UI POST the token to
   `/api/ai/confirm`, which re-validates everything and then performs the
   actual insert through the same paths a manual user would (subscription
   gate, RLS, notifications, calendar invite email).

This is the core safety guarantee: **the AI cannot submit a booking or
raise an issue on its own**. A human always taps Confirm.

## Required env vars

| Var | Purpose | Required? |
|---|---|---|
| `AI_PROVIDER` | `groq` / `openai` / `gemini` / `none` | yes (else assistant returns 503) |
| `AI_API_KEY`  | provider API key | yes if `AI_PROVIDER ≠ none` |
| `AI_MODEL`    | model override | optional |
| `AI_TOOLS_SECRET` | HMAC key for signing pending-action tokens | yes if you want write tools to work |

If `AI_TOOLS_SECRET` is unset the assistant falls back to `CLUBHOUSE_PASS_SECRET`
(installs that have already minted one don't need a new secret). Generate
with:

```bash
openssl rand -base64 32
```

Tokens are bound to (user id, expiry, args), so a leaked token is useless
once it expires or once the targeted user logs out.

## Limits

- Per-user request limit: 20 chat turns / 10 minutes.
- Per-user confirm limit: 30 confirms / 10 minutes.
- Max tool-call rounds per turn: 4. (List facilities → check sub → draft →
  reply is enough for 99% of flows.)
- Max message size: 2000 chars. Last 8 turns of history are sent for context.

## Migrating existing setups

Old installs may still have `AI_OLLAMA_BASE_URL` / `AI_OLLAMA_MODEL` env vars
in `.env.local`. They are no longer read; remove them and add the three
provider vars above. Local Ollama is not supported on Vercel and the
in-app references have been removed.
