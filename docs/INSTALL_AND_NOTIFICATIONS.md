# Install the App & Enable Notifications

A simple, step-by-step guide for **Aaditri Emerland** residents on how to install the community app on your phone and turn on push notifications — so you never miss a gate-entry approval request, booking update, or community announcement.

> **TL;DR**
> - **Android:** Open in Chrome → tap **Install** when prompted → allow notifications. Done.
> - **iPhone / iPad:** Open in **Safari** → **Share** → **Add to Home Screen** → open the new icon → allow notifications when prompted.

---

## Why install the app?

The Aaditri Emerland app is a **Progressive Web App (PWA)**. That means there is no Play Store or App Store download — you install it directly from the website. Once installed:

- It opens fullscreen, just like a native app
- It has its own icon on your home screen
- It can send you **push notifications** even when the app is closed
- It uses very little storage (typically less than 5 MB)

For flat owners, this is especially important for **gate-entry approvals**: when a visitor arrives, the security guard sends an approval request that pops up as a notification on your phone. You tap **Approve** or **Reject** without having to open the app first.

---

## Part 1 — Android (Chrome, Edge, Brave, Samsung Internet)

### Step 1. Install the app

1. Open **`https://your-aaditri-emerland-domain.com`** in **Google Chrome** (or any Chromium-based browser).
2. After a few seconds, Chrome will show an **"Install Aaditri Emerland"** banner at the bottom of the screen, *or* a small install icon in the address bar.
3. Tap **Install** → tap **Install** again to confirm.

If you don't see the banner:

- Tap the **⋮** (three-dot menu) in the top right
- Tap **Install app** or **Add to Home screen** → **Install**

The app icon will appear on your home screen and in your app drawer.

### Step 2. Enable notifications

1. Open the app from your home screen (the green **AE Community** icon).
2. Sign in with your registered phone number / email.
3. Go to **Profile** → **Notifications** (or tap any "Enable notifications" prompt that appears).
4. Tap **Allow** when Android asks *"Allow Aaditri Emerland to send you notifications?"*.

That's it — you're now subscribed to push.

### What works on Android

| Feature | Supported |
|---|---|
| Auto install prompt | Yes |
| Works in Chrome / Edge / Brave / Samsung Internet | Yes |
| Push notifications when app is closed | Yes |
| Push notifications when phone is locked | Yes |
| Notification sound and vibration | Yes (uses your system settings) |
| Action buttons (Approve / Reject inline) | Yes |
| Background sync | Yes |

---

## Part 2 — iPhone & iPad (iOS / iPadOS 16.4 or newer)

iPhones support push notifications for web apps too — but Apple has stricter rules than Android. You **must** install the app to your home screen first; notifications will not work from a Safari tab.

### Before you start — check your iOS version

1. Open **Settings** → **General** → **About** → **Software Version**.
2. You need **iOS 16.4 or later** (released March 2023). Most iPhone 8 and newer devices support this.
3. If you're on an older version, update via **Settings** → **General** → **Software Update**.

### Step 1. Install the app (Safari only)

> ⚠️ You **must use Safari** for this step. Chrome, Firefox, and other browsers on iOS cannot install PWAs or enable push.

1. Open **`https://your-aaditri-emerland-domain.com`** in **Safari**.
2. Tap the **Share** button at the bottom of the screen (the square with an arrow pointing up).

   ![Share button location](#) *(Bottom toolbar, middle icon)*

3. Scroll down in the share sheet and tap **Add to Home Screen**.
4. You can rename the app if you want (default: *AE Community*) → tap **Add** in the top-right.
5. The app icon now appears on your home screen.

### Step 2. Open the installed app

This step is critical. **Do not open the website in Safari again** — open the app from the home screen icon you just added. Otherwise iOS treats it as a normal web page and notifications won't work.

1. Find the **AE Community** icon on your home screen.
2. Tap it. The app should open **fullscreen**, with no Safari address bar visible. That confirms it's running as a standalone PWA.

### Step 3. Enable notifications

1. Sign in with your registered phone number / email.
2. Go to **Profile** → **Notifications**, or tap any "Enable notifications" prompt.
3. Tap the **Enable** button — this is required because iOS only allows the permission prompt after you tap something.
4. iOS will ask *"AE Community would like to send you notifications."* → tap **Allow**.

You're now subscribed. To verify, ask an admin to send you a test broadcast, or trigger a test from the **Profile → Notifications → Send test** button (if available).

### What works (and doesn't) on iOS

| Feature | Supported |
|---|---|
| Install via Chrome/Firefox on iOS | **No — Safari only** |
| Auto install prompt | **No — manual via Share menu** |
| Push notifications from Safari tab | **No — must install to home screen first** |
| Push notifications when app is closed | Yes (iOS 16.4+) |
| Push notifications when phone is locked | Yes |
| Notification sound | Yes |
| Background sync | Limited |
| Storage limit | ~50 MB |

---

## Part 3 — Gate-Entry Approval Flow (for Flat Owners)

Once you have the app installed and notifications enabled, here is how the gate-entry approval works:

### When a visitor arrives at the gate

1. **Security guard** opens the gate-entry screen on their device.
2. Guard enters the visitor's name, your flat number, and (optionally) a photo or vehicle number.
3. Guard taps **Send for approval**.

### What you (the flat owner) see

Within 1–5 seconds, your phone shows a **notification banner**:

> **Visitor at gate**
> *Rajesh Kumar is requesting entry to Flat A-204*

You can:

- **Tap the notification** → opens the app directly to the visitor request screen.
- **Tap Approve** → guard sees the green tick on their screen, visitor is allowed in.
- **Tap Reject** → guard sees the red cross, visitor is politely turned away.
- **Ignore it** → after 2 minutes (configurable), the request times out and the guard is notified to call you on intercom instead.

### Multiple flat owners

If your flat has more than one registered owner (e.g. husband and wife both have accounts), **all owners receive the notification**. The first one to approve or reject decides the outcome — the others get a "Resolved by [name]" update.

### Audit trail

Every approve / reject decision is logged in the **admin audit log** with:

- Who decided (resident name + user id)
- When (timestamp)
- Which device (phone model + browser, from the user-agent)
- Visitor details

Admins can view this in **Admin → Audit Log → Filter: Gate Entry**.

---

## Troubleshooting

### "I'm not getting notifications on my iPhone"

Check, in this order:

1. **Are you on iOS 16.4 or later?** Settings → General → About → Software Version.
2. **Did you install the app to the home screen?** It should have its own icon, not just a Safari bookmark.
3. **Did you open it from the home screen icon at least once?** Push only works from the standalone app context, not from Safari.
4. **Did you grant permission?** Settings → Notifications → AE Community → check that **Allow Notifications** is on.
5. **Is Focus / Do Not Disturb / Sleep mode on?** These will silence notifications.
6. **Is your phone connected to the internet?** iOS does not queue and replay missed pushes when offline.

### "I'm not getting notifications on my Android phone"

1. **Is the app installed?** Long-press the icon → it should say "App info", not "Shortcut".
2. **Are notifications allowed?** Settings → Apps → AE Community → Notifications → enable.
3. **Is battery optimization killing it?** Settings → Apps → AE Community → Battery → set to **Unrestricted**.
4. **Is the browser running in the background?** On some Android skins (MIUI, ColorOS, OneUI), you may need to "Lock" the browser app in the recent-apps view.

### "I want to uninstall the app"

- **Android:** Long-press the icon → Uninstall.
- **iOS:** Long-press the icon → Remove App → Delete from Home Screen.

This also revokes notification permission. To reinstall, repeat Part 1 or Part 2 above.

### "I changed my mind — how do I turn off notifications?"

- **Android:** Settings → Apps → AE Community → Notifications → toggle off.
- **iOS:** Settings → Notifications → AE Community → toggle **Allow Notifications** off.

You can also go to **Profile → Notifications → Unsubscribe this device** in the app.

---

## Privacy & data

- We use **VAPID Web Push** — your notifications are routed via Apple Push Notification Service (APNS) on iOS and Firebase Cloud Messaging (FCM) on Android, **without** us needing your Apple ID or Google account.
- We **do not** track your location, contacts, or any data outside the app.
- The notification payload contains only: title, short body, and a deep-link URL into the app.
- Stale subscriptions (uninstalled apps, revoked permissions) are automatically cleaned up from our database.

For full details see the [Privacy Policy](#) and [Security overview](../SECURITY.md).

---

## Quick reference card (print this!)

```
┌────────────────────────────────────────────────────────┐
│  ANDROID                                               │
│  1. Open site in Chrome                                │
│  2. Tap "Install" prompt → Install                     │
│  3. Open app → Allow notifications                     │
│                                                        │
│  iPHONE / iPAD (iOS 16.4+)                             │
│  1. Open site in SAFARI (not Chrome!)                  │
│  2. Tap Share → Add to Home Screen → Add               │
│  3. Open the new icon (NOT Safari)                     │
│  4. Sign in → Profile → Notifications → Enable         │
│  5. Tap Allow when iOS asks                            │
│                                                        │
│  TEST IT                                               │
│  Profile → Notifications → Send test notification      │
└────────────────────────────────────────────────────────┘
```

---

*Last updated: April 2026 — for app version using Next.js 16, iOS 16.4+ Web Push, and Android Chrome 42+.*
