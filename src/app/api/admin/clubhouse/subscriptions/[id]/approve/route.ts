import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { sendPushToUsers } from '@/lib/push';
import { logAdminAction } from '@/lib/admin-audit';

// Admin-only: approve a pending clubhouse subscription request.
// Computes start_date = today (or admin override) and end_date =
// start_date + requested_months months, then flips status='active'.
//
// We re-check that no OTHER active subscription exists for the
// flat before flipping (race window between the resident's
// request and an admin manually adding a sub). If another active
// sub exists, the partial unique index will reject the update;
// we surface that as a clean 409.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApprovePayload {
  start_date?: string; // YYYY-MM-DD; defaults to today
  months_override?: number; // 1, 3, 6, 12 \u2014 lets admin grant a different period
}

const ALLOWED_MONTHS = new Set([1, 3, 6, 12]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Subscription id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { data: sub } = await supabase
    .from('clubhouse_subscriptions')
    .select('id, flat_number, primary_user_id, tier_id, status, requested_months, clubhouse_tiers(name)')
    .eq('id', id)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  if (sub.status !== 'pending_approval') {
    return NextResponse.json({
      error: `Cannot approve a ${sub.status} subscription`,
    }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as ApprovePayload;
  const months = Number(body.months_override ?? sub.requested_months ?? 1);
  if (!ALLOWED_MONTHS.has(months)) {
    return NextResponse.json({ error: 'months must be one of 1, 3, 6, 12' }, { status: 400 });
  }

  const startStr = (body.start_date ?? '').trim() || new Date().toISOString().slice(0, 10);
  const start = new Date(`${startStr}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 });
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  const endStr = end.toISOString().slice(0, 10);

  // Race-check: is another flat-level active sub already in place?
  const { data: clash } = await supabase
    .from('clubhouse_subscriptions')
    .select('id')
    .eq('flat_number', sub.flat_number)
    .eq('status', 'active')
    .neq('id', sub.id)
    .maybeSingle();
  if (clash) {
    return NextResponse.json({
      error: `Flat ${sub.flat_number} already has an active subscription. Cancel that one first or wait for it to expire.`,
    }, { status: 409 });
  }

  const { error: updErr } = await supabase
    .from('clubhouse_subscriptions')
    .update({
      status: 'active',
      start_date: startStr,
      end_date: endStr,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', sub.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'update',
    targetType: 'clubhouse_subscription',
    targetId: sub.id,
    targetLabel: `Flat ${sub.flat_number} - ${(sub.clubhouse_tiers as { name?: string } | null)?.name ?? 'Tier'}`,
    reason: `Approved (${months}mo: ${startStr} -> ${endStr})`,
    before: sub,
    after: { status: 'active', start_date: startStr, end_date: endStr, approved_by: user.id },
    request: req,
  });

  // Best-effort: tell the resident their subscription is live.
  let push: { sent?: number; attempted?: number; skipped?: string } = { skipped: 'self' };
  if (sub.primary_user_id !== user.id) {
    try {
      const tierName = (sub.clubhouse_tiers as { name?: string } | null)?.name ?? 'Clubhouse';
      const result = await sendPushToUsers([sub.primary_user_id], {
        title: 'Subscription approved',
        body: `${tierName} active for flat ${sub.flat_number} until ${endStr}.`,
        url: '/dashboard/clubhouse',
        tag: `clubhouse-approved:${sub.id}`,
      });
      push = result;
    } catch {
      push = { skipped: 'push_error' };
    }
  }

  return NextResponse.json({ ok: true, id: sub.id, end_date: endStr, push });
}
