/**
 * Test credential resolver.
 *
 * Lookup order (first match wins):
 *
 *   1. Process env vars — TEST_<ROLE>_<FIELD>, e.g. TEST_ADMIN_EMAIL.
 *      These are how CI/CD passes creds in (GitHub Secrets, Vercel env, …).
 *      Set them in `.env.test.local` for local convenience — playwright.config
 *      loads that file via dotenv before the resolver runs.
 *
 *   2. Local JSON file — `tests/credentials.local.json` (gitignored).
 *      Useful for solo local dev when you'd rather not pollute your shell
 *      env. The shape mirrors the env-var keys; see credentials.example.json.
 *
 * If neither source has a value the test FAILS LOUDLY with a message that
 * names the exact env var(s) and JSON key the dev needs to set. We never
 * silently default to a placeholder — a placeholder credential against a
 * real Supabase project would either log in as the wrong user or fail in
 * a way that's hard to diagnose.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type RoleId =
  | 'admin'
  | 'resident'
  | 'residentPending'
  | 'staffSecurity'
  | 'staffHousekeeping';

export interface RoleCredentials {
  /** Sign-in identifier — email OR phone (E.164). Resident login accepts either. */
  identifier: string;
  /** Plain text password as configured on the Supabase user. */
  password: string;
  /** Optional human-readable label for assertions ("Welcome, <fullName>"). */
  fullName?: string;
  /** Optional flat number for resident assertions ("Flat A-101"). */
  flatNumber?: string;
}

interface RawCreds {
  admin?: Partial<RoleCredentials>;
  resident?: Partial<RoleCredentials>;
  residentPending?: Partial<RoleCredentials>;
  staffSecurity?: Partial<RoleCredentials>;
  staffHousekeeping?: Partial<RoleCredentials>;
}

const JSON_PATH = path.resolve(__dirname, '..', 'credentials.local.json');

let jsonCache: RawCreds | null | undefined;
function loadJson(): RawCreds | null {
  if (jsonCache !== undefined) return jsonCache;
  try {
    if (!fs.existsSync(JSON_PATH)) {
      jsonCache = null;
      return null;
    }
    const raw = fs.readFileSync(JSON_PATH, 'utf8');
    jsonCache = JSON.parse(raw) as RawCreds;
    return jsonCache;
  } catch (err) {
    throw new Error(
      `tests/credentials.local.json exists but could not be parsed: ${
        (err as Error).message
      }. Fix the JSON or delete the file and use env vars instead.`,
    );
  }
}

const ENV_KEY: Record<RoleId, string> = {
  admin: 'ADMIN',
  resident: 'RESIDENT',
  residentPending: 'RESIDENT_PENDING',
  staffSecurity: 'STAFF_SECURITY',
  staffHousekeeping: 'STAFF_HOUSEKEEPING',
};

function envFor(role: RoleId, field: 'IDENTIFIER' | 'PASSWORD' | 'FULL_NAME' | 'FLAT_NUMBER'): string | undefined {
  const k = `TEST_${ENV_KEY[role]}_${field}`;
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
}

function jsonFor(role: RoleId): Partial<RoleCredentials> | undefined {
  const j = loadJson();
  if (!j) return undefined;
  return j[role];
}

/**
 * Resolve credentials for `role`. Throws a precise error if either
 * `identifier` or `password` is missing — these are the only two
 * truly-required fields. `fullName` and `flatNumber` are optional and
 * only used by some assertions; tests that need them assert their own
 * presence.
 */
export function getCredentials(role: RoleId): RoleCredentials {
  // Per-role legacy aliases (TEST_ADMIN_EMAIL, TEST_RESIDENT_PHONE) so
  // existing CI environments that already use the email/phone-specific
  // names keep working. The canonical name is TEST_<ROLE>_IDENTIFIER.
  const legacyIdentifier =
    process.env[`TEST_${ENV_KEY[role]}_EMAIL`]?.trim() ||
    process.env[`TEST_${ENV_KEY[role]}_PHONE`]?.trim();

  const json = jsonFor(role);

  const identifier =
    envFor(role, 'IDENTIFIER') ??
    legacyIdentifier ??
    json?.identifier;
  const password = envFor(role, 'PASSWORD') ?? json?.password;
  const fullName = envFor(role, 'FULL_NAME') ?? json?.fullName;
  const flatNumber = envFor(role, 'FLAT_NUMBER') ?? json?.flatNumber;

  if (!identifier || !password) {
    const missing: string[] = [];
    if (!identifier) missing.push(`TEST_${ENV_KEY[role]}_IDENTIFIER`);
    if (!password) missing.push(`TEST_${ENV_KEY[role]}_PASSWORD`);
    throw new Error(
      `Missing test credentials for role "${role}". ` +
        `Set ${missing.join(' and ')} in .env.test.local / CI secrets, ` +
        `or add a "${role}" entry to tests/credentials.local.json. ` +
        `See tests/credentials.example.json for the expected shape.`,
    );
  }

  return { identifier, password, fullName, flatNumber };
}

/** True if creds for `role` resolve. Used by tests to skip optional roles
 * (e.g. residentPending) cleanly when the environment hasn't seeded one. */
export function hasCredentials(role: RoleId): boolean {
  try {
    getCredentials(role);
    return true;
  } catch {
    return false;
  }
}
