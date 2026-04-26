import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { isWhatsAppConfigured, sendWhatsAppTemplate } from '@/lib/msg91';
import { notify } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_LENGTH = 2000;

interface Recipient {
  id: string;
  full_name: string | null;
  phone: string | null;
  whatsapp_opt_in: boolean | null;
}

export async function POST(req: Request) {
  let payload: unknown;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const body = (payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {});
  const rawMessage = typeof body.body === 'string' ? body.body : '';
  const message = rawMessage.trim();

  if (!message) return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
  if (message.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: `Message is too long (max ${MAX_BODY_LENGTH} chars)` }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me, error: meError } = await supabase
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', user.id)
    .single();
  if (meError || !me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { data: recipientsRaw, error: recipientsError } = await supabase
    .from('profiles')
    .select('id, full_name, phone, whatsapp_opt_in')
    .eq('is_approved', true)
    .eq('is_bot', false);
  if (recipientsError) {
    return NextResponse.json({ error: `Couldn't load recipients: ${recipientsError.message}` }, { status: 500 });
  }
  const recipients = (recipientsRaw ?? []) as Recipient[];
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No approved residents to send to' }, { status: 400 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('bot_messages')
    .insert({ body: message, authored_by: me.id })
    .select('id')
    .single();
  if (insertError || !inserted) {
    return NextResponse.json({ error: `Couldn't create message: ${insertError?.message ?? 'unknown'}` }, { status: 500 });
  }

  const messageId = inserted.id;

  const rows = recipients.map((r) => ({
    message_id: messageId,
    user_id: r.id,
    whatsapp_status: isWhatsAppConfigured() ? 'pending' : 'skipped_disabled',
  }));
  const { data: recipientRows, error: fanoutError } = await supabase
    .from('bot_message_recipients')
    .insert(rows)
    .select('id, user_id');
  if (fanoutError) {
    await supabase.from('bot_messages').delete().eq('id', messageId);
    return NextResponse.json({ error: `Couldn't fan out: ${fanoutError.message}` }, { status: 500 });
  }

  const recipientRowById = new Map<string, string>();
  (recipientRows ?? []).forEach((r) => recipientRowById.set(r.user_id, r.id));

  const summary = { sent: 0, failed: 0, skipped: 0, disabled: !isWhatsAppConfigured() };

  if (isWhatsAppConfigured()) {
    const CONCURRENCY = 5;
    let cursor = 0;

    async function worker() {
      while (cursor < recipients.length) {
        const i = cursor++;
        const recipient = recipients[i];
        const rowId = recipientRowById.get(recipient.id);
        if (!rowId) continue;

        const firstName = (recipient.full_name ?? 'Resident').split(' ')[0] || 'Resident';
        const optedIn = recipient.whatsapp_opt_in !== false;

        const result = await sendWhatsAppTemplate({
          toPhone: recipient.phone,
          optedIn,
          components: [firstName, message],
        });

        if (result.ok) {
          summary.sent += 1;
          await supabase
            .from('bot_message_recipients')
            .update({
              whatsapp_status: 'sent',
              whatsapp_message_id: result.messageId,
              whatsapp_sent_at: new Date().toISOString(),
              whatsapp_error: null,
            })
            .eq('id', rowId);
        } else if (result.skipped) {
          summary.skipped += 1;
          await supabase
            .from('bot_message_recipients')
            .update({ whatsapp_status: result.reason })
            .eq('id', rowId);
        } else {
          summary.failed += 1;
          await supabase
            .from('bot_message_recipients')
            .update({
              whatsapp_status: 'failed',
              whatsapp_error: result.error.slice(0, 500),
            })
            .eq('id', rowId);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, recipients.length) }, () => worker()));
  }

  // Push + Telegram DM each recipient with the same message body so
  // residents who haven't opted into WhatsApp still receive it. The
  // dispatcher's per-user dedup ledger keeps a single row per
  // (kind, dedup-key, user) so retries are safe.
  //
  // We `await Promise.allSettled` rather than fire-and-forget because
  // the previous fire-and-forget pattern was vulnerable to Vercel's
  // serverless function lifecycle: when the response flushes, any
  // promise that hasn't settled yet may be cancelled before the push
  // / Telegram fetches resolve, silently dropping notifications for
  // some recipients. Awaiting here costs the admin a few hundred ms
  // on the request but guarantees delivery completion.
  //
  // TODO(scaling): once recipients > ~200 the request budget gets
  // tight. Migrate to Vercel's `waitUntil()` (next/after) when this
  // fan-out grows, or move the dispatch to a queue (Inngest, QStash,
  // Supabase pg_cron). Until then, awaiting is the correct trade-off.
  // Pass the composing admin's full_name so residents see "From
  // <Admin Name>" instead of an anonymous "New message". Falls back
  // to the system label inside the renderer if `me.full_name` is
  // somehow blank.
  const senderName = me.full_name ?? null;
  await Promise.allSettled(
    recipients.map((recipient) =>
      notify('direct_message_received', `${messageId}:${recipient.id}`, {
        messageId,
        recipientId: recipient.id,
        preview: message,
        senderName,
      }),
    ),
  );

  return NextResponse.json({
    ok: true,
    messageId,
    recipientCount: recipients.length,
    whatsapp: summary,
  });
}
