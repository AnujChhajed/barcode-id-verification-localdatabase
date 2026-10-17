# phases.md — Development Phases and Current Status

## ABB ID Verification and Gate Security System — Plant 3

**Last updated:** 2026-10-17
**Read `memory.md` first**, then this file, then `tasks.md`.

---

## How to read this file

- A phase is **not** complete because it is written here. Completion is decided by code in the
  repository plus recorded evidence in `WORKLOG.md`.
- `✅ done` = verified in the repository. `🚧 in progress` = partly built. `⬜ planned` = not started.
- Anything marked **PENDING DECISION** needs an answer from the user; do not invent the rule.

---

## Where the project actually is (verified 2026-10-17)

The project root is `Anuj ABB Id verification system\`, and it is now **one project**:

- **One root, one `package.json`, one `npm install`.** The old split (frontend at the root, a second
  `package.json` inside `backend\`) is gone.
- **One command to run everything in development:** `npm run dev` starts the API (port 4000) and the
  Vite dev server (port 8080) together with `concurrently`. Vite proxies `/api` to the API, so the
  browser sees a single origin and the session cookie works without CORS.
- **One command for production:** `npm run build` writes the SPA to `dist\`, then `npm start` runs a
  single Node process that serves both the API and the built UI on port 4000.
- **The separate admin-bootstrap command is gone.** `ensureFirstAdmin()` runs inside the server process.
- **Login and signup are restored (Phase F3, done 2026-10-17).** The temporary automatic sign-in
  (`AUTH_AUTO_SIGNIN`, `POST /api/auth/local`) was **deleted entirely**, not flag-disabled. `/login` is a
  real password form; `/signup` creates a request for an account which an administrator approves on
  `/users`. A fresh install still has exactly one way in: while the `users` table is empty the server
  creates the first administrator from `ABB_LOCAL_ADMIN_*` (username `admin`).
- The Cloudflare/SSR-worker/Lovable build wrapper and the Supabase client were removed.
- The UI is **English only** (the Swahili locale pack and the language switcher were removed).
- **The public surface is exactly four routes**, asserted in both directions at startup:
  `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/signup`, `GET /api/check/:code`.
- **The card carries a QR code, never a barcode.** `jsbarcode` was removed on 2026-10-17.

**Backend:** complete for health, auth (login + signup + account approval), users, settings, people,
credentials, gate, inside, incidents, canteen, announcements, watchlist, audit, dashboard, reports and
the public card check; **173 tests, 173 pass** in 34 suites.
**Frontend:** every screen is on the new API; no file under `src\` mentions Supabase. The public pages
`/login`, `/signup` and `/check` exist alongside the authenticated shell.
**Verified 2026-10-17:** `npm run typecheck` 0 errors · `npx eslint .` 0 errors (7 pre-existing
`react-refresh` warnings) · `npm run build` succeeds · `npm test` **173/173** · `npm start` serves the
API **and** the SPA from one process on `:4000`.

---

## Reference project

`barcode-student-verification-system-add-srs-document\` (plus its `.zip`) is the user's own earlier
**college** system, supplied as a **feature reference only**. Its code is not copied: it is
Supabase-shaped and college-shaped. What is taken from it is the *feature list and dashboard layout*,
re-expressed on the ABB data model.

| Reference screen | ABB equivalent | Adopted? |
|---|---|---|
| `students.*` (register, profile, bulk import) | `register.tsx` — People & Credentials | **Yes — Phase B** |
| `verify.tsx` | `verify.tsx` — gate scan, camera, lookup, override, shift summary | **Yes — Phase A + C** |
| `inside.tsx` | `inside.tsx` | Already exists ✅ |
| `logs.tsx` | `logs.tsx` | Already exists ✅ |
| `visitors.tsx` | Visitor walk-in on `verify.tsx` | **Yes — Phase C (done)** |
| `watchlist.tsx` | `watchlist.tsx` + gate alert | **Yes — Phase D4 (done)** |
| `incidents.tsx` | `incidents.tsx` | **Yes — Phase D2 (done)** |
| `announcements.tsx` | `announcements.tsx` + dashboard widget | **Yes — Phase D3 (done)** |
| `reports.tsx` | `reports.tsx` | **Yes — Phase E3** |
| `dashboard.tsx` | `dashboard.tsx` v2 | **Yes — Phase E2** |
| `check.tsx` (public) | `/check` card-status page | **Yes — Phase F1** |
| `notifications.tsx` | `notifications.tsx` (expiry notices) | **Yes — Phase F2** |
| `my-shift.tsx` | Shift summary panel on `verify.tsx` (no separate screen) | Partial — Phase C |
| `gates.tsx` | Not adopted — Plant 3 has exactly one gate by requirement | No |
| `appointments.tsx` | Not adopted yet — visitor pre-booking is a new business rule | No (recorded) |
| `users.tsx` / `settings.tsx` | Already exist ✅ | Already exists ✅ |

---

## Phase A — One root, one command, a running system ✅ COMPLETE

**Goal:** the whole system installs, builds and runs from one root, and no screen still talks to
Supabase. **Achieved and verified on 2026-10-17.**

| # | Task | Status |
|---|---|---|
| A1 | Collapse frontend + `backend\` into one root with one `package.json` and one `npm install` | ✅ done |
| A2 | `npm run dev` starts API + web together; Vite proxies `/api` → `:4000` (single origin, no CORS) | ✅ done |
| A3 | `npm run build` → `dist\`; `npm start` serves API **and** UI from the one Node process on `:4000` | ✅ done |
| A4 | Remove the separate admin-bootstrap command; `ensureLocalAdmin()` runs in-process | ✅ done |
| A5 | Remove login for now; server guarantees the local admin and the browser auto-signs-in | ✅ done |
| A6 | Remove the Cloudflare / SSR-worker / Lovable build wrapper | ✅ done |
| A7 | English only — remove the Swahili locale and the language switcher | ✅ done |
| A8 | Delete the approved dead files (`dist\`, `.wrangler\`, `take_screenshots.cjs`, `src\integrations\supabase\*`, `backend\package*.json`, college `README.md`, `wrangler.jsonc`, `bun.lock`) | ✅ done |
| A9 | Rewrite `src\routes\_authenticated\verify.tsx` off Supabase onto `/api/gate/*` + `/api/people/search` | ✅ done |
| A10 | Rewrite `src\lib\idcard.ts` for ABB (ID card + gate pass, CODE128 from the opaque credential id) | ✅ done |
| A11 | Remove the college-shaped `src\lib\offline.ts` + the unused `idb` dependency | ✅ done |
| A12 | Serve the active credential code in the gate-staff people search so Manual Lookup can verify | ✅ done |
| A13 | `npm run typecheck`, `npm run build`, `npm test`, `npm start` all green | ✅ done |

**Exit criteria:** `npm install` → `npm run dev` → the gate screen scans, verifies and shows
APPROVED / REJECTED / UNABLE TO VERIFY against the local SQLite database; `npm run build && npm start`
serves the same app from one process; `npm test` still passes.

---

## Phase B — People & credential management ✅ COMPLETE

**Goal:** an administrator can run the whole credential lifecycle without touching the database.

| # | Task | Status |
|---|---|---|
| B1 | `register.tsx` — register list: filter by category (worker / intern / visitor) and status, search, paginate | ✅ done |
| B2 | Create person — per-category required fields only (worker→`workerRef`; intern→`institutionName`; visitor→`purposeOfVisit` + `personToMeet`) | ✅ done |
| B3 | Edit person, and change status (suspend / terminate) **with a reason** (audited) | ✅ done |
| B4 | Person detail: credential history with computed validity (`isValid`, `reasonCode`) | ✅ done |
| B5 | Issue credential (`id_card` / `gate_pass`), extend validity, suspend, terminate — all with a reason | ✅ done |
| B6 | Print/download the ID card and gate pass; verify the barcode scans back to the credential id | ✅ done |
| B7 | Bulk CSV import for workers/interns/visitors, with a per-row error report | ✅ done |
| B8 | Role guard: the whole register is administrator-only; security staff see nothing here | ✅ done |

All of B1–B8 lives in `src\routes\_authenticated\register.tsx` (2026-10-17).

**Exit criteria:** a new worker can be registered, issued a card, have it printed, be suspended with a
reason recorded in `audit_log`, and be refused at the gate on the next scan.

---

## Phase C — Gate operations ✅ COMPLETE (C5 / C6 pending a decision)

| # | Task | State |
|---|---|---|
| C1 | Finish the gate screen: direction toggle (entry/exit), HID scanner, camera (Quagga2), manual lookup | ✅ done |
| C2 | Verdict panel: APPROVED / REJECTED / UNABLE TO VERIFY with `reasonText`, holder identification, auto-close | ✅ done |
| C3 | Session summary (granted / denied / unable / total) + recent-scans list | ✅ done |
| C4 | Kiosk mode (full-screen, chrome hidden, auto-return to ready state) | ✅ done |
| C5 | Emergency lockdown toggle that denies every scan until lifted (audited) | ⬜ **PENDING DECISION** |
| C6 | Operator override of a denial, with a mandatory written reason (audited) | ⬜ **PENDING DECISION** |
| C7 | Visitor walk-in: register visitor + issue a gate pass for today, then record the entry | ✅ done |
| C8 | Report-an-incident shortcut from the gate screen | ✅ done |

**C7 / C8 notes:** C7 is a frontend flow that reuses `POST /api/people`, `POST /api/credentials` and
`POST /api/gate/verify`, so it adds no backend surface. C8 adds one gate-role route,
`POST /api/incidents` (the `incidents` table already existed in `0001_init.sql`), written to the audit
log. C5 and C6 stay unbuilt until the lockdown/override policy is agreed.

**Exit criteria:** a guard can run a full shift from this screen alone, and every override or lockdown
is attributable to an operator. *(The first half holds; the override/lockdown half is C5/C6.)*

---

## Phase D — Compliance and monitoring ✅ COMPLETE

| # | Task |
|---|---|
| D1 | Backend: canteen routes (`POST /api/canteen/verify`, `GET /api/canteen/events`) using the existing one-per-day unique index — ✅ |
| D2 | Backend: incidents routes + `incidents.tsx` — ✅ |
| D3 | Backend: announcements routes + `announcements.tsx` + dashboard banner — ✅ |
| D4 | Migration `0003_watchlist.sql` + backend routes + `watchlist.tsx` + the gate-screen alert — ✅ |
| D5 | Backend: `GET /api/audit` + `audit.tsx` viewer (administrator only) — ✅ |
| D6 | Canteen screen on the gate UI — ✅ |

**Exit criteria:** a second same-day canteen entry is reliably refused (including concurrently), a
watchlisted person triggers a visible alert at the gate, and every privileged change is readable in
the audit viewer. **All verified** — `compliance.test.js` (13 tests) proves the one-per-day rule
sequentially and concurrently, the advisory watchlist alert, and 403-with-no-row-write for every
administrators-only route. `npm test` → 112/112.

---

## Phase E — Insight: dashboard and reports ✅ COMPLETE

| # | Task | State |
|---|---|---|
| E1 | Backend `GET /api/dashboard/summary` — one call for today's counts, inside totals, category split, hourly buckets and a 7-day series. Replaces the dashboard's current 4 + 8 + 7 calls | ✅ done |
| E2 | Dashboard v2 — server summary, announcements banner, watchlist alerts, category split, hourly stacked chart, 7-day trend, live feed | ✅ done |
| E3 | `reports.tsx` — date-range reports with CSV/PDF export, restricted by role | ✅ done |
| E4 | Every figure on the dashboard has a written definition in `Architecture.md` and reconciles with `gate_events` | ✅ done |

**E1 / E2 notes:** the dashboard now loads from a single request (`backend/src/data/dashboard.js`,
`backend/src/routes/dashboard.routes.js`; 15 tests in `backend/tests/dashboard.test.js`). All
bucketing is done in JS over raw `gate_events` rows so the plant timezone is honoured and the code
stays portable to PostgreSQL. Verified 2026-10-17: `npm run typecheck` 0 errors, `npm run build` OK,
`npm test` **127/127**. In the same batch, the identity card moved from a CODE128 barcode to a **QR
carrying the same opaque credential id**, and `/register` was reworked (category tiles, register-and-
issue in one dialog, visitor **group passes**, a clearer 3-step CSV import).

**E3 — reports.** New `backend/src/data/reports.js` (`buildScanReport`) and
`backend/src/routes/reports.routes.js` (`GET /api/reports/scans?from=&to=`, access
`["administrator","security_staff"]`, `scanReportQuerySchema`). It reuses `listScanFacts` and the same
`scans === approved + rejected + unable` rule as the dashboard, so the two reconcile exactly. The
payload is **counts and reason codes only** — no name, phone, email, worker reference or purpose of
visit (asserted). Screen: `src/routes/_authenticated/reports.tsx` with a role-restricted date range,
charts and CSV/PDF export; `/reports` is entry 5 of `NAV_ITEMS` in `_authenticated.tsx`. 16 tests in
`backend/tests/reports.test.js`.

**E4 — figure definitions.** `Architecture.md` §17 now defines every number on both screens (the single
source, the reconciliation rule, why bucketing is done in JS, the dashboard figures, the report figures,
what the report deliberately omits, and which suite proves each). No code changed for E4.

**Exit criteria:** the dashboard loads in one request and every number can be traced back to a SQL
query over the append-only event tables. **Met.**

---

## Phase F — Public page and credential lifecycle ✅ COMPLETE (F2 skipped by decision)

| # | Task | State |
|---|---|---|
| F1 | Public `/check` page — card status only, no personal data; added exactly two entries to the asserted public-route allowlist (`POST /api/auth/signup`, `GET /api/check/:code`) | ✅ done |
| F2 | Expiry reminders: scheduler + `notification_log` + `notifications.tsx` | [!] **SKIPPED — PENDING DECISION** |
| F3 | Signup/login restored properly, replacing the temporary `POST /api/auth/local` | ✅ done |

**F1 — the public card check.** New `backend/src/data/public-check.js` (`lookupCardStatus`) and
`backend/src/routes/check.routes.js` (`GET /api/check/:code`, `PUBLIC`). It takes one opaque code and
returns `{valid, status, reasonCode, reasonText, kind, category, validTo}` — deliberately **no name, no
phone, no employee email, no worker reference, no photo**. The verdict is not invented here: it calls
`evaluateCredential`, the same pure rule the gate and the canteen use, so a card this page calls
unusable can never be approved at the gate (asserted by scanning the same code both ways). An unknown
code is an **answer** (`status: "not_found"`), not an error. Screen: `src/routes/check.tsx`.

**F3 — login + signup.** The whole temporary bypass was removed: `AUTH_AUTO_SIGNIN`, `config.autoSignIn`,
`AUTO_SIGNIN_PUBLIC_ROUTE`, `publicRouteAllowlist()` and `authApi.localSignIn()` no longer exist, and
`ensureLocalAdmin()` became `ensureFirstAdmin()`, which creates the first administrator **only while the
`users` table is empty**. Added:
`POST /api/auth/signup` (creates a **disabled** `security_staff` account — the caller cannot choose a
role and cannot sign in until approved), `PATCH /api/users/:id` (administrator-only enable/disable, with
no self-disable and no disabling the last active administrator), and a 12-char minimum password on
signup. Screens: `src/routes/login.tsx` and `src/routes/signup.tsx`; `auth-context.tsx` no longer
auto-signs-in and `src/routes/index.tsx` now sends an anonymous visitor to `/login` (showing
`<ServerUnreachable />` only for a genuine outage). 20 tests in `backend/tests/accounts.test.js` and
`backend/tests/check.test.js`.

**F2 is deliberately not built.** The user chose *"Skip F2 for now"*: the reminder interval, the
recipient source, the wording and whether ABB has an SMTP server are all unanswered, and none of them
can be invented. Credentials still expire correctly without it — reminders are a convenience, never the
control.

**Exit criteria (amended):** a holder can check their own card without signing in; a real login and an
approvable signup exist; expiry notices remain **not built** pending a decision.

---

## Phase G — Hardening and offline 🔄 in progress (G1–G3 done)

| # | Task | State |
|---|---|---|
| G1 | Backend tests for every new endpoint (canteen, incidents, announcements, watchlist, dashboard, audit, reports, signup, account approval, public card check) | ✅ done |
| G2 | Negative tests: a `security_staff` session is refused every administrator endpoint, and no row is written | ✅ done |
| G3 | `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` clean | ✅ done |
| G4 | Secret sweep (frontend, repository, logs, build output) and personal-data exposure review | 🚧 **partly** — the new public payload is covered by a leak test; the repository secret sweep is still outstanding |
| G5 | Offline scanning — **blocked** until the user approves an offline policy. Stale cached data must never yield APPROVED | [!] blocked |
| G6 | Deployment readiness: topology, backup/restore **tested**, HTTPS, DB file permissions | [!] pending decision |

**G1 / G2 / G3 evidence (2026-10-17).** `npm run typecheck` → 0 errors · `npx eslint .` → **0 errors**,
7 pre-existing `react-refresh/only-export-components` warnings left deliberately (they are in generated
shadcn files) · `npm run build` → exit 0 · `npm test` → **173 tests, 173 pass, 0 fail, 34 suites**. The
new suites prove: signup cannot create an administrator or an enabled account; a disabled account cannot
sign in and loses its sessions the moment it is disabled; `security_staff` cannot enable an account via
`PATCH /api/users/:id` **and the row is unchanged**; the public allowlist is exactly four routes; and
`GET /api/check/:code` leaks no personal field and agrees with the gate for both a good and a bad card.

**Exit criteria:** the test suite covers the real implementation, no secret is exposed, and a restore
has actually been demonstrated. *(First two largely met; the restore demonstration is G6 and is blocked
on the topology decision.)*

---

## Approval required before these actions

- Deleting or overwriting project files, or substantial user work
- Combining projects, or resetting/replacing a repository
- Destructive database commands, data deletion, or migrations against real data
- Changing access or security policy
- Redesigning the architecture or replacing the inherited stack
- Deploying, or modifying production data

---

## Task execution protocol

1. State the task, the expected outcome and the acceptance criteria.
2. List the exact files and database objects expected to change.
3. Identify risks and any approval needed.
4. Make only that change.
5. Run the relevant checks and report the **actual** result.
6. Update `tasks.md`, and `phases.md` when a phase moves; update `WORKLOG.md` and `NEXT-SESSION.md`.
7. Never mark a phase complete without evidence in `WORKLOG.md`.

---

## Current status

- **Phase A:** ✅ **complete and verified** — one root, one command, no Supabase anywhere.
- **Phase B:** ✅ **complete and verified** — B1–B8 all done in `register.tsx` (list, create, edit,
  credential lifecycle, printing, CSV import/export), and the credential round-trip was proven against
  the gate API.
- **Phase C:** ✅ **complete except C5/C6** — C1–C4, C7 and C8 all done. C5 (lockdown) and C6
  (override) remain **PENDING DECISION**.
- **Phase D:** ✅ **complete and verified** — D1–D7 all done: canteen (one entry per person per day,
  enforced by a DB index), the incidents screen with triage, announcements (backend + screen +
  dashboard banner), the watchlist (migration `0003` + screen + advisory gate alert), and the
  administrator audit viewer.
- **Phase E:** ✅ **complete and verified** — E1/E2 (the one-call dashboard summary + dashboard v2) and
  E3/E4 (the date-range scan report with CSV/PDF export, and the §17 figure definitions in
  `Architecture.md`).
- **Phase F:** ✅ **complete (F2 skipped by decision)** — F1 (the public `/check` card-status page,
  sharing the gate's `evaluateCredential` rule) and F3 (real login + signup + administrator account
  approval). F2 (expiry reminders) is **not built** — the user chose *"Skip F2 for now"*; credentials
  still expire correctly without it.
- **Phase G:** 🔄 **in progress** — G1, G2 and G3 are done (backend tests for every new endpoint,
  negative authorization tests, and a clean typecheck / eslint / build / **173 passing tests**). G4 is
  **partly** done. G5 (offline) and G6 (deployment) are **blocked on a decision**.
- **Backend:** healthy; `npm test` covers auth (login, signup, approval), people, credentials, the gate,
  compliance (canteen, incidents, announcements, watchlist, audit), settings, the dashboard, reports and
  the public card check — **173 tests, 173 pass, 0 fail, 34 suites**.
- **Running:** `npm start` serves the API **and** the built SPA from one process on `:4000`
  (`38 routes`, `servingFrontend: true`).
- **Blocking decisions:** lockdown/override policy (C5/C6), reminder schedule + SMTP (F2), deployment
  topology and DB location (G6), offline policy (G5).
