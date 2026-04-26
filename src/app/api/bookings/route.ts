import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { notifyAfter } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Booking-creation endpoint that enforces the clubhouse subscription
// requirement server-side. RLS on `public.bookings` (see migration
// 20260428_security_hardening.sql) now blocks resident-direct INSERTs:
// only admins can insert via the regular session client. Residents MUST
// route through this endpoint, which:
//   1. authenticates the caller from the session cookie,
//   2. runs the subscription / facility-eligibility gate that RLS can't
//      easily express in a single policy,
//   3. performs the actual write via the service-role admin client so
//      the RLS lockdown doesn't reject our own legitimate insert.
// The service-role client is invoked ONLY for the final insert; every
// authorisation decision is still made against the resident's session
// so we can never write a row on behalf of a different user than the
// one holding the cookie.

interface CreateBookingPayload {
  facility_id?: string;
  facility?: string;
  date?: string;
  time_slot?: string;
  notes?: string;
}

export async function POST(req: Request) {
  // Service-role is required for the final insert because RLS now
  // blocks resident-direct INSERTs on `bookings`. We fail fast with a
  // clear message if the env var is missing, matching the registration
  // route's contract.
  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      {
        error:
          'Server is missing SUPABASE_SERVICE_ROLE_KEY. Bookings cannot be created until the admin sets this env var.',
      },
      { status: 500 },
    );
  }

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

  // Insert via the service-role client. RLS would otherwise reject this
  // (residents are blocked from direct INSERTs as of the security
  // hardening migration). We keep the legacy `facility` column populated
  // with the display name so existing list views keep working without a
  // coordinated client migration. user_id is taken from the verified
  // session above — never from the request body — so a malicious payload
  // can't book on behalf of someone else.
  const admin = createAdminSupabaseClient();
  const { data: inserted, error } = await admin
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

  // Best-effort fan-out: ping admins (with Telegram inline buttons)
  // and echo the requester. Runs via Next's `after()` (Vercel
  // `waitUntil`) so the resident doesn't pay push + Telegram
  // round-trip latency, and — critically — the platform doesn't
  // kill the work the moment this function returns. Plain
  // fire-and-forget `notify(...).catch(...)` is silently dropped on
  // Vercel serverless, which is why bookings used to insert rows
  // but never notify anyone.
  notifyAfter('booking_submitted', inserted.id, {
    bookingId: inserted.id,
    requesterId: user.id,
    facilityName: facility.name,
    whenLabel: `${body.date} · ${body.time_slot}`,
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}
