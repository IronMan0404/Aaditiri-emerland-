import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/admin-audit';

// Admin-only: hard-delete a clubhouse subscription row.
//
// We expose this as a POST (not DELETE) so the existing fetch wrappers
// don't have to deal with method gating in middleware/proxies and so it
// can carry an optional `reason` body field.
//
// Cascading effects (see schema.sql):
//   - clubhouse_subscription_events on this row are removed by FK
//     CASCADE, so the timeline of status changes for the deleted sub
//     also disappears. The audit log row we write below preserves the
//     row's last-known state.
//   - clubhouse_subscription_notices_sent rows are similarly cascaded.
//
// Active subscriptions can be deleted - this is intentional. If admin
// deletes an active sub, the partial-unique-index allowing only one
// active sub per flat is freed up immediately.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeletePayload {
  reason?: string;
}

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

  // Snapshot before delete so the audit row can preserve the prior state.
  const { data: existing, error: fetchErr } = await supabase
    .from('clubhouse_subscriptions')
    .select('*, clubhouse_tiers(name, monthly_price)')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as DeletePayload;
  const reason = (body.reason ?? '').trim().slice(0, 500) || null;

  const { error: delErr } = await supabase
    .from('clubhouse_subscriptions')
    .delete()
    .eq('id', id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const tierName = (existing.clubhouse_tiers as { name?: string } | null)?.name ?? 'Tier';
  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'delete',
    targetType: 'clubhouse_subscription',
    targetId: id,
    targetLabel: `Flat ${existing.flat_number} - ${tierName} (${existing.status})`,
    reason,
    before: existing,
    after: null,
    request: req,
  });

  return NextResponse.json({ ok: true, id });
}
