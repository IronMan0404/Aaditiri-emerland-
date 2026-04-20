import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Hard-delete a user from the system.
 *
 * Effects (cascading by FK on profiles.id → auth.users.id):
 *   - profiles row is removed
 *   - vehicles, family_members, pets, event_rsvps, photos, bookings,
 *     bot_message_recipients, etc. are removed by ON DELETE CASCADE
 *   - the auth.users row is removed last via the service-role admin API,
 *     freeing up the email address for future re-registration
 *
 * Caller must be an authenticated admin. Self-delete is blocked — admins
 * cannot remove their own account from this endpoint (avoids accidental
 * lockout). Use Supabase Dashboard → Authentication → Users for that.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'User id required' }, { status: 400 });
  }

  // Authn + authz with the regular SSR client (RLS-aware).
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const caller = authRes?.user;
  if (!caller) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', caller.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  if (caller.id === id) {
    return NextResponse.json(
      { error: "You can't delete your own account from here. Ask another admin." },
      { status: 400 },
    );
  }

  // Look up the target so the response can echo something useful and so
  // we can snapshot the row in the audit log before the cascade wipes it.
  const { data: target } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      {
        error:
          'Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local ' +
          '(and Vercel) from Supabase Dashboard → Project Settings → API.',
      },
      { status: 500 },
    );
  }

  // Privileged delete. Removing from auth.users cascades to profiles
  // (and from there to vehicles/family/pets/etc.) because every public
  // table FKs into profiles.id with ON DELETE CASCADE.
  const admin = createAdminSupabaseClient();
  const { error: deleteErr } = await admin.auth.admin.deleteUser(id);
  if (deleteErr) {
    return NextResponse.json(
      { error: `Failed to delete: ${deleteErr.message}` },
      { status: 500 },
    );
  }

  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'delete',
    targetType: 'profile',
    targetId: id,
    targetLabel: target?.full_name ?? target?.email ?? id,
    before: target ?? null,
    after: null,
    request: req,
  });

  return NextResponse.json({
    ok: true,
    deleted: { id, email: target?.email ?? null, full_name: target?.full_name ?? null },
  });
}
