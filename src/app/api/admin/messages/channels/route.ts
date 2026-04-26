import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { isWhatsAppConfigured } from '@/lib/msg91';
import { isTelegramConfigured } from '@/lib/telegram';

// ============================================================
// GET /api/admin/messages/channels
//
// Returns which side-channels (beyond the in-app inbox) are wired
// up for bot messages. The /admin/messages page reads this on mount
// to render an honest "WhatsApp: not configured / Telegram: enabled"
// pair under each sent message instead of guessing from the saved
// recipient rows.
//
// Why a route and not a client read of NEXT_PUBLIC_*:
//   * The Telegram + MSG91 API keys are server-only (TELEGRAM_BOT_TOKEN,
//     MSG91_AUTHKEY). We don't want to expose them as NEXT_PUBLIC_*
//     just to render a badge.
//   * Letting the server decide also means we can later add a
//     "configured AND at least one paired chat" check without
//     touching the UI.
//
// Auth: admin only — same gate as the other /api/admin/messages
// routes. A non-admin client has no business knowing our channel
// inventory.
// ============================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { data: me } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  return NextResponse.json({
    inApp: true,
    whatsapp: isWhatsAppConfigured(),
    telegram: isTelegramConfigured(),
  });
}
