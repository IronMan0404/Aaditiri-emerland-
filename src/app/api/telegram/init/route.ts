import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { callTelegram, isTelegramConfigured } from '@/lib/telegram';

// ============================================================
// Admin-only one-shot to register the bot's webhook + commands.
//
// Run this AFTER deploying to Vercel (or against a public ngrok
// tunnel for local dev). Requires:
//
//   TELEGRAM_BOT_TOKEN       — from @BotFather
//   TELEGRAM_BOT_USERNAME    — bot username, no @
//   TELEGRAM_WEBHOOK_SECRET  — random string we round-trip with
//                              Telegram so it can prove inbound
//                              updates are really from them.
//                              Generate with `openssl rand -hex 32`.
//
// The endpoint:
//   1. Tells Telegram our webhook URL + secret.
//   2. Registers the slash-command list users see in the bot UI.
//
// Both are idempotent — re-running just refreshes the values.
//
// Auth: must be called by a logged-in admin. We rely on the same
// Supabase profile.role = 'admin' check we use everywhere else;
// no service-role key required because RLS already gates the
// profiles read.
// ============================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface InitBody {
  /** Override the auto-detected base URL (handy for ngrok). */
  baseUrl?: string;
}

function detectBaseUrl(req: Request, body: InitBody): string | null {
  if (body.baseUrl) return body.baseUrl.replace(/\/$/, '');
  // Vercel exposes VERCEL_URL without protocol; in production
  // NEXT_PUBLIC_APP_URL is set by AGENTS conventions. Either works.
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // Fallback: derive from the request itself. Won't work for
  // localhost \u2192 Telegram (Telegram can't reach localhost), but
  // makes the error message obvious.
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

async function requireAdmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') {
    return { ok: false, res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true };
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;

  if (!isTelegramConfigured()) {
    return NextResponse.json(
      {
        error:
          'TELEGRAM_BOT_TOKEN is not set. Add it to .env.local (and Vercel) before initialising the webhook.',
      },
      { status: 500 },
    );
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error:
          'TELEGRAM_WEBHOOK_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to env.',
      },
      { status: 500 },
    );
  }

  let body: InitBody = {};
  try {
    body = (await req.json()) as InitBody;
  } catch {
    body = {};
  }

  const baseUrl = detectBaseUrl(req, body);
  if (!baseUrl || baseUrl.startsWith('http://localhost')) {
    return NextResponse.json(
      {
        error:
          'Telegram cannot reach localhost. Deploy first (Vercel) or expose the dev server with ngrok and pass {"baseUrl":"https://your-ngrok-url"} in the request body.',
      },
      { status: 400 },
    );
  }

  const webhookUrl = `${baseUrl}/api/telegram/webhook`;

  // 1) Register the webhook with Telegram.
  const setHook = await callTelegram('setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    // Filter to just the update kinds we actually handle. Reduces
    // Telegram's outbound traffic and our cold-start cost.
    allowed_updates: ['message', 'edited_message', 'callback_query'],
    drop_pending_updates: false,
  });
  if (!setHook.ok) {
    return NextResponse.json(
      { error: 'setWebhook failed', detail: setHook.description },
      { status: 502 },
    );
  }

  // 2) Register the slash-command list shown in the bot UI.
  const setCmds = await callTelegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'Link this chat with your resident account' },
      { command: 'help', description: 'Show available commands' },
      { command: 'dues', description: 'Show your pending society dues' },
      { command: 'issue', description: 'Raise a maintenance ticket' },
      { command: 'cancel', description: 'Abort the current step' },
      { command: 'disconnect', description: 'Unlink this chat' },
    ],
  });

  // 3) Confirm by reading the current webhook config back.
  const info = await callTelegram<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
  }>('getWebhookInfo', {});

  return NextResponse.json({
    ok: true,
    webhook_url: webhookUrl,
    set_webhook: setHook.ok,
    set_my_commands: setCmds.ok,
    webhook_info: info.result ?? null,
  });
}

// Convenience GET — same body as POST but no admin write. Used by
// /admin/telegram to display current webhook status.
export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;

  if (!isTelegramConfigured()) {
    return NextResponse.json({ configured: false });
  }
  const info = await callTelegram<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
  }>('getWebhookInfo', {});
  return NextResponse.json({ configured: true, webhook_info: info.result ?? null, ok: info.ok });
}
