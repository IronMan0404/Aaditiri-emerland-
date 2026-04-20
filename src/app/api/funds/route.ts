import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

// GET /api/funds — list visible funds (RLS handles the visibility filter).
// Optional ?status=collecting|spending|closed|cancelled
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  let query = auth.supabase
    .from('v_fund_summary')
    .select('*')
    .order('status', { ascending: true })
    .order('event_date', { ascending: true, nullsFirst: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ funds: data ?? [] });
}
