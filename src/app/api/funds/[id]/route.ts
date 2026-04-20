import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

// GET /api/funds/[id] — fund detail with category info
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const { data, error } = await auth.supabase
    .from('community_funds')
    .select('*, fund_categories(*)')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ fund: data });
}
