import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { consume, getClientIp } from '@/lib/rate-limit';
import { consumeLookupToken } from '@/lib/forgot-password-token';
import { notifyAfter } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================
// Admin-mediated password recovery — submit a request.
//
// This is the LAST-RESORT branch of /auth/forgot-password,
// hit only when:
//   - The lookup step (POST /lookup) returned has_email=false
//     AND has_telegram=false for the resident, AND
//   - The resident chose "Request admin reset".
//
// The request is recorded in admin_recovery_requests with the
// resident's typed contact note, then notify() fans out to all
// admins. Admin verifies the resident OUT OF BAND (call them,
// see them in person — small society) and uses /admin/users to
// generate a temp password. The actual reset endpoint is at
// /api/admin/recovery-requests/[id]/resolve.
//
// Anti-abuse:
//   - The lookup_id is a server-issued signed token, so callers
//     can't enumerate profile IDs through this endpoint.
//   - Per-profile dedup: if a pending request already exists,
//     we treat the second submit as idempotent and return ok:true
//     without firing another admin notification. Saves admins
//     from getting paged repeatedly by a tap-happy resident.
//   - Per-IP rate limit: 5 requests / 30 min. A misbehaving
//     client can still get blocked from generating new requests
//     for different profiles.
// =============================================================

interface SubmitPayload {
  lookup_id?: string;
  contact_note?: string;
}

const IP_LIMIT = 5;
const IP_WINDOW_MS = 30 * 60 * 1000;

function tooManyRequests(retryAfterMs: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: 'Too many requests. Please wait a while before trying again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

function fingerprint(req: Request): string {
  const ua = req.headers.get('user-agent') ?? '';
  const lang = req.headers.get('accept-language')?.slice(0, 16) ?? '';
  return crypto
    .createHash('sha256')
    .update(`${ua}|${lang}`)
    .digest('hex')
    .slice(0, 32);
}

// We deliberately store a TRUNCATED IP rather than the raw one.
// /admin/users renders this back to admins so they can spot a
// fishy "request from a totally different region" pattern, but
// we don't need the full IPv4 octet to tell that — a /16 is
// enough. Removes the row from being a useful cross-reference
// point if the DB is ever leaked.
function truncateIp(ip: string): string {
  if (!ip) return '';
  // IPv6 — keep first two hextets (~/32).
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 2).join(':')}:…`;
  }
  // IPv4 — keep first two octets, mask last two.
  const parts = ip.split('.');
  if (parts.length !== 4) return ip.slice(0, 16);
  return `${parts[0]}.${parts[1]}.x.x`;
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ipCheck = consume(`fp:adminrec:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  let body: SubmitPayload;
  try {
    body = (await req.json()) as SubmitPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const lookupId = (body.lookup_id ?? '').trim();
  if (!lookupId) {
    return NextResponse.json(
      { error: 'Lookup token missing. Restart the reset flow.' },
      { status: 400 },
    );
  }

  // Bound the contact note. The DB has its own length check too.
  const contactNote = (body.contact_note ?? '').trim().slice(0, 500) || null;

  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      { error: 'Service unavailable. Please contact an admin directly.' },
      { status: 503 },
    );
  }

  const consumed = consumeLookupToken(lookupId);
  if (!consumed.ok) {
    return NextResponse.json(
      { error: 'Reset session expired. Restart the flow.' },
      { status: 400 },
    );
  }
  const profileId = consumed.profileId;

  const admin = createAdminSupabaseClient();

  // Refetch the profile so we (a) fail closed if the row was
  // deleted between /lookup and now and (b) populate the admin
  // notification with the fresh display name and flat number.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, full_name, phone, flat_number, email, is_approved')
    .eq('id', profileId)
    .maybeSingle();
  if (profileErr || !profile) {
    return NextResponse.json(
      { error: 'Profile not found. Please contact an admin.' },
      { status: 404 },
    );
  }

  // Idempotency: if a pending request already exists, return
  // success without re-notifying admins. The unique partial index
  // (admin_recovery_requests_one_pending_per_profile) would reject
  // the insert anyway, but explicit check gives a cleaner error
  // path and lets us return the same `submitted: true` UX for the
  // duplicate case.
  const { data: existing } = await admin
    .from('admin_recovery_requests')
    .select('id, created_at')
    .eq('profile_id', profileId)
    .eq('status', 'pending')
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      submitted: true,
      already_pending: true,
      // Echo back the original timestamp so the UI can show "you
      // submitted this 12 minutes ago — admin will reach out".
      submitted_at: existing.created_at,
    });
  }

  const fp = fingerprint(req);
  const truncatedIp = truncateIp(ip);

  const { data: inserted, error: insertErr } = await admin
    .from('admin_recovery_requests')
    .insert({
      profile_id: profileId,
      status: 'pending',
      contact_note: contactNote,
      request_fingerprint: fp,
      request_ip: truncatedIp,
    })
    .select('id, created_at')
    .single();

  if (insertErr || !inserted) {
    // The unique index is the only realistic failure mode (race
    // with a concurrent submit). Treat it as success since the
    // user's request IS in fact queued — just by an earlier tap.
    if (
      insertErr &&
      /admin_recovery_requests_one_pending_per_profile|duplicate key/i.test(insertErr.message)
    ) {
      return NextResponse.json({
        ok: true,
        submitted: true,
        already_pending: true,
      });
    }
    return NextResponse.json(
      { error: 'Could not record your request. Please try again.' },
      { status: 500 },
    );
  }

  // Fire the admin notification AFTER the response is queued so
  // the resident's tap doesn't pay the round-trip latency. The
  // dedup key is the request id, so each new pending request
  // fires exactly once (the partial unique index above ensures
  // that's at most once per resident per pending cycle).
  notifyAfter('admin_recovery_requested', inserted.id, {
    requestId: inserted.id,
    profileId,
    fullName: profile.full_name ?? null,
    flatNumber: profile.flat_number ?? null,
    phone: profile.phone ?? null,
    contactNote,
  });

  return NextResponse.json({
    ok: true,
    submitted: true,
    submitted_at: inserted.created_at,
  });
}
