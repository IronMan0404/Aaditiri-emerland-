import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE /api/family/invitations/[id]
// Soft-revokes a pending invitation (sets status='revoked'). The
// underlying RLS policy already restricts UPDATEs to the inviter,
// same-flat residents, and admins, so we just attempt the update and
// surface a 404 if no row was changed.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const { data, error } = await auth.supabase
    .from('family_invitations')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: auth.profile.id,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Invitation not found or already accepted/revoked' }, { status: 404 });

  // Detach the placeholder family_members row so the profile editor
  // stops showing "Pending invite" against this entry. The row itself
  // sticks around as display-only — the resident still wants to see
  // "wife: Priya" in their roster even after revoking the login.
  await auth.supabase
    .from('family_members')
    .update({ invitation_id: null })
    .eq('invitation_id', id);

  return NextResponse.json({ ok: true });
}
