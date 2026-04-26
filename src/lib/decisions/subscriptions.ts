import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { notifyAfter } from '@/lib/notify';
import type { DecisionActor, DecisionResult } from '@/lib/decisions/registrations';

// ============================================================
// Shared clubhouse-subscription decision helpers.
//
// Mirrors src/lib/decisions/registrations.ts. Both the
// /api/admin/clubhouse/subscriptions/[id]/{approve,reject} routes
// and the Telegram callback runner go through these so audit log,
// race-checking, date computation, and notify() dispatch live in
// exactly one place.
// ============================================================

const ALLOWED_MONTHS = new Set([1, 3, 6, 12]);

interface SubscriptionRow {
  id: string;
  flat_number: string;
  primary_user_id: string;
  tier_id: string;
  status: string;
  requested_months: number | null;
  clubhouse_tiers: { name?: string | null } | null;
}

async function readSubscription(id: string): Promise<SubscriptionRow | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('clubhouse_subscriptions')
    .select(
      'id, flat_number, primary_user_id, tier_id, status, requested_months, clubhouse_tiers(name)',
    )
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as unknown as SubscriptionRow | null;
}

// "What" line for Telegram disabled-button footer. Always self-contained so
// co-admins reading the chat later can see what was decided without opening
// the row.
function describeSubscription(row: SubscriptionRow, monthsHint?: number): string {
  const tier = row.clubhouse_tiers?.name ?? 'Tier';
  const months = monthsHint ?? row.requested_months;
  const monthsText = months ? `${months} mo · ` : '';
  return `${tier} · ${monthsText}Flat ${row.flat_number}`;
}

export interface ApproveSubscriptionOptions {
  startDate?: string;
  monthsOverride?: number;
}

export async function approveSubscription(
  subscriptionId: string,
  actor: DecisionActor,
  options: ApproveSubscriptionOptions = {},
): Promise<DecisionResult> {
  const sub = await readSubscription(subscriptionId);
  if (!sub) return { ok: false, status: 'failed', label: 'Subscription not found' };
  if (sub.status !== 'pending_approval') {
    return { ok: false, status: 'failed', label: `Cannot approve a ${sub.status} subscription` };
  }

  const months = Number(options.monthsOverride ?? sub.requested_months ?? 1);
  if (!ALLOWED_MONTHS.has(months)) {
    return { ok: false, status: 'failed', label: 'months must be one of 1, 3, 6, 12' };
  }

  const startStr = (options.startDate ?? '').trim() || new Date().toISOString().slice(0, 10);
  const start = new Date(`${startStr}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, status: 'failed', label: 'start_date must be YYYY-MM-DD' };
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  const endStr = end.toISOString().slice(0, 10);

  const admin = createAdminSupabaseClient();

  // Race-check: any other active sub for this flat?
  const { data: clash } = await admin
    .from('clubhouse_subscriptions')
    .select('id')
    .eq('flat_number', sub.flat_number)
    .eq('status', 'active')
    .neq('id', sub.id)
    .maybeSingle();
  if (clash) {
    return {
      ok: false,
      status: 'failed',
      label: `Flat ${sub.flat_number} already has an active subscription`,
    };
  }

  const { error: updErr } = await admin
    .from('clubhouse_subscriptions')
    .update({
      status: 'active',
      start_date: startStr,
      end_date: endStr,
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', sub.id);
  if (updErr) {
    return { ok: false, status: 'failed', label: 'Update failed', error: updErr.message };
  }

  const tierName = sub.clubhouse_tiers?.name ?? 'Tier';
  await logAdminAction({
    actor: { id: actor.id, email: actor.email, name: actor.fullName },
    action: 'update',
    targetType: 'clubhouse_subscription',
    targetId: sub.id,
    targetLabel: `Flat ${sub.flat_number} - ${tierName}${
      actor.via === 'telegram' ? ' (via Telegram)' : ''
    }`,
    reason: `Approved (${months}mo: ${startStr} -> ${endStr})`,
    before: sub as unknown as Record<string, unknown>,
    after: { status: 'active', start_date: startStr, end_date: endStr, approved_by: actor.id },
    request: actor.request,
  });

  notifyAfter('subscription_decided', sub.id, {
    subscriptionId: sub.id,
    requesterId: sub.primary_user_id,
    approved: true,
  });

  return {
    ok: true,
    status: 'approved',
    label: `Approved subscription ${describeSubscription(sub, months)} — by ${actor.fullName ?? 'admin'}`,
  };
}

export async function rejectSubscription(
  subscriptionId: string,
  reason: string,
  actor: DecisionActor,
): Promise<DecisionResult> {
  const cleanReason = (reason ?? '').trim();
  if (!cleanReason) {
    return { ok: false, status: 'failed', label: 'Reason required' };
  }
  if (cleanReason.length > 500) {
    return { ok: false, status: 'failed', label: 'Reason must be 500 chars or fewer' };
  }

  const sub = await readSubscription(subscriptionId);
  if (!sub) return { ok: false, status: 'failed', label: 'Subscription not found' };
  if (sub.status !== 'pending_approval') {
    return { ok: false, status: 'failed', label: `Cannot reject a ${sub.status} subscription` };
  }

  const admin = createAdminSupabaseClient();
  const { error: updErr } = await admin
    .from('clubhouse_subscriptions')
    .update({
      status: 'rejected',
      rejected_reason: cleanReason,
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', sub.id);
  if (updErr) {
    return { ok: false, status: 'failed', label: 'Update failed', error: updErr.message };
  }

  const tierName = sub.clubhouse_tiers?.name ?? 'Tier';
  await logAdminAction({
    actor: { id: actor.id, email: actor.email, name: actor.fullName },
    action: 'update',
    targetType: 'clubhouse_subscription',
    targetId: sub.id,
    targetLabel: `Flat ${sub.flat_number} - ${tierName}${
      actor.via === 'telegram' ? ' (via Telegram)' : ''
    }`,
    reason: `Rejected: ${cleanReason}`,
    before: sub as unknown as Record<string, unknown>,
    after: { status: 'rejected', rejected_reason: cleanReason },
    request: actor.request,
  });

  notifyAfter('subscription_decided', sub.id, {
    subscriptionId: sub.id,
    requesterId: sub.primary_user_id,
    approved: false,
    rejectedReason: cleanReason,
  });

  return {
    ok: true,
    status: 'rejected',
    label: `Rejected subscription ${describeSubscription(sub)} — by ${actor.fullName ?? 'admin'}`,
  };
}
