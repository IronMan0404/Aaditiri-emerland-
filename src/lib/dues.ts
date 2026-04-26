import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';

// ============================================================
// Shared per-flat dues computation.
//
// Used by:
//   * POST /api/admin/funds/dues/alert  (admin global / per-fund)
//   * Telegram /dues handler             (resident self-lookup)
//
// "Pending" for a flat-fund pair = max(0, suggested_per_flat -
// sum(received cash contributions)). In-kind contributions and
// pending/refunded cash are NOT counted as paid (matching the dues
// dashboard behaviour).
//
// We intentionally read with the service-role client because:
//   * the Telegram webhook has no user session at all
//   * the admin dues alert needs to see *every* flat regardless of
//     the admin's RLS scope.
// ============================================================

export interface DueLine {
  /** UUID of community_funds row. */
  fundId: string;
  /** Display name of the fund. */
  fundName: string;
  /** Amount in paise the flat is short on this fund. */
  pendingPaise: number;
  /** Amount in paise this flat has paid (received cash) so far. */
  paidPaise: number;
  /** Suggested amount per flat for this fund (paise). */
  suggestedPaise: number;
}

export interface FlatDuesSummary {
  flatNumber: string;
  /** Per-fund breakdown, only funds with pending > 0. */
  lines: DueLine[];
  /** Sum of pendingPaise across lines. */
  totalPendingPaise: number;
}

/**
 * Compute pending dues for a single flat across the supplied set of
 * collecting funds. Returns null if the flat owes nothing.
 *
 * If `funds` is omitted, every active collecting fund with a
 * `suggested_per_flat` is considered.
 */
export async function computeFlatDues(
  flatNumber: string,
  funds?: { id: string; name: string; suggested_per_flat: number }[],
): Promise<FlatDuesSummary | null> {
  const adb = createAdminSupabaseClient();

  let scope = funds;
  if (!scope) {
    const { data } = await adb
      .from('community_funds')
      .select('id, name, suggested_per_flat')
      .eq('status', 'collecting')
      .not('suggested_per_flat', 'is', null)
      .gt('suggested_per_flat', 0);
    scope = (data ?? []) as { id: string; name: string; suggested_per_flat: number }[];
  }
  if (scope.length === 0) {
    return null;
  }

  const fundIds = scope.map((f) => f.id);
  const { data: contribRaw } = await adb
    .from('fund_contributions')
    .select('fund_id, amount')
    .in('fund_id', fundIds)
    .eq('flat_number', flatNumber)
    .eq('status', 'received')
    .eq('is_in_kind', false);
  const contribs = (contribRaw ?? []) as { fund_id: string; amount: number }[];
  const paidByFund = new Map<string, number>();
  for (const c of contribs) {
    paidByFund.set(c.fund_id, (paidByFund.get(c.fund_id) ?? 0) + c.amount);
  }

  const lines: DueLine[] = [];
  for (const f of scope) {
    const paid = paidByFund.get(f.id) ?? 0;
    const pending = Math.max(0, f.suggested_per_flat - paid);
    if (pending > 0) {
      lines.push({
        fundId: f.id,
        fundName: f.name,
        pendingPaise: pending,
        paidPaise: paid,
        suggestedPaise: f.suggested_per_flat,
      });
    }
  }
  if (lines.length === 0) return null;

  return {
    flatNumber,
    lines,
    totalPendingPaise: lines.reduce((s, l) => s + l.pendingPaise, 0),
  };
}

/**
 * Format paise as a rupee string. 150000 → "₹1,500", 150050 → "₹1,500.50".
 * No external locale dependency — Telegram chat doesn't need one.
 */
export function formatPaiseAsRupees(paise: number): string {
  const rupees = paise / 100;
  const hasFraction = paise % 100 !== 0;
  const formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
  return `₹${formatted}`;
}
