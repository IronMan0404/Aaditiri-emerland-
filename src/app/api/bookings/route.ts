import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Booking-creation endpoint that enforces the clubhouse subscription
// requirement server-side. The client (src/app/dashboard/bookings/page.tsx)
// could insert directly via the supabase-js client \u2014 RLS would still let
// it through \u2014 but we need to *block* unsubscribed flats from booking
// subscription-only facilities (gym/pool/yoga). RLS can't easily express
// "facility lookup + flat lookup + tier membership" in a single policy, so
// we centralise the check here.

interface CreateBookingPayload {
  facility_id?: string;
  facility?: string;
  date?: string;
  time_slot?: string;
  notes?: string;
}

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, flat_number')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as CreateBookingPayload;
  if (!body.date || !body.time_slot) {
    return NextResponse.json({ error: 'date and time_slot are required' }, { status: 400 });
  }

  // Resolve the facility \u2014 prefer the new id-based lookup, fall back to the
  // legacy free-text "facility" field for any old client still in flight.
  let facility:
    | { id: string; name: string; slug: string; requires_subscription: boolean; is_bookable: boolean; is_active: boolean }
    | null = null;
  if (body.facility_id) {
    const { data } = await supabase
      .from('clubhouse_facilities')
      .select('id, name, slug, requires_subscription, is_bookable, is_active')
      .eq('id', body.facility_id)
      .maybeSingle();
    facility = data ?? null;
  } else if (body.facility) {
    const { data } = await supabase
      .from('clubhouse_facilities')
      .select('id, name, slug, requires_subscription, is_bookable, is_active')
      .eq('name', body.facility)
      .maybeSingle();
    facility = data ?? null;
  }

  if (!facility) {
    return NextResponse.json({ error: 'Facility not found' }, { status: 404 });
  }
  if (!facility.is_active || !facility.is_bookable) {
    return NextResponse.json({ error: `${facility.name} is not currently bookable` }, { status: 409 });
  }

  // Subscription gate: subscription-only facilities require the resident's
  // flat to have an active subscription whose tier includes this facility's
  // slug.
  if (facility.requires_subscription) {
    if (!profile.flat_number) {
      return NextResponse.json({
        error: `${facility.name} requires a clubhouse subscription. Please set your flat number in your profile, then ask the admin team to activate one.`,
      }, { status: 403 });
    }
    const { data: sub } = await supabase
      .from('clubhouse_subscriptions')
      .select('id, tier_id, end_date, clubhouse_tiers(included_facilities)')
      .eq('flat_number', profile.flat_number)
      .eq('status', 'active')
      .maybeSingle();
    const includedFacilities = (sub?.clubhouse_tiers as { included_facilities?: string[] } | null)?.included_facilities ?? [];
    if (!sub || !includedFacilities.includes(facility.slug)) {
      return NextResponse.json({
        error: `${facility.name} requires a clubhouse tier that includes it. Please contact the admin team to upgrade.`,
      }, { status: 403 });
    }
  }

  // Insert. We keep the legacy `facility` column populated with the display
  // name so existing list views (which key off bookings.facility) keep
  // working without a coordinated client migration.
  const { data: inserted, error } = await supabase
    .from('bookings')
    .insert({
      user_id: user.id,
      facility: facility.name,
      date: body.date,
      time_slot: body.time_slot,
      notes: body.notes ?? null,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: inserted.id });
}
