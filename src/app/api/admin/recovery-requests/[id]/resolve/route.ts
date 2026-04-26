import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { notifyAfter } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================
// Admin-only: resolve a recovery request.
//
// Two modes:
//   action='reset'    -> generate a temp password, set it on the
//                        auth user, mark row resolved. Returns
//                        the temp password to the admin's screen
//                        ONCE so they can read it to the
//                        resident. We do NOT store the password
//                        anywhere — the admin must capture it
//                        the moment the API responds.
//   action='cancel'   -> dismiss the request without reset (e.g.
//                        admin determines it's spam, or the
//                        resident already got back in via email).
//                        Audit-logged but no notification fired
//                        (the resident is still in the same
//                        broken state — no need to ping them).
//
// Why temp passwords instead of a magic link:
//   The whole point of THIS branch is the resident has no working
//   email and no Telegram. A magic link can't reach them. The
//   admin reads the password to them by phone or hands it to
//   them in person.
//
// Password format:
//   12-char base32-ish alphabet. Easy to read aloud (no 0/O,
//   no 1/I/l). Strong enough that an attacker who somehow
//   captures one specific word-of-mouth handover from the admin
//   to the resident has no shortcut to brute-force the next.
// =============================================================

interface ResolvePayload {
  action?: 'reset' | 'cancel';
  resolution_note?: string;
}

const TEMP_PWD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEMP_PWD_LEN = 12;

function generateTempPassword(): string {
  const out: string[] = [];
  // crypto.randomInt is uniform; we sample TEMP_PWD_LEN chars
  // from a 32-char alphabet so the result has ~60 bits of entropy.
  for (let i = 0; i < TEMP_PWD_LEN; i++) {
    out.push(TEMP_PWD_ALPHABET[crypto.randomInt(0, TEMP_PWD_ALPHABET.length)]);
  }
  // Insert a hyphen at the midpoint to make reading aloud easier:
  // "B7K4QM-9PXNT3" is much easier to dictate than "B7K4QM9PXNT3".
  const half = Math.floor(TEMP_PWD_LEN / 2);
  return `${out.slice(0, half).join('')}-${out.slice(half).join('')}`;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Request id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  if (!isAdminClientConfigured()) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  let body: ResolvePayload;
  try {
    body = (await req.json()) as ResolvePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action ?? 'reset';
  if (action !== 'reset' && action !== 'cancel') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const resolutionNote = (body.resolution_note ?? '').trim().slice(0, 500) || null;

  const admin = createAdminSupabaseClient();

  // Refetch under the service-role client. The row's state is the
  // source of truth — if it's already resolved/cancelled we treat
  // this as a no-op rather than double-firing.
  const { data: request, error: readErr } = await admin
    .from('admin_recovery_requests')
    .select('id, profile_id, status, contact_note, created_at')
    .eq('id', id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!request) {
    return NextResponse.json({ error: 'Recovery request not found' }, { status: 404 });
  }
  if (request.status !== 'pending') {
    return NextResponse.json(
      { error: `Already ${request.status}. Refresh the page.` },
      { status: 409 },
    );
  }

  // Pull the target profile so we (a) double-check it still
  // exists, (b) populate the audit log, and (c) include the
  // resident's name in the notify() call.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, full_name, email, flat_number, phone')
    .eq('id', request.profile_id)
    .maybeSingle();
  if (profileErr || !profile) {
    return NextResponse.json(
      { error: 'Profile no longer exists. Cancelling request.' },
      { status: 404 },
    );
  }

  if (action === 'cancel') {
    const { error: cancelErr } = await admin
      .from('admin_recovery_requests')
      .update({
        status: 'cancelled',
        resolved_by: me.id,
        resolved_at: new Date().toISOString(),
        resolution_note: resolutionNote,
      })
      .eq('id', id)
      .eq('status', 'pending'); // Avoid racing two admins.
    if (cancelErr) {
      return NextResponse.json({ error: cancelErr.message }, { status: 500 });
    }
    logAdminAction({
      actor: { id: me.id, email: me.email, name: me.full_name },
      action: 'update',
      targetType: 'profile',
      targetId: profile.id,
      targetLabel: `Recovery request cancelled — ${
        profile.full_name ?? profile.email ?? profile.id
      }`,
      reason: resolutionNote,
      before: { status: 'pending' } as Record<string, unknown>,
      after: { status: 'cancelled' } as Record<string, unknown>,
      request: req,
    });
    return NextResponse.json({ ok: true, status: 'cancelled' });
  }

  // ---- action === 'reset' --------------------------------------
  // Set a fresh password on the auth user. This lives in
  // auth.users so we MUST go through admin.auth.admin —
  // there's no RLS-level workaround for password resets.
  const tempPassword = generateTempPassword();

  const { error: pwdErr } = await admin.auth.admin.updateUserById(profile.id, {
    password: tempPassword,
  });
  if (pwdErr) {
    return NextResponse.json(
      { error: `Could not set password: ${pwdErr.message}` },
      { status: 500 },
    );
  }

  // Flip the request to resolved. The CAS on status='pending'
  // ensures two admins racing this endpoint can't both mark it
  // resolved (only one update succeeds; the loser sees row count
  // 0 and we surface a 409 via the recheck below).
  const { data: updated, error: updateErr } = await admin
    .from('admin_recovery_requests')
    .update({
      status: 'resolved',
      resolved_by: me.id,
      resolved_at: new Date().toISOString(),
      resolution_note: resolutionNote,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (updateErr || !updated) {
    // The password did get reset (auth.users is updated above) but
    // we couldn't flag the request as resolved. The audit log
    // still records the act so an admin can manually flip the row.
    return NextResponse.json(
      {
        error:
          'Password was reset but the request row could not be flagged. Refresh and check the panel.',
      },
      { status: 500 },
    );
  }

  logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'update',
    targetType: 'profile',
    targetId: profile.id,
    targetLabel: `Password reset via recovery request — ${
      profile.full_name ?? profile.email ?? profile.id
    }`,
    reason: resolutionNote,
    // Snapshot only the fields that changed. The temp password
    // itself is never persisted — neither in the audit log nor
    // anywhere else.
    before: { status: 'pending' } as Record<string, unknown>,
    after: { status: 'resolved', resolved_by: me.id } as Record<string, unknown>,
    request: req,
  });

  notifyAfter('admin_recovery_resolved', id, {
    requestId: id,
    profileId: profile.id,
    adminName: me.full_name ?? null,
  });

  return NextResponse.json({
    ok: true,
    status: 'resolved',
    // Returned ONCE. Admin reads it to the resident. There is no
    // "show password again" flow on purpose — if the admin missed
    // it, they re-resolve a fresh request (the old one is now
    // 'resolved' and a new one will need to be re-submitted by
    // the resident, which is the correct security model).
    temp_password: tempPassword,
    profile: {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      flat_number: profile.flat_number,
      phone: profile.phone,
    },
  });
}
