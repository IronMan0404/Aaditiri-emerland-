import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { sendPushToUsers } from '@/lib/push';
import type { ClubhouseRequestMonths } from '@/types';

// Resident-facing endpoint for submitting a clubhouse subscription
// request. Inserts a pending_approval row gated by RLS (the policy
// "Residents request own subscription" enforces flat ownership and
// the pending_approval status). The admin then reviews it on
// /admin/clubhouse and either approves or rejects.
//
// We intentionally DO NOT compute start/end dates here \u2014 the admin
// fills those at approval time (so residents can't game the system
// by requesting today and getting backdated cover). For the DB's
// non-null requirements we store today + (months) as placeholders;
// the active_dates_check constraint is conditional on status, so
// pending rows aren't validated against them.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_MONTHS = new Set<ClubhouseRequestMonths>([1, 3, 6, 12]);

interface RequestPayload {
  tier_id?: string;
  months?: number;
  notes?: string;
}

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, flat_number')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  if (!profile.flat_number) {
    return NextResponse.json({
      error: 'Set your flat number in your profile before subscribing.',
    }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as RequestPayload;
  if (!body.tier_id) {
    return NextResponse.json({ error: 'tier_id is required' }, { status: 400 });
  }
  const months = Number(body.months) as ClubhouseRequestMonths;
  if (!ALLOWED_MONTHS.has(months)) {
    return NextResponse.json({
      error: 'months must be one of 1, 3, 6, 12',
    }, { status: 400 });
  }

  // Block if a request or active sub already exists for this flat.
  // The DB also enforces this via two partial unique indexes, but we
  // surface a friendlier error than "duplicate key" here.
  const { data: existing } = await supabase
    .from('clubhouse_subscriptions')
    .select('id, status')
    .eq('flat_number', profile.flat_number)
    .in('status', ['pending_approval', 'active', 'expiring']);
  if (existing && existing.length > 0) {
    const states = existing.map((s) => s.status).join(', ');
    return NextResponse.json({
      error: `Your flat already has a ${states} subscription. Cancel or wait for it to expire before submitting a new request.`,
    }, { status: 409 });
  }

  // Verify the tier exists and is currently offered.
  const { data: tier } = await supabase
    .from('clubhouse_tiers')
    .select('id, name, monthly_price, is_active')
    .eq('id', body.tier_id)
    .maybeSingle();
  if (!tier) return NextResponse.json({ error: 'Tier not found' }, { status: 404 });
  if (!tier.is_active) {
    return NextResponse.json({ error: `Tier "${tier.name}" is not currently offered` }, { status: 409 });
  }

  // Placeholder dates: today + N months. Admin overwrites these at
  // approval time. The active_dates_check constraint is conditional
  // on status so it doesn't fire for the pending row.
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10);
  const placeholderEnd = new Date(today);
  placeholderEnd.setMonth(placeholderEnd.getMonth() + months);
  const placeholderEndYmd = placeholderEnd.toISOString().slice(0, 10);

  const { data: inserted, error } = await supabase
    .from('clubhouse_subscriptions')
    .insert({
      flat_number: profile.flat_number,
      tier_id: tier.id,
      primary_user_id: user.id,
      start_date: ymd,
      end_date: placeholderEndYmd,
      status: 'pending_approval',
      requested_months: months,
      requested_at: new Date().toISOString(),
      request_notes: body.notes?.trim()?.slice(0, 500) || null,
    })
    .select('id')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort: ping admins so they can act on the request quickly.
  // We don't fail the request if push fan-out misbehaves.
  try {
    const { data: admins } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin');
    const adminIds = (admins ?? []).map((a) => a.id).filter((id): id is string => Boolean(id));
    if (adminIds.length > 0) {
      await sendPushToUsers(adminIds, {
        title: 'Subscription request',
        body: `${profile.full_name} (Flat ${profile.flat_number}) requested ${tier.name} for ${months} month${months === 1 ? '' : 's'}.`,
        url: '/admin/clubhouse',
        tag: `clubhouse-request:${inserted.id}`,
      });
    }
  } catch {
    // Swallow push errors; the request is already saved.
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
