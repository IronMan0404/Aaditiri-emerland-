# AI Assistant (100% Free, Local)

This project now includes a community AI assistant at:

- `GET /api/ai/assistant` (status/config)
- `POST /api/ai/assistant` (chat)
- `GET /dashboard/assistant` (resident UI)

The default provider is **Ollama** running locally, so there are no per-request API costs.

## What it helps with

- Booking help (facility/date/time draft suggestions)
- Weekly activity/report summaries
- Issue-report drafting
- General community Q&A grounded in app data

The API pulls recent context from Supabase using the signed-in user session:

- announcements
- broadcasts
- upcoming events
- my bookings
- my issues

## Setup (local)

1. Install Ollama:
   - [https://ollama.com/download](https://ollama.com/download)
2. Start Ollama:
   - `ollama serve`
3. Pull a free model (recommended default):
   - `ollama pull llama3.2:3b`
4. Run the app:
   - `npm run dev`

Then open `/dashboard/assistant`.

## Optional env vars

If omitted, sane defaults are used.

```bash
AI_OLLAMA_BASE_URL=http://127.0.0.1:11434
AI_OLLAMA_MODEL=llama3.2:3b
```

## Recommended free Llama models

- `llama3.2:3b` - fastest on laptops, good baseline
- `llama3.1:8b` - better quality, heavier RAM/CPU use

Example switch:

```bash
ollama pull llama3.1:8b
# then set:
AI_OLLAMA_MODEL=llama3.1:8b
```

## Notes

- The route has auth + rate limiting.
- If Ollama is not running, the assistant returns a clear setup error.
- Because this is local inference, speed depends on your machine.

