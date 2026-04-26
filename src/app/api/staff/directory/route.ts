import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// /api/staff/directory
//
// GET  Resident-facing roster of all active staff. Calls the
//      public.resident_visible_staff() SECURITY DEFINER function,
//      which already enforces:
//        - caller must be authenticated
//        - caller must be admin, staff, or an APPROVED resident
//        - bot accounts get nothing
//        - inactive staff are filtered out
//        - email / address / hire date are NOT in the projection
//
// We rely on the function's role gate rather than re-checking
// here so a pending resident gets a clean empty array (not a
// 403). The dashboard widget that consumes this is happy with
// either, but an empty array degrades visually better.

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

  const { data, error } = await supabase.rpc('resident_visible_staff');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    staff: data ?? [],
  });
}
