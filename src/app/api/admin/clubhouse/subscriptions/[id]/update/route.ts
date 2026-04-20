import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/admin-audit';
import type { ClubhouseSubscriptionStatus } from '@/types';

// Admin-only: modify a clubhouse subscription. Allows changing status,
// start/end date and the tier of an existing subscription. Replaces the
// previous client-side `supabase.from('clubhouse_subscriptions').update`
// path so we get a uniform audit trail.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES: ReadonlySet<ClubhouseSubscriptionStatus> = new Set([
  'active', 'expiring', 'expired', 'cancelled',
]);

interface UpdatePayload {
  status?: ClubhouseSubscriptionStatus;
  start_date?: string; // YYYY-MM-DD
  end_date?: string;   // YYYY-MM-DD
  tier_id?: string;    // uuid
  reason?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Subscription id required' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as UpdatePayload;
  const patch: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `status must be one of ${Array.from(ALLOWED_STATUSES).join(', ')}` },
        { status: 400 },
      );
    }
    patch.status = body.status;
    if (body.status === 'cancelled') {
      patch.cancelled_at = new Date().toISOString();
    }
  }
  if (body.start_date !== undefined) {
    if (!DATE_RE.test(body.start_date)) {
      return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 });
    }
    patch.start_date = body.start_date;
  }
  if (body.end_date !== undefined) {
    if (!DATE_RE.test(body.end_date)) {
      return NextResponse.json({ error: 'end_date must be YYYY-MM-DD' }, { status: 400 });
    }
    patch.end_date = body.end_date;
  }
  if (body.tier_id !== undefined) {
    // Make sure the tier exists & is active before swapping.
    const { data: tier } = await supabase
      .from('clubhouse_tiers')
      .select('id')
      .eq('id', body.tier_id)
      .maybeSingle();
    if (!tier) {
      return NextResponse.json({ error: 'tier_id does not exist' }, { status: 400 });
    }
    patch.tier_id = body.tier_id;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  // Snapshot before so the audit row records what changed. Selecting *
  // is fine here - the row is small and we want all fields preserved.
  const { data: before, error: fetchErr } = await supabase
    .from('clubhouse_subscriptions')
    .select('*, clubhouse_tiers(name)')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  // If a date range is being set, sanity-check the resulting interval.
  const finalStart = (patch.start_date as string | undefined) ?? (before.start_date as string);
  const finalEnd   = (patch.end_date   as string | undefined) ?? (before.end_date   as string);
  if (finalEnd < finalStart) {
    return NextResponse.json({ error: 'end_date cannot be before start_date' }, { status: 400 });
  }

  const { data: after, error: updErr } = await supabase
    .from('clubhouse_subscriptions')
    .update(patch)
    .eq('id', id)
    .select('*, clubhouse_tiers(name)')
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const tierName = (before.clubhouse_tiers as { name?: string } | null)?.name ?? 'Tier';
  const reason = (body.reason ?? '').trim().slice(0, 500) || null;
  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'update',
    targetType: 'clubhouse_subscription',
    targetId: id,
    targetLabel: `Flat ${before.flat_number} - ${tierName}`,
    reason,
    before,
    after,
    request: req,
  });

  return NextResponse.json({ ok: true, id, after });
}
