import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { notifyAfter } from '@/lib/notify';
import { mailBookingInviteAfter } from '@/lib/booking-email';

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

  // We pull `full_name`, `phone`, and `email` here too so:
  //   - admin Telegram/push can show "who's asking" (Flat 413 \u00b7
  //     Bhargava \u00b7 +91…) without forcing the admin to open the app;
  //   - the booking-confirmation email + tentative ICS can be sent
  //     to the requester immediately on submit.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, flat_number, full_name, phone, email')
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
    requesterName: profile.full_name ?? null,
    requesterFlat: profile.flat_number ?? null,
    requesterPhone: profile.phone ?? null,
    notes: body.notes ?? null,
  });

  // Resident-side echo. Goes to just the requester, with no admin
  // buttons. Two distinct notifications by design — see the comment
  // block at the top of src/lib/notify-routing.ts on the *_submitted
  // / *_acknowledged split. The dedup ledger uses a different ref id
  // (`-ack` suffix) so this never collides with the admin send.
  notifyAfter('booking_acknowledged', `${inserted.id}-ack`, {
    bookingId: inserted.id,
    requesterId: user.id,
    facilityName: facility.name,
    whenLabel: `${body.date} · ${body.time_slot}`,
  });

  // Mail the resident a "booking received" email with a TENTATIVE
  // ICS attached. Their calendar will hold the slot pending admin
  // approval; on approve we send a CONFIRMED update with the same
  // UID so the entry transitions in place. On reject we send a
  // CANCEL so it disappears from their calendar instead of staying
  // tentative forever. Email is best-effort: if Brevo isn't
  // configured the booking still succeeds.
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  mailBookingInviteAfter({
    phase: 'submit',
    origin,
    bookingId: inserted.id,
    facility: facility.name,
    date: body.date,
    timeSlot: body.time_slot,
    notes: body.notes ?? null,
    resident: { name: profile.full_name ?? null, email: profile.email ?? null },
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}
