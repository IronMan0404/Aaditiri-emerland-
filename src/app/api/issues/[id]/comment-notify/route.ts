import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { notify } from '@/lib/notify';

// Push + Telegram fan-out for new issue comments. Called best-effort
// by the client AFTER the comment row has been inserted via Supabase
// (RLS-protected).
//
// Why this is a separate route (not "POST /api/issues/:id/comment"
// that inserts AND notifies in one shot):
//   - The insert path is governed by RLS, so trying to do it via a
//     server route would either need to call the user's session
//     client (no benefit) or use the admin client (which would
//     bypass the RLS access checks we just wrote). Letting the
//     client insert keeps a single source of truth for permission
//     rules.
//   - This route only needs to verify the caller can SEE the issue,
//     then delegates to the dispatcher for the cross-user fan-out.
//
// Migrated to notify('ticket_comment_added', ...) (April 2026).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CommentBody {
  preview?: string;
}

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

  // Confirm the caller can see the issue (RLS does this for us — if
  // the select returns null we silently 404).
  const { data: issue } = await supabase
    .from('issues')
    .select('id, title, created_by, status')
    .eq('id', id)
    .single();
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });

  // Resolve caller role so the renderer can pick the right copy.
  const admin = createAdminSupabaseClient();
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', user.id)
    .single();
  const callerIsAdmin = callerProfile?.role === 'admin';

  // Comment text preview (caller may pass it; otherwise we fall back
  // to a generic line — the dispatcher won't fail either way).
  let preview = '';
  try {
    const body = (await req.json().catch(() => ({}))) as CommentBody;
    preview = (body.preview ?? '').trim();
  } catch {
    preview = '';
  }
  if (!preview) {
    preview = callerIsAdmin
      ? 'Open the ticket to read the reply.'
      : `${callerProfile?.full_name ?? 'A resident'}: ${issue.title}`;
  }

  const result = await notify('ticket_comment_added', issue.id, {
    issueId: issue.id,
    title: issue.title,
    commentAuthorId: user.id,
    commentAuthorIsAdmin: callerIsAdmin,
    reporterId: issue.created_by,
    preview,
  });

  return NextResponse.json({
    ok: true,
    audienceSize: result.audienceSize,
    push: result.pushOutcome,
    telegram: result.telegramOutcome,
  });
}
