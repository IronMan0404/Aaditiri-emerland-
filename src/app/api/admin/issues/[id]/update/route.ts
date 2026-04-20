import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/admin-audit';

// Admin-only: modify an issue (status, priority, assignment, category,
// title, description). Replaces direct
// `supabase.from('issues').update` calls in the admin UI so changes
// are auditable. The existing `/api/admin/issues/[id]/status-notify`
// route still fires push notifications - the admin UI calls both.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = new Set(['todo', 'in_progress', 'resolved', 'closed']);
const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const ALLOWED_CATEGORIES = new Set([
  'plumbing', 'electrical', 'housekeeping', 'security',
  'lift', 'garden', 'pest_control', 'internet', 'other',
]);

interface UpdatePayload {
  status?: string;
  priority?: string;
  category?: string;
  title?: string;
  description?: string;
  assigned_to?: string | null;
  reason?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Issue id required' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as UpdatePayload;
  const patch: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: `status must be one of ${Array.from(ALLOWED_STATUSES).join(', ')}` }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.priority !== undefined) {
    if (!ALLOWED_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ error: `priority must be one of ${Array.from(ALLOWED_PRIORITIES).join(', ')}` }, { status: 400 });
    }
    patch.priority = body.priority;
  }
  if (body.category !== undefined) {
    if (!ALLOWED_CATEGORIES.has(body.category)) {
      return NextResponse.json({ error: `category must be one of ${Array.from(ALLOWED_CATEGORIES).join(', ')}` }, { status: 400 });
    }
    patch.category = body.category;
  }
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (t.length < 1 || t.length > 200) {
      return NextResponse.json({ error: 'title must be 1-200 chars' }, { status: 400 });
    }
    patch.title = t;
  }
  if (body.description !== undefined) {
    const d = String(body.description);
    if (d.length > 4000) {
      return NextResponse.json({ error: 'description max 4000 chars' }, { status: 400 });
    }
    patch.description = d;
  }
  if (body.assigned_to !== undefined) {
    if (body.assigned_to !== null && !UUID_RE.test(body.assigned_to)) {
      return NextResponse.json({ error: 'assigned_to must be a UUID or null' }, { status: 400 });
    }
    patch.assigned_to = body.assigned_to;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data: before, error: fetchErr } = await supabase
    .from('issues')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  }

  // Maintain resolved_at / closed_at the same way the previous client
  // code did, so analytics keep working.
  if (patch.status === 'resolved' && !before.resolved_at) {
    patch.resolved_at = new Date().toISOString();
  }
  if (patch.status === 'closed' && !before.closed_at) {
    patch.closed_at = new Date().toISOString();
  }

  const { data: after, error: updErr } = await supabase
    .from('issues')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const reason = (body.reason ?? '').trim().slice(0, 500) || null;
  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'update',
    targetType: 'issue',
    targetId: id,
    targetLabel: before.title ?? id,
    reason,
    before,
    after,
    request: req,
  });

  return NextResponse.json({ ok: true, id, after });
}
