// ============================================================
// Phonebook server-side validation & normalisation helpers.
// Used by both POST /api/phonebook (create) and
// PATCH /api/phonebook/[id] (edit) so the two paths stay in
// lockstep — historically the create path normalised numbers
// while the edit path passed raw strings through, leading to
// the same vendor showing up as "+91 98xxx", "98xxx" and
// "(040) 2xxx" depending on which form last touched the row.
// ============================================================

import type { DirectoryCategory } from '@/types';

export const VALID_CATEGORIES: DirectoryCategory[] = [
  'plumbing',
  'electrical',
  'carpentry',
  'painting',
  'pest_control',
  'lift_amc',
  'maid',
  'cook',
  'nanny',
  'driver',
  'milkman',
  'newspaper',
  'gas_cylinder',
  'laundry',
  'tailor',
  'cab_auto',
  'doctor',
  'hospital',
  'pharmacy',
  'police',
  'ambulance',
  'fire',
  'hardware',
  'grocery',
  'rwa_official',
  'society_office',
  'security_agency',
  'other',
];

// Strip everything except digits and a leading +. Keeps the same
// vendor consistent regardless of the formatting the user typed.
// We never persist the unformatted display version — only this
// canonicalised form, so search/dedup works across every entry.
export function normalisePhone(input: string | null | undefined): string {
  if (!input) return '';
  const trimmed = String(input).trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

/** True iff the value (or its digit-only canonical) is plausibly a
 * phone number (≥ 7 digits). We keep the bar low because Indian
 * landlines can be 7 digits and we don't want to block valid entries. */
export function isPlausiblePhone(input: string): boolean {
  return input.replace(/\D/g, '').length >= 7;
}

/**
 * Result of validating a directory contact payload. Either
 * `{ ok: true, value }` with the cleaned + normalised columns
 * ready to persist, or `{ ok: false, error }` with a 400-friendly
 * message. The shape is identical for create and edit so the two
 * routes can share the same validator.
 */
export type DirectoryPayload = {
  name?: string;
  category?: string;
  phone?: string;
  alt_phone?: string | null;
  whatsapp?: string | null;
  notes?: string | null;
  area_served?: string | null;
  hourly_rate?: number | string | null;
};

export type CleanedDirectoryRow = {
  name: string;
  category: DirectoryCategory;
  phone: string;
  alt_phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  area_served: string | null;
  hourly_rate: number | null;
};

export function validateDirectoryPayload(
  body: DirectoryPayload,
): { ok: true; value: CleanedDirectoryRow } | { ok: false; error: string } {
  const name = body.name?.trim();
  if (!name || name.length < 2 || name.length > 80) {
    return { ok: false, error: 'Name must be 2–80 characters' };
  }
  const category = body.category as DirectoryCategory | undefined;
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return { ok: false, error: 'Invalid category' };
  }
  const phone = normalisePhone(body.phone);
  if (!phone || !isPlausiblePhone(phone)) {
    return { ok: false, error: 'Phone must be at least 7 digits' };
  }

  const altRaw = body.alt_phone?.toString().trim();
  const alt_phone = altRaw ? normalisePhone(altRaw) || null : null;

  const waRaw = body.whatsapp?.toString().trim();
  const whatsapp = waRaw ? normalisePhone(waRaw) || null : null;

  const notes = body.notes?.toString().trim().slice(0, 500) || null;
  const area_served = body.area_served?.toString().trim().slice(0, 100) || null;

  let hourly_rate: number | null = null;
  if (body.hourly_rate !== undefined && body.hourly_rate !== '' && body.hourly_rate !== null) {
    const parsed =
      typeof body.hourly_rate === 'number'
        ? body.hourly_rate
        : parseFloat(String(body.hourly_rate));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < 100000) {
      hourly_rate = parsed;
    }
  }

  return {
    ok: true,
    value: {
      name,
      category,
      phone,
      alt_phone,
      whatsapp,
      notes,
      area_served,
      hourly_rate,
    },
  };
}
