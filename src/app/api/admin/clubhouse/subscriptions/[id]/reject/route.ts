import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { sendPushToUsers } from '@/lib/push';
import { logAdminAction } from '@/lib/admin-audit';

// Admin-only: reject a pending clubhouse subscription request.
// Stores the reason on the row so the resident sees it in
// /dashboard/clubhouse and pushes them a notification.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RejectPayload {
  reason?: string;
}

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

  const body = (await req.json().catch(() => ({}))) as RejectPayload;
  const reason = (body.reason ?? '').trim();
  if (!reason) {
    return NextResponse.json({ error: 'A rejection reason is required' }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json({ error: 'Reason must be 500 characters or fewer' }, { status: 400 });
  }

  const { data: sub } = await supabase
    .from('clubhouse_subscriptions')
    .select('id, flat_number, primary_user_id, status, clubhouse_tiers(name)')
    .eq('id', id)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  if (sub.status !== 'pending_approval') {
    return NextResponse.json({
      error: `Cannot reject a ${sub.status} subscription`,
    }, { status: 409 });
  }

  const { error: updErr } = await supabase
    .from('clubhouse_subscriptions')
    .update({
      status: 'rejected',
      rejected_reason: reason,
      // approved_by is filled here too as the audit trail \u2014 it
      // reads as "who took action on this request" regardless of
      // whether the action was approve or reject.
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
    reason: `Rejected: ${reason}`,
    before: sub,
    after: { status: 'rejected', rejected_reason: reason },
    request: req,
  });

  let push: { sent?: number; attempted?: number; skipped?: string } = { skipped: 'self' };
  if (sub.primary_user_id !== user.id) {
    try {
      const tierName = (sub.clubhouse_tiers as { name?: string } | null)?.name ?? 'Clubhouse';
      const result = await sendPushToUsers([sub.primary_user_id], {
        title: 'Subscription request declined',
        body: `Your ${tierName} request for flat ${sub.flat_number} was declined. Reason: ${reason.slice(0, 80)}${reason.length > 80 ? '\u2026' : ''}`,
        url: '/dashboard/clubhouse',
        tag: `clubhouse-rejected:${sub.id}`,
      });
      push = result;
    } catch {
      push = { skipped: 'push_error' };
    }
  }

  return NextResponse.json({ ok: true, id: sub.id, push });
}
