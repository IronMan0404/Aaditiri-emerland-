import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

// GET /api/funds/[id]/spends — public list of all spends for a fund
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const { data, error } = await auth.supabase
    .from('fund_spends')
    .select('*')
    .eq('fund_id', id)
    .order('spend_date', { ascending: false })
    .order('recorded_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ spends: data ?? [] });
}
