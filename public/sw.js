/* Aaditri Emerland — service worker
 *
 * Minimal push + notification handler. We are *not* using next-pwa to register
 * this; the app registers it manually from `PushSubscriber` so we don't drag
 * in next-pwa's runtime caching (which fights Next.js 16 + Turbopack dev).
 *
 * Responsibilities:
 *   1. Listen for `push` events and show a notification.
 *   2. Listen for `notificationclick` events and focus / open the right URL.
 */

self.addEventListener('install', (event) => {
  // Activate this SW as soon as it's installed so users get push support
  // without having to close every open tab first.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Aaditri Emerland', body: event.data.text() };
  }

  const title = payload.title || 'Aaditri Emerland';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon.svg',
    badge: payload.badge || '/icon.svg',
    tag: payload.tag || 'ae-notification',
    renotify: !!payload.renotify,
    data: { url: payload.url || '/dashboard' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      // If a tab is already open on this origin, focus it and navigate.
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a fresh tab.
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
