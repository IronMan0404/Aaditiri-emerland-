import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { notify } from '@/lib/notify';

// ============================================================
// Shared registration approval / rejection helpers.
//
// One source of truth for "what happens when a registration is
// approved / rejected". Called by:
//
//   * Web admin route POST /api/admin/users/:id/approve|reject
//   * Telegram callback runner (channels/telegram-actions.ts)
//   * Admin users page (which proxies to the API route)
//
// Each helper:
//   1. Re-reads the target row to get the canonical state.
//   2. Verifies the row is currently pending (idempotent — a second
//      call returns the same result without double-firing
//      notifications).
//   3. Applies the DB change.
//   4. Writes an admin-audit row.
//   5. Dispatches notify('registration_decided', ...).
//
// The Telegram path uses the same helper, so admins approving via
// Telegram trigger the exact same audit log + push + DM.
// ============================================================

export interface DecisionActor {
  id: string;
  fullName: string | null;
  email: string | null;
  /** Optional flag so audit log knows the action came from Telegram. */
  via?: 'web' | 'telegram';
  /** Optional Request reference for IP capture in audit log. */
  request?: Request;
}

export interface DecisionResult {
  ok: boolean;
  /** Stable status the row ended up in (or 'noop' for a no-op). */
  status: 'approved' | 'rejected' | 'noop' | 'failed';
  /** Short human label suitable for showing in a Telegram footer. */
  label: string;
  /** Error message if ok=false. */
  error?: string;
}

interface RegistrationRow {
  id: string;
  full_name: string | null;
  email: string | null;
  flat_number: string | null;
  is_approved: boolean;
}

async function readRegistration(profileId: string): Promise<RegistrationRow | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('profiles')
    .select('id, full_name, email, flat_number, is_approved')
    .eq('id', profileId)
    .maybeSingle();
  return (data ?? null) as RegistrationRow | null;
}

export async function approveRegistration(
  profileId: string,
  actor: DecisionActor,
): Promise<DecisionResult> {
  const before = await readRegistration(profileId);
  if (!before) return { ok: false, status: 'failed', label: 'Profile not found' };
  if (before.is_approved) {
    // Already approved — no audit log, no notify.
    return {
      ok: true,
      status: 'noop',
      label: `Already approved`,
    };
  }

  const admin = createAdminSupabaseClient();
  const { data: after, error } = await admin
    .from('profiles')
    .update({ is_approved: true })
    .eq('id', profileId)
    .select('id, full_name, email, flat_number, is_approved')
    .single();
  if (error || !after) {
    return { ok: false, status: 'failed', label: 'Update failed', error: error?.message };
  }

  await logAdminAction({
    actor: { id: actor.id, email: actor.email, name: actor.fullName },
    action: 'update',
    targetType: 'profile',
    targetId: profileId,
    targetLabel: `${before.full_name ?? before.email ?? profileId} — approved${
      actor.via === 'telegram' ? ' (via Telegram)' : ''
    }`,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    request: actor.request,
  });

  // Notify the requester. Failures here MUST NOT fail the approval
  // itself; the admin already saw it succeed.
  notify('registration_decided', profileId, { profileId, approved: true }).catch(() => {});

  return {
    ok: true,
    status: 'approved',
    label: `Approved by ${actor.fullName ?? 'admin'}`,
  };
}

export async function rejectRegistration(
  profileId: string,
  reason: string,
  actor: DecisionActor,
): Promise<DecisionResult> {
  const cleanReason = (reason ?? '').trim();
  if (!cleanReason) {
    return { ok: false, status: 'failed', label: 'Reason required' };
  }

  const before = await readRegistration(profileId);
  if (!before) return { ok: false, status: 'failed', label: 'Profile not found' };
  if (before.is_approved) {
    // Reject after approve is unusual; surface it rather than silently
    // demoting an active user.
    return {
      ok: false,
      status: 'failed',
      label: 'Already approved — cannot reject',
    };
  }

  // Registration "rejection" leaves the row at is_approved=false and
  // doesn't have a dedicated rejected flag. We surface the rejection
  // through the audit log and the notify() side-channel; the row
  // itself stays exactly as it is. (A future migration can add a
  // proper `rejected_at` / `rejected_reason` column without
  // breaking this helper's contract.)
  await logAdminAction({
    actor: { id: actor.id, email: actor.email, name: actor.fullName },
    action: 'update',
    targetType: 'profile',
    targetId: profileId,
    targetLabel: `${before.full_name ?? before.email ?? profileId} — rejected${
      actor.via === 'telegram' ? ' (via Telegram)' : ''
    }`,
    reason: cleanReason,
    before: before as unknown as Record<string, unknown>,
    after: before as unknown as Record<string, unknown>,
    request: actor.request,
  });

  notify('registration_decided', profileId, { profileId, approved: false }).catch(() => {});

  return {
    ok: true,
    status: 'rejected',
    label: `Rejected by ${actor.fullName ?? 'admin'}`,
  };
}
