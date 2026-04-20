import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

// GET /api/funds/by-flat/[flat] — full contribution history for a flat
// across every fund. Public to all authenticated residents (transparency).
export async function GET(_req: Request, ctx: { params: Promise<{ flat: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { flat } = await ctx.params;
  const decoded = decodeURIComponent(flat);

  const { data, error } = await auth.supabase
    .from('fund_contributions')
    .select('*, community_funds(id, name, status, fund_categories(icon, color, name))')
    .eq('flat_number', decoded)
    .eq('status', 'received')
    .order('contribution_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const total = (data ?? []).reduce(
    (sum, r) => (r.is_in_kind ? sum : sum + (r.amount ?? 0)),
    0
  );
  return NextResponse.json({
    flat_number: decoded,
    total_contributed: total,
    contribution_count: data?.length ?? 0,
    contributions: data ?? [],
  });
}
