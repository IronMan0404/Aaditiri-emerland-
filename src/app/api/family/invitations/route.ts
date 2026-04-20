import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import {
  generateInviteToken,
  isFamilyRelation,
  buildInviteEmail,
  originFor,
  type FamilyRelation,
} from '@/lib/family-invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateBody {
  invitee_name: string;
  invitee_email: string;
  relation: FamilyRelation;
  message?: string;
  // Optional: when present, this invite is "upgrading" an EXISTING
  // family_members display row (created via the FamilyEditor on the
  // profile page) into a full login account. We'll backfill its
  // `email` + `invitation_id` columns so the row shows "Pending
  // invite" inline. When omitted, we'll create a fresh display row
  // alongside the invitation so the family member appears on the
  // primary resident's roster from the moment they're invited.
  family_member_id?: string;
}

// GET /api/family/invitations
// Lists all invitations the caller can see (their own + same-flat
// residents'). RLS on family_invitations is doing the heavy lifting;
// we just SELECT and let Postgres filter.
export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from('family_invitations')
    .select('id, inviter_id, flat_number, invitee_email, invitee_name, relation, message, status, expires_at, accepted_at, accepted_profile_id, revoked_at, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invitations: data ?? [] });
}

// POST /api/family/invitations
// Creates a new family invitation and emails the link. The inviter
// must be an APPROVED owner or tenant — the RLS policy enforces this
// independently, but we check eagerly so we can return a friendly 403
// instead of a generic RLS rejection.
export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  if (!auth.profile.is_approved) {
    return NextResponse.json({ error: 'Your account must be approved before you can invite family members.' }, { status: 403 });
  }
  if (!auth.profile.flat_number) {
    return NextResponse.json({ error: 'Set your flat number before inviting family members.' }, { status: 400 });
  }
  if (!auth.profile.resident_type || (auth.profile.resident_type !== 'owner' && auth.profile.resident_type !== 'tenant')) {
    return NextResponse.json({ error: 'Only flat owners and tenants can invite family members.' }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const inviteeName = body.invitee_name?.trim() ?? '';
  const inviteeEmail = body.invitee_email?.trim().toLowerCase() ?? '';
  const relation = body.relation;
  const message = body.message?.trim() || null;

  if (!inviteeName) return NextResponse.json({ error: 'Invitee name required' }, { status: 400 });
  if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  if (!isFamilyRelation(relation)) {
    return NextResponse.json({ error: 'Invalid relation' }, { status: 400 });
  }

  // Reject inviting the caller themselves — easy mistake; gives a
  // confusing UX otherwise (they'd get a "this email is already
  // registered" error during accept).
  if (inviteeEmail === auth.profile.email?.toLowerCase()) {
    return NextResponse.json({ error: 'You cannot invite yourself.' }, { status: 400 });
  }

  // Reject if there's already a profile with this email — they're
  // already a resident (or pending one) and don't need a family
  // invite.
  //
  // PRIVACY: we only reveal WHERE the email belongs if it's on the
  // SAME flat as the inviter (in which case the inviter probably
  // already knows). For an email that belongs to a different flat we
  // give a generic "already has an account" so the invite form can't
  // be used as an oracle to map emails to flats.
  const { data: existing } = await auth.supabase
    .from('profiles').select('id, full_name, flat_number').ilike('email', inviteeEmail).maybeSingle();
  if (existing) {
    const sameFlat = existing.flat_number === auth.profile.flat_number;
    return NextResponse.json({
      error: sameFlat
        ? `${existing.full_name ?? inviteeEmail} is already on your flat's roster — no invite needed.`
        : `${inviteeEmail} already has an account on this site. Family invites can only go to fresh emails.`,
    }, { status: 409 });
  }

  // If the caller supplied a family_member_id, validate it belongs to
  // someone on the same flat (RLS already restricts SELECT to same-
  // flat after migration 20260427, but we double-check for clarity).
  let linkedFamilyMemberId: string | null = null;
  if (body.family_member_id) {
    const { data: fm, error: fmErr } = await auth.supabase
      .from('family_members')
      .select('id, user_id, account_profile_id, invitation_id, email')
      .eq('id', body.family_member_id)
      .maybeSingle();
    if (fmErr) return NextResponse.json({ error: fmErr.message }, { status: 500 });
    if (!fm) return NextResponse.json({ error: 'Family member row not found' }, { status: 404 });
    if (fm.account_profile_id) {
      return NextResponse.json({ error: 'This family member already has a login account.' }, { status: 409 });
    }
    if (fm.invitation_id) {
      return NextResponse.json({ error: 'This family member already has a pending invite. Revoke it before re-inviting.' }, { status: 409 });
    }
    linkedFamilyMemberId = fm.id;
  }

  // Pre-check: a UNIQUE index `family_members_email_unique` on
  // `lower(email)` means we cannot have the same email twice across
  // the whole table. If it's already present we either:
  //   - point our linkage at the existing row (if it has no
  //     account/invite already AND it belongs to this same flat), OR
  //   - reject with a clear error.
  // Doing this BEFORE inserting the family_invitations row avoids
  // creating orphan invitations that no UI can ever show.
  if (!linkedFamilyMemberId) {
    const { data: emailRow } = await auth.supabase
      .from('family_members')
      .select('id, user_id, account_profile_id, invitation_id, profiles!inner(flat_number)')
      .ilike('email', inviteeEmail)
      .maybeSingle();
    if (emailRow) {
      // Cast: nested join projection isn't typed by supabase-js without codegen.
      const targetFlat = (emailRow as unknown as { profiles?: { flat_number?: string } }).profiles?.flat_number;
      if (targetFlat !== auth.profile.flat_number) {
        return NextResponse.json({
          error: `${inviteeEmail} is already linked to a family roster on a different flat. Family invites can only go to fresh emails.`,
        }, { status: 409 });
      }
      if (emailRow.account_profile_id) {
        return NextResponse.json({ error: 'This email already has a login account on your flat.' }, { status: 409 });
      }
      if (emailRow.invitation_id) {
        return NextResponse.json({ error: 'A pending invite already exists for this email on your flat. Revoke it first to resend.' }, { status: 409 });
      }
      linkedFamilyMemberId = emailRow.id;
    }
  }

  const { raw, hash } = generateInviteToken();

  const { data: invite, error: insertErr } = await auth.supabase
    .from('family_invitations')
    .insert({
      inviter_id: auth.profile.id,
      flat_number: auth.profile.flat_number,
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      relation,
      message,
      token_hash: hash,
    })
    .select()
    .single();

  if (insertErr) {
    // 23505 = our partial unique index "one pending per email per flat".
    if (insertErr.code === '23505') {
      return NextResponse.json({
        error: `${inviteeEmail} already has a pending invite for Flat ${auth.profile.flat_number}. Revoke it first if you want to re-send.`,
      }, { status: 409 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Attach this invite back to the existing family_members display
  // row (or create a fresh one) so the primary resident's profile
  // page shows the "Pending invite" badge inline next to the family
  // entry. We attempt this BEFORE returning so that on failure we can
  // roll back the invitation row and report a clean error — leaving
  // an orphan invite in the DB would just confuse the inviter.
  if (linkedFamilyMemberId) {
    const { error: linkErr } = await auth.supabase
      .from('family_members')
      .update({ invitation_id: invite.id, email: inviteeEmail })
      .eq('id', linkedFamilyMemberId);
    if (linkErr) {
      // Roll back the invitation. Best-effort, but we have to try.
      await auth.supabase.from('family_invitations').delete().eq('id', invite.id);
      return NextResponse.json({ error: `Could not link invite to family roster: ${linkErr.message}` }, { status: 500 });
    }
  } else {
    // No family_member row yet: create a placeholder so the inviter
    // sees "Priya · spouse · pending invite" on their profile page
    // immediately. The row gets `account_profile_id` filled in on
    // accept; if revoked, the row sticks around as display-only
    // (which is fine — Priya is still spouse, just without login).
    const { error: phErr } = await auth.supabase
      .from('family_members')
      .insert({
        user_id: auth.profile.id,
        full_name: inviteeName,
        relation,
        email: inviteeEmail,
        invitation_id: invite.id,
      });
    if (phErr) {
      await auth.supabase.from('family_invitations').delete().eq('id', invite.id);
      // 23505 here would be a race we missed in the pre-check above.
      const msg = phErr.code === '23505'
        ? `${inviteeEmail} was just added to a family roster. Refresh and try again.`
        : `Could not create family roster entry: ${phErr.message}`;
      return NextResponse.json({ error: msg }, { status: 409 });
    }
  }

  // Build the accept URL with the RAW token. Invitee will hit this and
  // hand the token back; we'll hash again and look up the row.
  const acceptUrl = `${originFor(req)}/family/accept/${raw}`;

  let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
  let emailError: string | null = null;
  if (isEmailConfigured()) {
    const tpl = buildInviteEmail({
      inviterName: auth.profile.full_name ?? 'Someone',
      inviterFlat: auth.profile.flat_number,
      inviteeName,
      acceptUrl,
      message,
      expiresAtIso: invite.expires_at,
    });
    const r = await sendEmail({
      to: inviteeEmail,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    if (r.ok) emailStatus = 'sent';
    else if ('skipped' in r && r.skipped) emailStatus = 'skipped';
    else { emailStatus = 'failed'; emailError = 'error' in r ? r.error : 'unknown'; }
  }

  return NextResponse.json({
    ok: true,
    invitation: {
      id: invite.id,
      inviter_id: invite.inviter_id,
      flat_number: invite.flat_number,
      invitee_email: invite.invitee_email,
      invitee_name: invite.invitee_name,
      relation: invite.relation,
      message: invite.message,
      status: invite.status,
      expires_at: invite.expires_at,
      created_at: invite.created_at,
    },
    // We surface the URL so the inviter can copy it from the UI as a
    // fallback (e.g. if email delivery is configured but the invitee
    // didn't get it). It is NEVER returned again after this response.
    accept_url: acceptUrl,
    email_status: emailStatus,
    email_error: emailError,
  });
}
