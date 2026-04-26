import 'server-only';
import { after } from 'next/server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';

// Append-only journal of every privileged admin write. Every API route
// that mutates a row on behalf of an admin should call `logAdminAction`
// inside the same handler so we have a single, queryable trail of who
// did what and when (see `/admin/audit`).
//
// We always write through the service-role client so that:
//   (a) the audit row lands even if the actor's session / RLS is in a
//       weird state when the calling route runs, and
//   (b) the table's RLS can deny INSERT/UPDATE/DELETE to every other
//       role - making the log effectively append-only and tamper-proof
//       from the application path. (See migration
//       20260422_admin_audit_log.sql.)
//
// Performance posture (Vercel Hobby in mind):
//   * Inserts run AFTER the response has been flushed to the admin via
//     Next's `after()` (powered by Vercel's `waitUntil`). The handler
//     therefore doesn't pay the round-trip latency of the audit insert
//     in its measured wall-clock time, which keeps it under the 10s
//     Hobby function timeout even if Supabase is slow.
//   * `before` / `after` snapshots are capped to roughly 4 KB each so
//     a single audit row never balloons past ~10 KB. Without this an
//     announcement or photo with a long body would dominate storage.
//
// Failure to log MUST NOT block the underlying admin action: a logging
// outage should not prevent an admin from removing a problem booking.
// We swallow + console.error errors and return a discriminated result
// so callers can opt into surfacing them.

export type AdminAuditAction = 'create' | 'update' | 'delete';

export type AdminAuditTargetType =
  | 'profile'
  | 'booking'
  | 'clubhouse_subscription'
  | 'clubhouse_facility'
  | 'clubhouse_tier'
  | 'clubhouse_pass'
  | 'issue'
  | 'announcement'
  | 'event'
  | 'broadcast'
  | 'photo'
  | 'community_fund'
  | 'fund_contribution'
  | 'fund_spend'
  | 'fund_refund'
  | 'admin_tag'
  | 'profile_admin_tag'
  | 'scheduled_reminder'
  | 'service';

export interface LogAdminActionInput {
  actor: {
    id: string;
    email?: string | null;
    name?: string | null;
  };
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  // Short human-readable label (e.g. "Flat 413 - Basic", "Booking on
  // 2026-04-12") so the audit list can render without re-fetching the
  // (possibly deleted) target row.
  targetLabel?: string | null;
  // Optional reason supplied by the admin in the UI (e.g. "duplicate
  // booking", "resident asked for refund").
  reason?: string | null;
  // Snapshot of the row before / after the change. `before` is null on
  // create, `after` is null on delete.
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  // Optional request context for forensics. Pass `req.headers` and
  // we'll best-effort extract IP + UA.
  request?: Request | { headers: Headers } | null;
}

// Approximate hard cap on the JSON-serialised size of `before` / `after`.
// Picked so a single row stays well under the 8 KB Postgres TOAST
// threshold for the common case (so reads stay fast and storage stays
// predictable). When a snapshot is over the budget we keep the small
// fields and replace anything large with a `[truncated:N bytes]` marker
// so the audit is still informative.
const SNAPSHOT_BYTE_BUDGET = 4096;

// Fields that are almost never useful in an audit (large text bodies,
// raw blobs, image URLs) are dropped entirely before the size check
// runs. Keeps the snapshot focused on what changed without losing the
// "what was this row" context.
const ALWAYS_DROP_FIELDS: ReadonlySet<string> = new Set([
  'description',
  'body',
  'content',
  'message',
  'image_url',
  'avatar_url',
  'request_notes',
  'notes',
]);

export type LogAdminActionResult =
  | { ok: true; queued: true }
  | { ok: false; error: string };

export function logAdminAction(input: LogAdminActionInput): LogAdminActionResult {
  if (!isAdminClientConfigured()) {
    const msg = 'SUPABASE_SERVICE_ROLE_KEY is not set; admin audit log skipped.';
    console.error('[admin-audit]', msg);
    return { ok: false, error: msg };
  }

  // Capture request headers synchronously - the `Request` object may
  // not be safe to read after the response is flushed.
  const ip = extractIp(input.request);
  const ua = input.request?.headers.get('user-agent') ?? null;

  const row = {
    actor_id: input.actor.id,
    actor_email: input.actor.email ?? null,
    actor_name: input.actor.name ?? null,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    target_label: input.targetLabel ?? null,
    reason: input.reason ?? null,
    before: trimSnapshot(input.before),
    after: trimSnapshot(input.after),
    ip_address: ip,
    user_agent: ua ? ua.slice(0, 500) : null,
  };

  // Run the insert AFTER the response has been streamed back to the
  // client. On Vercel this is implemented via `waitUntil`, so we don't
  // pay for the Postgres round-trip in the user-visible request time
  // budget. `after()` falls back to running the callback inline outside
  // of Vercel (e.g. local `next dev`).
  try {
    after(async () => {
      try {
        const admin = createAdminSupabaseClient();
        const { error } = await admin.from('admin_audit_log').insert(row);
        if (error) {
          console.error('[admin-audit] insert failed', error);
        }
      } catch (err) {
        console.error('[admin-audit] insert threw', err);
      }
    });
  } catch (err) {
    // `after()` throws synchronously if called outside of a request
    // context (e.g. from a script). In that case, write inline as a
    // best-effort fallback - we never want a real admin write to
    // succeed with no audit record at all.
    console.error('[admin-audit] after() unavailable, falling back to inline insert', err);
    void writeInline(row);
  }

  return { ok: true, queued: true };
}

async function writeInline(row: Record<string, unknown>): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    const { error } = await admin.from('admin_audit_log').insert(row);
    if (error) console.error('[admin-audit] inline insert failed', error);
  } catch (err) {
    console.error('[admin-audit] inline insert threw', err);
  }
}

function extractIp(req: LogAdminActionInput['request']): string | null {
  if (!req) return null;
  const h = req.headers;
  // Vercel / most reverse proxies set x-forwarded-for as a comma-list,
  // leftmost = original client. Fall back to x-real-ip.
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = h.get('x-real-ip');
  if (real) return real.slice(0, 64);
  return null;
}

// Returns a snapshot whose JSON serialisation is at most
// `SNAPSHOT_BYTE_BUDGET`. Drops the always-noisy fields first, then if
// still over budget replaces the largest remaining string fields with
// a `[truncated:N bytes]` placeholder until the row fits. This keeps
// the field NAMES (so an admin can still see "description was changed")
// without paying storage for the contents.
function trimSnapshot(snap: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!snap) return snap ?? null;

  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (ALWAYS_DROP_FIELDS.has(k)) {
      const sizeHint = typeof v === 'string' ? v.length : approxSize(v);
      copy[k] = sizeHint > 0 ? `[truncated:${sizeHint} bytes]` : null;
      continue;
    }
    copy[k] = v;
  }

  if (approxSize(copy) <= SNAPSHOT_BYTE_BUDGET) return copy;

  // Still too big. Replace the largest string/object fields, biggest
  // first, until we fit.
  const entries = Object.entries(copy)
    .map(([k, v]) => [k, v, approxSize(v)] as const)
    .sort((a, b) => b[2] - a[2]);

  for (const [k, , size] of entries) {
    if (size <= 64) continue;
    copy[k] = `[truncated:${size} bytes]`;
    if (approxSize(copy) <= SNAPSHOT_BYTE_BUDGET) break;
  }
  return copy;
}

function approxSize(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
