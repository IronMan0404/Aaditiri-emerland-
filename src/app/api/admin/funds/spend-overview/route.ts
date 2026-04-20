import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';

// GET /api/admin/funds/spend-overview
//
// Treasurer dashboard endpoint. Three breakdowns of money flow:
//   1. overall  — single-row "where do we stand" snapshot
//   2. by_category — collected / spent / balance per fund category
//   3. by_month — collected vs spent month-by-month (last 12 months)
//   4. recent_spends — last 20 spends across all funds, for the activity feed
//
// We deliberately reuse the existing v_community_balance_overall +
// v_category_totals views (already enforced visibility=all_residents).
// For the monthly chart we hit fund_contributions + fund_spends directly
// because the views are point-in-time aggregates.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  // ----- 1. Overall snapshot -----
  const { data: overall, error: oErr } = await auth.supabase
    .from('v_community_balance_overall')
    .select('*')
    .single();
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

  // ----- 2. Category breakdown -----
  const { data: byCategory, error: cErr } = await auth.supabase
    .from('v_category_totals')
    .select('*');
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  // ----- 3. Monthly trend (last 12 months) -----
  // Use a 12-month lookback window. Group entirely in JS so we don't
  // need a stored proc; the row volume is small (a year of spends in a
  // 100-flat society is in the low hundreds).
  const since = new Date();
  since.setMonth(since.getMonth() - 11);
  since.setDate(1);
  const sinceISO = since.toISOString().slice(0, 10);

  const [{ data: contribs }, { data: spends }] = await Promise.all([
    auth.supabase
      .from('fund_contributions')
      .select('amount, contribution_date')
      .eq('status', 'received')
      .eq('is_in_kind', false)
      .gte('contribution_date', sinceISO),
    auth.supabase
      .from('fund_spends')
      .select('amount, spend_date')
      .gte('spend_date', sinceISO),
  ]);

  // Build a map keyed by 'YYYY-MM' so missing months sort correctly.
  const monthly = new Map<string, { collected: number; spent: number }>();
  // Pre-seed every month in the window with zeros so the chart has no gaps.
  for (let i = 0; i < 12; i++) {
    const d = new Date(since);
    d.setMonth(since.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly.set(key, { collected: 0, spent: 0 });
  }
  for (const c of contribs ?? []) {
    const key = (c.contribution_date as string).slice(0, 7);
    const cur = monthly.get(key) ?? { collected: 0, spent: 0 };
    cur.collected += c.amount;
    monthly.set(key, cur);
  }
  for (const s of spends ?? []) {
    const key = (s.spend_date as string).slice(0, 7);
    const cur = monthly.get(key) ?? { collected: 0, spent: 0 };
    cur.spent += s.amount;
    monthly.set(key, cur);
  }
  const byMonth = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v, net: v.collected - v.spent }));

  // ----- 4. Recent spends (last 20, newest first) -----
  const { data: recentSpendsRaw } = await auth.supabase
    .from('fund_spends')
    .select('id, fund_id, amount, spend_date, description, vendor_name, payment_method, is_reimbursement, reimbursed_at, paid_by_name, community_funds(name, fund_categories(icon, color, name))')
    .order('spend_date', { ascending: false })
    .limit(20);

  return NextResponse.json({
    overall,
    by_category: byCategory ?? [],
    by_month: byMonth,
    recent_spends: recentSpendsRaw ?? [],
  });
}
