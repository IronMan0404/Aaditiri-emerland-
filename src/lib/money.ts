// Money helpers. The DB stores all amounts in PAISE (integer, INR * 100)
// to avoid floating-point drift on currency math. The display layer
// formats to ₹ using Indian locale grouping (lakhs/crores).

export function paiseToRupees(paise: number | null | undefined): number {
  if (paise == null || Number.isNaN(paise)) return 0;
  return paise / 100;
}

export function rupeesToPaise(rupees: number | string): number {
  const n = typeof rupees === 'string' ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// Format paise as "₹12,345" (no decimals when whole, max 2 otherwise).
export function formatINR(paise: number | null | undefined, opts?: { withDecimals?: boolean }): string {
  const rupees = paiseToRupees(paise);
  const isWhole = Number.isInteger(rupees);
  const fractionDigits = opts?.withDecimals === false ? 0 : isWhole ? 0 : 2;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

// Compact format for big numbers in cards, e.g. "₹3.8L" / "₹47K".
// Useful in dashboards where space is tight.
export function formatINRCompact(paise: number | null | undefined): string {
  const rupees = paiseToRupees(paise);
  if (rupees >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(rupees % 1_00_00_000 === 0 ? 0 : 1)}Cr`;
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(rupees % 1_00_000 === 0 ? 0 : 1)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(rupees % 1_000 === 0 ? 0 : 1)}K`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}
