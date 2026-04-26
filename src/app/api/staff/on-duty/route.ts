import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// /api/staff/on-duty
//
// GET  Public-to-residents lookup of "who's on duty right now".
//      Calls the staff_on_duty_now() Postgres SECURITY DEFINER
//      function which masks surname and excludes phone/address.
//      Auth: any authenticated user (resident or admin or staff).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { data, error } = await supabase.rpc('staff_on_duty_now');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    on_duty: data ?? [],
  });
}
