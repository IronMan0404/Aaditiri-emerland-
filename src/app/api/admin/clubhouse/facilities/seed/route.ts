import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// Admin-only: re-seed the default facility catalog. Idempotent via the
// `slug` unique constraint (on conflict do nothing). This exists because
// fresh installs that miss the original migration end up with an empty
// `clubhouse_facilities` table, which renders the Book modal as "No
// bookable facilities available." Rather than asking the admin to open
// the Supabase SQL editor, we expose this as a one-tap action behind
// the Facilities tab's "Reset catalogue" button.
//
// We do NOT touch any existing rows: admins can edit hourly/pass rates
// and slug will already exist, so on conflict the row is left alone.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SeedRow {
  slug: string;
  name: string;
  requires_subscription: boolean;
  display_order: number;
}

const DEFAULT_FACILITIES: SeedRow[] = [
  { slug: 'clubhouse',       name: 'Clubhouse',       requires_subscription: false, display_order: 10 },
  { slug: 'swimming_pool',   name: 'Swimming Pool',   requires_subscription: true,  display_order: 20 },
  { slug: 'tennis_court',    name: 'Tennis Court',    requires_subscription: false, display_order: 30 },
  { slug: 'badminton_court', name: 'Badminton Court', requires_subscription: false, display_order: 40 },
  { slug: 'gym',             name: 'Gym',             requires_subscription: true,  display_order: 50 },
  { slug: 'yoga_room',       name: 'Yoga Room',       requires_subscription: true,  display_order: 60 },
  { slug: 'party_hall',      name: 'Party Hall',      requires_subscription: false, display_order: 70 },
  { slug: 'conference_room', name: 'Conference Room', requires_subscription: false, display_order: 80 },
];

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  // ignoreDuplicates lets PostgREST emit ON CONFLICT DO NOTHING semantics
  // against the slug unique index, leaving any admin-edited rows alone.
  const { error } = await supabase
    .from('clubhouse_facilities')
    .upsert(DEFAULT_FACILITIES, { onConflict: 'slug', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return the current row count so the UI can confirm the catalog is
  // populated. Cheap because the table is tiny.
  const { count } = await supabase
    .from('clubhouse_facilities')
    .select('id', { count: 'exact', head: true });

  return NextResponse.json({ ok: true, total: count ?? 0, seeded: DEFAULT_FACILITIES.length });
}
