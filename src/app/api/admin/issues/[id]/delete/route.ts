import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/admin-audit';

// Admin-only: hard-delete an issue. Cascades to issue_comments and
// issue_status_events via FK ON DELETE CASCADE - so the audit log
// snapshot of the issue itself is the only post-mortem record.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeletePayload { reason?: string }

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Issue id required' }, { status: 400 });

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

  const { data: existing, error: fetchErr } = await supabase
    .from('issues')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as DeletePayload;
  const reason = (body.reason ?? '').trim().slice(0, 500) || null;

  const { error: delErr } = await supabase
    .from('issues')
    .delete()
    .eq('id', id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'delete',
    targetType: 'issue',
    targetId: id,
    targetLabel: existing.title ?? id,
    reason,
    before: existing,
    after: null,
    request: req,
  });

  return NextResponse.json({ ok: true, id });
}
