import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// Admin-only clubhouse analytics: subscriber/pass/revenue rollups + a small
// time series of subscription counts. Mirrors the issues analytics route
// in shape so the admin UI can fetch + render with the same chart helpers.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 300;

const TIMESERIES_DAYS = 90;

interface SubRow {
  id: string;
  flat_number: string;
  // Includes the new request-flow statuses; analytics filters them
  // out of revenue/active rollups but counts churn events from the
  // event ledger normally.
  status: 'pending_approval' | 'active' | 'expiring' | 'expired' | 'cancelled' | 'rejected';
  start_date: string;
  end_date: string;
  cancelled_at: string | null;
  created_at: string;
  tier: { id: string; name: string; monthly_price: number; included_facilities: string[] } | null;
}

interface PassRow {
  id: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  facility_id: string;
  created_at: string;
  used_at: string | null;
  facility: { name: string } | null;
}

interface SubEventRow {
  subscription_id: string;
  flat_number: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

interface FamilyRow { user_id: string }
interface ProfileRow { id: string; flat_number: string | null }

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowStart = new Date(now.getTime() - TIMESERIES_DAYS * 24 * 60 * 60 * 1000);

  const [
    { data: subs },
    { data: passes },
    { data: events },
    { data: profiles },
    { data: family },
  ] = await Promise.all([
    supabase.from('clubhouse_subscriptions').select(`
      id, flat_number, status, start_date, end_date, cancelled_at, created_at,
      tier:clubhouse_tiers(id, name, monthly_price, included_facilities)
    `),
    supabase.from('clubhouse_passes').select(`
      id, status, facility_id, created_at, used_at,
      facility:clubhouse_facilities(name)
    `),
    supabase
      .from('clubhouse_subscription_events')
      .select('subscription_id, flat_number, from_status, to_status, changed_at')
      .gte('changed_at', windowStart.toISOString()),
    supabase.from('profiles').select('id, flat_number'),
    supabase.from('family_members').select('user_id'),
  ]);

  const subList = (subs ?? []) as unknown as SubRow[];
  const passList = (passes ?? []) as unknown as PassRow[];
  const eventList = (events ?? []) as unknown as SubEventRow[];
  const profileList = (profiles ?? []) as unknown as ProfileRow[];
  const familyList = (family ?? []) as unknown as FamilyRow[];

  // ---------- KPIs ----------
  const activeSubs = subList.filter((s) => s.status === 'active' || s.status === 'expiring');
  const activeFlats = new Set(activeSubs.map((s) => s.flat_number));

  // Each profile counts once. Family members count once per row. We sum
  // family members for users whose flat is in the active set.
  const flatToUserIds = new Map<string, string[]>();
  for (const p of profileList) {
    if (!p.flat_number) continue;
    const arr = flatToUserIds.get(p.flat_number) ?? [];
    arr.push(p.id);
    flatToUserIds.set(p.flat_number, arr);
  }
  const familyByUser = new Map<string, number>();
  for (const f of familyList) {
    familyByUser.set(f.user_id, (familyByUser.get(f.user_id) ?? 0) + 1);
  }
  let coveredResidents = 0;
  for (const flat of activeFlats) {
    const userIds = flatToUserIds.get(flat) ?? [];
    coveredResidents += userIds.length;
    for (const uid of userIds) coveredResidents += familyByUser.get(uid) ?? 0;
  }

  const mrr = activeSubs.reduce((sum, s) => sum + Number(s.tier?.monthly_price ?? 0), 0);

  const passesThisMonth = passList.filter((p) => new Date(p.created_at) >= monthStart);
  const passesUsedThisMonth = passesThisMonth.filter((p) => p.status === 'used');

  // Churn this month = subscriptions that transitioned to cancelled OR
  // expired during the calendar month so far.
  const churnedThisMonth = eventList.filter(
    (e) =>
      new Date(e.changed_at) >= monthStart &&
      (e.to_status === 'cancelled' || e.to_status === 'expired')
  );
  const newThisMonth = eventList.filter(
    (e) => new Date(e.changed_at) >= monthStart && e.from_status === null && e.to_status === 'active'
  );

  // ---------- Time series: active subscriptions per day ----------
  // Replay events over starting state, identical to the issues burndown.
  const finalStatus = new Map<string, string>();
  for (const s of subList) finalStatus.set(s.id, s.status);

  const eventsBySub = new Map<string, SubEventRow[]>();
  for (const ev of eventList) {
    const arr = eventsBySub.get(ev.subscription_id) ?? [];
    arr.push(ev);
    eventsBySub.set(ev.subscription_id, arr);
  }
  for (const arr of eventsBySub.values()) arr.sort((a, b) => a.changed_at.localeCompare(b.changed_at));

  const stateAtWindowStart = new Map<string, string | 'none'>();
  for (const s of subList) {
    const evs = eventsBySub.get(s.id);
    if (!evs || evs.length === 0) {
      stateAtWindowStart.set(s.id, s.status);
    } else {
      const first = evs[0];
      stateAtWindowStart.set(s.id, first.from_status ?? 'none');
    }
  }

  const timeseries: { date: string; active: number }[] = [];
  for (let d = 0; d < TIMESERIES_DAYS; d++) {
    const dayEnd = new Date(windowStart.getTime() + (d + 1) * 24 * 60 * 60 * 1000);
    let count = 0;
    for (const s of subList) {
      let status: string | 'none' = stateAtWindowStart.get(s.id) ?? s.status;
      const evs = eventsBySub.get(s.id) ?? [];
      for (const ev of evs) {
        if (new Date(ev.changed_at) > dayEnd) break;
        status = ev.to_status;
      }
      if (status === 'active' || status === 'expiring') count += 1;
    }
    timeseries.push({ date: dayEnd.toISOString().slice(0, 10), active: count });
  }

  // ---------- Passes per facility this month ----------
  const facilityCounts = new Map<string, number>();
  for (const p of passesThisMonth) {
    const name = p.facility?.name ?? 'Unknown';
    facilityCounts.set(name, (facilityCounts.get(name) ?? 0) + 1);
  }
  const passesByFacility = Array.from(facilityCounts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // ---------- Revenue by tier (active subs only) ----------
  const tierBuckets = new Map<string, number>();
  for (const s of activeSubs) {
    if (!s.tier) continue;
    tierBuckets.set(s.tier.name, (tierBuckets.get(s.tier.name) ?? 0) + Number(s.tier.monthly_price));
  }
  const revenueByTier = Array.from(tierBuckets.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // ---------- Funnel ----------
  const funnel = {
    new: newThisMonth.length,
    renewed: 0,
    cancelled: churnedThisMonth.filter((e) => e.to_status === 'cancelled').length,
    expired: churnedThisMonth.filter((e) => e.to_status === 'expired').length,
  };
  // Renewals are approximated as: a new active subscription created this
  // month for a flat that ALREADY had a prior active subscription that just
  // expired. Cheap approximation: count flats appearing twice in the events.
  const flatNewCounts = new Map<string, number>();
  for (const e of newThisMonth) {
    flatNewCounts.set(e.flat_number, (flatNewCounts.get(e.flat_number) ?? 0) + 1);
  }
  funnel.renewed = Array.from(flatNewCounts.values()).reduce((s, n) => s + (n > 0 ? 1 : 0), 0);

  return NextResponse.json({
    kpis: {
      activeFlats: activeFlats.size,
      coveredResidents,
      mrr,
      passesThisMonth: passesThisMonth.length,
      passesUsedThisMonth: passesUsedThisMonth.length,
      utilizationRate: passesThisMonth.length
        ? Math.round((passesUsedThisMonth.length / passesThisMonth.length) * 100)
        : 0,
      churnedThisMonth: funnel.cancelled + funnel.expired,
    },
    timeseries,
    passesByFacility,
    revenueByTier,
    funnel,
  });
}
