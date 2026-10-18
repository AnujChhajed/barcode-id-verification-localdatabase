# tasks.md — Actionable Checklist and Progress Tracker

**Last updated:** 2026-10-17 (session 3 — Phases E and F complete, Phases G1–G3 green, real login/signup restored)
**Read `memory.md` and `phases.md` first.**

---

## How to use this file

- Every unchecked item is **not started** until code and evidence confirm it.
- Never tick an item because a document or a session *claims* it was done.
- Work on one task at a time. Inspect the implementation before editing it.
- Record blockers and decisions that need an answer. Do not invent business rules.
- Update this file at the end of every session, together with `WORKLOG.md` and `NEXT-SESSION.md`.

Legend: `[x]` verified done · `[~]` in progress · `[ ]` not started · `[!]` blocked on a decision

---

## Status snapshot — 2026-10-17

**One root, one command.** The frontend and the backend are now a single project:

- one `package.json`, one `npm install`, at the root;
- `npm run dev` → API on `:4000` + Vite on `:8080` together (`concurrently`), Vite proxying `/api`;
- `npm run build` → `dist\`; `npm start` → **one** Node process serving the API **and** the built UI on `:4000`;
- the separate admin-bootstrap command is gone (`ensureFirstAdmin()` runs in-process);
- **login and signup are real again** (Phase F3): `/login` is a password form, `/signup` creates an
  account request an administrator approves on `/users`. The temporary auto sign-in
  (`AUTH_AUTO_SIGNIN`, `POST /api/auth/local`) was deleted, not flag-disabled;
- **the public surface is exactly four routes**, asserted both ways at startup:
  `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/signup`, `GET /api/check/:code`;
- English only; Supabase, Cloudflare, the SSR worker and the Lovable build wrapper are gone.

**Backend:** implemented and tested for health, auth (**login + signup + account approval**), users,
settings, people, credentials, gate, inside, incidents, **canteen**, **announcements**, **watchlist**,
the **audit viewer**, the **dashboard summary**, the **date-range scan report** and the **public card
check**. `npm test` covers them — **173 tests, 173 pass, 0 fail, in 34 suites**.

**Frontend:** `dashboard.tsx` (v2, one summary call), `inside.tsx`, `logs.tsx`, `verify.tsx`
(QR-first camera), `register.tsx` (People & Credentials, reworked UX), `users.tsx` (now with
**account approval**), `settings.tsx`, `reports.tsx` (E3, NAV_ITEMS entry 5), plus the Phase D screens
`canteen.tsx`, `incidents.tsx`, `announcements.tsx`, `watchlist.tsx`, `audit.tsx` and the three public
screens `login.tsx`, `signup.tsx`, `check.tsx`. A case-insensitive search for `supabase` across `src\`
returns no matches.

**Verified 2026-10-17 (session 3, batch):** `npm run typecheck` **0 errors** · `npx eslint .`
**0 errors / 7 pre-existing warnings** · `npm run build` **exit 0** · `npm test` **173/173 pass** ·
`npm start` serves API **and** SPA from one process on `:4000`. **Phases A, B, C, D, E and F are
complete (C5/C6 and F2 pending a decision). Phase G is in progress — G1, G2 and G3 are done; G4 is
partly done; G5 and G6 are blocked on a decision.**

---

## Feature checklist — what is ADDED and what is REMAINING

This is the quick, plain-language view the user asked for. `[x]` = built and verified · `[ ]` = not
built yet · `[!]` = blocked on a decision. The phase tables further down are the same work in finer
detail.

### Foundation & platform

- [x] One project root, one `package.json`, one `npm install`, one `npm run dev` / `build` / `start`.
- [x] Local Node + SQLite backend (WAL, foreign keys, busy timeout), versioned SQL migrations.
- [x] Centralised backend role-based authorization (there is no RLS); fail-closed gate rule.
- [x] Business audit log kept separate from diagnostic logs.
- [x] No Supabase, no cloud database, no external service anywhere in `src\`.
- [x] **Real login and signup** (F3) — password login, self-service signup that creates a **disabled**
      `security_staff` request, administrator approval on `/users`, and fail-closed sessions (a
      disabled account loses its live sessions immediately). The temporary automatic sign-in was
      **deleted**, not flag-disabled.

### Gate scan — `/verify`

- [x] Direction toggle: **Entry** / **Exit** (never inferred).
- [x] USB / Bluetooth (HID) barcode scanner input with auto-submit.
- [x] Camera scanning (Quagga2) — **now QR-first**; the linear readers stay so an older printed card
      still scans. The HTTPS requirement is shown in the UI.
- [x] Manual lookup by name / worker ref / company.
- [x] Three verdicts shown distinctly — **APPROVED** / **REJECTED** (with a reason) / **UNABLE TO VERIFY**.
- [x] Session summary (approved / rejected / unable) and a recent-scans list.
- [x] Every scan recorded in the append-only `gate_events` table.
- [x] **Kiosk mode** — full-screen, chrome hidden, verdict panel auto-returns to ready.
- [x] **Visitor walk-in** — register → issue a gate pass valid for today → record the entry, in one step.
- [x] **Report an incident** — a shortcut from the gate screen, dated and attributed by the server.

### Who's Inside — `/inside`

- [x] Live list of who is currently inside; worker / intern / visitor counts.
- [x] Entries with **no recorded exit** flagged.
- [x] Search, type filter, sort options, CSV export.

### Access Logs — `/logs`

- [x] Audit trail of every scan, filterable by decision, direction and gate; search by scanned code.
- [x] Tabs: all logs / today's attendance / denied frequency; CSV export.

### Dashboard — `/dashboard`

- [x] Totals and currently-inside count.
- [x] Hourly scans chart (today), decision split (today), 7-day series.
- [x] Live recent-activity list.
- [x] **v2 (E1/E2)** — the whole page now loads from **one** call, `GET /api/dashboard/summary`.
      Added: currently-inside **by category**, **missing-exit** flag, **category split** chart,
      **hourly stacked** chart, **7-day trend**, **watchlist count** alert, announcements banner.
      `scans === approved + rejected + unable` is enforced on the server.

### Identity card & gate pass (QR)

- [x] Card face simplified to exactly: the **ABB logo**, **holder name**, **QR**, **category**
      (worker / visitor / intern), **Issued**, **Valid till** — nothing else.
- [x] The QR carries the **opaque credential id** — never personal data.
- [x] The ABB logo is **drawn** onto the card, so a card can never print with a missing image.
- [x] QR-first camera at the gate, so the printed QR scans back to the credential id.
- [x] Bulk render of many cards/passes (all QRs generated before the PDF is written).
- [x] The old CODE128 barcode, `workerRef`, `contractorCompany`, `institutionName`, `validFrom` and
      the visitor photo are **removed** from the card.
- [!] **Operational note:** USB scanner guns must be set to **QR mode** (a gun left in linear/CODE128
      mode cannot read the new card).

### People & Credentials — `/register` (administrator only)

- [x] List of people with search, category filter, status filter and pagination.
- [x] Create a person (worker / intern / visitor) with **per-category required fields only**.
- [x] Server-side validation errors shown inline on the matching field.
- [x] Person detail panel (profile + credentials).
- [x] Credential history with computed validity (valid / invalid + reason).
- [x] Issue an **ID card** or a **gate pass**.
- [x] Renew validity, suspend, terminate, reactivate — each with a **reason**.
- [x] Change a person's status (active / suspended / terminated) with a reason.
- [x] Download a single ID card and a single gate pass.
- [x] Bulk-download ID cards for the selected people.
- [x] CSV export (current page, or the selected rows).
- [x] **Edit** an existing person's profile.
- [x] **Bulk CSV import** of workers / interns / visitors with a per-row error report and a downloadable template.
- [x] **Reworked create flow** — pick one of three **category tiles** (worker / visitor / intern), see
      **only that category's required fields**, and register + issue the card in a single dialog with
      a live QR preview and Download / Print.
- [x] **Visitor group pass** — register **N visitors at once** (shared visit details + rows), issuing
      **one individually-audited QR pass per visitor**, with a per-row outcome and "download all".
- [x] **Clearer CSV import** — a numbered 3-step dialog with the expected columns inline, a
      **pre-import** valid/invalid summary, and a **post-import** created/failed summary plus a
      failures CSV.
- [x] Guarded — security staff are redirected away, matching the API's 403.

### Compliance & monitoring (Phase D)

- [x] **Canteen** — `/canteen` screen + backend; one approved entry per person per local day, enforced by a DB unique index; same-day repeats recorded as a friendly refusal. **VERIFIED DONE**
- [x] **Incidents** — `/incidents` screen with status/severity filters and triage (open → under review → closed). **VERIFIED DONE**
- [x] **Announcements** — `/announcements` screen (admin post, soft-deactivate) + a dashboard banner. **VERIFIED DONE**
- [x] **Watchlist** — `/watchlist` screen (admin add/deactivate) + an **advisory** alert on the gate screen; a match can never change a verdict. **VERIFIED DONE**
- [x] **Audit viewer** — `/audit` (administrator only) with action filter and before/after snapshots. **VERIFIED DONE**
- [x] Negative authz proven: administrators-only endpoints return 403 for security staff and write no row. **VERIFIED DONE**

### Users & Settings (administrator)

- [x] `/users` — list users, create a user with a role, and **approve (enable) or disable an account**
      with the two lockout guards (no self-disable, no disabling the last active administrator).
- [x] `/settings` — read and update system settings.

### Reports — `/reports` (E3)

- [x] Date-range scan report over `gate_events` — `GET /api/reports/scans?from=&to=`.
- [x] Totals, per-day series, category split, direction split, gate split and a top-reasons table.
- [x] CSV and PDF export from the screen.
- [x] **Counts and reason codes only** — no name, phone, email, worker reference or purpose of visit
      (asserted by test).
- [x] The same `scans === approved + rejected + unable` rule as the dashboard, so the two reconcile.
- [x] Accessible to both gate roles (administrator and security operator).

### Public card check — `/check` (F1)

- [x] No sign-in required; takes one opaque code and answers with the card's status only.
- [x] Verdict comes from the **same** `evaluateCredential` rule the gate uses, so the page and the gate
      can never disagree (asserted by scanning the same code both ways).
- [x] Leaks no personal field (asserted). An unknown code is an **answer** (`status: "not_found"`),
      not an error.
- [x] Added `GET /api/check/:code` as the fourth and last entry of the asserted public-route allowlist.

### Still REMAINING

- [!] **Emergency lockdown** and **operator override** — pending decision (C5 / C6).
- [!] **Expiry reminders + email** — pending decision (F2). Credentials still expire correctly without
      it; reminders are a convenience, never the control.
- [ ] **G4** — repository-wide secret sweep and personal-data exposure review. (The new public payload
      already has a leak test; the rest of the repository has not been swept.)
- [!] **Offline scanning** — blocked on an approved policy (G5).
- [!] **Deployment readiness** (topology, tested backup/restore, HTTPS, DB file permissions) — pending
      decision (G6).
- [ ] **Optional person fields** (`email`, `address`) — approved but **no migration written yet**.
      (`contractor_company` is already optional, so nothing to do there.)
- [ ] **Loose ends:** `users.routes.js` and `settings.routes.js` still build SQL inline instead of going
      through `backend\src\data\`; the 35 inherited `npm audit` vulnerabilities need re-checking; no Git
      repository exists yet (deferred by the user).
- [!] **Operational:** set the gate scanner guns to **QR mode**.

---

## Phase A — One root, one command, a running system — COMPLETE

### A1–A8 — Consolidation (verified complete)

- [x] One root, one `package.json`, one `npm install`.
- [x] `npm run dev` runs API + web together; Vite proxies `/api` → `http://127.0.0.1:4000`.
- [x] `npm run build` → `dist\`; `npm start` serves API + UI from the single process on `:4000`.
- [x] `ensureFirstAdmin()` runs inside the server (renamed from `ensureLocalAdmin()` in F3); the separate
      bootstrap command was deleted.
- [x] ~~Login temporarily removed: `config.autoSignIn` (`AUTH_AUTO_SIGNIN`, default `true`) +
      `POST /api/auth/local`, plus `ServerUnreachable` in place of the old `/login` redirect.~~
      **SUPERSEDED 2026-10-17 by F3** — the bypass was deleted entirely and real login/signup restored.
      `ServerUnreachable` is kept, but now it renders only for a genuine API outage; an anonymous
      visitor is sent to `/login`.
- [x] Removed the Cloudflare / SSR-worker / `@lovable.dev` build wrapper.
- [x] English only — Swahili locale and `LanguageSwitcher` removed.
- [x] Deleted the approved dead files and `src\integrations\`.

### A9 — Rewrite `verify.tsx` off Supabase — VERIFIED DONE

- [x] Delete the `@/integrations/supabase/client` import and every `supabase.*` call
      (`students`, `access_logs`, `watchlist`, `settings`, `storage`, `functions`).
- [x] Route verification through `gateApi.verify(code, direction)`.
- [x] Direction toggle (**entry / exit**) — the API requires it and never infers it.
- [x] Manual lookup through `peopleApi.search(q)`.
- [x] Session summary + recent-scan list from the in-session scan log.
- [x] Keep the HID scanner behaviour (autofocus, auto-submit on Enter) and the `ScannerStatus` panel.
- [x] Keep camera scanning with Quagga2, and make the HTTPS requirement explicit in the UI.
- [x] Drop the college-only paths: photo signed URLs, edge functions, watchlist alerts
      (watchlist returns in Phase D4), offline queue.
- [x] Show the three verdicts distinctly: **APPROVED**, **REJECTED** (with `reasonText`),
      **UNABLE TO VERIFY** — a technical failure must never look like a pass.

### A10 — `src\lib\idcard.ts` for ABB — VERIFIED DONE

- [x] Replace `IdCardStudent` (`admission_number`, `programme`, `nta_level`, `year_of_study`,
      `parent_email`, `parent_phone`) with ABB fields: `fullName`, `category`, `workerRef`,
      `contractorCompany`, `institutionName`, `credentialId`, `validFrom`, `validTo`.
- [x] Render the **opaque credential id** as a CODE128 barcode — never personal data.
      **⚠ SUPERSEDED 2026-10-17: the card now carries a QR code instead (see "Identity card & gate
      pass (QR)" above). The payload is still the opaque credential id; only the symbology changed.**
- [x] Rename the college branding (`Arusha Technical College`) to ABB Plant 3.
- [x] Keep a visitor/gate-pass layout for short-lived passes. (Not yet consumed by any screen — Phase B6.)

### A11 — Remove the college-shaped offline cache — VERIFIED DONE

- [x] Delete `src\lib\offline.ts` (`CachedStudent`, `QueuedScan`, `openDB("atc-gate")`) and its
      `verify.tsx` usages; drop the now-unused `idb` dependency. Offline mode is Phase G5 and is
      **blocked** until a policy is approved.

### A12 — Gate-staff lookup must be able to verify — VERIFIED DONE

- [x] Add the holder's **active credential code** to the `GET /api/people/search` response so Manual
      Lookup can hand a code to `/api/gate/verify`. This is not a new disclosure: the credential id is
      the barcode already printed on the card the guard scans.
- [x] Confirm no phone, email or visit detail is added to that response (`people.test.js` asserts this).

### A13 — Prove it runs — VERIFIED DONE

- [x] `npm run typecheck` → 0 errors.
- [x] `npm run build` → `dist\` produced.
- [x] `npm start` → `GET /api/health` 200 **and** `GET /` returns the built SPA, from one process.
- [x] `npm test` → 99 tests, 99 pass, 0 fail (fixed the script: `node --test "backend/tests/**/*.test.js"`).
- [x] Record the exact commands and output in `WORKLOG.md`.

---

## Phase B — People & credential management — COMPLETE

- [x] B1 `src\routes\_authenticated\register.tsx` — register list with category/status filters, search, pagination. **VERIFIED DONE**
- [x] B2 Create-person form with per-category required fields only; surface backend `details[]` per field. **VERIFIED DONE**
- [x] B3 Edit person (`peopleApi.update` → `PATCH /api/people/:id`); status change (suspend/terminate) **with a reason** (audited server-side). **VERIFIED DONE**
- [x] B4 Person detail panel: credential history with computed `isValid` / `reasonCode` / `reasonText`. **VERIFIED DONE**
- [x] B5 Issue credential (`id_card` / `gate_pass`), extend validity, suspend, terminate — all with a reason. **VERIFIED DONE**
- [x] B6 Print/download the ID card and gate pass; the barcode scans back to the credential id. **VERIFIED DONE** (round-trip proven against the gate API)
- [x] B7 Bulk CSV import for workers/interns/visitors with a per-row error report, plus a downloadable template. **VERIFIED DONE**
- [x] B8 Register is administrator-only; security staff are redirected away, matching the API's 403. **VERIFIED DONE**

---

## Phase C — Gate operations

- [x] C1 Direction toggle, HID scanner, camera scanning and manual lookup all verified on the gate screen. **VERIFIED DONE**
- [x] C2 Verdict panel with holder identification, `reasonText`, and auto-close back to ready. **VERIFIED DONE**
- [x] C3 Session summary (granted / denied / unable / total) and a recent-scans list. **VERIFIED DONE**
- [x] C4 Kiosk mode (full-screen, chrome hidden, auto-return to ready). **VERIFIED DONE**
- [!] C5 Emergency lockdown that denies every scan until lifted, audited. **PENDING DECISION.**
- [!] C6 Operator override of a denial with a mandatory written reason, audited. **PENDING DECISION.**
- [x] C7 Visitor walk-in: register visitor → issue a gate pass valid for today → record the entry. **VERIFIED DONE**
- [x] C8 Report-an-incident shortcut from the gate screen (`POST /api/incidents`). **VERIFIED DONE**

**C4–C8 detail**

- C4 — `verify.tsx` already had the kiosk shell; confirmed it enters full screen, hides the mode
  switcher / recent list / toolbar, and that the verdict panel closes itself (5 s on APPROVED,
  12 s otherwise) leaving the scanner input refocused and ready.
- C7 — **Visitor walk-in** button (administrator only, because it writes personal data) on the gate
  header. One dialog registers the visitor, issues a `gate_pass` valid for **today only**, and then
  runs the normal `POST /api/gate/verify` with the new credential for an **entry** — so the pass the
  guard just created is the pass the server checks. No new backend route: it reuses
  `POST /api/people`, `POST /api/credentials` and `POST /api/gate/verify`.
- C8 — **Report incident** button on the gate header, open to the gate roles. Files against the
  Plant 3 main gate and the signed-in operator; `occurredAt` is set by the server. New:
  `backend/src/data/incidents.js`, `backend/src/routes/incidents.routes.js`
  (`POST /api/incidents`), and `createIncidentSchema`. The `incidents` table already existed in
  `0001_init.sql`, so there is no new migration.

---

## Phase D — Compliance and monitoring — COMPLETE

- [x] D1 Backend canteen routes using the existing `ux_canteen_one_per_day` unique index. **VERIFIED DONE**
- [x] D2 Incidents **screen** `incidents.tsx` + the read/triage routes (create already exists: `POST /api/incidents`, done in C8). **VERIFIED DONE**
- [x] D3 Backend announcements routes + `announcements.tsx` + a dashboard banner. **VERIFIED DONE**
- [x] D4 Migration `0003_watchlist.sql` + backend routes + `watchlist.tsx` + the gate-screen alert. **VERIFIED DONE**
- [x] D5 `GET /api/audit` + `audit.tsx` viewer (administrator only). **VERIFIED DONE**
- [x] D6 Canteen screen on the gate UI (`canteen.tsx`). **VERIFIED DONE**
- [x] D7 Tests: a second same-day canteen entry is refused, including concurrently (`compliance.test.js`, 13 tests). **VERIFIED DONE**

**Phase D detail**

- **D1 / D6 / D7 — Canteen.** New `backend/src/data/canteen.js` and
  `backend/src/routes/canteen.routes.js` (`POST /api/canteen/verify`, `GET /api/canteen/events`).
  One approved entry per person per local calendar day, enforced inside a `db.transaction` on top of
  the existing `ux_canteen_one_per_day` unique index. Every attempt is written to the append-only
  table — a same-day repeat is recorded as a **friendly refusal** (`already_entered_today`), and a
  concurrent race yields exactly one APPROVED. Screen: `src/routes/_authenticated/canteen.tsx`
  (scanner-style input, verdict panel, today's log, "served today" counter).
- **D2 — Incidents.** `incidents.js` gained `listIncidents` / `countIncidents` / `setIncidentStatus`;
  `incidents.routes.js` now registers `GET /api/incidents` and `PATCH /api/incidents/:id`
  (GATE_ROLES; the `PATCH` writes an `incident.status` audit row). Screen: `incidents.tsx`
  (status/severity filters, triage actions). No migration — the table already existed.
- **D3 — Announcements.** New `backend/src/data/announcements.js` +
  `announcements.routes.js` (`GET` for GATE_ROLES; `POST` and `POST /:id/deactivate` for
  ADMINISTRATOR_ONLY). Screen: `announcements.tsx` (admin posting, soft-deactivate) and a dashboard
  banner in `dashboard.tsx`.
- **D4 — Watchlist.** New migration `backend/migrations/0003_watchlist.sql` (table + 3 indexes),
  `backend/src/data/watchlist.js`, `backend/src/routes/watchlist.routes.js`. The gate alert is wired
  into the **existing** `POST /api/gate/verify` handler and is **advisory**: a lookup failure is
  caught and logged, and a match can never change a verdict. Screen: `watchlist.tsx`.
- **D5 — Audit viewer.** New `backend/src/data/audit.js` + `audit.routes.js` (`GET /api/audit`,
  ADMINISTRATOR_ONLY); malformed JSON snapshots degrade to `null`. Screen: `audit.tsx`.
- **Authorization posture:** every administrator-only route (`POST /api/announcements`,
  `POST /api/watchlist`, `GET /api/audit`) was proven to 403 for `security_staff` **and** to write no
  row. `assertPublicRoutes` still passes — no public route was added.
- **Verification (batch, end of phase):** `npm run typecheck` clean, `npm run build` OK,
  `npm test` → **112/112 pass** (13 of them the new `compliance.test.js`).

---

## Phase E — Insight: dashboard and reports — COMPLETE

- [x] E1 `GET /api/dashboard/summary` — today's counts, inside totals, category split, hourly buckets, 7-day series in one call. **VERIFIED DONE** (15 new tests in `backend/tests/dashboard.test.js`).
- [x] E2 Dashboard v2 on that single call, plus announcements and watchlist banners. **VERIFIED DONE** (typecheck + build + 127/127).
- [x] E3 `reports.tsx` with date-range reports and CSV/PDF export, restricted by role. **VERIFIED DONE** (16 tests in `backend/tests/reports.test.js`).
- [x] E4 Document every dashboard figure's definition in `Architecture.md` and reconcile it with `gate_events`. **VERIFIED DONE** (`Architecture.md` §17).

**E1 / E2 detail (2026-10-17)**

- **E1 — one call replaces 4 + 8 + 7.** New `backend/src/data/dashboard.js` (`buildDashboardSummary`)
  and `backend/src/routes/dashboard.routes.js` (`GET /api/dashboard/summary`, access
  `["administrator","security_staff"]`, `dashboardSummaryQuerySchema` with `days` 1–31, default 7).
  All aggregation happens in JS over raw rows pulled by `listScanFacts` (`gate-events.js`), because
  SQLite cannot convert a UTC instant to an IANA zone — so the same code will run on PostgreSQL and a
  night shift cannot get a UTC-derived "today". `scans === approved + rejected + unable` is enforced
  in every bucket. Supporting changes: `backend/src/lib/time.js` gained `hourInZone`,
  `startOfDayIso` and `isEntryUnclosed`; `watchlist.js` gained `countLiveWatchlist`; `gate.routes.js`
  dropped its duplicate local `entryIsUnclosed` in favour of the shared helper.
- **E2 — dashboard v2.** `src/routes/_authenticated/dashboard.tsx` rewritten: one
  `dashboardApi.summary(7)` query (30 s refetch) plus the live feed (15 s) and the announcements
  banner (120 s). Category split, hourly stacked chart, 7-day trend, inside-by-category and
  missing-exit flag. `src/lib/api.ts` gained `DashboardSummary` / `ScanCounts` / `dashboardApi`. New
  `dash.*` keys in `src/locales/en.json`.

**E3 / E4 detail (2026-10-17)**

- **E3 — the date-range scan report.** New `backend/src/data/reports.js` (`buildScanReport`) and
  `backend/src/routes/reports.routes.js` (`GET /api/reports/scans?from=&to=`, access
  `["administrator","security_staff"]`, `scanReportQuerySchema`). It reuses `listScanFacts` and the
  dashboard's `scans === approved + rejected + unable` rule, so a CSV exported from it reconciles
  exactly with the dashboard. The payload is **counts and reason codes only** — no name, phone, email,
  worker reference or purpose of visit (asserted). Day bucketing is in JS for the same reason as the
  dashboard. Bounds: `days` capped at `MAX_DAYS = 366`, reason table capped at `TOP_REASONS = 12`.
  Screen: `src/routes/_authenticated/reports.tsx` — date range, charts, CSV/PDF export; `/reports` is
  entry 5 of `NAV_ITEMS`. **16 tests** in `backend/tests/reports.test.js`.
- **E4 — figure definitions.** `Architecture.md` §17 defines every number on both screens: the single
  source (`gate_events`), the reconciliation rule, why bucketing is in JS, every dashboard figure,
  every report figure, what the report deliberately omits, and which suite proves each one. No code
  changed for E4.

---

## Phase F — Public page and credential lifecycle — COMPLETE (F2 skipped by decision)

- [x] F1 Public `/check` page — card status only, no personal data; added exactly two entries to the asserted public-route allowlist (`POST /api/auth/signup`, `GET /api/check/:code`). **VERIFIED DONE** (`backend/tests/check.test.js`).
- [!] F2 Expiry reminders: scheduler, `notification_log`, `notifications.tsx`.
      **SKIPPED BY DECISION (user: "Skip F2 for now"). Credentials still expire correctly without it.**
- [x] F3 Signup/login restored properly, replacing the temporary `POST /api/auth/local`. **VERIFIED DONE** (`backend/tests/accounts.test.js`).

**F1 / F3 detail (2026-10-17)**

- **F1 — the public card check.** New `backend/src/data/public-check.js` (`lookupCardStatus`) and
  `backend/src/routes/check.routes.js` (`GET /api/check/:code`, `PUBLIC`). It returns
  `{valid, status, reasonCode, reasonText, kind, category, validTo}` and deliberately nothing personal.
  The verdict calls `evaluateCredential`, the same pure rule the gate and the canteen use, so the page
  can never disagree with the gate (asserted by scanning the same code both ways). An unknown code is
  an **answer** (`status: "not_found"`), not an error. Screen: `src/routes/check.tsx`.
- **F3 — login + signup.** The whole temporary bypass was removed: `AUTH_AUTO_SIGNIN`,
  `config.autoSignIn`, `AUTO_SIGNIN_PUBLIC_ROUTE`, `publicRouteAllowlist()` and `authApi.localSignIn()`
  no longer exist, and `ensureLocalAdmin()` became `ensureFirstAdmin()` (first administrator created
  only while `users` is empty). Added `POST /api/auth/signup` (creates a **disabled** `security_staff`
  account; the caller cannot choose a role and cannot sign in until approved), `PATCH /api/users/:id`
  (administrator-only enable/disable, with no self-disable and no disabling the last active
  administrator) and a 12-char minimum password. Screens: `src/routes/login.tsx`,
  `src/routes/signup.tsx`; `users.tsx` gained account approval; `index.tsx` now sends an anonymous
  visitor to `/login` (and shows `<ServerUnreachable />` only for a genuine outage).

---

## Phase G — Hardening and offline

- [x] G1 Backend tests for every new endpoint. **VERIFIED DONE** (new `accounts.test.js`, `check.test.js`; existing `dashboard.test.js`, `reports.test.js`).
- [x] G2 Negative tests: `security_staff` is refused every administrator endpoint and no row is written. **VERIFIED DONE**.
- [x] G3 `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` all clean. **VERIFIED DONE** (typecheck 0 · eslint 0 errors / 7 pre-existing warnings · build exit 0 · 173/173 tests).
- [ ] G4 Secret sweep and personal-data exposure review (screens, exports, logs, QR payloads).
      **PARTLY DONE** — the new public payload has a leak test; the repository-wide sweep is outstanding.
- [!] G5 Offline scanning. **BLOCKED** on an approved offline policy; stale data must never yield APPROVED.
- [!] G6 Deployment readiness: topology, tested backup/restore, HTTPS, DB file permissions. **PENDING DECISION.**

---

## Known issues carried forward (not new)

- `npm audit` reported 35 vulnerabilities in the inherited shell; none are proven exploitable in this
  local-only deployment — to be re-checked in Phase G3 (now G4).
- `npm run lint` had ~135 pre-existing problems in the inherited shell code — now down to
  **7 warnings** (all `react-refresh/only-export-components` in generated shadcn/ui files), deliberately
  left alone.
- `users.routes.js` and `settings.routes.js` still build SQL inline instead of going through
  `backend\src\data\`.
- No Git repository exists yet (deliberately deferred by the user).

---

## Every-session checklist

**Before work:** read `memory.md` → `phases.md` → this file → `NEXT-SESSION.md`; inspect the workspace;
state the single next task with its acceptance criteria.

**After work:** summarise exactly what changed; record the commands run and their **actual** output;
note blockers and risks; tick only what verification supports; update this file, `phases.md`,
`WORKLOG.md` and `NEXT-SESSION.md`.

---

## Approval required before these actions

Deleting or overwriting project files or substantial user work · combining projects or resetting a
repository · destructive database commands or migrations against real data · changing access or
security policy · redesigning the architecture or replacing the inherited stack · copying the
reference project's code · deploying or modifying production data.

---

## Update and Changes Checklist (2026-10-18) — In Progress

From `project info/update and changes prompt.txt`:

### 1. Inspection & Architecture Findings
- [x] Identify stack: React 19 + TypeScript + Vite SPA (`src/`) & Node Express 5 + SQLite (`backend/`).
- [x] Verify database: Local SQLite with portable conventions; prepare normalized PostgreSQL schema proposal for database teammate.
- [x] Verify asset: Official `abb-logo.png` located in root and `public/abb-logo.png`.
- [x] Root cause analysis for scanning, duplicate events, IN/OUT state, canteen limits, and calculations.

### 2. ID Numbering & Database Schema Update
- [ ] Migration `0004_short_id.sql` adding `short_id` with `ux_people_short_id` unique index on `people`.
- [ ] Backfill existing records: Jane Doe (`W101`), ANUJ (`I101`), Vipul (`I102`), Vivek (`I103`).
- [ ] Auto-assign prefix IDs on backend: `W101, W102...` (Worker), `I101, I102...` (Intern), `V101, V102...` (Visitor), `GRP101...` (Group pass).
- [ ] Update backend data layer (`people.js`, `people.routes.js`, `gate.routes.js`) to support lookup by short ID and UUID.

### 3. Professional Portrait ID Card Design (CR80 ~54 × 85.6 mm)
- [ ] Portrait CR80 vertical layout only (no landscape).
- [ ] ABB logo at top (using official asset).
- [ ] Category centered title ONLY: "WORKER" / "INTERN" / "VISITOR" (no "CATEGORY:" label).
- [ ] Centered person photograph (or crisp avatar placeholder).
- [ ] Full name clearly readable.
- [ ] Short ID number: `ID NO. W101`, `ID NO. I101`, `ID NO. V101`.
- [ ] Compact, reliably scannable 1D barcode (Code 128) encoding short ID.
- [ ] "VALID UNTIL: DD MMM YYYY" near bottom.
- [ ] "ABB PLANT 3" footer.
- [ ] Clean print styling and print preview dialog.

### 4. Gate Verification & Automatic IN/OUT
- [ ] Automatic gate IN/OUT: state OUT -> next scan IN; state IN -> next scan OUT.
- [ ] Support authorized manual IN/OUT override with mandatory written reason logged to `audit_log`.
- [ ] Debounce / cooldown preventing rapid repeated scans and duplicate Enter events.
- [ ] Return state details (`previousState`, `gateState`, `direction`, `shortId`).

### 5. Corner Confirmation Toasts
- [ ] Gate screen: Corner toast for success entry ("ENTRY RECORDED — [ID]"), exit ("EXIT RECORDED — [ID]"), rejected ("ACCESS DENIED — [REASON]"), unable ("UNABLE TO VERIFY — TRY AGAIN").
- [ ] Canteen screen: Corner toast for success ("CANTEEN ENTRY RECORDED — [ID]"), duplicate ("ALREADY USED TODAY — [ID]"), rejected ("ACCESS DENIED — [REASON]").

### 6. Combined Access Logs & Reports Page
- [ ] Unify `/logs` to include both Access Logs and Reports via simple tabs ("Access Logs" and "Reports").
- [ ] Unified filter controls: date range, ID, category, direction, result.
- [ ] Retain charts, totals, and CSV export.

### 7. Navigation Cleanup
- [ ] Remove Incidents, Announcements, and Watchlist from navigation in `_authenticated.tsx`.
- [ ] Remove Audit Trail from ordinary navigation (retain backend audit functionality).
- [ ] Merge Reports into Logs nav item (`Logs & Reports`).
- [ ] Retain streamlined Settings page.

### 8. Login & User Management Polish
- [ ] Show/hide password toggle on login form input while typing.
- [ ] Display Account ID, username, name, role, active status, created date, last login in Users page.
- [ ] Safe password reset/change modal for authorized administrators.

### 9. Validation & Testing
- [ ] `npm test` passing all test suites.
- [ ] `npm run typecheck` 0 errors.
- [ ] `npm run build` exit code 0.
- [ ] Update `WORKLOG.md`, `phases.md`, `memory.md`, and `NEXT-SESSION.md`.
