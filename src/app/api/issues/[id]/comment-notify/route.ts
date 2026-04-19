import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { sendPushToUsers } from '@/lib/push';

// Push fan-out for new issue comments. Called best-effort by the client
// AFTER the comment row has been inserted via Supabase (RLS-protected).
//
// Why this is a separate route (not "POST /api/issues/:id/comment" that
// inserts AND notifies in one shot):
//   - The insert path is governed by RLS, so trying to do it via a server
//     route would either need to call the user's session client (no benefit)
//     or use the admin client (which would bypass the RLS access checks
//     we just wrote). Letting the client insert keeps a single source of
//     truth for permission rules.
//   - This route only needs to verify the caller can SEE the issue, then
//     uses the admin client for the cross-user push fan-out.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Issue id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Confirm the caller can see the issue (RLS does this for us \u2014 if the
  // select returns null we silently 404).
  const { data: issue } = await supabase
    .from('issues')
    .select('id, title, created_by, status')
    .eq('id', id)
    .single();
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });

  // Resolve recipients: every admin (so any on-duty admin gets a ping) plus
  // the issue's creator if the caller is an admin replying to a resident.
  const admin = createAdminSupabaseClient();
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', user.id)
    .single();
  const callerIsAdmin = callerProfile?.role === 'admin';

  let recipientIds: string[] = [];
  if (callerIsAdmin) {
    if (issue.created_by !== user.id) recipientIds = [issue.created_by];
  } else {
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_bot', false);
    recipientIds = (admins ?? []).map((r: { id: string }) => r.id).filter((rid) => rid !== user.id);
  }

  if (recipientIds.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_recipients' });
  }

  const result = await sendPushToUsers(recipientIds, {
    title: callerIsAdmin ? `Admin replied: ${issue.title}` : `New comment on issue`,
    body: callerIsAdmin
      ? 'Open the issue to read the reply.'
      : `${callerProfile?.full_name ?? 'A resident'}: ${issue.title}`,
    url: callerIsAdmin ? '/dashboard/issues' : '/admin/issues',
    tag: `issue-comment:${issue.id}`,
  });

  return NextResponse.json({ ok: true, push: result });
}
