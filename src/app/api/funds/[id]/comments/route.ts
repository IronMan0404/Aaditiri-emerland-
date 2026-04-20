import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

// GET — list comments under a fund (newest first)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const { data, error } = await auth.supabase
    .from('fund_comments')
    .select('*')
    .eq('fund_id', id)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comments: data ?? [] });
}

// POST — any authenticated user can add a comment (or threaded reply)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: fundId } = await ctx.params;
  const body = (await req.json()) as { body?: string; parent_comment_id?: string };
  const text = (body.body ?? '').trim();
  if (!text) return NextResponse.json({ error: 'Comment body required' }, { status: 400 });
  if (text.length > 1000) return NextResponse.json({ error: 'Comment too long (max 1000 chars)' }, { status: 400 });

  const { data, error } = await auth.supabase
    .from('fund_comments')
    .insert({
      fund_id: fundId,
      parent_comment_id: body.parent_comment_id ?? null,
      author_id: auth.profile.id,
      author_name: auth.profile.full_name,
      author_flat: auth.profile.flat_number ?? null,
      body: text,
      is_admin_reply: auth.profile.role === 'admin',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}
