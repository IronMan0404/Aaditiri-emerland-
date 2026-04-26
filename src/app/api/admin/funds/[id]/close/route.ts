import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { notify } from '@/lib/notify';
import { formatINR } from '@/lib/money';
import { logAdminAction } from '@/lib/admin-audit';

interface CloseBody {
  closure_notes: string;
  surplus_handling: 'roll_to_general_pool' | 'refund_pro_rata' | 'roll_to_next_year' | 'leave_as_is';
  general_pool_fund_id?: string;
  notify?: boolean;
}

// POST /api/admin/funds/[id]/close — close a fund.
// surplus_handling determines what we do with (collected - spent - refunded):
//   * roll_to_general_pool: insert a refund row (out of this fund) and a
//     contribution row into the chosen general pool fund
//   * refund_pro_rata: insert refund rows for each contributor proportional
//     to their share of total received contributions
//   * roll_to_next_year: just close; admin will create a new fund and
//     hand-pick. Recorded in closure_notes.
//   * leave_as_is: just close. Surplus stays as a positive balance on the
//     closed fund (visible but inert).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: fundId } = await ctx.params;
  const body = (await req.json()) as CloseBody;

  if (!body.closure_notes?.trim()) {
    return NextResponse.json({ error: 'Closure notes required' }, { status: 400 });
  }
  if (!body.surplus_handling) {
    return NextResponse.json({ error: 'Surplus handling required' }, { status: 400 });
  }

  const { data: fund, error: fundErr } = await auth.supabase
    .from('community_funds')
    .select('id, name, status, total_collected, total_spent, total_refunded, visibility')
    .eq('id', fundId)
    .single();
  if (fundErr || !fund) return NextResponse.json({ error: 'Fund not found' }, { status: 404 });
  if (fund.status === 'closed') return NextResponse.json({ error: 'Already closed' }, { status: 400 });

  const surplus = fund.total_collected - fund.total_spent - fund.total_refunded;
  const today = new Date().toISOString().slice(0, 10);

  if (surplus > 0) {
    if (body.surplus_handling === 'roll_to_general_pool') {
      if (!body.general_pool_fund_id) {
        return NextResponse.json(
          { error: 'general_pool_fund_id required for roll_to_general_pool' },
          { status: 400 }
        );
      }
      // Refund out of this fund
      const { error: rErr } = await auth.supabase.from('fund_refunds').insert({
        fund_id: fundId,
        flat_number: 'POOL',
        amount: surplus,
        refund_date: today,
        method: 'other',
        notes: `Surplus rolled to General Pool on close (fund: ${body.general_pool_fund_id})`,
        recorded_by: auth.profile.id,
      });
      if (rErr) return NextResponse.json({ error: `Refund insert failed: ${rErr.message}` }, { status: 500 });

      // Contribution into the pool fund (received status so it counts)
      const { error: cErr } = await auth.supabase.from('fund_contributions').insert({
        fund_id: body.general_pool_fund_id,
        flat_number: 'POOL',
        contributor_name: `Surplus from ${fund.name}`,
        amount: surplus,
        method: 'other',
        contribution_date: today,
        notes: `Rolled over from closed fund: ${fund.name}`,
        status: 'received',
        reported_by: auth.profile.id,
        received_by: auth.profile.id,
        received_at: new Date().toISOString(),
      });
      if (cErr) return NextResponse.json({ error: `Pool credit failed: ${cErr.message}` }, { status: 500 });
    } else if (body.surplus_handling === 'refund_pro_rata') {
      // Pull all received contributions, compute pro-rata, insert refunds.
      const { data: contribs } = await auth.supabase
        .from('fund_contributions')
        .select('id, flat_number, resident_id, amount')
        .eq('fund_id', fundId)
        .eq('status', 'received')
        .eq('is_in_kind', false);

      const totalRaised = (contribs ?? []).reduce((s, r) => s + r.amount, 0);
      if (totalRaised > 0 && (contribs?.length ?? 0) > 0) {
        // Build refund rows. Use Math.floor and assign rounding remainder
        // to the largest contributor so totals balance to the rupee.
        const refundsToInsert = (contribs ?? []).map((c) => ({
          fund_id: fundId,
          contribution_id: c.id,
          flat_number: c.flat_number,
          resident_id: c.resident_id,
          amount: Math.floor((surplus * c.amount) / totalRaised),
          refund_date: today,
          method: 'other' as const,
          notes: 'Pro-rata refund from closed fund',
          recorded_by: auth.profile.id,
        }));
        const computedSum = refundsToInsert.reduce((s, r) => s + r.amount, 0);
        const remainder = surplus - computedSum;
        if (remainder !== 0 && refundsToInsert.length > 0) {
          // give the leftover paise to the largest contributor
          const biggestIdx = refundsToInsert
            .map((r, i) => ({ amt: r.amount, i }))
            .sort((a, b) => b.amt - a.amt)[0].i;
          refundsToInsert[biggestIdx].amount += remainder;
        }
        const cleaned = refundsToInsert.filter((r) => r.amount > 0);
        if (cleaned.length > 0) {
          const { error: rErr } = await auth.supabase.from('fund_refunds').insert(cleaned);
          if (rErr)
            return NextResponse.json(
              { error: `Pro-rata refund insert failed: ${rErr.message}` },
              { status: 500 }
            );
        }
      }
    }
    // For 'roll_to_next_year' and 'leave_as_is' we don't generate any
    // refund rows; surplus remains visible on the closed fund.
  }

  // Flip status to 'closed'
  const { data: closed, error: closeErr } = await auth.supabase
    .from('community_funds')
    .update({
      status: 'closed',
      closed_by: auth.profile.id,
      closed_at: new Date().toISOString(),
      closure_notes: body.closure_notes.trim(),
    })
    .eq('id', fundId)
    .select()
    .single();

  if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: 500 });

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'update',
    targetType: 'community_fund',
    targetId: fundId,
    targetLabel: closed.name,
    reason: `Closed: ${body.surplus_handling} (surplus ${formatINR(surplus)})`,
    before: { status: fund.status, total_collected: fund.total_collected, total_spent: fund.total_spent, total_refunded: fund.total_refunded },
    after: { status: closed.status, closure_notes: closed.closure_notes, surplus_handling: body.surplus_handling, general_pool_fund_id: body.general_pool_fund_id ?? null },
    request: req,
  });

  if (body.notify && closed.visibility === 'all_residents') {
    notify('fund_closed', closed.id, {
      fundId: closed.id,
      name: closed.name,
      surplusPaise: surplus,
      closureNotes: body.closure_notes.trim(),
    }).catch(() => {});
  }

  return NextResponse.json({ fund: closed, surplus });
}
