import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { buildPairingDeepLink, isTelegramConfigured } from '@/lib/telegram';
import { consume } from '@/lib/rate-limit';

// ============================================================
// Telegram pairing endpoints (resident-driven).
//
//   GET    /api/telegram/pair
//     Returns the current link state for the calling user:
//       { linked: false }                        — never paired
//       { linked: true, username, linkedAt }     — paired and active
//       { linked: false, pending: { code, deepLink, expiresAt } }
//                                                 — pairing code outstanding
//
//   POST   /api/telegram/pair
//     Generates a fresh one-time pairing code (15-min TTL) and
//     returns it + the t.me deep-link the resident clicks. Replaces
//     any previous unconsumed code for the same user. Rate-limited
//     to 5 requests / 10 min / user so the table can't be spammed.
//
//   DELETE /api/telegram/pair
//     Unlinks the calling user's chat (deletes the telegram_links
//     row). The bot side is left intact — if the user types /start
//     in the bot again it'll just say "not linked".
//
// All three require an authenticated profile (any state — pending,
// approved, even bots-flagged are fine for the lookup endpoints).
// We don't expose chat_id or any cross-user data.
//
// Why approval is NOT required: a brand-new resident sitting on
// /auth/pending should be able to pair Telegram so the moment admin
// approves them, the approval push lands in their bot DM. Pairing
// is a binding between an auth user and a Telegram chat — it has
// nothing to do with whether the resident is allowed to read
// announcements or book the clubhouse, which is what is_approved
// controls. Forcing approval-before-pair just creates a chicken-
// and-egg cycle for password recovery in the unapproved state.
// ============================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 15-minute pairing window. Long enough that a user fumbling
// between Telegram and the app doesn't time out; short enough that
// a leaked code can't be exploited weeks later.
const PAIRING_TTL_MS = 15 * 60 * 1000;

interface AuthedUser {
  id: string;
  isApproved: boolean;
}

async function requireAuthedUser(): Promise<
  { ok: true; user: AuthedUser } | { ok: false; res: NextResponse }
> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, is_approved, is_bot')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'profile_not_found' }, { status: 404 }),
    };
  }
  // Bots are tagged `is_bot=true` and have no real human at the
  // other end. Block them from pairing — there's nothing to pair
  // them WITH. is_approved is intentionally NOT checked here.
  if (profile.is_bot) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'bot_account', message: 'Bot accounts cannot pair Telegram.' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user: { id: profile.id, isApproved: profile.is_approved } };
}

/**
 * Cryptographically random pairing code. Format: "AE-XXXX-XXXX"
 * using base32-friendly alphabet (no 0/O/1/I confusion). 8 random
 * chars from a 32-letter alphabet = 32^8 \u2248 10^12 codes \u2014 way more
 * than we'll ever issue, so collisions are vanishingly unlikely
 * even before the unique constraint catches them.
 */
function generatePairingCode(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i === 3) out += '-';
  }
  return `AE-${out}`;
}

// ============================================================
// GET — current pairing/link status
// ============================================================
export async function GET(): Promise<NextResponse> {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();

  // 1. Already linked?
  const { data: link } = await admin
    .from('telegram_links')
    .select('username, first_name, linked_at, is_active')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (link && link.is_active) {
    return NextResponse.json({
      linked: true,
      username: link.username ?? null,
      firstName: link.first_name ?? null,
      linkedAt: link.linked_at,
    });
  }

  // 2. Pending pairing code outstanding?
  const { data: pairing } = await admin
    .from('telegram_pairings')
    .select('code, expires_at, consumed_at')
    .eq('user_id', auth.user.id)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pairing) {
    return NextResponse.json({
      linked: false,
      pending: {
        code: pairing.code,
        deepLink: buildPairingDeepLink(pairing.code),
        expiresAt: pairing.expires_at,
      },
    });
  }

  return NextResponse.json({ linked: false });
}

// ============================================================
// POST — start a pairing flow
// ============================================================
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.res;

  if (!isTelegramConfigured()) {
    return NextResponse.json(
      { error: 'telegram_not_configured', message: 'Telegram bot is not configured on the server.' },
      { status: 503 },
    );
  }

  // Rate limit: per user, 5 requests / 10 min. We key by user_id
  // (not IP) so a shared corporate IP can't lock everyone out.
  // Slightly generous because a user fumbling re-pair attempts is
  // a real failure mode we shouldn't punish.
  void req;
  const rl = consume(`tg-pair:${auth.user.id}`, 5, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many pairing attempts. Try again in a few minutes.' },
      {
        status: 429,
        headers: { 'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  const admin = createAdminSupabaseClient();

  // Invalidate any prior unconsumed codes for this user, so the
  // resident only ever has at most one valid pending code.
  await admin
    .from('telegram_pairings')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', auth.user.id)
    .is('consumed_at', null);

  // Generate + insert with up to 3 retries on the (extremely rare)
  // unique-violation collision.
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  let code = '';
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    code = generatePairingCode();
    const { error } = await admin
      .from('telegram_pairings')
      .insert({ user_id: auth.user.id, code, expires_at: expiresAt });
    if (!error) {
      lastErr = null;
      break;
    }
    lastErr = error;
  }
  if (lastErr) {
    console.error('[telegram-pair] failed to insert pairing code', lastErr);
    return NextResponse.json(
      { error: 'pairing_insert_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    code,
    deepLink: buildPairingDeepLink(code),
    expiresAt,
  });
}

// ============================================================
// DELETE — unlink
// ============================================================
export async function DELETE(): Promise<NextResponse> {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from('telegram_links')
    .delete()
    .eq('user_id', auth.user.id);
  if (error) {
    return NextResponse.json({ error: 'unlink_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
