/**
 * Phone number normalization for the Aaditri Emerland app.
 *
 * Why this exists: residents type phone numbers in many shapes:
 *   - "9876543210"
 *   - "+91 98765 43210"
 *   - "0091-98765-43210"
 *   - "98765 43210"
 *
 * Supabase's Phone provider expects E.164 format ("+919876543210"). Our
 * `profiles.phone` column also benefits from a single canonical shape so we
 * can build a unique index on it (otherwise two rows storing the same number
 * in different formatting would slip past).
 *
 * This helper is intentionally India-first because the community is in
 * Hyderabad — but it's tolerant of explicit international prefixes too, so a
 * resident with a foreign number isn't blocked.
 */

/** Default country code when the resident types a bare 10-digit number. */
const DEFAULT_COUNTRY_CODE = '91'; // India

/**
 * Normalize any reasonable user-entered phone string to strict E.164.
 *
 * Returns `null` when the input is unparseable (too short, too long, contains
 * non-digit characters after strip). Callers should treat null as a
 * validation failure and reject the form input rather than silently
 * "approximating" it — phone is identity, getting it wrong has real
 * consequences (we'd OTP the wrong human).
 *
 * Rules:
 *   - Strip spaces, dashes, parentheses, dots.
 *   - "00xxx..." → treat as "+xxx..." (international call prefix).
 *   - 10-digit bare number → assume +91 (India) and prepend.
 *   - Anything starting with "+" → keep the country code as-is.
 *   - Final result must match `^\+\d{8,15}$` per E.164.
 */
export function normalizePhoneE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  // Strip everything that isn't a digit or a leading "+".
  const cleaned = trimmed.replace(/[\s\-()\.]/g, '');

  let withCountry: string;
  if (cleaned.startsWith('+')) {
    withCountry = cleaned;
  } else if (cleaned.startsWith('00')) {
    withCountry = `+${cleaned.slice(2)}`;
  } else if (/^\d{10}$/.test(cleaned)) {
    withCountry = `+${DEFAULT_COUNTRY_CODE}${cleaned}`;
  } else if (/^\d{11,15}$/.test(cleaned)) {
    // Probably already had country code embedded but no '+'. Take it as-is.
    withCountry = `+${cleaned}`;
  } else {
    return null;
  }

  // Final shape check.
  if (!/^\+\d{8,15}$/.test(withCountry)) return null;
  return withCountry;
}

/**
 * Pretty-print a normalized E.164 phone for UI display.
 * E.g. "+919876543210" → "+91 98765 43210".
 *
 * Falls back to the raw input if the number isn't recognized. Pure UI sugar.
 */
export function formatPhoneForDisplay(e164: string | null | undefined): string {
  if (!e164) return '';
  // India: "+91 XXXXX XXXXX"
  const match = /^(\+91)(\d{5})(\d{5})$/.exec(e164);
  if (match) return `${match[1]} ${match[2]} ${match[3]}`;
  return e164;
}

/**
 * Lightweight client-side validity check that doesn't normalize.
 * Useful for disabling submit buttons before the user finishes typing.
 */
export function isLikelyValidPhoneInput(raw: string): boolean {
  const cleaned = raw.replace(/[\s\-()\.]/g, '');
  if (cleaned.startsWith('+')) return /^\+\d{8,15}$/.test(cleaned);
  if (cleaned.startsWith('00')) return /^00\d{8,15}$/.test(cleaned);
  return /^\d{10,15}$/.test(cleaned);
}
