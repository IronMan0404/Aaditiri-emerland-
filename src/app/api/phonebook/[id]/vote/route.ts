import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { notifyAfter } from '@/lib/notify';
import type { DirectoryVoteKind } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Toggle a 'helpful' or 'reported' vote for a contact. Idempotent —
// hitting it twice in quick succession leaves the vote on; sending
// `?action=remove` removes it. We could let the client manage this
// via direct supabase-js calls (the RLS policy already permits
// auth.uid() = user_id inserts/deletes) but routing through a single
// endpoint:
//   * gives us one obvious place to add anti-abuse logic later,
//   * keeps the resident page's API surface tight (one POST per
//     interaction), and
//   * lets us return the updated vote_count in the response so the
//     UI doesn't need a follow-up SELECT to refresh.

const VALID_KINDS: DirectoryVoteKind[] = ['helpful', 'reported'];

interface VotePayload {
  kind?: string;
  action?: 'add' | 'remove';
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Missing contact id' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, is_approved')
    .eq('id', user.id)
    .single();
  if (!profile?.is_approved) {
    return NextResponse.json({ error: 'Account not yet approved' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as VotePayload;
  const kind = body.kind as DirectoryVoteKind | undefined;
  const action = body.action ?? 'add';
  if (!kind || !VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: 'Invalid vote kind' }, { status: 400 });
  }

  if (action === 'remove') {
    const { error } = await supabase
      .from('directory_votes')
      .delete()
      .eq('contact_id', id)
      .eq('user_id', user.id)
      .eq('kind', kind);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // INSERT — relies on the unique(contact_id, user_id, kind)
    // constraint to make double-clicks idempotent. We swallow the
    // 23505 unique_violation because that's the desired outcome.
    const { error } = await supabase
      .from('directory_votes')
      .insert({ contact_id: id, user_id: user.id, kind });
    if (error && error.code !== '23505') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Return the new counters so the UI can update without a re-fetch.
  const { data: updated } = await supabase
    .from('directory_contacts')
    .select('id, name, vote_count, report_count')
    .eq('id', id)
    .maybeSingle();

  // Best-effort: alert admins when the report threshold is hit.
  // We only fire on `add` actions (un-reporting shouldn't ping
  // admins), and we use the report_count as the dispatcher's dedup
  // key via the routing tag so admins don't get spammed for every
  // increment. Any failure here must NOT block the vote response.
  if (
    action === 'add' &&
    kind === 'reported' &&
    updated &&
    typeof updated.report_count === 'number' &&
    updated.report_count >= 1
  ) {
    notifyAfter('phonebook_entry_reported', id, {
      contactId: id,
      contactName: updated.name ?? '(unnamed)',
      reportCount: updated.report_count,
    });
  }

  return NextResponse.json({ contact: updated });
}
