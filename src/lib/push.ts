import 'server-only';
import webpush from 'web-push';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';

// VAPID identity. The PUBLIC key is also exposed to the browser via
// NEXT_PUBLIC_VAPID_PUBLIC_KEY so subscribers can negotiate with the push
// service. Generate a key pair once with `npx web-push generate-vapid-keys`
// and store all three in your env (or Vercel project settings).
//
// VAPID_SUBJECT must be a `mailto:` or `https://` URL — push services use it
// to contact the operator if there's abuse. Defaults to a placeholder so the
// server doesn't crash on boot in environments where push isn't configured.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@aaditri-emerland.local';
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  renotify?: boolean;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushFanOutResult {
  attempted: number;
  sent: number;
  failed: number;
  removed: number;
  skipped?: 'not_configured';
}

/**
 * Fan a single push payload out to a list of users (or to *every* approved
 * resident if `userIds` is omitted). Stale subscriptions (HTTP 404 / 410 from
 * the push service) are deleted automatically so the table doesn't bloat.
 *
 * Safe to call when VAPID is not configured — returns
 * `{ attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'not_configured' }`.
 */
export async function sendPushToUsers(
  userIds: string[] | null,
  payload: PushPayload
): Promise<PushFanOutResult> {
  if (!ensureConfigured()) {
    return { attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'not_configured' };
  }

  const admin = createAdminSupabaseClient();
  let query = admin.from('push_subscriptions').select('id, endpoint, p256dh, auth');
  if (userIds && userIds.length > 0) query = query.in('user_id', userIds);
  const { data, error } = await query;
  if (error || !data) {
    return { attempted: 0, sent: 0, failed: 0, removed: 0 };
  }

  const subs = data as SubscriptionRow[];
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const stale: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body
        );
        sent += 1;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404 = endpoint never existed; 410 = the user revoked / expired it.
        // Either way it's never coming back, so we evict it.
        if (status === 404 || status === 410) {
          stale.push(s.id);
        } else {
          failed += 1;
        }
      }
    })
  );

  if (stale.length) {
    await admin.from('push_subscriptions').delete().in('id', stale);
  }

  return { attempted: subs.length, sent, failed, removed: stale.length };
}

/**
 * Resolve "every approved resident" to a list of user IDs, then fan out.
 * Used by the broadcast pipeline.
 */
export async function sendPushToAllResidents(payload: PushPayload): Promise<PushFanOutResult> {
  if (!ensureConfigured()) {
    return { attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 'not_configured' };
  }
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('is_approved', true)
    .eq('is_bot', false);
  const ids = (data ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return { attempted: 0, sent: 0, failed: 0, removed: 0 };
  return sendPushToUsers(ids, payload);
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
}
