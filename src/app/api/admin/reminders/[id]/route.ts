import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import type { ScheduledReminder } from '@/types';

// /api/admin/reminders/[id]
//
// PATCH  — edit a pending reminder. Allowed fields: title, body,
//          fire_on. Editing is only permitted while status='pending'
//          (so a 'sent' or 'cancelled' row is immutable). The intent
//          is to preserve audit history; if an admin wants to "edit"
//          a sent reminder, they should create a new one.
//
// DELETE — soft-cancel. Sets status='cancelled' and stamps
//          cancelled_at. The row stays in the table so admins can
//          see "yes, I cancelled this on Date X" in the Cancelled
//          tab. Hard-deleting would lose that paper trail.
//
// Both ops are admin-only and write an admin_audit_log row.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchPayload {
  title?: string;
  body?: string;
  fire_on?: string;
  send_until?: string | null;
}

const MAX_REPEAT_DAYS = 60;

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const f = new Date(fromIso + 'T00:00:00Z').getTime();
  const t = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((t - f) / (24 * 60 * 60 * 1000));
}

export async function PATCH(
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
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });

  if (existing.status !== 'pending') {
    return NextResponse.json(
      { error: `Only pending reminders can be edited (current status: ${existing.status}).` },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as PatchPayload;

  // Build a partial update. Only carry over fields that were
  // explicitly provided AND pass validation; anything missing is
  // preserved.
  const update: {
    title?: string;
    body?: string;
    fire_on?: string;
    send_until?: string | null;
    last_actor: string;
  } = { last_actor: auth.user.id };

  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (t.length < 1 || t.length > 120) {
      return NextResponse.json({ error: 'Title must be 1-120 characters.' }, { status: 400 });
    }
    update.title = t;
  }
  if (typeof body.body === 'string') {
    const b = body.body.trim();
    if (b.length < 1 || b.length > 1500) {
      return NextResponse.json({ error: 'Body must be 1-1500 characters.' }, { status: 400 });
    }
    update.body = b;
  }
  if (typeof body.fire_on === 'string') {
    const f = body.fire_on.trim();
    if (!isValidIsoDate(f)) {
      return NextResponse.json(
        { error: 'fire_on must be a YYYY-MM-DD date.' },
        { status: 400 },
      );
    }
    update.fire_on = f;
  }
  // send_until accepts null (revert to single-fire) or a YYYY-MM-DD.
  // Empty string is normalised to null so the form's "clear" gesture
  // doesn't have to special-case the absent field.
  if (body.send_until !== undefined) {
    if (body.send_until === null || body.send_until === '') {
      update.send_until = null;
    } else {
      const su = body.send_until.trim();
      if (!isValidIsoDate(su)) {
        return NextResponse.json(
          { error: 'send_until must be a YYYY-MM-DD date or null.' },
          { status: 400 },
        );
      }
      update.send_until = su;
    }
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json(
      { error: 'No editable fields provided.' },
      { status: 400 },
    );
  }

  // Validate the merged date pair (post-update). Either both
  // fields might be in the patch, or just one; either way we
  // need to check that the resulting row is consistent.
  const mergedFireOn = update.fire_on ?? (existing.fire_on as string);
  const mergedSendUntil =
    update.send_until !== undefined
      ? update.send_until
      : (existing.send_until as string | null);
  if (mergedSendUntil !== null) {
    if (mergedSendUntil < mergedFireOn) {
      return NextResponse.json(
        { error: 'send_until cannot be before fire_on.' },
        { status: 400 },
      );
    }
    const span = daysBetweenIsoDates(mergedFireOn, mergedSendUntil);
    if (span > MAX_REPEAT_DAYS) {
      return NextResponse.json(
        {
          error: `send_until is ${span} days after fire_on; the maximum is ${MAX_REPEAT_DAYS} days.`,
        },
        { status: 400 },
      );
    }
  }

  const { data: updated, error: updErr } = await adb
    .from('scheduled_reminders')
    .update(update)
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .single();
  if (updErr) {
    console.error('[admin/reminders] update failed', id, updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logAdminAction({
    actor: { id: auth.user.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'update',
    targetType: 'scheduled_reminder',
    targetId: id,
    targetLabel: `Reminder: ${(updated as ScheduledReminder).title}`,
    before: existing,
    after: updated,
    request: req,
  });

  return NextResponse.json({ reminder: updated as ScheduledReminder });
}

export async function DELETE(
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
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });

  if (existing.status !== 'pending') {
    return NextResponse.json(
      {
        error: `Only pending reminders can be cancelled (current status: ${existing.status}).`,
      },
      { status: 409 },
    );
  }

  const { data: cancelled, error: cancelErr } = await adb
    .from('scheduled_reminders')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      last_actor: auth.user.id,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .single();
  if (cancelErr) {
    console.error('[admin/reminders] cancel failed', id, cancelErr);
    return NextResponse.json({ error: cancelErr.message }, { status: 500 });
  }

  await logAdminAction({
    actor: { id: auth.user.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'update',
    targetType: 'scheduled_reminder',
    targetId: id,
    targetLabel: `Cancelled reminder: ${(cancelled as ScheduledReminder).title}`,
    before: existing,
    after: cancelled,
    request: req,
  });

  return NextResponse.json({ reminder: cancelled as ScheduledReminder });
}
