'use client';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

// Convert the URL-safe base64 VAPID key the browser hands us into the
// ArrayBuffer-backed Uint8Array that `pushManager.subscribe()` requires.
// We allocate a fresh ArrayBuffer (rather than using `new Uint8Array(len)`
// directly) so the resulting view satisfies BufferSource's stricter
// ArrayBuffer-only typing in TS 5.9+.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return view;
}

// Background registrar. Once the user is signed-in *and* they've already
// granted notification permission, we silently:
//   1. Register the service worker (if not already registered)
//   2. Make sure they have a current PushSubscription
//   3. Persist that subscription on the server
//
// We deliberately do NOT prompt for notification permission here — that's
// the job of `InstallPrompt` (or any other explicit user action). Browsers
// require a user gesture before `Notification.requestPermission()` to count
// as a useful interaction, and we don't want to ship a forced prompt the
// instant someone lands on /dashboard.
export default function PushSubscriber() {
  const { profile, mounted } = useAuth();

  useEffect(() => {
    if (!mounted || !profile?.id) return;
    const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublic) return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission !== 'granted') return;

    let cancelled = false;

    (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        if (cancelled) return;

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublic),
          });
        }
        if (cancelled || !sub) return;

        // Persist server-side. `endpoint` is the dedupe key on the server.
        const json = sub.toJSON();
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            userAgent: navigator.userAgent,
          }),
        });
      } catch {
        // Push isn't critical to app functionality — failing here just means
        // this device won't receive push for now. We retry on next mount.
      }
    })();

    return () => { cancelled = true; };
  }, [mounted, profile?.id]);

  return null;
}
