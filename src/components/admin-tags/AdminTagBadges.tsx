'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import type { AdminTagBadge } from '@/types/admin-tags';

// Singleton cache: every component instance shares one map keyed by
// profile_id. We hydrate it once (on first mount) by reading the
// v_admin_tags_by_profile view, and components subscribe via a
// version counter so hydrations triggered by one badge re-render every
// other badge currently mounted on the page.
//
// This keeps the badge "drop-in cheap": you can sprinkle <AdminTagBadges
// profileId={...} /> on every contribution row, every comment, every
// avatar, and we still only fire ONE network call per page load.
type TagsByProfile = Map<string, AdminTagBadge[]>;
const cache: TagsByProfile = new Map();
let cacheVersion = 0;
let cachePromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  cacheVersion += 1;
  for (const l of listeners) l();
}

async function hydrate() {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('v_admin_tags_by_profile')
        .select('profile_id, tags');
      if (error) {
        // The view may not exist yet (migration not applied) — degrade
        // silently rather than spamming the console for every page.
        return;
      }
      cache.clear();
      for (const row of (data ?? []) as Array<{ profile_id: string; tags: AdminTagBadge[] }>) {
        cache.set(row.profile_id, row.tags ?? []);
      }
      notifyListeners();
    } catch {
      // Same rationale as above — never let a tag load break the page.
    }
  })();
  return cachePromise;
}

interface Props {
  profileId: string | null | undefined;
  // When true (default) renders nothing if there are no tags. Set to
  // false if a parent layout reserves space for the badge row.
  hideIfEmpty?: boolean;
  // Tailwind classes added to the wrapper, e.g. 'ml-2'.
  className?: string;
  // 'sm' is the default and fits inline next to a name. 'xs' shrinks
  // for dense list cells, 'md' for headers/profile cards.
  size?: 'xs' | 'sm' | 'md';
  // Show the icon (emoji) prefix. Defaults to true.
  showIcon?: boolean;
}

export default function AdminTagBadges({
  profileId,
  hideIfEmpty = true,
  className = '',
  size = 'sm',
  showIcon = true,
}: Props) {
  // We re-render whenever the cache version bumps so that a badge
  // mounted before hydration finishes still picks up its tags.
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((v) => v + 1);
    listeners.add(listener);
    void hydrate();
    return () => { listeners.delete(listener); };
  }, []);

  if (!profileId) return null;
  const tags = cache.get(profileId) ?? [];
  if (tags.length === 0 && hideIfEmpty) return null;

  const sizeClass =
    size === 'xs' ? 'text-[10px] px-1.5 py-0.5 gap-0.5'
    : size === 'md' ? 'text-xs px-2.5 py-1 gap-1.5'
    : 'text-[11px] px-2 py-0.5 gap-1';

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {tags.map((t) => (
        <span
          key={t.id}
          className={`inline-flex items-center rounded-full font-semibold text-white whitespace-nowrap ${sizeClass}`}
          style={{ backgroundColor: t.color }}
          title={t.label}
        >
          {showIcon && t.icon ? <span aria-hidden>{t.icon}</span> : null}
          <span>{t.label}</span>
        </span>
      ))}
    </span>
  );
}

// Imperative refresh hook: call after assigning/removing tags so the
// badge cache picks up the change without a full page reload.
export function refreshAdminTagBadges() {
  cachePromise = null;
  void hydrate();
}
