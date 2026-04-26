import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { notify } from '@/lib/notify';
import type { ScheduledReminder } from '@/types';

// /api/admin/reminders/[id]/fire-now
//
// POST — manually dispatch a reminder right now without waiting for
// the daily cron. Useful for:
//
//   - testing the pipeline end-to-end before scheduling a real one;
//   - re-firing a 'failed' reminder after fixing the upstream cause;
//   - last-minute reminders ("we need to send this in 10 minutes,
//     not tomorrow morning").
//
// Allowed when status is 'pending' or 'failed'. Sent or cancelled
// reminders are immutable. On success the row flips to 'sent' and
// fired_count is bumped so the audit trail reflects re-fires.
//
// Note for repeating reminders (send_until set): "Send now" is
// treated as a TERMINAL fire — we end the schedule. If the admin
// wanted "fire today AND continue tomorrow", they should just wait
// for the daily cron, or fire-now and immediately schedule a fresh
// row for the remaining days. We make this explicit in the UI
// prompt rather than silently treating Send-Now as just-today.
// last_fired_on is stamped so the cron doesn't double-fire today.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Reminder id required' }, { status: 400 });

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const adb = createAdminSupabaseClient();
  const { data: existing, error: fetchErr } = await adb
    .from('scheduled_reminders')
    .select('*, profiles:created_by(full_name)')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });

  if (existing.status !== 'pending' && existing.status !== 'failed') {
    return NextResponse.json(
      {
        error: `Reminder is already ${existing.status}; only pending or failed reminders can be fired now.`,
      },
      { status: 409 },
    );
  }

  // Resolve the sender name — prefer the original creator's profile
  // (so the message is attributed correctly even when a different
  // admin clicks "fire now"). Fall back to the firing admin if the
  // creator was deleted, then to the system label inside the renderer.
  const creatorProfile = (existing as unknown as {
    profiles?: { full_name?: string | null } | null;
  }).profiles;
  const senderName: string | null =
    creatorProfile?.full_name ?? auth.profile.full_name ?? null;

  // Use the same per-day dedup key shape the cron uses, so a
  // fire-now invocation after a cron run on the same day doesn't
  // re-deliver via telegram (notify()'s ledger blocks the second
  // attempt). Conversely, a fresh-day fire-now creates a new
  // ledger row and re-delivers correctly.
  const offsetMs = (5 * 60 + 30) * 60 * 1000;
  const todayIst = new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
  const dedupRefId = `${existing.id}:${todayIst}`;

  try {
    await notify('scheduled_reminder', dedupRefId, {
      reminderId: existing.id,
      title: existing.title,
      body: existing.body,
      senderName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/reminders/fire-now] notify failed', id, msg);

    await adb
      .from('scheduled_reminders')
      .update({
        status: 'failed',
        fired_count: (existing.fired_count ?? 0) + 1,
        error_message: msg.slice(0, 500),
        last_actor: auth.user.id,
      })
      .eq('id', id);

    return NextResponse.json(
      { error: 'Dispatch failed.', details: msg.slice(0, 500) },
      { status: 502 },
    );
  }

  const { data: updated, error: updErr } = await adb
    .from('scheduled_reminders')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      last_fired_on: todayIst,
      fired_count: (existing.fired_count ?? 0) + 1,
      error_message: null,
      last_actor: auth.user.id,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updErr) {
    console.error('[admin/reminders/fire-now] update failed', id, updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logAdminAction({
    actor: { id: auth.user.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'update',
    targetType: 'scheduled_reminder',
    targetId: id,
    targetLabel: `Fired now: ${(updated as ScheduledReminder).title}`,
    before: existing,
    after: updated,
    request: req,
  });

  return NextResponse.json({
    ok: true,
    reminder: updated as ScheduledReminder,
  });
}
