import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE /api/family/members/[id]
// Revokes a family member's access (deletes their auth user + profile).
// Allowed for:
//   - The original inviter
//   - Any approved owner / tenant on the SAME flat (so spouses can
//     manage each other's family members)
//   - Admins
//
// We hard-delete rather than soft-suspend because:
//   * The PRIMARY owner of the flat asked for this; they expect it
//     to be gone.
//   * Family rows have very few foreign-key dependencies — a deleted
//     auth user cascades the profile away (ON DELETE CASCADE), and
//     contributions / comments authored by the family member retain
//     a NULL author with their snapshotted name (already the pattern
//     used by other delete flows in this app).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!isAdminClientConfigured()) {
    return NextResponse.json({ error: 'Server is misconfigured (missing service role key).' }, { status: 500 });
  }

  const { id } = await ctx.params;

  if (id === auth.profile.id) {
    return NextResponse.json({ error: 'You cannot remove yourself with this endpoint.' }, { status: 400 });
  }

  const { data: target, error: lookupErr } = await auth.supabase
    .from('profiles')
    .select('id, full_name, flat_number, resident_type, inviter_id')
    .eq('id', id)
    .maybeSingle();

  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: 'Family member not found' }, { status: 404 });

  if (target.resident_type !== 'family') {
    return NextResponse.json({ error: 'This endpoint only removes family members. Use the admin user removal flow for owners/tenants.' }, { status: 400 });
  }

  const isAdmin = auth.profile.role === 'admin';
  const isInviter = target.inviter_id === auth.profile.id;
  const isSameFlatPrimary =
    auth.profile.flat_number === target.flat_number
    && (auth.profile.resident_type === 'owner' || auth.profile.resident_type === 'tenant')
    && auth.profile.is_approved === true;

  if (!isAdmin && !isInviter && !isSameFlatPrimary) {
    return NextResponse.json({
      error: "Only the inviter, another resident of the same flat, or an admin can remove a family member.",
    }, { status: 403 });
  }

  // Service-role: deleting an auth user requires the admin API.
  // ON DELETE CASCADE on profiles(id) will wipe the profiles row too.
  // The family_members.account_profile_id FK is ON DELETE SET NULL,
  // so the display row reverts cleanly to "no login attached" — the
  // resident still sees "spouse: Priya" in their roster, just without
  // the green "has account" badge.
  const admin = createAdminSupabaseClient();
  const { error: delErr } = await admin.auth.admin.deleteUser(id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
