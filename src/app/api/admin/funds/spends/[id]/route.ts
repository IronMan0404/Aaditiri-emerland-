import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { logAdminAction } from '@/lib/admin-audit';

// DELETE — remove a spend (mistakes happen). Recalc trigger fires.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  // Snapshot first so audit can preserve who/what/how-much was deleted.
  const { data: before } = await auth.supabase
    .from('fund_spends')
    .select('*')
    .eq('id', id)
    .single();

  const { error } = await auth.supabase.from('fund_spends').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (before) {
    logAdminAction({
      actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
      action: 'delete',
      targetType: 'fund_spend',
      targetId: id,
      targetLabel: `${before.description} — ₹${(before.amount / 100).toLocaleString('en-IN')}`,
      before,
      request: req,
    });
  }

  return NextResponse.json({ ok: true });
}

// POST /reimburse — mark a spend's reimbursement as completed
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = (await req.json()) as { mark_reimbursed?: boolean };

  if (body.mark_reimbursed) {
    const { data: before } = await auth.supabase
      .from('fund_spends')
      .select('*')
      .eq('id', id)
      .single();

    const { data, error } = await auth.supabase
      .from('fund_spends')
      .update({ reimbursed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    logAdminAction({
      actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
      action: 'update',
      targetType: 'fund_spend',
      targetId: id,
      targetLabel: `Reimbursed: ${data.description} — ₹${(data.amount / 100).toLocaleString('en-IN')}`,
      before: before ?? undefined,
      after: data,
      request: req,
    });

    return NextResponse.json({ spend: data });
  }
  return NextResponse.json({ error: 'No action specified' }, { status: 400 });
}
