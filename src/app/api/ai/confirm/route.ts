import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { consume, getClientIp } from '@/lib/rate-limit';
import { verifyPendingActionToken } from '@/lib/ai/pending';
import { notifyAfter } from '@/lib/notify';
import { mailBookingInviteAfter } from '@/lib/booking-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Confirm an AI-drafted action.
 *
 * The chat UI POSTs `{ token }` here when the user taps Confirm on the
 * pending-action card. We verify:
 *   - The token's HMAC signature.
 *   - The token's user_id matches the authenticated session.
 *   - The token has not expired (5-minute TTL by default).
 * Then we run the actual write through the same paths a manual user would,
 * including all the same validation and notifications. The route NEVER
 * trusts any field from the request body — every field comes from the
 * verified token payload.
 */

interface ConfirmPayload {
  token?: string;
}

const CONFIRM_LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const ip = getClientIp(req);
  const limiter = consume(`ai-confirm:${user.id}:${ip}`, CONFIRM_LIMIT, WINDOW_MS);
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: 'Too many confirmations. Please wait and retry.' },
      { status: 429 },
    );
  }

  let body: ConfirmPayload;
  try {
    body = (await req.json()) as ConfirmPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  let verified;
  try {
    verified = verifyPendingActionToken(body.token, user.id);
  } catch (err) {
    // Misconfigured server (missing AI_TOOLS_SECRET) — surface as 503 so the
    // admin sees a clear message instead of a generic 400.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI tools secret is not configured.' },
      { status: 503 },
    );
  }
  if (!verified.ok || !verified.payload) {
    const friendly: Record<string, string> = {
      expired: 'This action expired. Please ask the assistant again.',
      bad_signature: 'This action could not be verified. Please ask the assistant again.',
      malformed: 'This action could not be verified. Please ask the assistant again.',
      wrong_user: 'This action belongs to a different user.',
      wrong_version: 'This action token is from an old version. Please ask the assistant again.',
    };
    return NextResponse.json(
      { error: friendly[verified.reason ?? ''] ?? 'Could not verify action.' },
      { status: 400 },
    );
  }

  const action = verified.payload.action;

  if (action.kind === 'create_booking') {
    return await runCreateBooking(req, user.id, action.args);
  }
  if (action.kind === 'create_issue') {
    return await runCreateIssue(user.id, action.args);
  }
  return NextResponse.json({ error: 'Unknown action kind' }, { status: 400 });
}

async function runCreateBooking(
  req: Request,
  userId: string,
  args: { facility: string; date: string; time_slot: string; notes: string | null },
): Promise<NextResponse> {
  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      {
        error:
          'Server is missing SUPABASE_SERVICE_ROLE_KEY. Bookings cannot be created until the admin sets this env var.',
      },
      { status: 500 },
    );
  }

  // Re-fetch the resident's profile + facility row + subscription using
  // the resident's session-bound client so RLS enforces access. We do
  // NOT trust the action args for anything but the user-chosen facility
  // name / date / time_slot / notes — those are still validated below.
  const supabase = await createServerSupabaseClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, flat_number, full_name, phone, email')
    .eq('id', userId)
    .single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const { data: facility } = await supabase
    .from('clubhouse_facilities')
    .select('id, name, slug, requires_subscription, is_bookable, is_active')
    .eq('name', args.facility)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json(
      { error: `Facility "${args.facility}" was not found. The assistant may have used a stale name.` },
      { status: 404 },
    );
  }
  if (!facility.is_active || !facility.is_bookable) {
    return NextResponse.json({ error: `${facility.name} is not currently bookable` }, { status: 409 });
  }

  if (facility.requires_subscription) {
    if (!profile.flat_number) {
      return NextResponse.json(
        {
          error: `${facility.name} requires a clubhouse subscription. Please set your flat number, then ask admin to activate one.`,
        },
        { status: 403 },
      );
    }
    const { data: sub } = await supabase
      .from('clubhouse_subscriptions')
      .select('id, tier_id, end_date, clubhouse_tiers(included_facilities)')
      .eq('flat_number', profile.flat_number)
      .eq('status', 'active')
      .maybeSingle();
    const includedFacilities =
      (sub?.clubhouse_tiers as { included_facilities?: string[] } | null)?.included_facilities ?? [];
    if (!sub || !includedFacilities.includes(facility.slug)) {
      return NextResponse.json(
        {
          error: `${facility.name} requires a clubhouse tier that includes it. Please contact admin to upgrade.`,
        },
        { status: 403 },
      );
    }
  }

  const admin = createAdminSupabaseClient();
  const { data: inserted, error } = await admin
    .from('bookings')
    .insert({
      user_id: userId,
      facility: facility.name,
      date: args.date,
      time_slot: args.time_slot,
      notes: args.notes,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  notifyAfter('booking_submitted', inserted.id, {
    bookingId: inserted.id,
    requesterId: userId,
    facilityName: facility.name,
    whenLabel: `${args.date} · ${args.time_slot}`,
    requesterName: profile.full_name ?? null,
    requesterFlat: profile.flat_number ?? null,
    requesterPhone: profile.phone ?? null,
    notes: args.notes,
  });

  // Resident-side echo (mirrors /api/bookings POST). See the
  // *_submitted / *_acknowledged split in src/lib/notify-routing.ts.
  notifyAfter('booking_acknowledged', `${inserted.id}-ack`, {
    bookingId: inserted.id,
    requesterId: userId,
    facilityName: facility.name,
    whenLabel: `${args.date} · ${args.time_slot}`,
  });

  const origin = req.headers.get('origin') || new URL(req.url).origin;
  mailBookingInviteAfter({
    phase: 'submit',
    origin,
    bookingId: inserted.id,
    facility: facility.name,
    date: args.date,
    timeSlot: args.time_slot,
    notes: args.notes,
    resident: { name: profile.full_name ?? null, email: profile.email ?? null },
  });

  return NextResponse.json({
    ok: true,
    kind: 'create_booking',
    id: inserted.id,
    message: `Booking submitted for ${facility.name} on ${args.date} at ${args.time_slot}. Admin will review shortly.`,
  });
}

async function runCreateIssue(
  userId: string,
  args: { title: string; description: string; category: string; priority: string },
): Promise<NextResponse> {
  // Issues use the resident's session client directly (RLS allows residents
  // to insert issues for themselves). This matches the manual flow at
  // /dashboard/issues so audit/notification behaviour stays consistent.
  const supabase = await createServerSupabaseClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('flat_number')
    .eq('id', userId)
    .maybeSingle();

  const { data: inserted, error } = await supabase
    .from('issues')
    .insert({
      created_by: userId,
      title: args.title,
      description: args.description,
      category: args.category,
      priority: args.priority,
      flat_number: profile?.flat_number ?? null,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    kind: 'create_issue',
    id: inserted.id,
    message: `Issue raised: "${args.title}". Track it under Issues.`,
  });
}
