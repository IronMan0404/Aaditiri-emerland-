import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { hashInviteToken } from '@/lib/family-invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/family/accept
// Body: { token: string, password: string, full_name?: string, phone?: string }
//
// Two-mode endpoint depending on whether `password` is supplied:
//   - GET-equivalent (password omitted) → returns the invitation
//     metadata so the accept page can pre-fill the form (name, flat,
//     who invited).
//   - With password → creates the auth user pre-confirmed, inserts a
//     pre-approved profiles row with resident_type='family' and
//     inviter_id linked back, then marks the invitation accepted.
//
// Why one POST endpoint instead of GET + POST? Tokens are sensitive —
// putting them in a query string means they end up in proxy logs and
// browser history. Posting the token in the body keeps it out of
// every log we don't fully control.
//
// Uses the SERVICE-ROLE client because the invitee is NOT signed in
// yet — we need to provision their auth user from outside an
// authenticated session. The token itself is the authorization.

interface AcceptBody {
  token?: string;
  password?: string;
  full_name?: string;
  phone?: string;
}

export async function POST(req: Request) {
  if (!isAdminClientConfigured()) {
    return NextResponse.json({ error: 'Server is misconfigured (missing service role key).' }, { status: 500 });
  }

  let body: AcceptBody;
  try { body = (await req.json()) as AcceptBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const token = body.token?.trim();
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

  const tokenHash = hashInviteToken(token);
  const admin = createAdminSupabaseClient();

  const { data: invite, error: lookupErr } = await admin
    .from('family_invitations')
    .select('id, inviter_id, flat_number, invitee_email, invitee_name, relation, status, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!invite) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });

  if (invite.status !== 'pending') {
    const reason =
      invite.status === 'accepted' ? 'This invitation has already been accepted. Please sign in instead.'
      : invite.status === 'revoked' ? 'This invitation was revoked by the inviter. Ask them to send a new one.'
      : 'This invitation is no longer valid.';
    return NextResponse.json({ error: reason }, { status: 410 });
  }

  if (new Date(invite.expires_at).getTime() < Date.now()) {
    // Mark expired so the same row isn't re-checked. Best-effort —
    // ignore the result, the response shape stays the same regardless.
    await admin
      .from('family_invitations')
      .update({ status: 'expired' })
      .eq('id', invite.id)
      .eq('status', 'pending');
    return NextResponse.json({ error: 'This invitation has expired. Ask your family member to send a new one.' }, { status: 410 });
  }

  // GET-equivalent — caller just wants to see who invited them.
  if (!body.password) {
    // Look up the inviter's display name so the accept page can show
    // "Ravi from Flat 413 invited you". One-off, no PII beyond name +
    // flat (both already in the email anyway).
    const { data: inviter } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', invite.inviter_id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      invitation: {
        invitee_email: invite.invitee_email,
        invitee_name: invite.invitee_name,
        relation: invite.relation,
        flat_number: invite.flat_number,
        inviter_name: inviter?.full_name ?? 'Someone',
      },
    });
  }

  if (body.password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  // Create the auth user pre-confirmed. This bypasses Supabase's
  // confirmation mailer (same trick the registration route uses).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: invite.invitee_email,
    password: body.password,
    email_confirm: true,
    user_metadata: {
      full_name: body.full_name?.trim() || invite.invitee_name,
      flat_number: invite.flat_number,
      resident_type: 'family',
      inviter_id: invite.inviter_id,
    },
  });

  if (createErr || !created.user) {
    const msg = createErr?.message ?? 'Failed to create account';
    if (/already.*regist|already.*exist/i.test(msg)) {
      return NextResponse.json({ error: 'An account with this email already exists. Please sign in instead.' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const userId = created.user.id;
  const fullName = body.full_name?.trim() || invite.invitee_name;
  const phone = body.phone?.trim() || null;

  // Upsert profile pre-approved. The handle_new_user trigger may have
  // fired with default values; we overwrite with the final shape.
  const { error: profileErr } = await admin.from('profiles').upsert({
    id: userId,
    email: invite.invitee_email,
    full_name: fullName,
    phone,
    flat_number: invite.flat_number,
    resident_type: 'family',
    role: 'user',
    is_approved: true,           // family is auto-approved — vouched for by inviter
    inviter_id: invite.inviter_id,
    family_relation: invite.relation,
  });

  if (profileErr) {
    // Roll back the auth user so the invitee can retry. Otherwise we
    // leave a half-created account that blocks future attempts.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  // Mark the invite accepted. Best-effort — the account already exists,
  // so even if this fails the user can sign in. We just lose the
  // "accepted_profile_id" pointer in audit.
  await admin
    .from('family_invitations')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_profile_id: userId,
    })
    .eq('id', invite.id);

  // Backfill the existing family_members display row (created by
  // /api/family/invitations) so it now points at the live login
  // account. We clear `invitation_id` because the invite is no longer
  // pending — the row's "status" is now "Has account". If the row was
  // somehow lost (manual delete by the inviter mid-invite), we no-op.
  await admin
    .from('family_members')
    .update({ account_profile_id: userId, invitation_id: null })
    .eq('invitation_id', invite.id);

  return NextResponse.json({
    ok: true,
    profile: {
      id: userId,
      email: invite.invitee_email,
      full_name: fullName,
      flat_number: invite.flat_number,
    },
  });
}
