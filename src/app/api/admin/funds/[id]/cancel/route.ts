import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { logAdminAction } from '@/lib/admin-audit';

interface CancelBody {
  reason?: string;
}

// POST /api/admin/funds/[id]/cancel
// Soft-archive a fund that has activity (contributions / spends / refunds)
// but should no longer accept new ones. Use this when DELETE is rejected
// because the fund has child rows. The audit trail is preserved.
//
// Differences from /close:
//   * /close is for "we're done, here's the summary, here's how we handled
//     surplus" — implies the collection ran successfully.
//   * /cancel is for "this fund was a mistake / abandoned / superseded" —
//     no surplus handling, just flips status to 'cancelled'.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  let body: CancelBody = {};
  try { body = (await req.json()) as CancelBody; } catch { /* empty body is fine */ }

  const { data: fund, error: fErr } = await auth.supabase
    .from('community_funds')
    .select('id, name, status, closure_notes')
    .eq('id', id)
    .single();
  if (fErr || !fund) return NextResponse.json({ error: 'Fund not found' }, { status: 404 });

  if (fund.status === 'closed' || fund.status === 'cancelled') {
    return NextResponse.json(
      { error: `Fund is already ${fund.status}` },
      { status: 400 }
    );
  }

  // Append the reason onto closure_notes so admins can see why later.
  // (Closed funds use this same field to show the closing summary.)
  const reason = body.reason?.trim();
  const stamped = `[Cancelled by admin on ${new Date().toISOString().slice(0, 10)}]${reason ? ` ${reason}` : ''}`;
  const next_notes = fund.closure_notes
    ? `${fund.closure_notes}\n\n${stamped}`
    : stamped;

  const { error: uErr } = await auth.supabase
    .from('community_funds')
    .update({
      status: 'cancelled',
      closed_by: auth.user.id,
      closed_at: new Date().toISOString(),
      closure_notes: next_notes,
    })
    .eq('id', id);

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'update',
    targetType: 'community_fund',
    targetId: id,
    targetLabel: fund.name,
    reason: reason || 'Cancelled (no reason provided)',
    before: { status: fund.status, closure_notes: fund.closure_notes },
    after: { status: 'cancelled', closure_notes: next_notes },
    request: req,
  });

  return NextResponse.json({ ok: true });
}
