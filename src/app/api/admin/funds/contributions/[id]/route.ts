import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { notifyAfter } from '@/lib/notify';
import { logAdminAction } from '@/lib/admin-audit';

interface ActionBody {
  action: 'verify' | 'reject';
  rejection_reason?: string;
}

// POST /api/admin/funds/contributions/[id] — verify or reject a reported contribution.
// Marking 'received' triggers a recalculation of the fund's totals via the
// trigger we created in the migration.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const body = (await req.json()) as ActionBody;

  const { data: existing } = await auth.supabase
    .from('fund_contributions')
    .select('id, fund_id, resident_id, amount, contributor_name, status, is_in_kind')
    .eq('id', id)
    .single();
  if (!existing) return NextResponse.json({ error: 'Contribution not found' }, { status: 404 });

  if (body.action === 'verify') {
    if (existing.status === 'received') {
      return NextResponse.json({ error: 'Already verified' }, { status: 400 });
    }
    const { data, error } = await auth.supabase
      .from('fund_contributions')
      .update({
        status: 'received',
        received_by: auth.profile.id,
        received_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    logAdminAction({
      actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
      action: 'update',
      targetType: 'fund_contribution',
      targetId: id,
      targetLabel: `${existing.contributor_name ?? 'Flat ' + (data.flat_number ?? '')} — verified`,
      before: existing,
      after: data,
      request: req,
    });

    if (existing.resident_id) {
      notifyAfter('fund_contribution_verified', id, {
        contributionId: id,
        fundId: existing.fund_id,
        residentId: existing.resident_id,
        isInKind: existing.is_in_kind,
        amountPaise: existing.amount ?? null,
      });
    }
    return NextResponse.json({ contribution: data });
  }

  if (body.action === 'reject') {
    const reason = body.rejection_reason?.trim();
    if (!reason) {
      return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 });
    }
    const { data, error } = await auth.supabase
      .from('fund_contributions')
      .update({
        status: 'rejected',
        received_by: auth.profile.id,
        received_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    logAdminAction({
      actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
      action: 'update',
      targetType: 'fund_contribution',
      targetId: id,
      targetLabel: `${existing.contributor_name ?? 'Flat ' + (data.flat_number ?? '')} — rejected`,
      reason,
      before: existing,
      after: data,
      request: req,
    });

    if (existing.resident_id) {
      notifyAfter('fund_contribution_rejected', id, {
        contributionId: id,
        fundId: existing.fund_id,
        residentId: existing.resident_id,
        reason,
      });
    }
    return NextResponse.json({ contribution: data });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// DELETE — admin can delete a contribution row entirely (e.g. duplicate).
// Recalc trigger fires automatically.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  // Snapshot first so the audit captures what was deleted (amount, flat, method).
  const { data: before } = await auth.supabase
    .from('fund_contributions')
    .select('*')
    .eq('id', id)
    .single();
  const { error } = await auth.supabase.from('fund_contributions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (before) {
    logAdminAction({
      actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
      action: 'delete',
      targetType: 'fund_contribution',
      targetId: id,
      targetLabel: `${before.contributor_name ?? 'Flat ' + before.flat_number} — ₹${(before.amount / 100).toLocaleString('en-IN')}`,
      before,
      request: req,
    });
  }

  return NextResponse.json({ ok: true });
}
