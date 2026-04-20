import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

interface FundRow {
  id: string;
  name: string;
  suggested_per_flat: number | null;
  collection_deadline: string | null;
  fund_categories: { name: string; icon: string | null; color: string | null } | null;
}

interface ContribRow {
  fund_id: string;
  amount: number;
}

// GET /api/funds/my-dues
//
// Returns "what does my flat still owe?" — the resident-facing slice of
// /api/admin/funds/dues. Computes pending = suggested_per_flat − paid for
// each active collecting fund the caller's flat hasn't fully paid.
export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const flat = auth.profile.flat_number;
  if (!flat) {
    // A resident without a flat_number can't have dues. Return an empty
    // shape so the UI renders cleanly instead of a 4xx the user can't act on.
    return NextResponse.json({
      flat_number: null,
      dues: [],
      summary: { total_owed: 0, total_paid: 0, fund_count: 0 },
    });
  }

  const { data: fundsRaw } = await auth.supabase
    .from('community_funds')
    .select('id, name, suggested_per_flat, collection_deadline, fund_categories(name, icon, color)')
    .eq('status', 'collecting')
    .eq('visibility', 'all_residents')
    .not('suggested_per_flat', 'is', null)
    .gt('suggested_per_flat', 0);
  const funds = (fundsRaw ?? []) as unknown as FundRow[];

  if (funds.length === 0) {
    return NextResponse.json({
      flat_number: flat,
      dues: [],
      summary: { total_owed: 0, total_paid: 0, fund_count: 0 },
    });
  }

  const fundIds = funds.map((f) => f.id);
  const { data: contribRaw } = await auth.supabase
    .from('fund_contributions')
    .select('fund_id, amount')
    .in('fund_id', fundIds)
    .eq('flat_number', flat)
    .eq('status', 'received')
    .eq('is_in_kind', false);
  const contribs = (contribRaw ?? []) as ContribRow[];

  const paidByFund = new Map<string, number>();
  for (const c of contribs) {
    paidByFund.set(c.fund_id, (paidByFund.get(c.fund_id) ?? 0) + c.amount);
  }

  const dues = funds
    .map((f) => {
      const paid = paidByFund.get(f.id) ?? 0;
      const suggested = f.suggested_per_flat ?? 0;
      const pending = Math.max(0, suggested - paid);
      return {
        fund_id: f.id,
        fund_name: f.name,
        category: f.fund_categories?.name ?? null,
        icon: f.fund_categories?.icon ?? null,
        color: f.fund_categories?.color ?? null,
        deadline: f.collection_deadline,
        suggested,
        paid,
        pending,
        status: pending === 0 ? 'paid' : paid > 0 ? 'partial' : 'pending',
      };
    })
    // Sort: pending first (by deadline), then partial, then paid.
    .sort((a, b) => {
      const order = { pending: 0, partial: 1, paid: 2 } as const;
      const oDiff = order[a.status as keyof typeof order] - order[b.status as keyof typeof order];
      if (oDiff !== 0) return oDiff;
      const ad = a.deadline ?? '9999-12-31';
      const bd = b.deadline ?? '9999-12-31';
      return ad.localeCompare(bd);
    });

  const summary = {
    total_owed: dues.reduce((s, d) => s + d.pending, 0),
    total_paid: dues.reduce((s, d) => s + d.paid, 0),
    fund_count: dues.length,
    open_dues_count: dues.filter((d) => d.pending > 0).length,
  };

  return NextResponse.json({ flat_number: flat, dues, summary });
}
