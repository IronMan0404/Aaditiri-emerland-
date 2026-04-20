# Product Backlog — Aaditri Emerland Community App

**Purpose:** A prioritized backlog of all features under consideration, sorted by tier (priority + value). This is a living document that the society committee can use to prioritize what to build after the v1 gate management roadmap completes.

**Status:** Living document — last updated April 2026.

**Companion document:** [`ROADMAP_GATE_MANAGEMENT.md`](./ROADMAP_GATE_MANAGEMENT.md) covers the active v1 build (Phases 1 → 5).

---

## How to read this backlog

Features are organized into 4 tiers:

| Tier | Meaning | When |
|---|---|---|
| 🔴 **Tier A** | Critical — must-have for v1 | **Already in v1 roadmap (Phase 2.6)** |
| 🟡 **Tier B** | High value — should-have | **Phase 6** (committee features) |
| 🟠 **Tier C** | Power features — nice-to-have | **Phase 7+** (after 3 months of v1 usage) |
| 🔵 **Tier D** | Long-term wishlist | Maybe never — needs strong evidence of demand |

Effort estimates assume **a single developer working full-time**.

Cost estimates are in INR per month at 200-flat scale.

---

## At-a-glance summary

| Tier | # Features | Total Effort | Operating Cost |
|---|---|---|---|
| 🔴 A — Critical | 4 | 3–4 days | ₹0/mo |
| 🟡 B — Phase 6 | 11 | ~13 days | ₹0/mo |
| 🟠 C — Phase 7 | 10 | ~30 days | **₹0/mo** |
| 🔵 D — Long-term | 8 | varies | varies |
| **Total backlog** | **33 features** | **~50 days** | **₹0/mo** |

**Note:** With C1 changed to track-only and the new C1b community funds spec added, the entire backlog can be built **without introducing any paid services**. Operating cost stays at ₹0/month forever.

**🆕 Recent additions:**
- **C1** now uses no-payment-gateway design (saves ₹20K/month, full spec at [`FINANCE_TRACKING_SPEC.md`](./FINANCE_TRACKING_SPEC.md))
- **C1b** new — community internal funds with public balance sheet (full spec at [`COMMUNITY_FUNDS_SPEC.md`](./COMMUNITY_FUNDS_SPEC.md))

---

## 🔴 Tier A — Critical (in v1 roadmap as Phase 2.6)

These are already integrated into the v1 roadmap. See [`ROADMAP_GATE_MANAGEMENT.md`](./ROADMAP_GATE_MANAGEMENT.md) Section 5c for full specs.

| # | Feature | Effort | Status |
|---|---|---|---|
| A1 | Pre-approve a visitor in advance (without QR) | 1 day | In Phase 2.6 |
| A2 | Emergency / panic button (one-tap SOS) | 1 day | In Phase 2.6 |
| A3 | Visitor blacklist (society + flat scope) | 0.5 day | In Phase 2.6 |
| A4 | Notification preferences + quiet hours | 1.5 days | In Phase 2.6 |

---

## 🟡 Tier B — Phase 6 (committee features, ~13 days)

These are the features the **committee will love** and unlock formal society management. Build after v1 is stable in production for 1–2 months.

### B1. Multi-flat residents (rentals, second homes)

**The problem:** Some owners have multiple flats (rented out, second home, parking-only ownership). Currently a profile has one `flat_number`.

**The solution:** Many-to-many `flat_residents` table. A profile can be associated with multiple flats with different roles per flat (owner / tenant / parking-only / family).

**Effort:** 2 days
**Affects:** Auth, gate routing, billing, community directory
**Risk:** Medium — touches authentication. Carefully migrate existing data.

---

### B2. Multiple gates / entry points

**The problem:** Most societies have 2–4 gates (main, service, basement parking). Each guard works at ONE gate.

**The solution:** New `gates` table. Assign guards to a gate. Show gate-specific entry log. Visitor entry shows which gate they used.

**Effort:** 1 day
**Affects:** Phase 2 + 3 + 4 (every gate flow)
**Risk:** Low

---

### B3. Move-in / move-out workflow

**The problem:** When a tenant moves in/out, lots of helpers carry furniture in/out. Multiple visitors. Security needs a one-time "moving permit". Often legally required.

**The solution:** New `move_permits` table. Resident requests permit (date, expected helpers, vehicle). Admin approves. Guard sees a banner during the permit window: *"Moving in progress at A-204 — allow up to 8 helpers"*.

**Effort:** 2 days
**Risk:** Low

---

### B4. Society circulars (formal documents)

**The problem:** You have informal `announcements` and `broadcasts`, but real societies have **formal circulars** with PDF, document number, signed by secretary/treasurer, with acknowledgment requirement.

**The solution:** New `circulars` table with PDF storage + acknowledgment tracking. "I have read this" button → tracked per resident → admin sees who has/hasn't acknowledged.

**Effort:** 2 days
**Risk:** Low
**Dependency:** Supabase Storage (free under 1GB)

---

### B5. Society documents library

**The problem:** Bye-laws, AGM minutes, audit reports, vendor contracts, society registration certificate — residents need access. Currently no place for this.

**The solution:** New `documents` table + Supabase Storage folder. Categorized (legal / financial / minutes / contracts). Admin uploads, residents download.

**Effort:** 1 day
**Risk:** Low

---

### B6. Polls & voting

**The problem:** AGM decisions, committee elections, "should we change the gardener?" require vote-counting. Currently done on WhatsApp (chaotic) or paper (slow).

**The solution:** New `polls` and `votes` tables. Admin creates a poll with options. Residents vote (one vote per flat, or one per resident). Anonymous OR named. Results visible to admin always; to residents after close.

**Effort:** 2 days
**Risk:** Low

---

### B7. Family member separate logins

**The problem:** Currently only the primary owner has a login. Spouse, adult children, parents living together cannot get gate notifications.

**The solution:** Convert `family_members` rows into real user accounts (with consent). They share the flat, get gate notifications independently. First-to-respond wins.

**Effort:** 2 days
**Risk:** Medium — touches auth + RLS policies

---

### B8. Tenant / Owner permission split

**The problem:** Tenants currently have identical permissions to owners. They can edit ownership data, change parking allocation — they shouldn't.

**The solution:** Add fine-grained permission flags. Tenants: approve own visitors, book own facilities. Owners: edit flat-level data, manage tenants. Admin: everything.

**Effort:** 1 day
**Risk:** Low

---

### B9. Admin role granularity

**The problem:** Currently every admin has FULL access. Real societies want:
- **President** — everything
- **Treasurer** — only finance + bills
- **Secretary** — only announcements + circulars
- **Committee member** — read-only admin access
- **Maintenance admin** — only issues + bookings
- **Security supervisor** — only gate + security personnel

**The solution:** Add `admin_permissions` JSONB per admin. Restrict UI and API endpoints based on permissions.

**Effort:** 2 days
**Risk:** Medium — requires careful RLS audit

---

### B10. Data export for residents (GDPR-style)

**The problem:** Resident leaves the society — should be able to download their visitor history, bookings, messages, profile. Legal best practice.

**The solution:** "Download My Data" button on profile. Server generates a ZIP with JSON exports of all resident-owned data. Email link valid 24 hours.

**Effort:** 1 day
**Risk:** Low

---

### B11. Right to be forgotten / account deletion

**The problem:** Resident moves out → can request full deletion of their data (with audit retention exception for compliance).

**The solution:** "Delete Account" flow with admin approval (can't be self-service due to financial dues, etc.). Soft-delete keeps audit trail; hard-delete after 90 days.

**Effort:** 1 day
**Risk:** Medium — must coordinate with audit log retention

---

## 🟠 Tier C — Phase 7 (power features, ~26 days)

These are major features that should only be built **after** v1 has been live for 3 months and you have data on what residents actually use.

### C1. Finance tracking — bills, payments, expenses ⭐ (BIGGEST OPPORTUNITY)

**The problem:** This is the **#1 reason people use society apps**. No way to bill, collect, or report on finances right now.

**The solution:** Track-only finance system (no payment gateway). Residents pay via their own UPI/bank transfer to the society account; the app records and tracks everything. Includes:
- Admin issues monthly bills per flat (CSV import or per-flat amount, with itemized breakdown)
- Resident sees dues, pays via own UPI/PhonePe/GPay, reports payment with UTR + screenshot
- Treasurer verifies payments (bulk-verify from bank statement)
- Bank statement CSV import + auto-reconciliation
- Defaulter list with reminder pushes
- Expense tracking (electricity, security, garden, etc.) with vendor management
- Receipts (PDF) for verified payments
- Monthly P&L reports + AGM annual report
- Per-flat ledger (useful for property sales)
- Late fee auto-calculation

**📄 Full spec:** [`FINANCE_TRACKING_SPEC.md`](./FINANCE_TRACKING_SPEC.md) — 13 sections, complete database schema with 11 tables, all UI wireframes, 24 API endpoints, decision points.

**Effort:** **6–8 days** (track-only). Largest feature in backlog but ~25% smaller than the gateway version.
**Cost:** **₹0/month forever.** No Razorpay, no PayU, no transaction fees.
**Risk:** Medium — financial accuracy critical, but no payment gateway complexity
**Dependency:** None (uses existing Supabase Storage for invoices/screenshots)

**Why "track-only" is better than payment gateway for Indian societies:**
- Saves ~₹20K/month in transaction fees (₹2.4L/year for 200-flat society at ₹10L/mo collection)
- Residents already pay daily via UPI — no new behavior to learn
- No KYC delays, no GST complications, no chargeback risk
- Bank statement is source of truth — no app/bank discrepancies
- Easy to upgrade to payment gateway later if needed (schema supports it)

---

### C1b. Community internal funds — public balance sheet ⭐ ✅ SHIPPED v1

**The problem:** Beyond formal monthly bills, communities collect informal money for many things — water softener AMC, Diwali decorations, common chairs, RO maintenance, Holi colors, picnics, ganpati, sports trophies. Today this is tracked in WhatsApp screenshots + Excel + Mr. Verma's notebook, and **every AGM ends with "where did this money go?" arguments**.

**The solution:** A public, transparent balance-sheet system separate from formal bills. Admin creates "Funds" (named pots like "Diwali 2026", "Softener AMC 2026"), records contributions IN and spends OUT. **Every resident** sees the full ledger live — overall balance, by category, by fund, by flat. Includes:
- Per-fund: target, progress %, contributors list, spends list, current balance
- Flat-wise contribution grid (who paid / who didn't, color-coded)
- Per-flat history (everything Flat A-204 has contributed across all funds)
- Overall community balance sheet with category-wise charts
- Cash + UPI + cheque + in-kind contribution support
- Quick-add for cash collections (committee member walks door-to-door, marks live)
- Reimbursement workflow (committee paid out of pocket → marked for reimbursement)
- Anonymous contribution toggle (privacy for big donors)
- Public discussion threads per fund (kills "where did money go" disputes forever)
- Surplus handling on close (refund pro-rata / roll to general pool / next year)
- Recurring fund auto-rollover (Diwali 2026 → one-click create Diwali 2027)
- AGM-ready PDF balance sheet with charts
- Photo gallery per fund (event proof)

**📄 Full spec:** [`COMMUNITY_FUNDS_SPEC.md`](./COMMUNITY_FUNDS_SPEC.md) — 14 sections, 7-table schema, all UI wireframes, 25 API endpoints, 16 unique recommendations, decision points.

**Why it's separate from C1:** C1 = mandatory monthly bills (society legal entity). C1b = informal voluntary collections (community goodwill). Different visibility (private vs public ledger), different cadence (monthly vs ad-hoc), different authority (committee vs anyone), different examples (maintenance vs Diwali sweets).

**Effort:** **~5 days**
**Cost:** **₹0/month forever**
**Risk:** Low — pure ledger system, no payment processing, no compliance complexity
**Dependency:** None
**Recommended sequence:** Build alongside or right after C1 — they share UPI-receiver UI, payment-report flow, and verification UX (~30% code reuse)

**Why this is a winning feature:** Trust above all. Public ledger = ends every "where did the money go" complaint forever. Replaces WhatsApp + Excel chaos with a single source of truth. Inclusive (cash + UPI + in-kind). AGM-ready in one click.

**v1 shipped (Apr 2026):** Migration `20260424_community_funds.sql`, full resident UI (`/dashboard/funds`), full admin UI (`/admin/funds` + verify queue), all APIs (`/api/funds/*` and `/api/admin/funds/*`), push notifications wired. Deferred to v2: attachments gallery, comment moderation UI, recurring auto-rollover cron, CSV export. See "Implementation status" in `COMMUNITY_FUNDS_SPEC.md`.

---

### C2. Vehicle registry & parking management

**The problem:** Vehicles tracked in `vehicles` table but no parking allocation, no visitor parking, no parking sticker issuance.

**The solution:**
- Allocate parking spots per flat (e.g., "Flat A-204 has spots P-12 and P-13")
- Visitor parking allocation at gate (guard assigns spot V-1 to V-12)
- Parking sticker issuance with QR
- Wrongly parked vehicle reporting
- Monthly parking report for admin

**Effort:** 3 days
**Risk:** Medium

---

### C3. Domestic staff verification (KYC)

**The problem:** When resident registers a maid/cook/driver, no identity verification. Safety risk.

**The solution:** Capture (with consent + privacy):
- Aadhaar last 4 digits only
- Photo (front + ID)
- Police verification status (yes/no, date)
- References from other flats in society ("Lakshmi works for A-204 since 2024")
- "Verified" badge visible to all residents who employ them

**Effort:** 2 days
**Risk:** Medium — privacy compliance critical (don't store full Aadhaar)

---

### C4. Group / society visits (large gatherings)

**The problem:** For functions, weddings: resident expects 30+ guests. Currently each one needs individual approval = chaos.

**The solution:** New `group_visits` table. Resident submits a list of expected guests (name + phone + vehicle). Single approval. Guard sees a single-screen list, ticks them off as they arrive. No 30 individual pings.

**Effort:** 1.5 days
**Risk:** Low

---

### C5. Vetted service marketplace

**The problem:** Residents call random plumbers/electricians from Justdial — often dodgy. Want a curated list.

**The solution:** Admin maintains list of vetted vendors (plumber, electrician, AC tech, carpenter, etc.). Each vendor has rating, contact, last-used by [Sharma family]. Residents can rate after use.

**Effort:** 3 days
**Risk:** Low (no payment integration in v1 — direct-to-vendor)

---

### C6. Helpdesk SLA / vendor assignment

**The problem:** `issues` page tracks issues, but for big societies you want auto-assignment + SLA timers + escalation.

**The solution:**
- Auto-assign to plumber/electrician/security based on category
- SLA timers (must respond in 4h, resolve in 24h)
- Escalation to committee if SLA breached
- Vendor performance scores

**Effort:** 3 days
**Risk:** Medium — workflow engine complexity

---

### C7. Daily attendance for staff

**The problem:** Maids/cooks/drivers — residents want to track attendance for billing or payroll.

**The solution:** When frequent visitor enters/exits, log attendance. Resident sees monthly attendance grid (✓/✗ per day). Optional: late-arrival flag if entered after configured time.

**Effort:** 2 days
**Risk:** Low

---

### C8. Two-way messaging (resident ↔ admin chat)

**The problem:** Currently bot messages are one-way (admin → resident). Residents want to ask committee questions.

**The solution:** Threaded chat between resident and admin. Optional "my issue is..." prefilled categories. Admin can mark threads as resolved.

**Effort:** 3 days
**Risk:** Medium — needs realtime updates

---

### C9. Incident / complaint log (separate from issues)

**The problem:** Serious incidents (theft, harassment, accident) need a different workflow than maintenance issues — confidential, committee-only access, formal investigation.

**The solution:** New `incidents` table with restricted RLS (only committee + reporter sees). Status workflow: reported → investigating → resolved → closed. Optional anonymous mode.

**Effort:** 2 days
**Risk:** High — privacy + legal sensitivity

---

## 🔵 Tier D — Long-term wishlist

These will probably never be built unless there's strong, repeated demand from residents.

### D1. EV charging slot booking

EV chargers — residents book charging time slots like clubhouse facilities.
**Effort:** 1 day. Reuses booking system.

### D2. Society e-vehicle pool / golf cart booking

Larger gated communities have shared shuttles or buggies — residents book rides.
**Effort:** 2 days

### D3. Children/elderly tracking with NFC pendant

Kids and elderly wear NFC/QR pendant. Guard scans → confirms identity → notifies parent. Premium feature.
**Effort:** 3 days + hardware procurement
**Why deferred:** Niche, hardware-dependent

### D4. Society e-magazine / newsletter

Monthly digital magazine — resident contributions, community news, photo essays.
**Effort:** 2 days
**Why deferred:** Community will use Instagram/WhatsApp instead — overengineered

### D5. Birthday / anniversary wishes

Auto-generated daily list "Today is Mrs. Sharma's birthday". Privacy opt-in.
**Effort:** 0.5 day
**Why deferred:** Privacy concerns; could be off-putting

### D6. Pet directory & lost pet alerts

Already track pets in profiles. Build community pet directory + lost pet broadcast.
**Effort:** 1 day
**Why deferred:** Low-frequency need; broadcast feature already covers urgent lost-pet alerts

### D7. Carbon footprint / sustainability dashboard

Power consumption per flat, water usage, recycling rate. Needs IoT integration.
**Effort:** Out of scope without hardware.
**Why deferred:** Requires utility-meter integrations; IoT hardware costs

### D8. Multi-society / multi-tower support

For developers running multiple societies under one admin.
**Effort:** 5 days. Major architectural change.
**Why deferred:** Only relevant if you decide to sell this app to other societies later

---

## 📊 Decision framework for the committee

When deciding what to build next from this backlog, use these criteria:

### Build it next if:
- ✅ More than 30% of residents have asked for it
- ✅ Effort is < 3 days
- ✅ No new paid services required
- ✅ Improves safety or saves admin time

### Defer if:
- ⚠️ Effort is > 5 days AND requested by < 10 residents
- ⚠️ Requires paid service > ₹500/mo
- ⚠️ Adds ongoing operational burden (e.g., daily moderation)

### Skip permanently if:
- ❌ Requires hardware purchases
- ❌ Duplicates a free service residents already use (Instagram, WhatsApp)
- ❌ Creates legal/privacy liability without clear benefit

---

## 🎯 Recommended sequence after v1

If we follow the standard "ship → measure → decide" cycle:

```
Month 0–2:  Build v1 (Phases 1–5 of gate roadmap)
            Roll out to society
            Collect 4 weeks of usage data

Month 3:    Committee reviews backlog
            Picks 3–5 Tier B features based on actual demand
            Priority candidates: B4 (circulars), B5 (documents), B6 (polls), B9 (admin granularity)

Month 4–5:  Build & ship Phase 6
            Continue collecting feedback

Month 6:    Big decision point — build C1 (maintenance bills)?
            If yes: 2-month focused effort with Razorpay integration
            If no: continue with smaller Tier C features

Month 7+:   Iterate based on resident feedback
            Aim for monthly small releases rather than big-bang
```

---

## 💡 Single strongest recommendations

If the committee can only pick **3 features** for Phase 6, these give the biggest ROI:

1. **B6 — Polls & voting** (2 days)
   Replaces chaotic WhatsApp polls. Committee + residents both love this immediately.

2. **B4 — Society circulars** (2 days)
   Formal compliance + clean inbox. Treasurer/Secretary will use it weekly.

3. **B9 — Admin role granularity** (2 days)
   Lets the President give Treasurer access to bills only, etc. Reduces accidental damage.

**Total: 6 days for a massive committee-perceived win.**

If the committee has appetite for **one big feature later**:

4. **C1 — Maintenance bills & payments** (7–10 days + Razorpay setup)
   This is the killer feature that makes the app indispensable. But only build after v1 is stable, residents are using gate features daily, and you have committee buy-in for the ~₹20K/mo Razorpay fee.

---

## 📝 Notes for future updates

- Add new feature requests as they come in (with date and requestor)
- Move features between tiers based on real demand
- Mark features as "Built ✅" when shipped to production
- Mark features as "Won't Do ❌" with reason if rejected
- Review this backlog **quarterly** with the committee

---

*Last updated: April 2026*
*Next review: July 2026 (post-v1 launch)*
*Document owner: development team*
*Approval required from: society management committee*
