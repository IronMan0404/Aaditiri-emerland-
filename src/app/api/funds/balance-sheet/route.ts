import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

// GET /api/funds/balance-sheet — overall + per-category + closed funds list
// Drives the headline page that any resident can open.
export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const [overall, categories, closedFunds, topContributors] = await Promise.all([
    auth.supabase.from('v_community_balance_overall').select('*').single(),
    auth.supabase.from('v_category_totals').select('*'),
    auth.supabase
      .from('v_fund_summary')
      .select('*')
      .in('status', ['closed', 'spending'])
      .order('event_date', { ascending: false, nullsFirst: false })
      .limit(20),
    auth.supabase
      .from('fund_contributions')
      .select('flat_number, contributor_name, amount')
      .eq('status', 'received')
      .eq('is_in_kind', false)
      .eq('is_anonymous', false),
  ]);

  // Aggregate top contributors in JS (Postgres view would need GROUP BY,
  // and the result set is small — every authenticated read is bounded).
  const totals = new Map<string, { flat_number: string; name: string; total: number }>();
  for (const c of (topContributors.data ?? []) as Array<{
    flat_number: string;
    contributor_name: string;
    amount: number;
  }>) {
    const cur = totals.get(c.flat_number) ?? {
      flat_number: c.flat_number,
      name: c.contributor_name,
      total: 0,
    };
    cur.total += c.amount;
    totals.set(c.flat_number, cur);
  }
  const top = Array.from(totals.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return NextResponse.json({
    overall: overall.data,
    categories: categories.data ?? [],
    closed_funds: closedFunds.data ?? [],
    top_contributors: top,
  });
}
