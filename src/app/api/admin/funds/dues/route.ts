import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';

interface FundRow {
  id: string;
  name: string;
  suggested_per_flat: number | null;
  category_id: string | null;
  fund_categories: { name: string; icon: string | null; color: string | null } | null;
}

interface ContribRow {
  fund_id: string;
  flat_number: string;
  amount: number;
}

interface ProfileRow {
  flat_number: string | null;
  full_name: string | null;
}

// GET /api/admin/funds/dues
//
// Computes pending dues per flat across every active 'collecting' fund
// that has a non-null suggested_per_flat (one-off festival drives without
// a per-flat suggestion are excluded — there's no formula for "what flat
// X owes" if admin never set one).
//
// Returns:
//   funds: [{ id, name, suggested_per_flat, category, ... }, ...]
//   flats: [{ flat_number, resident_name, total_owed, total_paid, dues:
//     [{ fund_id, suggested, paid, pending }, ...] }, ...]
//   summary: { total_owed_all, total_paid_all, flats_with_dues, fully_paid_flats }
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  // 1) Active collecting funds with a per-flat suggestion. Anything else
  //    cannot generate a "pending" number.
  const { data: fundsRaw } = await auth.supabase
    .from('community_funds')
    .select('id, name, suggested_per_flat, category_id, fund_categories(name, icon, color)')
    .eq('status', 'collecting')
    .not('suggested_per_flat', 'is', null)
    .gt('suggested_per_flat', 0)
    .order('name');
  const funds = (fundsRaw ?? []) as unknown as FundRow[];

  if (funds.length === 0) {
    return NextResponse.json({
      funds: [],
      flats: [],
      summary: { total_owed_all: 0, total_paid_all: 0, flats_with_dues: 0, fully_paid_flats: 0, fund_count: 0 },
    });
  }

  const fundIds = funds.map((f) => f.id);

  // 2) All received cash contributions across these funds.
  const { data: contribRaw } = await auth.supabase
    .from('fund_contributions')
    .select('fund_id, flat_number, amount')
    .in('fund_id', fundIds)
    .eq('status', 'received')
    .eq('is_in_kind', false);
  const contribs = (contribRaw ?? []) as ContribRow[];

  // 3) All approved (non-bot) profiles so we know every flat that *should*
  //    be paying. Without this, a flat with zero contributions would never
  //    appear in the matrix.
  const { data: profilesRaw } = await auth.supabase
    .from('profiles')
    .select('flat_number, full_name')
    .eq('is_approved', true)
    .eq('is_bot', false)
    .not('flat_number', 'is', null)
    .order('flat_number');
  const profiles = (profilesRaw ?? []) as ProfileRow[];

  // Aggregate per-flat-per-fund payment.
  const paidMap = new Map<string, number>(); // key = `${flat}|${fundId}`
  for (const c of contribs) {
    if (c.flat_number === 'OPENING' || c.flat_number === 'POOL') continue; // ignore synthetic
    const k = `${c.flat_number}|${c.fund_id}`;
    paidMap.set(k, (paidMap.get(k) ?? 0) + c.amount);
  }

  // Collect every flat: from profiles + any flat that has paid (legacy
  // pre-onboarding flats still get counted).
  const flatNames = new Map<string, string>();
  for (const p of profiles) {
    if (p.flat_number && !flatNames.has(p.flat_number)) flatNames.set(p.flat_number, p.full_name ?? '');
  }
  for (const c of contribs) {
    if (c.flat_number === 'OPENING' || c.flat_number === 'POOL') continue;
    if (!flatNames.has(c.flat_number)) flatNames.set(c.flat_number, '');
  }

  const flats = Array.from(flatNames.entries())
    .map(([flat_number, resident_name]) => {
      const dues = funds.map((f) => {
        const paid = paidMap.get(`${flat_number}|${f.id}`) ?? 0;
        const suggested = f.suggested_per_flat ?? 0;
        const pending = Math.max(0, suggested - paid);
        return { fund_id: f.id, fund_name: f.name, suggested, paid, pending };
      });
      const total_owed = dues.reduce((s, d) => s + d.pending, 0);
      const total_paid = dues.reduce((s, d) => s + d.paid, 0);
      const total_suggested = dues.reduce((s, d) => s + d.suggested, 0);
      return { flat_number, resident_name, total_owed, total_paid, total_suggested, dues };
    })
    .sort((a, b) => a.flat_number.localeCompare(b.flat_number, undefined, { numeric: true }));

  const summary = {
    total_owed_all: flats.reduce((s, f) => s + f.total_owed, 0),
    total_paid_all: flats.reduce((s, f) => s + f.total_paid, 0),
    flats_with_dues: flats.filter((f) => f.total_owed > 0).length,
    fully_paid_flats: flats.filter((f) => f.total_owed === 0 && f.total_paid > 0).length,
    fund_count: funds.length,
    suggested_total_per_flat: funds.reduce((s, f) => s + (f.suggested_per_flat ?? 0), 0),
  };

  return NextResponse.json({
    funds: funds.map((f) => ({
      id: f.id,
      name: f.name,
      suggested_per_flat: f.suggested_per_flat,
      category: f.fund_categories?.name ?? null,
      icon: f.fund_categories?.icon ?? null,
      color: f.fund_categories?.color ?? null,
    })),
    flats,
    summary,
  });
}
