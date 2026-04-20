import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { logAdminAction } from '@/lib/admin-audit';

interface PatchBody {
  label?: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
  display_order?: number;
  is_active?: boolean;
}

// PATCH /api/admin/admin-tags/[id] — edit an existing tag.
// Code is intentionally NOT mutable: the code is referenced from
// elsewhere in the app and from logs, so renaming would break audit
// readability. If a code is wrong, delete + recreate.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const body = (await req.json()) as PatchBody;

  const { data: before, error: beforeErr } = await auth.supabase
    .from('admin_tags').select('*').eq('id', id).maybeSingle();
  if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });

  // Only forward keys the user actually sent; keeps the audit diff
  // accurate (we don't want to log "color: '#374151' -> '#374151'"
  // just because the form re-submitted the default).
  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) patch.label = body.label.trim();
  if (body.description !== undefined) patch.description = body.description?.trim() || null;
  if (body.color !== undefined) patch.color = body.color.trim() || '#374151';
  if (body.icon !== undefined) patch.icon = body.icon?.trim() || null;
  if (body.display_order !== undefined) patch.display_order = body.display_order;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ tag: before });
  }

  const { data: after, error } = await auth.supabase
    .from('admin_tags').update(patch).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'update',
    targetType: 'admin_tag',
    targetId: id,
    targetLabel: after.label,
    before,
    after,
    request: req,
  });

  return NextResponse.json({ tag: after });
}

// DELETE /api/admin/admin-tags/[id] — remove a tag.
// Cascades to profile_admin_tags (FK on delete cascade) so every
// admin who currently has this tag loses it. Audit captures the
// snapshot for forensics.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const { data: before, error: beforeErr } = await auth.supabase
    .from('admin_tags').select('*').eq('id', id).maybeSingle();
  if (beforeErr) return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  if (!before) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });

  const { error } = await auth.supabase.from('admin_tags').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'delete',
    targetType: 'admin_tag',
    targetId: id,
    targetLabel: before.label,
    before,
    request: req,
  });

  return NextResponse.json({ ok: true });
}
