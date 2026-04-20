import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';

// GET /api/admin/funds/spend-analysis?fund_id=...&range=1m|3m|1y|all
//
// Returns a single payload with 7 analytics blocks. When fund_id is set we
// scope to one fund; otherwise it's society-wide.
//
//   1. summary — total_spent, spend_count, avg_per_spend, weekly_velocity (₹/week)
//   2. top_spends — top 10 individual spends in window
//   3. top_vendors — vendor totals + count, top 10
//   4. by_method — breakdown by payment method
//   5. by_category — fund category × ₹ spent (only meaningful overall; for
//      a single fund, this collapses to one row but we still return it for
//      a consistent shape)
//   6. by_paid_by — pending reimbursements grouped by who paid
//   7. fund_efficiency — for overall: per-fund collected/spent/balance/% spent.
//      For per-fund: just the one fund's snapshot.
//   8. anomalies — flagged spends:
//      * over-budget: cumulative spent > collected on the same fund
//      * very large: > 3× the median spend in the same fund (and > ₹1k)
//      * missing receipt: no receipt_url and amount > ₹2,000
//
// All ₹ values stay in PAISE on the wire.

interface SpendRow {
  id: string;
  fund_id: string;
  amount: number;
  spend_date: string;
  description: string;
  vendor_name: string | null;
  payment_method: string;
  is_reimbursement: boolean;
  reimbursed_at: string | null;
  paid_by_name: string | null;
  receipt_url: string | null;
  community_funds: { id: string; name: string; total_collected: number; total_spent: number; total_refunded: number; fund_categories: { id: string; name: string; icon: string | null; color: string | null } | null } | null;
}

type Range = '1m' | '3m' | '1y' | 'all';

function rangeStart(range: Range): string | null {
  if (range === 'all') return null;
  const d = new Date();
  if (range === '1m') d.setMonth(d.getMonth() - 1);
  else if (range === '3m') d.setMonth(d.getMonth() - 3);
  else if (range === '1y') d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const fundId = url.searchParams.get('fund_id');
  const range = (url.searchParams.get('range') ?? '3m') as Range;
  const since = rangeStart(range);

  // Pull spends with the joined fund + category in one go. RLS for spends
  // is permissive for admins so this is fine.
  let query = auth.supabase
    .from('fund_spends')
    .select('id, fund_id, amount, spend_date, description, vendor_name, payment_method, is_reimbursement, reimbursed_at, paid_by_name, receipt_url, community_funds(id, name, total_collected, total_spent, total_refunded, fund_categories(id, name, icon, color))')
    .order('spend_date', { ascending: false });

  if (fundId) query = query.eq('fund_id', fundId);
  if (since) query = query.gte('spend_date', since);

  const { data: rawSpends, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const spends = (rawSpends ?? []) as unknown as SpendRow[];

  // ---------- 1. Summary ----------
  const totalSpent = spends.reduce((s, r) => s + r.amount, 0);
  const spendCount = spends.length;
  const avgPerSpend = spendCount > 0 ? Math.round(totalSpent / spendCount) : 0;

  // Weekly velocity = total / weeks-in-window. For 'all' we infer the
  // window from min(spend_date) so a society with spend history gets a
  // meaningful number, not "₹X / 1000 weeks".
  let weeksInWindow = 1;
  if (range === '1m') weeksInWindow = 4;
  else if (range === '3m') weeksInWindow = 13;
  else if (range === '1y') weeksInWindow = 52;
  else if (range === 'all' && spendCount > 0) {
    const earliest = spends.reduce((min, s) => (s.spend_date < min ? s.spend_date : min), spends[0].spend_date);
    const days = Math.max(7, Math.round((Date.now() - new Date(earliest).getTime()) / 86_400_000));
    weeksInWindow = Math.max(1, days / 7);
  }
  const weeklyVelocity = Math.round(totalSpent / weeksInWindow);

  const summary = {
    total_spent: totalSpent,
    spend_count: spendCount,
    avg_per_spend: avgPerSpend,
    weekly_velocity: weeklyVelocity,
    range,
    since,
  };

  // ---------- 2. Top spends (top 10 by amount) ----------
  const topSpends = [...spends]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      fund_id: s.fund_id,
      fund_name: s.community_funds?.name ?? 'Unknown',
      amount: s.amount,
      description: s.description,
      vendor_name: s.vendor_name,
      spend_date: s.spend_date,
      payment_method: s.payment_method,
    }));

  // ---------- 3. Top vendors ----------
  const vendorMap = new Map<string, { vendor: string; total: number; count: number; last_spend_date: string }>();
  for (const s of spends) {
    const v = (s.vendor_name?.trim() || '(No vendor recorded)');
    const cur = vendorMap.get(v) ?? { vendor: v, total: 0, count: 0, last_spend_date: s.spend_date };
    cur.total += s.amount;
    cur.count += 1;
    if (s.spend_date > cur.last_spend_date) cur.last_spend_date = s.spend_date;
    vendorMap.set(v, cur);
  }
  const topVendors = Array.from(vendorMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // ---------- 4. By payment method ----------
  const methodMap = new Map<string, { method: string; total: number; count: number }>();
  for (const s of spends) {
    const cur = methodMap.get(s.payment_method) ?? { method: s.payment_method, total: 0, count: 0 };
    cur.total += s.amount;
    cur.count += 1;
    methodMap.set(s.payment_method, cur);
  }
  const byMethod = Array.from(methodMap.values()).sort((a, b) => b.total - a.total);

  // ---------- 5. By category ----------
  const catMap = new Map<string, { category_id: string; name: string; icon: string | null; color: string | null; total: number; count: number }>();
  for (const s of spends) {
    const cat = s.community_funds?.fund_categories;
    const key = cat?.id ?? 'uncategorised';
    const cur = catMap.get(key) ?? {
      category_id: key,
      name: cat?.name ?? 'Uncategorised',
      icon: cat?.icon ?? null,
      color: cat?.color ?? null,
      total: 0,
      count: 0,
    };
    cur.total += s.amount;
    cur.count += 1;
    catMap.set(key, cur);
  }
  const byCategory = Array.from(catMap.values()).sort((a, b) => b.total - a.total);

  // ---------- 6. Pending reimbursements (by paid_by_name) ----------
  const reimbMap = new Map<string, { person: string; pending_total: number; pending_count: number; oldest_date: string }>();
  for (const s of spends) {
    if (!s.is_reimbursement || s.reimbursed_at) continue;
    const person = s.paid_by_name?.trim() || '(Unspecified)';
    const cur = reimbMap.get(person) ?? { person, pending_total: 0, pending_count: 0, oldest_date: s.spend_date };
    cur.pending_total += s.amount;
    cur.pending_count += 1;
    if (s.spend_date < cur.oldest_date) cur.oldest_date = s.spend_date;
    reimbMap.set(person, cur);
  }
  const pendingReimbursements = Array.from(reimbMap.values()).sort((a, b) => b.pending_total - a.pending_total);

  // ---------- 7. Fund efficiency ----------
  // For overall mode: aggregate by fund. For per-fund mode: just one row.
  const fundMap = new Map<string, { id: string; name: string; collected: number; spent: number; refunded: number; balance: number; pct_spent: number | null }>();
  for (const s of spends) {
    const f = s.community_funds;
    if (!f) continue;
    if (fundMap.has(f.id)) continue;
    const balance = f.total_collected - f.total_spent - f.total_refunded;
    fundMap.set(f.id, {
      id: f.id,
      name: f.name,
      collected: f.total_collected,
      spent: f.total_spent,
      refunded: f.total_refunded,
      balance,
      pct_spent: f.total_collected > 0 ? Math.round((f.total_spent / f.total_collected) * 100) : null,
    });
  }
  const fundEfficiency = Array.from(fundMap.values()).sort((a, b) => b.spent - a.spent);

  // ---------- 8. Anomalies ----------
  // We need per-fund medians for the "very large" check. Build a quick
  // map of fund_id -> sorted amounts.
  const amountsByFund = new Map<string, number[]>();
  for (const s of spends) {
    const arr = amountsByFund.get(s.fund_id) ?? [];
    arr.push(s.amount);
    amountsByFund.set(s.fund_id, arr);
  }
  const medianByFund = new Map<string, number>();
  for (const [fid, arr] of amountsByFund.entries()) {
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const median = arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
    medianByFund.set(fid, median);
  }

  // Over-budget check needs running sum per fund chronologically. We sort
  // ascending so we can detect the FIRST spend that breaches collected.
  const ascSorted = [...spends].sort((a, b) => a.spend_date.localeCompare(b.spend_date));
  const runningSpentByFund = new Map<string, number>();
  const overBudgetSpends = new Set<string>();
  for (const s of ascSorted) {
    const f = s.community_funds;
    if (!f) continue;
    const prev = runningSpentByFund.get(s.fund_id) ?? 0;
    const next = prev + s.amount;
    runningSpentByFund.set(s.fund_id, next);
    // Use total_collected as the budget proxy. (target_amount would be
    // more honest but is optional and often unset — collected is the
    // money actually available.)
    if (f.total_collected > 0 && next > f.total_collected) {
      overBudgetSpends.add(s.id);
    }
  }

  const anomalies: { id: string; fund_id: string; fund_name: string; amount: number; spend_date: string; description: string; vendor_name: string | null; flags: string[] }[] = [];
  for (const s of spends) {
    const flags: string[] = [];

    if (overBudgetSpends.has(s.id)) flags.push('over_budget');

    const median = medianByFund.get(s.fund_id) ?? 0;
    if (median > 0 && s.amount > median * 3 && s.amount >= 100_000 /* ₹1,000 in paise */) {
      flags.push('very_large');
    }

    if (!s.receipt_url && s.amount >= 200_000 /* ₹2,000 in paise */) {
      flags.push('missing_receipt');
    }

    if (flags.length > 0) {
      anomalies.push({
        id: s.id,
        fund_id: s.fund_id,
        fund_name: s.community_funds?.name ?? 'Unknown',
        amount: s.amount,
        spend_date: s.spend_date,
        description: s.description,
        vendor_name: s.vendor_name,
        flags,
      });
    }
  }
  // Sort anomalies most-recent-first within type priority
  anomalies.sort((a, b) => b.spend_date.localeCompare(a.spend_date));

  return NextResponse.json({
    scope: fundId ? 'fund' : 'overall',
    fund_id: fundId,
    summary,
    top_spends: topSpends,
    top_vendors: topVendors,
    by_method: byMethod,
    by_category: byCategory,
    pending_reimbursements: pendingReimbursements,
    fund_efficiency: fundEfficiency,
    anomalies,
  });
}
