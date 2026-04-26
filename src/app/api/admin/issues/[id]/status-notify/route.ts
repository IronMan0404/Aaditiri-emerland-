import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { notify } from '@/lib/notify';
import type { IssueStatus } from '@/types';

// Best-effort push + Telegram fan-out triggered AFTER an admin
// transitions an issue's status (the actual status change happens
// via Supabase update, gated by RLS). We only push for the
// user-visible transitions ('resolved' and 'closed') so residents
// aren't spammed with every internal hand-off.
//
// Migrated to notify('ticket_status_changed', ...) (April 2026).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOTIFIABLE: IssueStatus[] = ['resolved', 'closed'];

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

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { status?: IssueStatus };
  if (!body.status || !NOTIFIABLE.includes(body.status)) {
    return NextResponse.json({ ok: true, skipped: 'not_notifiable' });
  }

  const { data: issue } = await supabase
    .from('issues')
    .select('id, title, created_by, status')
    .eq('id', id)
    .single();
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
  if (issue.created_by === user.id) {
    return NextResponse.json({ ok: true, skipped: 'self_action' });
  }

  const result = await notify('ticket_status_changed', issue.id, {
    issueId: issue.id,
    title: issue.title,
    reporterId: issue.created_by,
    actorId: user.id,
    newStatus: body.status,
  });

  return NextResponse.json({
    ok: true,
    audienceSize: result.audienceSize,
    push: result.pushOutcome,
    telegram: result.telegramOutcome,
  });
}
