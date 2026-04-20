import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { logAdminAction } from '@/lib/admin-audit';

interface PutBody {
  // Full set of tag IDs the profile should have AFTER the call.
  // Sending [] clears all tags for this profile.
  tag_ids: string[];
}

// GET /api/admin/profiles/[id]/tags — return the currently assigned tags
// for a profile (used to populate the assign UI).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const { data, error } = await auth.supabase
    .from('profile_admin_tags')
    .select('tag_id, assigned_at')
    .eq('profile_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tag_ids: (data ?? []).map((r) => r.tag_id) });
}

// PUT /api/admin/profiles/[id]/tags — replace the entire set of tags
// for the profile in one call. Computes the diff (added vs removed)
// so the audit log captures exactly what changed instead of a noisy
// "deleted all + recreated all".
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const body = (await req.json()) as PutBody;
  if (!Array.isArray(body.tag_ids)) {
    return NextResponse.json({ error: 'tag_ids must be an array' }, { status: 400 });
  }

  // Verify the target profile is actually an admin BEFORE we touch
  // anything. The DB trigger will block insertions for non-admins,
  // but we want a clean 422 from the API (rather than the trigger's
  // "errcode 23514" bubbling up as a generic 500).
  const { data: target } = await auth.supabase
    .from('profiles').select('id, role, full_name, flat_number').eq('id', id).maybeSingle();
  if (!target) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  if (target.role !== 'admin') {
    return NextResponse.json({
      error: 'Association tags can only be assigned to admins.',
    }, { status: 422 });
  }

  // De-duplicate the requested set so a noisy client can't insert
  // duplicate (profile_id, tag_id) pairs (which the PK would reject).
  const requested = Array.from(new Set(body.tag_ids));

  const { data: existing, error: existingErr } = await auth.supabase
    .from('profile_admin_tags').select('tag_id').eq('profile_id', id);
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
  const existingIds = new Set((existing ?? []).map((r) => r.tag_id));

  const toAdd = requested.filter((t) => !existingIds.has(t));
  const toRemove = Array.from(existingIds).filter((t) => !requested.includes(t));

  if (toRemove.length > 0) {
    const { error } = await auth.supabase
      .from('profile_admin_tags')
      .delete()
      .eq('profile_id', id)
      .in('tag_id', toRemove);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((tag_id) => ({ profile_id: id, tag_id, assigned_by: auth.profile.id }));
    const { error } = await auth.supabase.from('profile_admin_tags').insert(rows);
    if (error) {
      // 23514 is the trigger's "only admins can be tagged" check.
      if (error.code === '23514') {
        return NextResponse.json({ error: 'Tags can only be assigned to admins.' }, { status: 422 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Fetch labels for the audit snapshot so the log is readable
  // ("added: Treasurer; removed: Vice President") without having to
  // re-query later.
  const allChanged = Array.from(new Set([...toAdd, ...toRemove]));
  let labels: Record<string, string> = {};
  if (allChanged.length > 0) {
    const { data: tagRows } = await auth.supabase
      .from('admin_tags').select('id, label').in('id', allChanged);
    labels = Object.fromEntries((tagRows ?? []).map((t) => [t.id, t.label]));
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    logAdminAction({
      actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
      action: 'update',
      targetType: 'profile_admin_tag',
      targetId: id,
      targetLabel: target.full_name
        ? `${target.full_name}${target.flat_number ? ` (${target.flat_number})` : ''}`
        : id,
      before: { tag_ids: Array.from(existingIds), tag_labels: Array.from(existingIds).map((t) => labels[t]).filter(Boolean) },
      after: { tag_ids: requested, added: toAdd.map((t) => labels[t]).filter(Boolean), removed: toRemove.map((t) => labels[t]).filter(Boolean) },
      request: req,
    });
  }

  return NextResponse.json({ ok: true, tag_ids: requested, added: toAdd, removed: toRemove });
}
