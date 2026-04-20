# Project Roadmap — Gate Management System

**Goal:** Build a complete gate management system for Aaditri Emerland that matches commercial offerings like MyGate, NoBrokerHood, ApnaComplex, and ADDA — at **₹0/month operating cost**.

**Status:** Planning phase — push notification infrastructure already exists; this roadmap covers everything else.

**Estimated total effort:** 6–8 weeks for a single developer working full-time, broken into 7 incremental phases (including small but critical Phase 2.5 for exit tracking and Phase 2.6 for safety/UX features) that each ship value on their own.

**Cost commitment:** **100% FREE** — no WhatsApp, no SMS, no voice calls. Push notifications + intercom-based human escalation only.

**Companion document:** See [`PRODUCT_BACKLOG.md`](./PRODUCT_BACKLOG.md) for the full feature backlog (35+ features across 4 tiers) with priorities, effort estimates, and committee decision points for v2 / v3 features.

---

## 1. Vision

Replace the typical society gate experience (paper register, phone calls, intercom) with a digital flow:

1. **Visitors** arrive at the gate
2. **Security guard** logs them on a tablet/phone, captures photo, picks resident from directory
3. **Resident** gets a **ringing push notification** with visitor name + photo
4. Resident taps **Approve** or **Reject** in 1 tap
5. Guard sees the decision in real time and lets the visitor in (or not)
6. **If resident doesn't respond in 60 seconds** → guard's screen shows the resident's intercom number + mobile number → **guard calls them on intercom or mobile**
7. Resident answers the call → tells guard "yes, allow them in" or "no, send them away"
8. Guard taps **"Adhoc Approval — Approved by phone"** or **"Adhoc Rejection — Rejected by phone"** with mandatory note (e.g., *"Spoke to Mr. Sharma on intercom — visitor is plumber he called"*)
9. Every entry/exit is logged for audit + reports, including the adhoc decisions

**Plus:**
- **Frequent visitors** (maid, milkman, newspaper, cook, driver) get **recurring auto-approved passes**
- **Residents pre-issue passes** for expected guests — guard just scans the QR at the gate, no resident interaction needed
- **Daily / Monthly / One-time passes** with validity windows and entry limits
- **Security personnel** are managed by admins, with a stripped-down login that only sees gate operations
- **Smart exit tracking** — visitors auto-exit after a category-specific timeout (delivery 30m, cab 15m, service 4h, visitor 8h); residents can self-mark exits; guards do a shift-handover checklist; admin sees stuck entries

**What we're explicitly NOT building (to stay free):**
- ❌ WhatsApp notifications (paid)
- ❌ SMS fallback (paid)
- ❌ Voice/IVR calls (paid)
- ❌ Email notifications for gate entries (overkill, slow)

**The escalation strategy is human, not technical:** when push fails or resident doesn't respond, the **security guard makes a phone call** using the intercom or mobile number visible only to them. This is what guards already do today — we're just making it digital and auditable.

---

## 2. New roles & access model

You currently have two roles: `admin` and `user` (resident). We'll add a **third role**.

### Updated role table

| Role | Access | New? |
|---|---|---|
| **Admin** (`role = 'admin'`) | Full system, plus security profile management | Existing |
| **Resident** (`role = 'user'`) | `/dashboard/*` — plus new gate features (passes, history, approve/reject) | Existing, extended |
| **Security** (`role = 'security'`) | `/security/*` only — gate dashboard, scan passes, log visitors, view resident directory (read-only, limited fields) | **NEW** |

### Security role permissions

Security can:
- ✅ Log a visitor entry (name, phone, photo, vehicle, purpose)
- ✅ Search the **resident directory** (flat number, name, photo, **intercom number, mobile number** — for calling when push fails)
- ✅ Send entry approval requests to residents
- ✅ Scan resident-issued QR passes
- ✅ **Adhoc approve/reject** an entry on behalf of a resident after a phone call (mandatory note required)
- ✅ View **today's gate log** (their own shift)
- ✅ Mark exits when visitors leave

Security **cannot**:
- ❌ Access `/dashboard/*` (resident features — bookings, community, etc.)
- ❌ Access `/admin/*`
- ❌ See resident emails or family details
- ❌ Edit historical gate logs
- ❌ Create/delete passes (only validate them)
- ❌ Self-register (admin must create the account)
- ❌ Adhoc approve **without** logging a reason note (system enforces this)

### Why security can see phone numbers

Unlike commercial apps that hide all contact info from guards (then charge you for in-app calling), we **trust** the security guards by giving them access to:
- Resident **intercom number**
- Resident **mobile number** (only used when push fails)

This is the same information they already have on the paper register. Making it digital + auditable is an improvement, not a downgrade.

Every time a guard views a phone number it's logged in the audit trail (`security_phone_views` table) — admins can see exactly when each guard accessed each resident's contact info.

### Admin role gets new abilities

- ✅ Create / disable / delete security profiles
- ✅ Assign security shift schedules (optional, future)
- ✅ View **full gate log** across all dates and guards
- ✅ Configure visitor categories (visitor / maid / milkman / etc.)
- ✅ Export entry logs to CSV/PDF for monthly reports
- ✅ Audit which guards viewed which residents' phone numbers and when
- ✅ Review **adhoc approvals** flagged for verification

---

## 3. Phased delivery plan

The project is split into 5 phases. Each ships value independently and can be released to residents as soon as it's done.

| Phase | Scope | Effort | Dependencies |
|---|---|---|---|
| **Phase 1** | Security role + admin can create security profiles | 3–4 days | None |
| **Phase 2** | Visitor logging + ringing approval + adhoc approval flow | 5–7 days | Phase 1, push (done) |
| **Phase 2.5** | Exit tracking & cleanup (auto-exit, handover checklist) | 2–3 days | Phase 2 |
| **Phase 2.6** | **Safety & UX essentials (pre-approve, panic button, blacklist, notification prefs)** | **3–4 days** | **Phase 2** |
| **Phase 3** | Pre-issued QR passes (one-time, daily, monthly) | 4–5 days | Phase 1 |
| **Phase 4** | Frequent visitors / staff (maid, milkman, etc.) | 3–4 days | Phase 2, 3 |
| **Phase 5** | Reports, analytics, polish, escalation flows | 3–5 days | All above |

**Beyond v1:** See `PRODUCT_BACKLOG.md` for Phase 6 (committee features), Phase 7 (payments + premium), and the full backlog of 35+ requested features.

---

## 4. Phase 1 — Security role & admin management

**Goal:** Admin can create security guard accounts. Security guards can log in to a stripped-down `/security/*` portal.

### 4.1 Database changes

```sql
-- Migration: 20260424_security_role.sql

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'user', 'security'));

create table if not exists public.security_personnel (
  id uuid primary key references public.profiles(id) on delete cascade,
  badge_number text unique not null,
  shift_start time,
  shift_end time,
  emergency_contact text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Audit log: which guard viewed which resident's phone number, and when
create table if not exists public.security_phone_views (
  id bigserial primary key,
  security_id uuid not null references public.profiles(id),
  resident_id uuid not null references public.profiles(id),
  reason text,                              -- e.g. "Calling for visitor approval entry #abc123"
  related_entry_id uuid,                    -- gate_entries.id
  viewed_at timestamptz not null default now()
);

create index security_phone_views_resident_idx on public.security_phone_views(resident_id, viewed_at desc);
create index security_phone_views_guard_idx on public.security_phone_views(security_id, viewed_at desc);

alter table public.security_personnel enable row level security;
alter table public.security_phone_views enable row level security;

create policy "security_personnel_admin_all"
  on public.security_personnel for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "security_personnel_self_view"
  on public.security_personnel for select
  to authenticated
  using (id = auth.uid());

create policy "security_phone_views_admin_only"
  on public.security_phone_views for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "security_phone_views_guard_insert"
  on public.security_phone_views for insert
  to authenticated
  with check (security_id = auth.uid());
```

### 4.2 Backend

- `POST /api/admin/security/create` — admin creates a security profile (auto-confirms email like resident registration)
- `PATCH /api/admin/security/[id]` — disable/enable, update badge
- `GET /api/admin/security` — list all security personnel
- `POST /api/security/log-phone-view` — guard records that they viewed a resident's phone (called automatically when phone is revealed in UI)
- Update `src/proxy.ts` — route `/security/*` to security role only; redirect security users away from `/dashboard` and `/admin`

### 4.3 Frontend — Admin

New page: `src/app/admin/security/page.tsx`

- Table of all security personnel (name, badge, active, last login)
- "Add Security Guard" form modal (name, phone, badge number, password)
- Toggle active/inactive
- "Reset Password" button
- Link to **Phone Access Audit** showing recent phone-number views

### 4.4 Frontend — Security portal layout

New folder structure:
```
src/app/security/
  layout.tsx           — minimal layout, big buttons, mobile-first
  page.tsx             — landing: today's stats, "Log Visitor", "Scan Pass"
  visitors/
    new/page.tsx       — log a new visitor (Phase 2)
    [id]/page.tsx      — visitor detail with adhoc approval option
  scan/page.tsx        — QR scanner (Phase 3)
  log/page.tsx         — today's gate log
  directory/page.tsx   — resident directory (read-only, with reveal-phone button)
```

### 4.5 Acceptance criteria

- ✅ Admin can create a security guard with badge number
- ✅ Security guard can log in with their phone/email + password
- ✅ Security guard sees `/security` dashboard, NOT `/dashboard` or `/admin`
- ✅ Resident URLs return 403 for security users
- ✅ Admin URLs return 403 for security users
- ✅ Phone number views are logged to `security_phone_views` whenever guard taps "Show Phone"

---

## 5. Phase 2 — Visitor logging, ringing approval & adhoc approval

**Goal:** The core gate flow. Guard logs a visitor → resident gets a ringing notification → 1-tap approve/reject. If no response, guard calls resident on intercom/mobile and records an adhoc decision.

### 5.1 Database

```sql
-- Migration: 20260425_gate_entries.sql

create type gate_visitor_category as enum (
  'visitor',     -- general guest
  'delivery',    -- swiggy, zomato, amazon, etc.
  'cab',         -- ola, uber, taxi
  'service',     -- electrician, plumber, AC tech
  'maid',        -- house help (if not pre-registered)
  'milkman',
  'newspaper',
  'cook',
  'driver',
  'other'
);

create type gate_entry_status as enum (
  'pending',          -- waiting on resident
  'approved',         -- resident approved via app
  'rejected',         -- resident rejected via app
  'adhoc_approved',   -- guard approved after phone call (intercom/mobile)
  'adhoc_rejected',   -- guard rejected after phone call (intercom/mobile)
  'expired',          -- nobody responded and no adhoc decision was made
  'admin_override'    -- admin manually changed the decision
);

create type gate_decision_channel as enum (
  'app',              -- resident clicked Approve/Reject in app
  'push_action',      -- resident clicked Approve/Reject directly in notification
  'intercom_call',    -- guard called intercom and got verbal approval
  'mobile_call',      -- guard called resident mobile and got verbal approval
  'admin'             -- admin override
);

create table if not exists public.gate_entries (
  id uuid primary key default gen_random_uuid(),
  visitor_name text not null,
  visitor_phone text,
  visitor_photo_url text,
  vehicle_number text,
  category gate_visitor_category not null default 'visitor',
  purpose text,
  flat_number text not null,
  resident_id uuid references public.profiles(id),
  pass_id uuid references public.gate_passes(id),  -- if entered via pre-issued pass
  status gate_entry_status not null default 'pending',

  -- Decision tracking
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_channel gate_decision_channel,
  decision_reason text,                  -- mandatory for adhoc decisions

  -- Timing for audit
  logged_by uuid not null references public.profiles(id),
  logged_at timestamptz not null default now(),
  notification_sent_at timestamptz,
  first_renotify_at timestamptz,
  escalation_started_at timestamptz,    -- when guard saw "call resident" prompt
  entry_time timestamptz,
  exit_time timestamptz,

  created_at timestamptz not null default now()
);

create index gate_entries_status_idx on public.gate_entries(status);
create index gate_entries_resident_idx on public.gate_entries(resident_id, created_at desc);
create index gate_entries_flat_idx on public.gate_entries(flat_number, created_at desc);
create index gate_entries_pending_idx on public.gate_entries(status, logged_at)
  where status = 'pending';

-- Constraint: adhoc decisions MUST have a reason
alter table public.gate_entries
  add constraint gate_entries_adhoc_reason_required
  check (
    status not in ('adhoc_approved', 'adhoc_rejected')
    or (decision_reason is not null and length(trim(decision_reason)) > 0)
  );

-- RLS:
-- - residents see their own entries
-- - security sees today's entries (their shift)
-- - admin sees all
-- (full policies in migration file)
```

### 5.2 The 60-second escalation flow (FREE version)

```
T+0s     Guard taps "Log Visitor" → fills form → submits
T+0s     Server creates gate_entries row (status=pending)
T+0s     Push notification sent to resident with sound + vibration + ACTION BUTTONS
         ┌─────────────────────────────┐
         │ 🔔 Visitor at gate            │
         │ Rajesh Kumar (delivery)       │
         │ [APPROVE]    [REJECT]          │
         └─────────────────────────────┘

T+1s     Resident's PWA shows banner with `requireInteraction: true`
         (notification stays on screen until tapped, vibrates phone)

T+15s    If no response → second push (renotify) — same notification,
         re-rings the phone

T+30s    If still no response → third push: "URGENT — Visitor waiting at gate"

T+60s    NO MORE AUTOMATED MESSAGES (saves all WhatsApp/SMS/voice cost)

         Guard's screen automatically updates to show:
         ┌────────────────────────────────────────┐
         │ ⚠️ NO RESPONSE FROM A-204 (Sharma family)  │
         │                                          │
         │ Please call them now:                    │
         │                                          │
         │   📞 INTERCOM:    204                    │
         │   📱 MOBILE:      +91 98xxx xxxxx        │
         │                   (tap to view full)     │
         │                                          │
         │ After calling, record their decision:    │
         │                                          │
         │ [ ✓ ADHOC APPROVE ] [ ✗ ADHOC REJECT ]   │
         │ [ TRY AGAIN ]      [ CANCEL ENTRY ]     │
         └────────────────────────────────────────┘

T+60s+   Guard picks up the intercom phone (or their own mobile if needed),
         calls Mr./Mrs. Sharma at flat A-204.

         If Sharma says "yes, let him in":
         → Guard taps [✓ ADHOC APPROVE]
         → System asks for mandatory note:
           ┌──────────────────────────────────────┐
           │ Adhoc Approval — please confirm        │
           │                                        │
           │ Whom did you speak to? *               │
           │ ( ) Mr. Sharma (owner)                 │
           │ ( ) Mrs. Sharma (owner)                │
           │ ( ) Other family member                │
           │                                        │
           │ Note (mandatory) *                     │
           │ ┌────────────────────────────────────┐│
           │ │ Spoke to Mr. Sharma on intercom.    ││
           │ │ Visitor is electrician he called.   ││
           │ └────────────────────────────────────┘│
           │                                        │
           │ Channel: ( ) Intercom  ( ) Mobile      │
           │                                        │
           │ [ CONFIRM APPROVAL ]                   │
           └──────────────────────────────────────┘

T+60s+   Decision saved with status='adhoc_approved', channel='intercom_call'.

         Resident gets a notification (silent, info only):
         "Security guard approved entry of Rajesh Kumar after calling
          you on intercom at 10:34 AM. If this was not authorized,
          please tap here to flag it."
```

### 5.3 Ringing notifications (the technical bit)

Standard PWA push notifications are silent banners. To get **ringing/loud** behavior **without paying for anything**:

#### Strategy: Maximize browser-native loudness

```js
// public/sw.js — extend the existing push handler

self.addEventListener('push', (event) => {
  const payload = event.data.json();

  if (payload.urgent) {
    event.waitUntil((async () => {
      // If app is open, tell it to play a ringtone via the foreground audio API
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({
          type: 'PLAY_RINGTONE',
          soundUrl: '/sounds/gate-bell.mp3',
          loop: true
        });
      }

      // Show notification with maximum attention-grabbing options
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: payload.tag,
        renotify: true,                     // re-vibrate on repeat pushes
        requireInteraction: true,           // stays visible until tapped
        vibrate: [200, 100, 200, 100, 200, 100, 200, 100, 200],  // long pattern
        actions: [
          { action: 'approve', title: '✓ Approve' },
          { action: 'reject', title: '✗ Reject' },
        ],
        data: { entryId: payload.entryId, url: payload.url },
        silent: false,                      // use system notification sound
      });
    })());
  }
});

// When user clicks action button directly in the notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'approve' || event.action === 'reject') {
    event.waitUntil(
      fetch(`/api/gate/entries/${event.notification.data.entryId}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision: event.action,
          channel: 'push_action'
        }),
        headers: { 'Content-Type': 'application/json' },
      })
    );
    return;
  }

  // Otherwise open the app at the entry detail page
  event.waitUntil(
    self.clients.openWindow(event.notification.data.url)
  );
});
```

```ts
// In a foreground component (e.g. dashboard layout)
useEffect(() => {
  if (!('serviceWorker' in navigator)) return;

  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'PLAY_RINGTONE') {
      const audio = new Audio(event.data.soundUrl);
      audio.loop = event.data.loop;
      audio.play().catch(() => {
        // Browser blocked autoplay — user needs to interact first
        // Show a visible banner instead
      });
    }
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}, []);
```

#### Reality check on ringing volume

| Scenario | What happens |
|---|---|
| **Android, app open** | Loud audio loop + vibration + on-screen banner = very hard to miss |
| **Android, app closed, screen on** | Heavy vibration + system notification sound + banner = noticeable |
| **Android, app closed, screen off** | System notification sound (volume = your "Notifications" setting) + vibration = **may be missed if phone on silent** |
| **iOS, PWA installed, app open** | Audio loop + banner = noticeable |
| **iOS, PWA installed, app closed** | System notification sound (depends on Focus/DnD settings) = **may be missed** |
| **iOS, no PWA installed** | **Nothing — no notification at all** |

**This is why the human escalation matters.** Push will work for ~80% of cases. For the other 20%, the guard simply makes a phone call — same as he does today on the paper-register system, but now it's logged.

### 5.4 Backend endpoints

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /api/gate/entries` | Security | Create new entry, send notification |
| `POST /api/gate/entries/[id]/decide` | Resident | Approve/reject (channel = 'app' or 'push_action') |
| `POST /api/gate/entries/[id]/adhoc-decide` | Security | Adhoc approve/reject after phone call (requires note) |
| `POST /api/gate/entries/[id]/exit` | Security | Mark visitor exited |
| `POST /api/gate/entries/[id]/renotify` | Security | Manually resend the push |
| `POST /api/gate/entries/[id]/cancel` | Security | Cancel entry (visitor left, etc.) |
| `GET /api/gate/entries` | All | List entries (filtered by role) |
| `GET /api/gate/entries/[id]` | Resident/security/admin | View detail |
| `POST /api/cron/gate-escalation` | Cron (every 15s) | Send renotify pushes at T+15s, T+30s; mark T+60s entries as needing escalation UI on guard side |

### 5.5 Security frontend — log a visitor

`src/app/security/visitors/new/page.tsx`

Big mobile-first form:

```
┌────────────────────────────────────┐
│  📷 Take Photo (optional)             │
│      [camera preview]                │
├────────────────────────────────────┤
│  Visitor Name *                       │
│  [_________________________]         │
│                                       │
│  Phone (optional)                     │
│  [_________________________]         │
│                                       │
│  Vehicle Number                       │
│  [_________________________]         │
│                                       │
│  Category *                           │
│  ( ) Visitor                          │
│  ( ) Delivery (Swiggy/Zomato/etc.)   │
│  ( ) Cab (Ola/Uber)                   │
│  ( ) Service (Electrician/Plumber)   │
│  ( ) Other                            │
│                                       │
│  Flat to visit *                      │
│  [Search: A-204 Sharma_____] 🔍     │
│  → Sharma family, A-204               │
│                                       │
│  Purpose                              │
│  [_________________________]         │
│                                       │
│  [ SEND FOR APPROVAL ]                │
└────────────────────────────────────┘
```

### 5.6 Security frontend — pending entry view (the live screen)

After submit, the guard's screen shows the live status of the entry. This screen polls or uses Supabase Realtime to update without manual refresh.

**State 1 — Waiting (T+0 to T+60s):**
```
┌────────────────────────────────────┐
│  ⏳ Waiting for Sharma family...      │
│                                       │
│  Visitor: Rajesh Kumar (delivery)    │
│  Flat: A-204                          │
│                                       │
│  [pending — 0:23 elapsed]             │
│                                       │
│  We've notified them on the app.      │
│  If they don't respond by 1:00,       │
│  you'll see their phone number.       │
│                                       │
│  ✗ Cancel                             │
└────────────────────────────────────┘
```

**State 2 — Resident approved (any time):**
```
┌────────────────────────────────────┐
│  ✅ APPROVED by Mr. Sharma            │
│  via app — 0:14                       │
│                                       │
│  Allow entry of Rajesh Kumar          │
│  to A-204                             │
│                                       │
│  [ MARK AS ENTERED ]                  │
└────────────────────────────────────┘
```

**State 3 — Resident rejected:**
```
┌────────────────────────────────────┐
│  ❌ REJECTED by Mrs. Sharma           │
│  via app — 0:22                       │
│                                       │
│  Reason: "Not expecting anyone"       │
│                                       │
│  Please ask the visitor to leave.     │
│  [ ENTRY CLOSED ]                     │
└────────────────────────────────────┘
```

**State 4 — No response, escalation (T+60s+):**
```
┌────────────────────────────────────┐
│  ⚠️ NO RESPONSE FROM A-204            │
│  Sharma family did not respond        │
│  in 60 seconds.                       │
│                                       │
│  Please call them now:                │
│                                       │
│   📞 INTERCOM:  204                   │
│   📱 MOBILE:    [TAP TO REVEAL]       │
│                                       │
│  After calling, record decision:      │
│                                       │
│  [ ✓ ADHOC APPROVE ]                  │
│  [ ✗ ADHOC REJECT ]                   │
│                                       │
│  [ Try notification again ]           │
│  [ Cancel — visitor left ]            │
└────────────────────────────────────┘
```

When guard taps **"TAP TO REVEAL"**: phone number is shown AND a row is inserted into `security_phone_views` with the entry id and a default reason ("Calling for visitor approval entry #abc123"). Audit trail is automatic.

### 5.7 Security frontend — adhoc approval modal

When guard taps "Adhoc Approve":

```
┌────────────────────────────────────┐
│  Confirm Adhoc Approval               │
│                                       │
│  Visitor: Rajesh Kumar                │
│  Flat: A-204 (Sharma family)         │
│                                       │
│  How did you reach the resident? *    │
│  ( ) Intercom call                    │
│  ( ) Mobile call                      │
│                                       │
│  Whom did you speak to? *             │
│  ( ) Mr. Sharma (owner)               │
│  ( ) Mrs. Sharma (owner)              │
│  ( ) Family member                    │
│  ( ) Other (specify in note)          │
│                                       │
│  Note (mandatory, min 10 chars) *     │
│  ┌──────────────────────────────────┐│
│  │ Spoke to Mr. Sharma on intercom.  ││
│  │ Visitor is electrician he called  ││
│  │ for AC repair.                    ││
│  └──────────────────────────────────┘│
│                                       │
│  ⚠️ This will be visible to admins    │
│  and the resident.                     │
│                                       │
│  [ CONFIRM APPROVAL ]   [ Cancel ]    │
└────────────────────────────────────┘
```

Note must be **at least 10 characters** (configurable, server-side validated). Without a meaningful note, the request is rejected.

### 5.8 Resident frontend — incoming approval

When push lands, the notification itself has Approve/Reject buttons. If the resident taps the body of the notification (not a button), they land on:

`src/app/dashboard/gate/[entryId]/page.tsx`

```
┌────────────────────────────────────┐
│  🔔 Visitor at Gate                   │
│                                       │
│  [photo of visitor]                   │
│                                       │
│  Name:     Rajesh Kumar               │
│  Phone:    9876543210                 │
│  Vehicle:  KA-01-AB-1234              │
│  Category: Delivery                   │
│  Purpose:  Swiggy order               │
│                                       │
│  Logged by: Guard Ravi (Badge: G-12) │
│  Time: Just now                       │
│                                       │
│  [ ✓ APPROVE ]  [ ✗ REJECT ]          │
│                                       │
│  Reason (optional):                   │
│  [_____________________________]    │
└────────────────────────────────────┘
```

### 5.9 Resident frontend — adhoc approval notice

When the guard makes an adhoc decision, the resident gets a quiet info notification + a banner on their dashboard:

```
┌────────────────────────────────────┐
│  ℹ️ ADHOC APPROVAL by Security        │
│                                       │
│  At 10:34 AM, security guard Ravi    │
│  approved entry of Rajesh Kumar       │
│  after calling you on intercom.       │
│                                       │
│  Reason logged: "Spoke to Mr. Sharma  │
│  on intercom — visitor is electrician │
│  he called for AC repair."            │
│                                       │
│  Did this happen as expected?         │
│  [ Yes, OK ]   [ ⚠️ Flag as wrong ]   │
└────────────────────────────────────┘
```

If resident taps **"Flag as wrong"** → admin gets a notification, the entry is marked for review. This creates accountability for adhoc approvals.

### 5.10 Acceptance criteria

- ✅ Security can log a visitor in <30 seconds
- ✅ Resident receives ringing notification within 5 seconds
- ✅ Resident can approve/reject from the notification banner directly (Android)
- ✅ Resident can approve/reject from in-app screen (iOS + Android)
- ✅ Guard sees the decision in real time (no refresh needed — Supabase Realtime)
- ✅ At T+15s and T+30s, resident gets a renotify push
- ✅ At T+60s, guard sees the resident's intercom number + reveal-mobile button
- ✅ Guard can record adhoc approval/rejection with mandatory note (min 10 chars)
- ✅ Adhoc decisions notify the resident with the guard's note
- ✅ Resident can flag adhoc decisions as wrong → admin alerted
- ✅ Every entry is logged in `gate_entries` with full audit trail
- ✅ Phone number views logged in `security_phone_views` for compliance
- ✅ **Zero paid notification channels used**

---

## 5b. Phase 2.5 — Exit tracking & cleanup

**Goal:** Make sure every visitor entry eventually gets an exit time, even when the guard forgets to mark it. Without this, the system slowly fills with "permanently inside" visitors and reports become useless.

**Why this is its own phase:** It's small (2–3 days), but it touches every entry and is critical for data quality. Better to ship Phase 2 first, observe the "forgot to mark exit" problem in real life for a week, then bolt this on with confidence.

### 5b.1 The problem in real societies

Visitors enter, but the guard often forgets to mark them as "exited" because:

1. Guard is busy with another visitor at the gate
2. Visitor uses a different gate (delivery vs. main, or walks out via the swimming-pool gate)
3. Shift change happens — incoming guard doesn't know who's still inside
4. Visitor sneaks out without telling the guard
5. Guard simply forgets after a long shift

If left unmanaged, the gate log fills with "permanently inside" visitors, which:
- Breaks accurate "who's currently in the society" reports
- Creates false security alerts ("there are 247 people inside!")
- Makes audits useless
- Can hide real security issues (a visitor who actually didn't leave)

### 5b.2 Multi-layered defense (all free)

We use 5 progressively-more-aggressive layers, all running for free on existing infrastructure:

| Layer | Mechanism | Catches |
|---|---|---|
| **Layer 1** | Smart auto-exit by category (cron every 15 min) | 70% of cases |
| **Layer 2** | End-of-day cleanup at 11:55 PM (cron) | 20% more |
| **Layer 3** | Resident self-service "currently inside" widget | 5% more |
| **Layer 4** | Guard shift-handover checklist | 4% more |
| **Layer 5** | Admin "stuck entries" dashboard alert | 1% genuine concerns |

### 5b.3 Database changes

```sql
-- Migration: 20260428_gate_exit_tracking.sql

create type gate_exit_method as enum (
  'guard_marked',      -- guard tapped "Mark Exit" on the way out
  'resident_marked',   -- resident self-service exit from dashboard
  'pass_expired',      -- pass-based entry, expired automatically
  'auto_timeout',      -- category-specific timeout (Layer 1)
  'auto_eod',          -- end-of-day cleanup at 11:55 PM (Layer 2)
  'shift_handover',    -- guard marked during handover (Layer 4)
  'admin_corrected'    -- admin manually fixed
);

alter table public.gate_entries
  add column if not exists exit_method gate_exit_method,
  add column if not exists exit_marked_by uuid references public.profiles(id),
  add column if not exists exit_note text,
  add column if not exists expected_exit_at timestamptz;
  -- expected_exit_at is computed at entry_time based on category;
  -- the cron uses this column directly for efficient lookups.

create index gate_entries_inside_idx
  on public.gate_entries (expected_exit_at)
  where entry_time is not null and exit_time is null;

-- Configuration table for category-specific timeouts (admin-tunable)
create table if not exists public.gate_exit_timeouts (
  category gate_visitor_category primary key,
  timeout_minutes integer not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- Sensible defaults
insert into public.gate_exit_timeouts (category, timeout_minutes) values
  ('delivery', 30),
  ('cab', 15),
  ('service', 240),     -- 4 hours
  ('visitor', 480),     -- 8 hours
  ('maid', 180),        -- 3 hours
  ('cook', 120),
  ('driver', 720),      -- 12 hours
  ('milkman', 30),
  ('newspaper', 30),
  ('other', 360)        -- 6 hours
on conflict (category) do nothing;

alter table public.gate_exit_timeouts enable row level security;

create policy "gate_exit_timeouts_admin_write"
  on public.gate_exit_timeouts for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "gate_exit_timeouts_authenticated_read"
  on public.gate_exit_timeouts for select
  to authenticated
  using (true);
```

### 5b.4 Default auto-exit timeouts (Layer 1)

| Category | Default timeout | Rationale |
|---|---|---|
| **Delivery** | 30 minutes | Drop the package and leave |
| **Cab** | 15 minutes | Drop passenger and leave |
| **Milkman / Newspaper** | 30 minutes | Quick rounds |
| **Cook** | 2 hours | One meal prep cycle |
| **Maid** | 3 hours | Typical cleaning shift |
| **Service** (electrician, plumber, AC) | 4 hours | Half-day repair |
| **Other** | 6 hours | Conservative default |
| **Visitor** (general) | 8 hours | Whole-day social visit |
| **Driver** | 12 hours | Likely waiting all day for the resident |

Admins can adjust these in `Admin → Settings → Exit Timeouts` if their society has different patterns.

### 5b.5 Cron jobs

Two new cron endpoints, scheduled in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/gate-auto-exit",   "schedule": "*/15 * * * *" },
    { "path": "/api/cron/gate-eod-cleanup", "schedule": "55 23 * * *"  }
  ]
}
```

**`/api/cron/gate-auto-exit`** — every 15 minutes:

```sql
-- Pseudo-code
UPDATE gate_entries
SET exit_time = expected_exit_at,
    exit_method = 'auto_timeout',
    exit_note = 'Automatically exited after category timeout'
WHERE entry_time IS NOT NULL
  AND exit_time IS NULL
  AND expected_exit_at < now();
```

**`/api/cron/gate-eod-cleanup`** — every day at 11:55 PM:

```sql
UPDATE gate_entries
SET exit_time = now(),
    exit_method = 'auto_eod',
    exit_note = 'End-of-day automatic cleanup at 23:55'
WHERE entry_time IS NOT NULL
  AND exit_time IS NULL
  AND entry_time::date = current_date;
```

Both cron jobs notify residents quietly: *"Your visitor Rajesh Kumar was auto-marked as exited at 11:55 PM. Tap to correct if wrong."*

### 5b.6 Resident self-service exit (Layer 3)

New widget on `/dashboard` (top of home page when something is inside):

```
┌────────────────────────────────────┐
│  👥 Currently Inside (2)              │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ Rajesh Kumar (electrician)        ││
│  │ Entered: 2:30 PM (1h 23m ago)    ││
│  │ Expected exit: 6:30 PM            ││
│  │ [ MARK AS EXITED ]                ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Lakshmi (maid)                   ││
│  │ Entered: 9:15 AM (5h 38m ago)    ││
│  │ ⚠️ Should have exited at 12:15 PM ││
│  │ [ MARK AS EXITED ]                ││
│  └─────────────────────────────────┘│
└────────────────────────────────────┘
```

If a visitor has been "inside" for more than 1 hour past their expected exit, the resident gets a quiet push: *"Rajesh Kumar still shown as inside since 2:30 PM. If they've left, tap to mark exit."*

When resident marks exit, the entry stores:
- `exit_time = now()`
- `exit_method = 'resident_marked'`
- `exit_marked_by = resident.id`

### 5b.7 Guard shift-handover checklist (Layer 4)

When a security guard taps "End Shift" (or admin marks shift end):

```
┌────────────────────────────────────┐
│  End of Shift — Handover              │
│                                       │
│  10 visitors are still marked "inside"│
│  Please review each:                  │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ Rajesh Kumar — A-204 electrician  ││
│  │ Entered 2:30 PM (3h 12m ago)     ││
│  │                                   ││
│  │ [ ✓ Still inside ]                ││
│  │ [ ✗ Mark as exited ]              ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Suresh — B-101 delivery           ││
│  │ Entered 4:15 PM (1h 27m ago)     ││
│  │                                   ││
│  │ [ ✓ Still inside ]                ││
│  │ [ ✗ Mark as exited ]              ││
│  └─────────────────────────────────┘│
│  ...8 more...                         │
│                                       │
│  [ COMPLETE HANDOVER ]                │
└────────────────────────────────────┘
```

Guard cannot complete the handover without addressing every "inside" entry. Entries marked as still-inside get a flag visible to the next guard. Entries marked as exited get `exit_method = 'shift_handover'`.

The next guard logs in to a clean screen showing only the genuinely-still-inside visitors from the previous shift.

### 5b.8 Admin "stuck entries" widget (Layer 5)

New widget on `/admin/gate`:

```
┌────────────────────────────────────┐
│  ⚠️ Stuck Entries                     │
│                                       │
│  3 entries have been "inside" for     │
│  more than 12 hours. Please review:   │
│                                       │
│  • Mahesh Singh — A-204 (visitor)     │
│    Entered yesterday 8:30 PM          │
│    [ Mark exited ] [ Investigate ]   │
│                                       │
│  ...                                  │
└────────────────────────────────────┘
```

Anything still inside after 24 hours triggers a quiet email to admin (using your existing Brevo setup, free).

When admin marks exit, the entry stores `exit_method = 'admin_corrected'` and the original entry is preserved with admin's note for audit.

### 5b.9 Reporting on data quality

The `exit_method` enum lets monthly reports show how the system is performing:

```
April 2026 Exit Method Breakdown
─────────────────────────────────
guard_marked       72%   ✅ healthy
auto_timeout       18%   ✅ acceptable (expected for delivery/cab)
resident_marked     6%   ✅ engaged residents
shift_handover      3%   ✅ handover process working
auto_eod            1%   ✅ safety net
admin_corrected     0%   ✅ no genuine stuck entries
```

If `guard_marked` drops below 60%, the admin knows guards need retraining on exit-marking. If `auto_eod` ever climbs above 5%, something is wrong with the workflow.

### 5b.10 Backend endpoints

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /api/gate/inside` | Resident | "Currently inside my flat" list |
| `POST /api/gate/entries/[id]/mark-exit` | Resident or Security | Mark visitor as exited |
| `GET /api/security/handover` | Security | Get list of still-inside entries for handover |
| `POST /api/security/handover/complete` | Security | Submit handover decisions in batch |
| `GET /api/admin/gate/stuck-entries` | Admin | Entries inside >12 hours |
| `GET /api/admin/gate/exit-timeouts` | Admin | Read timeout config |
| `PATCH /api/admin/gate/exit-timeouts` | Admin | Adjust timeout per category |
| `POST /api/cron/gate-auto-exit` | Vercel Cron | Layer 1 cleanup |
| `POST /api/cron/gate-eod-cleanup` | Vercel Cron | Layer 2 cleanup |

### 5b.11 Edge cases handled

| Edge case | How handled |
|---|---|
| **Visitor exits via different gate** | Other gate's guard scans them out (if they have a pass) or resident self-marks |
| **Resident marks exit, but visitor is still inside** | Guard at gate sees "no record" if visitor tries to leave again — guard logs them as exiting anyway with note "Already marked exited by resident" |
| **Power/internet outage during exit** | Entry stays "inside"; auto-cleanup catches it later |
| **Guard accidentally marks wrong visitor as exited** | Shift handover screen shows the discrepancy; admin can revert via `admin_corrected` |
| **Visitor enters at 11 PM, EOD cleanup at 11:55 PM marks them exited** | Cleanup only marks entries from `current_date`. A visitor who entered at 11 PM is still inside at 11:55 PM and won't be touched until next-day's cleanup at 11:55 PM the following day, OR Layer 1 timeout kicks in earlier. |
| **Multi-day visitor (e.g., relative staying overnight)** | Resident extends `expected_exit_at` from their dashboard; or admin marks the entry as "extended stay" which exempts it from auto-cleanup |

### 5b.12 Acceptance criteria

- ✅ Every entry eventually has a non-null `exit_time` within 24 hours
- ✅ `exit_method` is always populated and accurately reflects who/what closed the entry
- ✅ Cron job runs every 15 minutes and processes batched updates efficiently (<100ms for 1000 entries)
- ✅ Resident "currently inside" widget loads in <500ms
- ✅ Guard cannot end shift without reviewing every still-inside entry
- ✅ Admin sees stuck-entries (>12 hours inside) prominently on dashboard
- ✅ Resident gets quiet push when their visitor is auto-exited (with one-tap "correct" option)
- ✅ Monthly report shows exit-method breakdown for data-quality monitoring
- ✅ Admin can tune category-specific timeouts without redeploying
- ✅ **Zero paid notification channels used**

---

## 5c. Phase 2.6 — Safety & UX essentials

**Goal:** Add the four highest-ROI features that turn the gate system from "functional" into "delightful and safe": pre-approve visitor, panic button, visitor blacklist, and notification preferences.

**Why this is its own phase:** These are 4 small, independent features that **don't depend on each other** but together massively close the gap with commercial apps. None of them requires the QR-pass infrastructure (Phase 3), so we can ship them right after Phase 2.5 to give residents safety + convenience wins early.

### 5c.1 Feature 1 — Pre-approve a visitor in advance

**The problem:** Resident knows the plumber is coming at 3 PM but doesn't have his number (so can't issue a QR pass). Right now the resident has to drop everything at 3 PM to approve in the app.

**The solution:** Resident pre-tells the system "I'm expecting Ramesh the plumber between 2–5 PM today". When Ramesh arrives, guard sees a green **"✓ Pre-approved by Mr. Sharma until 5 PM"** badge — no notification needed, instant entry.

#### Database

```sql
-- Migration: 20260429_expected_visitors.sql

create table if not exists public.expected_visitors (
  id uuid primary key default gen_random_uuid(),
  resident_id uuid not null references public.profiles(id) on delete cascade,
  flat_number text not null,
  visitor_name text not null,
  visitor_phone text,                 -- optional, for matching
  category gate_visitor_category not null default 'visitor',
  purpose text,
  expected_from timestamptz not null,
  expected_until timestamptz not null,
  used_count integer not null default 0,
  max_entries integer default 1,      -- default: one entry per pre-approval
  is_active boolean not null default true,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create index expected_visitors_active_window_idx
  on public.expected_visitors (flat_number, expected_until)
  where is_active = true and cancelled_at is null;

alter table public.expected_visitors enable row level security;

create policy "expected_visitors_owner_all"
  on public.expected_visitors for all
  to authenticated
  using (resident_id = auth.uid());

create policy "expected_visitors_security_read"
  on public.expected_visitors for select
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('security', 'admin'))
  );
```

#### Resident UI — `/dashboard/gate/expected/new`

```
┌────────────────────────────────────┐
│  I'm Expecting a Visitor              │
│                                       │
│  Visitor Name *                       │
│  [Ramesh (Plumber)__________]       │
│                                       │
│  Phone (optional, for matching)      │
│  [_________________________]         │
│                                       │
│  Category *                           │
│  ( ) Visitor   (•) Service           │
│  ( ) Delivery  ( ) Cab               │
│                                       │
│  Expected Window *                    │
│  From: [Today 2:00 PM]               │
│  Until: [Today 5:00 PM]              │
│                                       │
│  How many times can they enter?      │
│  ( ) Once  ( ) Multiple times        │
│                                       │
│  Purpose (optional)                   │
│  [Bathroom tap repair__________]    │
│                                       │
│  [ PRE-APPROVE ]                      │
└────────────────────────────────────┘
```

#### Security UI changes

When guard searches for a flat in the visitor logging form, the system **automatically checks** for matching pre-approvals:

```
┌────────────────────────────────────┐
│  Visitor Name: [Ramesh______]        │
│  Flat: [A-204_____]                  │
│                                       │
│  ✅ MATCHED PRE-APPROVAL              │
│  ┌─────────────────────────────────┐│
│  │ Expected: Ramesh (service)        ││
│  │ Pre-approved by Mr. Sharma        ││
│  │ Window: 2:00 PM – 5:00 PM today   ││
│  │ Purpose: Bathroom tap repair      ││
│  │                                   ││
│  │ [ ALLOW ENTRY (1-tap) ]           ││
│  └─────────────────────────────────┘│
│                                       │
│  Or override and send fresh approval: │
│  [ Send for fresh approval ]         │
└────────────────────────────────────┘
```

When guard taps "Allow Entry" on a matched pre-approval:
- Creates `gate_entries` row with `status='approved'`, `decision_channel='app'`, `decided_by=resident.id`
- Increments `expected_visitors.used_count`
- If `used_count >= max_entries`, marks the pre-approval as inactive
- Sends silent push to resident: *"Ramesh entered using your pre-approval at 2:34 PM"*

#### Resident UI — manage pre-approvals

`/dashboard/gate/expected` shows active and recent pre-approvals, with **"Cancel"** button.

#### Acceptance criteria

- ✅ Resident can pre-approve a visitor in <30 seconds
- ✅ Guard sees pre-approval automatically when logging the visitor
- ✅ One-tap entry — no resident interaction needed at the gate
- ✅ Pre-approvals expire automatically after `expected_until`
- ✅ Resident can cancel an active pre-approval
- ✅ Used pre-approvals are kept in history for audit

---

### 5c.2 Feature 2 — Emergency panic button

**The problem:** Resident in distress (medical emergency, intruder, fire) needs to alert the entire security team and committee instantly. Currently no way to do this from the app.

**The solution:** Big red button on the dashboard. One tap → all on-shift guards + all admins get a **loud, ringing notification** with the flat number, resident name, and emergency type. Guards can mark "responding" to coordinate.

#### Database

```sql
-- Migration: 20260430_emergency_alerts.sql

create type emergency_alert_type as enum (
  'medical',          -- heart attack, accident, etc.
  'security',         -- intruder, theft
  'fire',             -- fire, smoke
  'safety',           -- gas leak, electrical danger
  'other'             -- anything else
);

create type emergency_alert_status as enum (
  'active',           -- just triggered
  'acknowledged',     -- guard/admin acknowledged
  'responding',       -- someone is on the way
  'resolved',         -- emergency over
  'false_alarm'       -- accidental tap
);

create table if not exists public.emergency_alerts (
  id uuid primary key default gen_random_uuid(),
  triggered_by uuid not null references public.profiles(id),
  flat_number text not null,
  alert_type emergency_alert_type not null,
  description text,                       -- optional details from resident
  status emergency_alert_status not null default 'active',

  -- Response tracking
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_notes text,

  -- Location (optional, for big societies)
  block text,
  floor text,

  created_at timestamptz not null default now()
);

create index emergency_alerts_active_idx
  on public.emergency_alerts (created_at desc)
  where status in ('active', 'acknowledged', 'responding');
```

#### Resident UI — the panic button

Big red floating button on every dashboard page (bottom-right, above the bottom nav):

```
┌────────────────────────────────────┐
│                                       │
│       [home content]                  │
│                                       │
│                          ┌──────┐    │
│                          │  🚨   │    │
│                          │ SOS  │    │
│                          └──────┘    │
│                                       │
└────────────────────────────────────┘
```

On tap → confirmation modal (prevents accidental triggers):

```
┌────────────────────────────────────┐
│  🚨 EMERGENCY ALERT                   │
│                                       │
│  This will instantly alert security   │
│  guards and the committee.            │
│                                       │
│  Type of emergency: *                 │
│  [ 🏥 Medical    ]                    │
│  [ 🚔 Security   ]                    │
│  [ 🔥 Fire       ]                    │
│  [ ⚠️  Safety     ]                    │
│  [ 📞 Other      ]                    │
│                                       │
│  Quick details (optional):            │
│  [Father is having chest pain____]   │
│                                       │
│  [ 🚨 SEND ALERT NOW ]                │
│  [ Cancel — false alarm ]             │
└────────────────────────────────────┘
```

After tap → alert page with live status:

```
┌────────────────────────────────────┐
│  🚨 ALERT SENT                        │
│                                       │
│  Alerted: 2 guards + 5 admins         │
│                                       │
│  Status: Active (0:14 ago)            │
│                                       │
│  Guard Ravi acknowledged: 0:08 ago   │
│  Guard Ravi is responding: 0:03 ago  │
│  → Coming to your flat now            │
│                                       │
│  [ Mark as resolved ]                 │
│  [ Mark as false alarm ]              │
└────────────────────────────────────┘
```

#### Security/Admin UI — receiving the alert

All on-shift guards' phones immediately ring with a **distinct emergency notification** (different sound from gate-entry pushes):

```
┌────────────────────────────────────┐
│  🚨 EMERGENCY — A-204                 │
│                                       │
│  Sharma family (Mr. Sharma)           │
│  Type: MEDICAL                        │
│  "Father is having chest pain"        │
│                                       │
│  Triggered 0:08 ago                   │
│                                       │
│  [ ACKNOWLEDGE ]                      │
│  [ I'M RESPONDING ]                   │
└────────────────────────────────────┘
```

When guard taps "I'm Responding":
- All other guards see who's responding (avoid duplicate response)
- Resident sees the responder's name in real-time
- A timer starts for committee accountability

When emergency is resolved:
- Resident or responding guard taps "Resolved"
- Resolution notes captured
- Full audit trail saved
- Admin gets a quiet summary: *"Emergency at A-204 (medical) resolved by Guard Ravi in 4 min 23 sec"*

#### Admin dashboard — emergency log

`/admin/emergencies` shows:
- Active alerts (real-time, top of page, red)
- Today's alerts (resolved, status, response time)
- This month's stats (total, by type, avg response time)
- Trends over time (helps committee identify patterns)

#### Safety guard-rails

- **Cannot panic-button-spam** — system rate-limits to max 3 alerts per resident per hour
- **False alarm flag** — if resident accidentally tapped, they can mark it false alarm (reduces wolf-cried alerts)
- **Sound override** — emergency notifications use `silent: false` AND ignore the resident's quiet hours (Feature 4)
- **Cannot mute emergency notifications** in personal preferences — they always come through

#### Acceptance criteria

- ✅ Big red SOS button visible on every resident dashboard page
- ✅ Two-tap to send (button → confirm) prevents accidental triggers
- ✅ All on-shift guards + all admins get the alert in <3 seconds
- ✅ Emergency notifications use a distinct ringtone and bypass quiet hours
- ✅ Live status visible to resident (acknowledged → responding → resolved)
- ✅ Avg response time tracked for committee accountability
- ✅ Rate-limited to 3 alerts/resident/hour to prevent spam

---

### 5c.3 Feature 3 — Visitor blacklist

**The problem:** A particular visitor (ex-employee, banned vendor, harassing person) should not be allowed in. Currently no way to flag them — guard might unknowingly let them in.

**The solution:** Admin (or resident, for their own flat) can blacklist a visitor by name + phone + vehicle plate. When guard logs a visitor matching any of these fields, a big red warning appears.

#### Database

```sql
-- Migration: 20260431_visitor_blocklist.sql

create type blocklist_scope as enum (
  'society',          -- admin-blocked: applies to all flats
  'flat'              -- resident-blocked: applies only to their flat
);

create type blocklist_severity as enum (
  'block',            -- absolutely deny entry
  'warn',             -- allow but warn the guard
  'caution'           -- soft flag, info only
);

create table if not exists public.visitor_blocklist (
  id uuid primary key default gen_random_uuid(),
  scope blocklist_scope not null,
  severity blocklist_severity not null default 'block',

  -- Match criteria — at least one must be set
  visitor_name text,                  -- exact match (case-insensitive)
  visitor_phone text,                 -- exact match
  vehicle_number text,                -- normalized

  -- For flat-scoped blocks
  flat_number text,
  added_by uuid not null references public.profiles(id),

  reason text not null,               -- mandatory — why is this person blocked?
  notes text,                         -- detailed background
  active_until timestamptz,           -- optional expiry; null = forever

  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  -- At least one match field must be non-null
  constraint blocklist_has_match check (
    visitor_name is not null or
    visitor_phone is not null or
    vehicle_number is not null
  ),

  -- If scope is 'flat', flat_number must be set
  constraint blocklist_flat_scope_check check (
    scope = 'society' or (scope = 'flat' and flat_number is not null)
  )
);

create index visitor_blocklist_active_idx on public.visitor_blocklist(is_active)
  where is_active = true;
create index visitor_blocklist_phone_idx on public.visitor_blocklist(visitor_phone)
  where is_active = true and visitor_phone is not null;
create index visitor_blocklist_vehicle_idx on public.visitor_blocklist(vehicle_number)
  where is_active = true and vehicle_number is not null;
```

#### Admin UI — `/admin/blocklist`

Standard CRUD list with add/edit/disable:

```
┌────────────────────────────────────┐
│  Visitor Blocklist                    │
│  [ + Add to blocklist ]               │
│                                       │
│  Society-wide blocks (3):             │
│  ┌─────────────────────────────────┐│
│  │ 🚫 Suresh Kumar                   ││
│  │   Phone: 9876543210               ││
│  │   Reason: Theft attempt May 2026  ││
│  │   Added by Admin Verma 2 mo ago   ││
│  │   [ Edit ] [ Disable ]            ││
│  └─────────────────────────────────┘│
│                                       │
│  Flat-specific blocks (12):           │
│  ...                                  │
└────────────────────────────────────┘
```

#### Resident UI — block at flat level

`/dashboard/gate/blocklist` lets residents add personal blocks (only applies to their flat):

```
┌────────────────────────────────────┐
│  My Flat Blocklist                    │
│  [ + Block someone ]                  │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ ⚠️ Ex-driver Ramesh               ││
│  │   Phone: 9988776655               ││
│  │   Reason: No longer employed      ││
│  │   [ Edit ] [ Remove ]             ││
│  └─────────────────────────────────┘│
└────────────────────────────────────┘
```

#### Security UI changes

When guard fills the visitor form, server checks blocklist as they type. If a match is found:

```
┌────────────────────────────────────┐
│  🚫 BLOCKED VISITOR                   │
│  ┌─────────────────────────────────┐│
│  │ This visitor is on the           ││
│  │ society-wide blocklist!           ││
│  │                                   ││
│  │ Reason: Theft attempt May 2026   ││
│  │                                   ││
│  │ ❌ DO NOT ALLOW ENTRY             ││
│  │                                   ││
│  │ If they insist, contact admin.    ││
│  └─────────────────────────────────┘│
│                                       │
│  Name: Suresh Kumar                   │
│  Phone: 9876543210                    │
│  Match: Society-wide block            │
└────────────────────────────────────┘
```

For `severity = 'warn'` (yellow):
```
│  ⚠️ FLAGGED VISITOR                   │
│  Reason: Pending society dues         │
│  Allowed but flagged.                  │
│  [ Continue ]                          │
```

For `severity = 'caution'` (info):
```
│  ℹ️ Note: This visitor was flagged    │
│  by Sharma family (A-204) — handle    │
│  with care.                            │
```

#### Acceptance criteria

- ✅ Admin can add/edit/disable society-wide blocks
- ✅ Resident can add/disable flat-specific blocks
- ✅ Guard gets immediate visual warning when logging a blocked visitor
- ✅ Blocklist matching is fuzzy (case-insensitive, phone normalized, vehicle plate normalized)
- ✅ Blocked-visitor entry attempts are logged with `gate_entries.status = 'rejected'` and reason "Matched blocklist"
- ✅ Three severity levels (block / warn / caution) for nuanced policy
- ✅ Optional expiry on blocks (e.g., "block for 6 months")

---

### 5c.4 Feature 4 — Notification preferences & quiet hours

**The problem:** Right now push notifications are all-or-nothing. Residents can't say "I want gate alerts but not maintenance reminders" or "no notifications between 10 PM and 7 AM".

**The solution:** Per-category notification preferences + quiet hours window. Emergency alerts always come through, regardless.

#### Database

```sql
-- Migration: 20260432_notification_preferences.sql

alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{
    "gate_visitor": true,
    "gate_pre_approved": true,
    "gate_adhoc_review": true,
    "booking_status": true,
    "clubhouse_status": true,
    "issue_status": true,
    "issue_comment": true,
    "events": true,
    "broadcasts": true,
    "messages": true
  }'::jsonb,
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_hours_start time default '22:00',
  add column if not exists quiet_hours_end time default '07:00';
```

#### Resident UI — `/dashboard/profile/notifications`

```
┌────────────────────────────────────┐
│  Notification Preferences             │
│                                       │
│  Gate & Visitors                      │
│  ☑ New visitor at gate                │
│  ☑ Pre-approved visitor entered       │
│  ☑ Review adhoc approvals             │
│                                       │
│  Bookings & Clubhouse                 │
│  ☑ Booking status updates             │
│  ☑ Clubhouse subscription updates     │
│                                       │
│  Issues                               │
│  ☑ Issue status updates               │
│  ☐ New comments on my issues          │
│                                       │
│  Community                            │
│  ☑ New events                         │
│  ☐ Broadcasts                         │
│  ☑ Personal messages                  │
│                                       │
│  ────────────────────────             │
│                                       │
│  🌙 Quiet Hours                        │
│  ☑ Enable quiet hours                 │
│  From: [22:00]   To: [07:00]         │
│                                       │
│  ⚠️ Emergency alerts always come      │
│  through, even during quiet hours.    │
│                                       │
│  [ Save preferences ]                 │
└────────────────────────────────────┘
```

#### Server-side enforcement

Update `src/lib/push.ts` `sendPushToUsers()` to:

1. Look up each recipient's `notification_prefs[category]`
2. If `false` → skip them (record as `skipped_pref_off`)
3. If `quiet_hours_enabled` AND current time is within window AND category is not `emergency` or `gate_visitor_urgent` → skip them
4. Continue with normal send for everyone else

```ts
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  renotify?: boolean;
  category?: NotificationCategory;     // NEW — for filtering
  bypassQuietHours?: boolean;          // NEW — true for emergencies
}
```

#### Acceptance criteria

- ✅ Resident sees a clean preferences screen with all 10 categories
- ✅ Toggling a category off prevents future pushes for it
- ✅ Quiet hours skip non-urgent notifications during the configured window
- ✅ Emergency alerts (panic button) ALWAYS come through, ignoring all preferences
- ✅ Gate visitor approvals during quiet hours: still come through (this is urgent by definition; user can disable per-category if they really want to)
- ✅ Server logs `skipped_pref_off` and `skipped_quiet_hours` so admins can see preference patterns

### 5c.5 Combined effort

| Feature | Effort |
|---|---|
| Pre-approve visitor | 1 day |
| Emergency panic button | 1 day |
| Visitor blacklist | 0.5 day |
| Notification preferences | 1.5 days |
| **Phase 2.6 total** | **3–4 days** |

### 5c.6 Combined acceptance criteria

- ✅ All four features ship as one Phase 2.6 release
- ✅ Each feature is independently togglable (admin can disable any feature without breaking others)
- ✅ All four features documented in `INSTALL_AND_NOTIFICATIONS.md` for residents
- ✅ Zero new paid services introduced

---

## 6. Phase 3 — Pre-issued QR passes

**Goal:** Resident pre-creates a pass for an expected visitor. Guard scans the QR. Visitor walks in. **No resident interaction at the gate.**

This is the **MyGate killer feature** — most society apps copy this directly.

### 6.1 Database

```sql
-- Migration: 20260426_gate_passes.sql

create type gate_pass_type as enum (
  'one_time',    -- single use, expires after use OR after `valid_until`
  'daily',       -- valid for one specific day, multiple entries allowed
  'monthly',     -- valid for a month, unlimited entries
  'recurring'    -- e.g. maid every weekday 9am-11am
);

create table if not exists public.gate_passes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,            -- short human-readable code, e.g. "AE-7K3M"
  qr_token text unique not null,        -- long random token signed into QR
  issued_by uuid not null references public.profiles(id),
  flat_number text not null,
  pass_type gate_pass_type not null,
  visitor_name text not null,
  visitor_phone text,
  visitor_photo_url text,
  category gate_visitor_category not null default 'visitor',
  vehicle_number text,
  purpose text,
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  max_entries integer,                  -- null = unlimited
  used_count integer not null default 0,
  recurring_days integer[],             -- e.g. {1,2,3,4,5} = Mon-Fri
  recurring_start_time time,
  recurring_end_time time,
  is_active boolean not null default true,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index gate_passes_code_idx on public.gate_passes(code);
create index gate_passes_qr_token_idx on public.gate_passes(qr_token);
create index gate_passes_resident_idx on public.gate_passes(issued_by, created_at desc);
create index gate_passes_active_valid_idx on public.gate_passes(is_active, valid_until)
  where is_active = true;
```

### 6.2 Resident UI — issue a pass

`src/app/dashboard/gate/passes/new/page.tsx`

You already have the **clubhouse pass** flow built — this reuses 80% of that infrastructure (`src/lib/clubhouse-pass.ts`, QR generation, etc.).

```
┌────────────────────────────────────┐
│  Create Gate Pass                     │
│                                       │
│  Pass Type:                           │
│  ( ) One-time (single visit)         │
│  ( ) Daily (one specific day)        │
│  ( ) Monthly (whole month)           │
│  ( ) Recurring (e.g. weekly maid)    │
│                                       │
│  Visitor Name *                       │
│  [_________________________]         │
│                                       │
│  Visitor Phone                        │
│  [_________________________]         │
│                                       │
│  Valid from: [date+time picker]      │
│  Valid until: [date+time picker]     │
│                                       │
│  [If recurring:]                      │
│    Days: ☑M ☑T ☑W ☑T ☑F ☐S ☐S        │
│    Time: 09:00 to 11:00              │
│                                       │
│  [ CREATE PASS ]                      │
└────────────────────────────────────┘
```

After creation, show the QR + share buttons:

```
┌────────────────────────────────────┐
│  ✅ Pass Created                       │
│                                       │
│      ┌─────────────┐                │
│      │ ████ ████ ████ │                │
│      │ ████ ████ ████ │                │
│      │ ████ ████ ████ │                │
│      └─────────────┘                │
│                                       │
│      Code: AE-7K3M                    │
│                                       │
│  Valid: Oct 25, 2026 9 AM-11 AM       │
│                                       │
│  [ 📱 Share on WhatsApp ]              │
│  [ 📋 Copy code ]                      │
│  [ 📥 Download QR ]                    │
└────────────────────────────────────┘
```

The "Share on WhatsApp" button uses `wa.me` URL with a pre-filled message — this **opens the resident's own WhatsApp** to send the pass to the visitor. **No cost to us** since we're not sending via API; it's just a deep-link the resident sends from their personal account.

### 6.3 Security UI — scan a pass

`src/app/security/scan/page.tsx`

Uses the device camera (`getUserMedia` + a barcode/QR library like `@zxing/browser` — **free open-source**).

```
┌────────────────────────────────────┐
│  Scan Gate Pass                       │
│                                       │
│  [camera viewfinder with QR overlay] │
│                                       │
│  Or enter code manually:              │
│  [_________]  [LOOKUP]               │
└────────────────────────────────────┘
```

On scan/lookup:
```
┌────────────────────────────────────┐
│  ✅ VALID PASS                         │
│                                       │
│  Visitor:  Rajesh Kumar               │
│  For flat: A-204 (Sharma family)     │
│  Valid:    Until 11 AM today          │
│  Entries:  1 of unlimited             │
│                                       │
│  [ ALLOW ENTRY ]   [ DENY ]           │
└────────────────────────────────────┘
```

When guard taps "Allow Entry":
- Increments `used_count`
- Creates a `gate_entries` row with `pass_id` set, `status='approved'`, `decision_channel='app'`
- Sends a **silent confirmation push** to the resident: *"Rajesh Kumar entered using your pass at 9:32 AM"* — silent because no action needed

### 6.4 Backend endpoints

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /api/gate/passes` | Resident | Create new pass |
| `GET /api/gate/passes/mine` | Resident | List my passes |
| `POST /api/gate/passes/[id]/revoke` | Resident | Revoke a pass before expiry |
| `GET /api/gate/passes/validate/[token]` | Security | Validate a scanned QR |
| `POST /api/gate/passes/[id]/use` | Security | Record an entry against this pass |

### 6.5 Acceptance criteria

- ✅ Resident creates a one-time pass in <60s
- ✅ Pass QR can be shared via WhatsApp using `wa.me` deep-link (free)
- ✅ Guard scans QR with phone camera using free library
- ✅ Validation runs offline-fallback (cached for 5 min) for poor-internet gate locations
- ✅ Used count increments correctly; max-entries enforced
- ✅ Recurring passes auto-validate on the right days/times only
- ✅ Resident gets silent entry-confirmation notification

---

## 7. Phase 4 — Frequent visitors / staff

**Goal:** Maids, milkmen, cooks, drivers don't need a fresh approval every day. Resident registers them once → they get a permanent pass with a photo → guard recognizes them.

### 7.1 Database

```sql
-- Migration: 20260427_frequent_visitors.sql

create type frequent_visitor_role as enum (
  'maid', 'cook', 'driver', 'milkman', 'newspaper',
  'gardener', 'tutor', 'nanny', 'caretaker', 'other'
);

create table if not exists public.frequent_visitors (
  id uuid primary key default gen_random_uuid(),
  flat_number text not null,
  resident_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  phone text,
  photo_url text,
  role frequent_visitor_role not null,
  vehicle_number text,
  -- Auto-approval window: e.g. maid comes 9-11 AM weekdays
  allowed_days integer[],
  allowed_start_time time,
  allowed_end_time time,
  pass_code text unique,    -- short code, can be printed on a card
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
```

### 7.2 Resident UI — manage frequent visitors

`src/app/dashboard/gate/frequent/page.tsx`

```
┌────────────────────────────────────┐
│  My Frequent Visitors                 │
│                                       │
│  [+ ADD NEW]                          │
│                                       │
│  ┌─────────────────────────────────┐│
│  │ 👤 Lakshmi (maid)                 ││
│  │    9-11 AM, Mon–Sat                ││
│  │    Code: AE-MAID-7K              ││
│  │    [Share] [Edit] [Disable]       ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ 👤 Ramesh (driver)                ││
│  │    7 AM-7 PM, Daily               ││
│  │    Code: AE-DRIV-3M              ││
│  └─────────────────────────────────┘│
└────────────────────────────────────┘
```

### 7.3 Security UI — gate-side recognition

When the maid/cook/driver arrives, two flows:

**Flow A:** They show a printed pass card with their code.
- Guard enters code → instant validation.

**Flow B:** Guard searches by name or photo.
- `/security/staff/search` page shows photos of all registered staff.
- Tap one → "Allow entry of Lakshmi (maid for A-204)?"
- One tap → entry recorded, **silent notification to resident** (info only, no approval needed).

Outside the configured time window, the system falls back to the standard visitor approval flow — guard logs them as a visitor, resident gets the ringing notification.

### 7.4 Acceptance criteria

- ✅ Resident can add/remove/edit frequent visitors
- ✅ Frequent visitors get a permanent code or photo-based recognition
- ✅ Auto-approval within the configured time window — no resident interruption
- ✅ Outside the window, behaves like a normal visitor (needs approval)
- ✅ Resident gets a daily summary at end-of-day: "Today's staff: Lakshmi 9:15-10:45, Ramesh 7-19h"

---

## 8. Phase 5 — Reports, analytics, polish

**Goal:** Reports for admin, analytics for the committee, and the polish that makes the app feel professional.

### 8.1 Admin dashboard additions

New page: `src/app/admin/gate/page.tsx`

- **Today's stats:** total entries, approved, rejected, expired, by category
- **This week graph:** entries per day
- **Busiest hours heatmap**
- **Top visitor categories pie chart**
- **Guard activity:** entries logged per guard, average response time
- **Adhoc approval rate:** what % of entries needed an adhoc decision (high % = residents not responding to push, may need PWA install reminder)
- **Adhoc approval review:** list of all adhoc approvals with notes — admin can audit and flag concerning ones
- **Phone-view audit:** recent guard accesses to resident phone numbers

### 8.2 Reports & exports

- Monthly entry log CSV export
- Per-flat visitor history (for residents and admins)
- Audit trail integration with your existing admin audit log
- Adhoc approval audit trail with notes

### 8.3 Resident-side controls

Add to `/dashboard/profile`:

- **My visitor history** — see all entries to my flat
- **Flagged adhoc approvals** — entries I disputed
- **Notification settings** — sound on/off, vibration intensity
- **Trusted guards** (optional) — auto-trust certain guards' adhoc decisions without notification

### 8.4 Other polish

- **Visitor blacklist** — admin can blacklist a visitor name/phone; guard sees a warning
- **Vehicle tracking** — entry/exit times per vehicle for parking management
- **Society-wide alerts** — broadcast to all guards ("All visitors must wear masks until further notice")
- **Photo capture mandatory toggle** — admin setting to enforce visitor photos
- **Offline mode for guards** — pass validation works for 5 min without internet (cached)
- **Multi-language** — Hindi labels on the security portal (most guards in Indian societies are Hindi-first)

---

## 9. Comparison with commercial apps

| Feature | MyGate | NoBrokerHood | ApnaComplex | **Aaditri Emerland (after roadmap)** |
|---|---|---|---|---|
| Visitor approval (push) | ✅ | ✅ | ✅ | ✅ |
| Ringing notification | ✅ | ✅ | ✅ | ✅ (`requireInteraction`+vibrate+audio loop) |
| QR pre-pass | ✅ | ✅ | ✅ | ✅ |
| Frequent staff | ✅ | ✅ | ✅ | ✅ |
| Adhoc approval by guard | ✅ | ✅ | ✅ | ✅ (with mandatory note + resident notify) |
| In-app intercom call | ✅ | Limited | Limited | ❌ — **guard uses real intercom (free)** |
| Delivery tracking | ✅ | ✅ | ✅ | ✅ |
| Cab tracking | ✅ | ❌ | ❌ | ✅ |
| Vehicle entry/exit log | ✅ | ✅ | ✅ | ✅ |
| Auto-exit when guard forgets | ✅ (basic) | ✅ (basic) | ✅ (EOD only) | ✅ **(5-layer defense)** |
| Resident self-service exit | ❌ | Limited | ❌ | ✅ |
| Shift-handover checklist | ❌ | ❌ | ❌ | ✅ |
| Admin "stuck entries" alert | ❌ | ❌ | ❌ | ✅ |
| Pre-approve visitor (without QR) | ✅ | ✅ | Limited | ✅ |
| Emergency panic button | ✅ | ✅ | Limited | ✅ |
| Visitor blacklist (society + flat) | ✅ (society only) | Limited | ❌ | ✅ **(both levels)** |
| Notification preferences + quiet hours | Limited | ❌ | ❌ | ✅ |
| Daily/Monthly passes | ✅ | ✅ | ✅ | ✅ |
| Multi-owner per flat | ✅ | ✅ | ✅ | ✅ (already supported) |
| Helpdesk / issues | ✅ | ✅ | ✅ | ✅ (already built) |
| Bookings (clubhouse, etc.) | ✅ | ✅ | ✅ | ✅ (already built) |
| Community feed | ✅ | ✅ | ✅ | ✅ (already built) |
| **Cost** | **₹1,000–3,000/flat/year** | **₹500–2,000/flat/year** | **₹500/flat/year** | **₹0** |
| **Data ownership** | Their servers | Their servers | Their servers | **Your Supabase, your control** |
| **Customization** | None | None | Limited | **100% — it's your code** |

---

## 10. Estimated costs

### Development cost
If you're building this yourself: **₹0** beyond your time.
If you hire a contractor at ₹2,000/day: **₹40,000–60,000** for the full 5 phases.

### Operating cost (ongoing, for 200 flats)

| Item | Monthly cost |
|---|---|
| Supabase (current usage + gate features) | **₹0** (free tier, 500MB DB) — possibly $25 if you exceed |
| Vercel hosting | **₹0** (free tier) — possibly $20 if you exceed |
| Photo storage (Supabase Storage) | **₹0** under 1GB; compress photos to <100KB each → ~3 months of entries fit free |
| Push notifications (web-push, VAPID) | **₹0 forever** |
| QR scanner (@zxing/browser) | **₹0** (open source) |
| WhatsApp messages | **NOT USED** |
| SMS messages | **NOT USED** |
| Voice calls | **NOT USED** |
| **Total estimated** | **₹0/month** |

Per-flat cost: **₹0/flat/month** vs commercial apps at **₹50–200/flat/month**.

The only cost in the entire system is **the human time** of:
- The security guard making intercom/mobile calls when push fails (5 min/day max for a 200-flat society)
- One developer building it (one-time)

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **iOS users don't get loud ringing notifications** | Adhoc flow — guard calls on intercom/mobile |
| **iOS users don't install the PWA** | Adhoc flow — guard treats them as if they have no app |
| **Resident phone is on silent / DND** | Adhoc flow — guard calls on intercom (always works) |
| **Guard skips calling and just adhoc-approves everyone** | Mandatory note (min 10 chars); resident gets notified of every adhoc decision and can flag; admin sees adhoc-rate per guard in dashboard |
| **Guards' phones lose internet** | Offline pass validation cache (5 min) + paper backup register |
| **Older residents can't use the app** | They never installed it — they'll always be on the adhoc/intercom flow, which is exactly what they're used to today |
| **Photo storage gets expensive** | Compress photos client-side to <100KB before upload; auto-delete after 30–60 days |
| **Guards leave / get fired** | Admin "Disable Guard" instantly revokes login; audit log shows last activity |
| **Fake QR codes** | QR contains signed token (HMAC); server validates signature — cannot be forged |
| **Resident phone dies, can't approve** | Family co-owners (already supported) get the same notification; first to respond wins. If all phones dead, adhoc flow kicks in |
| **Guard abuses phone-view permission** | Every view logged with timestamp + reason; admin reviews monthly |
| **Resident disputes an adhoc approval** | "Flag" button on adhoc notification → admin alerted → conversation in audit |
| **Guard forgets to mark visitor as exited** | 5-layer defense (Phase 2.5): smart auto-exit per category, EOD cleanup, resident self-service, shift-handover checklist, admin stuck-entries alert |
| **Visitor never actually leaves but auto-exit marked them out** | Resident gets push when auto-exit happens; can tap "still inside" to revert; admin sees stuck-entries dashboard for >12h cases |
| **Multi-day visitors (overnight relatives) get auto-exited** | Resident can extend `expected_exit_at` from dashboard; admin can mark entry as "extended stay" exempt from auto-cleanup |

---

## 12. Suggested rollout schedule

Assumes a single developer working ~2 hours/day evenings + weekends:

| Week | Phase | Deliverable |
|---|---|---|
| Week 1 | Phase 1 | Security role + admin can create guards |
| Week 2–3 | Phase 2 | Visitor logging + ringing approval + adhoc approval (pilot with 1 guard, 5 residents) |
| Week 3 | — | **Pilot run** — fix bugs, observe "forgot to mark exit" rate, gather feedback |
| Week 4 (early) | Phase 2.5 | Exit tracking & cleanup (auto-exit, handover checklist, stuck-entries alert) |
| Week 4 (mid) | Phase 2.6 | Safety & UX essentials (pre-approve, panic button, blacklist, notification prefs) |
| Week 5 (early) | Phase 3 | Pre-issued QR passes |
| Week 5 (late) | Phase 4 | Frequent visitors / staff |
| Week 6 | Phase 5 | Reports, polish, multi-language Hindi UI |
| Week 6–7 | — | **Full society rollout** |
| Week 8+ | — | Move on to Phase 6 features (see `PRODUCT_BACKLOG.md`) based on resident feedback |

---

## 13. Out of scope for v1 (gate management roadmap)

These are deferred to **Phase 6+** (committee features) or **Phase 7+** (premium features). See `PRODUCT_BACKLOG.md` for the full backlog with priorities and effort estimates.

**Deferred to Phase 6 (committee features, ~13 days):**
- Multi-flat residents (rentals, second homes)
- Multiple gates / entry points
- Move-in / move-out workflow
- Society circulars with PDF + acknowledgment
- Society documents library (bye-laws, AGM minutes, etc.)
- Polls & voting (AGM, committee elections)
- Family member separate logins
- Tenant / Owner permission split
- Admin role granularity (President / Treasurer / Secretary / etc.)
- GDPR-style data export and account deletion

**Deferred to Phase 7 (premium / power features, ~26 days):**
- Maintenance bills & payments (Razorpay/UPI integration — **paid**)
- Vehicle registry & parking management
- Domestic staff KYC (Aadhaar + photo + police verification)
- Group / society visits (large gatherings / weddings)
- Vetted service marketplace
- Helpdesk SLA / vendor assignment
- Daily attendance for staff (QR scan in/out)
- Two-way messaging (resident ↔ admin chat)
- Incident / complaint log (separate from issues)

**Permanently out of scope (Tier D):**
- In-app voice/video intercom — use the real intercom phone, it's already there and it's free
- WhatsApp / SMS / voice fallback — explicitly excluded to keep cost at ₹0
- Face recognition at the gate — requires hardware + ML models
- License plate OCR — possible but adds complexity
- Smart lock integration
- Carbon footprint dashboards — needs IoT integration
- Multi-society support — only relevant if you sell this to other societies
- Children/elderly NFC pendant tracking — niche, hardware-dependent

---

## 14. Decision points before starting

Before we scaffold Phase 1, here are a few questions worth deciding:

1. ~~**Voice call provider**~~ — Not needed (using intercom/mobile calls by guard).
2. **Photo storage** — Supabase Storage (you already use this, free under 1GB) ← **recommended**, or skip photos entirely.
3. **QR scanner library** — `@zxing/browser` (lightweight, free, open source) ← **recommended**.
4. **Hardware for guards** — Do guards have their own smartphones, or does the society provide a tablet at the gate? Affects UI sizing.
5. **Hindi UI** — Build it in Phase 5 or from the start? **Recommend Phase 5** to keep early phases fast.
6. **Real-time updates for guards** — Use Supabase Realtime (free, built-in) ← **recommended**, or polling every 2s.
7. **Existing clubhouse pass code reuse** — Should the gate pass system extend `clubhouse_passes` infrastructure, or be a separate `gate_passes` table? **Recommend separate table** for cleaner audit/RLS, but reuse the QR generation code.
8. **Adhoc approval reason length** — Minimum 10 characters (recommended) or higher? Higher = more friction = more honest notes, but slower for guards.
9. **Resident dispute flow** — When resident flags an adhoc approval as wrong, what happens? Recommend: notify admin, mark entry, keep the visitor entry valid (already happened) but log the dispute for human review.
10. **Photo retention** — Auto-delete entry photos after how many days? **30 days** is enough for typical disputes, keeps storage costs at zero.
11. **Auto-exit category timeouts** — Use the defaults (delivery 30m, cab 15m, service 4h, visitor 8h, etc.) or society-specific values? Defaults are admin-tunable post-launch, no rush to decide.
12. **Stuck-entry threshold** — Admin gets alerted at 12 hours by default. Adjust to 6h (more sensitive) or 24h (more relaxed)?
13. **End-of-day cleanup time** — Default is 11:55 PM. Some societies prefer 6 AM (lets night visitors stay overnight without being marked as "auto exited"). Recommend keeping 11:55 PM for the gate-log cleanliness.

---

## 15. Next step

Let me know which of these you'd like to do first:

- **(A)** Start building **Phase 1** right now (security role + admin management) — ~3-4 days work
- **(B)** Refine this roadmap further — adjust scope, add features, change priorities
- **(C)** Build a small **proof of concept** first (just visitor logging + push + adhoc approval, no escalation cron, no passes) to validate the UX with 1–2 residents before committing to the full plan — ~1 week
- **(D)** Get cost/time estimates from a contractor for the full plan
- **(E)** Document Phase 1 in even more detail (DB migration file, exact API contracts, wireframes) before starting

---

*Last updated: April 2026.*
*Author: development team.*
*Status: Draft, awaiting committee approval and developer assignment.*
*Cost commitment: 100% FREE — no paid notification channels.*
