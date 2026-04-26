// Dev-only one-shot: read a user's profile and toggle is_approved/role.
//
// Usage:
//   node scripts/approve-user.mjs <user-uid> [--admin]
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
// Bypasses RLS via the service-role client. The profiles_block_privileged_self_edit
// trigger we added earlier no-ops for service-role writes (auth.uid() is null),
// so role/is_approved updates go through.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = join(__dirname, '..', '.env.local');
  const text = readFileSync(envPath, 'utf8');
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    out[k] = v;
  }
  return out;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const userId = process.argv[2];
const makeAdmin = process.argv.includes('--admin');
if (!userId) {
  console.error('Usage: node scripts/approve-user.mjs <user-uid> [--admin]');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: existing, error: readErr } = await supabase
  .from('profiles')
  .select('id, email, full_name, role, is_approved')
  .eq('id', userId)
  .maybeSingle();

if (readErr) {
  console.error('Read error:', readErr);
  process.exit(1);
}

console.log('Before:', existing ?? '(no profile row)');

if (!existing) {
  const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(userId);
  if (authErr || !authData?.user) {
    console.error('No auth.users row either. Aborting.', authErr);
    process.exit(1);
  }
  const u = authData.user;
  const { error: insErr } = await supabase.from('profiles').insert({
    id: u.id,
    email: u.email,
    full_name: u.user_metadata?.full_name ?? (u.email?.split('@')[0] ?? 'Resident'),
    role: makeAdmin ? 'admin' : 'user',
    is_approved: true,
  });
  if (insErr) {
    console.error('Insert error:', insErr);
    process.exit(1);
  }
  console.log('Inserted new profile row.');
} else {
  const patch = { is_approved: true };
  if (makeAdmin) patch.role = 'admin';
  const { error: updErr } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (updErr) {
    console.error('Update error:', updErr);
    process.exit(1);
  }
  console.log('Updated profile:', patch);
}

const { data: after } = await supabase
  .from('profiles')
  .select('id, email, full_name, role, is_approved')
  .eq('id', userId)
  .single();
console.log('After: ', after);
console.log('\nDone. Refresh http://localhost:3000/dashboard in your browser.');
