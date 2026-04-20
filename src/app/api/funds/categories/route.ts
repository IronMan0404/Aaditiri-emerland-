import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';

// GET /api/funds/categories — list active fund categories (for dropdowns)
export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from('fund_categories')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}
