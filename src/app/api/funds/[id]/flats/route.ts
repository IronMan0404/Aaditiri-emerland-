import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

interface ProfileRow {
  id: string;
  flat_number: string | null;
  full_name: string | null;
}

interface ContributionRow {
  flat_number: string;
  amount: number;
  contribution_date: string;
}

interface FundRow {
  suggested_per_flat: number | null;
}

// GET /api/funds/[id]/flats — flat-wise contribution matrix for a fund.
// Computes "paid / partial / pending" per flat using suggested_per_flat
// as the threshold. Returns one row per known flat (from profiles).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: fundId } = await ctx.params;

  // 1) Fund row
  const { data: fundData, error: fundErr } = await auth.supabase
    .from('community_funds')
    .select('suggested_per_flat')
    .eq('id', fundId)
    .single<FundRow>();
  if (fundErr || !fundData) {
    return NextResponse.json({ error: 'Fund not found' }, { status: 404 });
  }
  const suggested = fundData.suggested_per_flat ?? 0;

  // 2) All distinct flats with at least one approved profile
  const { data: profilesData } = await auth.supabase
    .from('profiles')
    .select('id, flat_number, full_name')
    .eq('is_approved', true)
    .eq('is_bot', false)
    .not('flat_number', 'is', null)
    .order('flat_number', { ascending: true });

  // 3) All received contributions for this fund
  const { data: contribData } = await auth.supabase
    .from('fund_contributions')
    .select('flat_number, amount, contribution_date')
    .eq('fund_id', fundId)
    .eq('status', 'received')
    .eq('is_in_kind', false);

  const contribByFlat = new Map<string, { total: number; count: number; latest: string | null }>();
  for (const c of (contribData ?? []) as ContributionRow[]) {
    const cur = contribByFlat.get(c.flat_number) ?? { total: 0, count: 0, latest: null };
    cur.total += c.amount;
    cur.count += 1;
    if (!cur.latest || c.contribution_date > cur.latest) cur.latest = c.contribution_date;
    contribByFlat.set(c.flat_number, cur);
  }

  // De-dupe profiles by flat_number; keep first (alphabetical resident name)
  const flatToName = new Map<string, string>();
  for (const p of (profilesData ?? []) as ProfileRow[]) {
    const flat = p.flat_number ?? '';
    if (!flat) continue;
    if (!flatToName.has(flat)) flatToName.set(flat, p.full_name ?? '');
  }

  // Also include flats that have contributed but are not in profiles
  // (legacy / pre-onboarding) so we don't lose them in the grid.
  for (const flat of contribByFlat.keys()) {
    if (!flatToName.has(flat)) flatToName.set(flat, '');
  }

  const flats = Array.from(flatToName.entries())
    .map(([flatNumber, residentName]) => {
      const c = contribByFlat.get(flatNumber);
      const contributed = c?.total ?? 0;
      const status: 'paid' | 'partial' | 'pending' =
        suggested > 0
          ? contributed >= suggested
            ? 'paid'
            : contributed > 0
              ? 'partial'
              : 'pending'
          : contributed > 0
            ? 'paid'
            : 'pending';
      return {
        flat_number: flatNumber,
        resident_name: residentName,
        contributed,
        contribution_count: c?.count ?? 0,
        last_contributed_on: c?.latest ?? null,
        flat_status: status,
      };
    })
    .sort((a, b) => a.flat_number.localeCompare(b.flat_number, undefined, { numeric: true }));

  const summary = {
    total_flats: flats.length,
    paid: flats.filter((f) => f.flat_status === 'paid').length,
    partial: flats.filter((f) => f.flat_status === 'partial').length,
    pending: flats.filter((f) => f.flat_status === 'pending').length,
    suggested_per_flat: suggested,
  };

  return NextResponse.json({ summary, flats });
}
