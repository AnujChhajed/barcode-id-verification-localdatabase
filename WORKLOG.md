# WORKLOG — ABB Plant 3 Security Gate Verification & ID Management System

Chronological record of what was actually done, with the exact commands run and their real results.
Newest entries at the bottom. Never record a success that was not verified.

Legend: **VERIFIED** = confirmed by running the command and reading the output. **UNVERIFIED** = not yet proven.

---

## 2026-10-16 — Session: seed the shell + establish the baseline

### Context

- Active project root: `Anuj ABB Id verification system\` (it now contains the shell plus the planning docs).
- Read `project info\HANDOVER-PROMPT.md` in full and the approved requirements document
  (`requirement pdf for friend.docx`) end to end. Phase 0 is now fully complete.
- Locked decisions (from the handover): SQLite behind a local backend (per the mentor), reuse the Sagar
  shell, replace the college domain with the ABB domain, keep the existing professional ABB red/white UI.
- User decisions recorded this session: canteen is a **separate app with its own DB**, but it must
  **never keep its own copy of people/credentials** — it verifies eligibility against the main backend
  (fail closed). Git init is **deferred** to project completion.

### Task 1 — Seed the baseline shell (**user approved**) — VERIFIED

Copied the Sagar checkout's application code into the new project root.

- Source: `..\Sagar Barcode id verfication Project\barcode-student-verification\` (commit `b655ebb`, read-only).
- Excluded: `.git`, `node_modules`, `dist`, `.env*`, and the college-only documents
  (`SRS_Barcode_Student_Verification_System.docx`, `ATC_Barcode_System_Data_Analysis.xlsx`,
  `PostgreSQL_vs_MySQL_Justification.pdf`).
- Command: `robocopy <src> <dst> /E /XD .git node_modules dist /XF .env ".env*" <college docs> ...`
- Result: **robocopy exit code 3** = success (files copied; destination already contained `project info/`
  and `abb-logo.png`, which robocopy reports as "extra").
- Follow-up: copied `abb-logo.png` into `public\abb-logo.png`, because `src/components/AbbLogo.tsx`
  references `/abb-logo.png`. Without this the logo would 404.

### Task 2 — Establish the baseline — VERIFIED

| Command | Result |
|---|---|
| `node -v` / `npm -v` | `v22.16.0` / `10.9.2` |
| `npm install` | **exit 0** — "added 588 packages, audited 589 packages in 10m". Warnings: `EBADENGINE` for `@zxing/library@0.23.0` (requires Node ≥ 24; we have 22.16) and `35 vulnerabilities (2 low, 6 moderate, 21 high, 6 critical)` |
| `npm run dev` | **VERIFIED running** — listened on port `8080`; `GET http://localhost:8080/` returned **HTTP 200** with SSR HTML (`<!DOCTYPE html>…`). Server stopped after the check. |
| `npm run build` | **✓ built in 1m 31s**, `dist/` produced. Process exit code was `1` **only** because the Trae sandbox blocked wrangler from writing its log to `%APPDATA%\xdg.config\.wrangler\logs\`. The build itself succeeded. |
| `npm run lint` (before fix) | **FAIL** — 16238 problems (16227 errors, 11 warnings); 16103 auto-fixable |
| `npm run lint` (after fix) | **FAIL** — 135 problems (124 errors, 11 warnings) |

### Fix applied — normalise line endings (user approved "do what is best")

Every file in the source checkout uses **CRLF**; `.prettierrc` implies `endOfLine: "lf"`, so prettier
flagged `Delete ␍` on nearly every line. Verified this is **pre-existing** (the Sagar source is CRLF too:
`vite.config.ts` = 30 CRLF / 0 LF), not caused by the copy.

- Added `project info` to `.prettierignore` so the planning documents are not reformatted.
- Ran `npm run format` (`prettier --write .`). Prettier exited `2` solely because
  `take_screenshots.cjs` is **UTF-16 encoded** (first bytes `00 00 00 00`) and cannot be parsed as UTF-8.
- After the run, `npm run lint` dropped from 16238 → 135 problems, confirming the CRLF noise is gone.

### Pre-existing issues — NOT introduced by this session

1. `take_screenshots.cjs` is UTF-16 and unparseable → the one remaining eslint "Parsing error" and the
   cause of prettier's exit code 2. It is a dev-only screenshot helper, not part of the app.
2. `35 vulnerabilities` reported by `npm audit` (2 low, 6 moderate, 21 high, 6 critical).
3. `@zxing/library@0.23.0` declares `node >= 24`; we run Node 22.16.
4. Remaining lint errors are shell code-quality issues: mostly `@typescript-eslint/no-explicit-any`,
   `no-empty` blocks in `src/lib/idcard.ts`, and `react-refresh/only-export-components` warnings.

### Notes / risks

- Empty leftover directories `backend\` and `frontend\` exist in the project root (created 2026-10-15,
  before this session, by the abandoned generic plan). They are empty. The backend will live in `server/`
  per the locked plan, so these two are junk — **awaiting permission to delete**.
- Files copied: the full `src/` shell, `supabase/` (to be replaced later), configs, `package.json`, etc.
- The Supabase integration (`src/integrations/supabase/*`, `src/lib/auth-context.tsx`) is present but is
  **not** part of the target architecture; it will be redirected to the local backend API.

### Next recommended task

Phase 2 — design the ABB Plant 3 schema (portable SQL migrations) and the role/permission matrix, and
present both for approval **before** any database is created.

---

## 2026-10-16 — Session: schema, backend foundation, and people/credential management

### Context

The user delegated the remaining design decisions ("You decide, just build"), so Phases 2, 3 and the
backend half of Phase 4 were built and verified in sequence. No production data was created; the only
database file on disk is the development one at `backend\data\abb-plant3.db`.

**Architecture change that must be recorded:** the backend was built in `backend\` (not `server\`), because
the user had already created the `frontend\` / `backend\` folder split for organisation. The frontend shell
itself still lives in the project root (`src\`, `public\`); there is no separate `frontend\` folder.

### Task 1 — Phase 2: schema and permission matrix — VERIFIED

- `backend\migrations\0001_init.sql` — 14 tables, 19 indexes, portable conventions documented at the top
  (opaque TEXT ids, ISO-8601 UTC timestamps, `YYYY-MM-DD` date-only validity, INTEGER 0/1 booleans, no
  triggers, no SQLite-only syntax). `gate_events` and `canteen_events` are append-only by convention and
  the data-access layer never issues UPDATE/DELETE against them.
- `backend\migrations\0002_seed_plant3.sql` — seeds exactly one plant (`plant-p3` / `P3`), one gate
  (`gate-p3-main` / "Plant 3 - Main Gate") and 5 settings. **No user rows** are seeded.
- `project info\PERMISSION-MATRIX.md` — 2 roles, a 30-row action matrix, the endpoint list, and 7
  non-negotiable enforcement rules. Two rows remain marked `*` pending ABB confirmation.
- Approval granted by the user the same day.

### Task 2 — Phase 3: backend foundation — VERIFIED

Built `backend\` — Express 5, ESM, Node ≥ 22, `better-sqlite3`, `zod`, `cookie-parser`.

- `src\config.js`, `src\app.js`, `src\server.js` (graceful SIGINT/SIGTERM shutdown), `scripts\migrate.js`,
  `scripts\bootstrap-admin.js` (refuses to run if an administrator already exists; never logs the password),
  `.env.example`, `.gitignore`.
- `src\auth\` — scrypt password hashing (`src\auth\password.js`), server-side sessions storing only a
  SHA-256 hash of the token (`src\auth\sessions.js`), a fixed-window login rate limiter
  (`src\auth\rate-limit.js`), and the central authorization middleware (`src\auth\middleware.js`).
- `src\http\route.js` — declarative route registration. A route **cannot be registered** without a valid
  `PUBLIC` / `AUTHENTICATED` / `[roles]` access declaration, and the authorization middleware is always the
  first guard. `src\app.js` additionally asserts the public surface against an explicit two-entry allowlist
  and refuses to boot if it widens.
- `src\lib\` — `errors.js` (AppError + one consistent error shape), `audit.js` (business audit trail),
  `logger.js` (JSON-lines diagnostics with secret redaction), `ids.js`, `time.js`.
- `src\db\` — WAL, `foreign_keys = ON`, `busy_timeout`, `synchronous = NORMAL`, `trusted_schema = OFF`, and
  a forward-only migration runner recorded in `schema_migrations`.

Verification (run in that session):

| Command | Result |
|---|---|
| `npm install` | “added 70 packages … found 0 vulnerabilities” |
| `npm run migrate` (first run) | `discovered: 2 / pending: 2 / 2 applied, 0 already current` |
| `npm run migrate` (second run) | `discovered: 2 / pending: 0 / 0 applied, 2 already current` |
| `npm test` | `# tests 19 / # suites 5 / # pass 19 / # fail 0` |
| `npm start` + probes | `GET /api/health` → 200; `GET /api/users` → 401 `UNAUTHORIZED`; `GET /api/nope` → 404 `NOT_FOUND`; `POST /api/auth/login {}` → 400 with per-field details |
| `npm run bootstrap-admin` (throwaway temp DB) | first run created the administrator; second run refused |

Two bugs were found and fixed while building: `node --test tests` fails on Node 22 (a bare directory is not
accepted) → changed to `node --test`; and `scripts\migrate.js` imported `../config.js` instead of
`../src/config.js`. `zod` was re-installed at `^3.24.2` so the schemas stay shareable with the frontend,
which is on v3.

### Task 3 — Phase 4: people and credential management (backend) — VERIFIED

New files: `src\data\people.js`, `src\data\credentials.js`, `src\data\settings.js`,
`src\domain\credential-validity.js`, `src\routes\people.routes.js`, `src\routes\credentials.routes.js`,
`tests\people.test.js`, `tests\credentials.test.js`.
Edited: `src\validation\schemas.js`, `src\http\route.js` (path-parameter validation), `src\app.js`.

Endpoints (all administrator-only except the search):

| Endpoint | Access |
|---|---|
| `GET /api/people/search` | administrator, security_staff — identification fields only |
| `GET /api/people` | administrator — register with filters and a total |
| `POST /api/people` | administrator |
| `GET /api/people/:id` | administrator — profile plus derived credential validity |
| `PATCH /api/people/:id` | administrator |
| `POST /api/people/:id/status` | administrator — suspend / terminate / reactivate, reason required |
| `GET /api/people/:id/credentials` | administrator |
| `POST /api/credentials` | administrator — issue |
| `POST /api/credentials/:id/validity` | administrator — renew / extend, reason required |
| `POST /api/credentials/:id/status` | administrator — suspend / terminate / reactivate, reason required |

Design points that matter:

- `src\domain\credential-validity.js` is a pure function with **no** database, clock or request access.
  It is the single place that answers "may this credential be used today?", and it fails closed: a missing
  credential, an unreadable date, an unknown status or a malformed timestamp all return
  `valid: false` with a stable reason code (`not_found`, `indeterminate`, `not_yet_valid`, `expired`,
  `suspended`, `terminated`, `person_suspended`, `person_terminated`). The holder's status is checked
  before the credential's own, so suspending a person takes effect immediately.
- `valid_to` is inclusive — the credential is valid **through** that calendar day, matching the user's
  answer of "end of that calendar day".
- Per-category required fields are validated twice: on create, and again after a PATCH is merged onto the
  stored record, because a category change can invalidate a record that was previously complete. The
  database CHECK constraints in `0001_init.sql` are the backstop.
- Every credential lifecycle action writes `audit_log` with the actor, before/after values and the stated
  reason. Credentials are never deleted.
- Personal photo paths are never disclosed: the API returns `hasPhoto` only.

Verification (this session):

| Command | Result |
|---|---|
| `npm test` | `# tests 66 / # suites 14 / # pass 66 / # fail 0` (was 19 tests / 5 suites; +47 tests) |
| `npm run migrate` | `discovered: 2 / pending: 0 / 0 applied, 2 already current` (still idempotent) |

The 47 new tests cover: anonymous 401s on every new endpoint; **security staff denied** listing the
register, reading a profile, creating, editing, suspending and every credential action — with assertions
that no row was written and no row was read; security staff *allowed* the search, which is proven to omit
phone, email and visit details; missing per-category fields; unknown categories and unknown fields; bad
phone numbers and emails; duplicate name+category+phone; duplicate `worker_ref`; invalid and impossible
dates; a reversed validity window; unknown person and unknown credential 404s; issuing; the one-live-
credential-per-kind rule; a credential for a suspended person; renewing a terminated credential being
refused; suspend making a credential invalid immediately; reactivation; expired and not-yet-valid
credentials; terminating the holder invalidating their credential; and direct unit tests of the
fail-closed validity rule (including malformed inputs and the inclusive end date).

### Open items carried forward

1. **Deployment topology** — one laptop, or one server the gate laptops reach over the network? The user
   is confirming with the mentor. Blocks Phase 11. Never a shared network folder.
2. Two `*`-marked rows in `PERMISSION-MATRIX.md` (exact security-staff read scope for incidents, reports
   and settings) still need ABB confirmation.
3. `scan.duplicate_window_seconds` is provisional (5 s).
4. "One live credential per kind per person" is enforced in application code, not by a partial unique
   index. A `ux_credentials_one_active_per_kind` index would make it database-enforced; that is a change
   to the approved schema, so it needs approval first.
5. The frontend still talks to Supabase (`src\integrations\supabase\*`, `src\lib\auth-context.tsx`) and
   must be redirected to this backend.
6. The ID-card / visitor-pass components and their print/PDF output are not adapted yet (the remaining
   half of Phase 4).
7. Pre-existing and unchanged: the UTF-16 `take_screenshots.cjs`, 35 npm audit vulnerabilities, and
   `@zxing/library@0.23.0` declaring Node ≥ 24 while we run 22.16.

### Next recommended task

Finish Phase 4 by adapting the ID-card / visitor-pass frontend to these endpoints, or start Phase 5
(`POST /api/gate/verify`) on the backend — `credential-validity.js` already implements the decision rule it
needs.

---

## 2026-10-16 — Session: Phase 5, gate verification and event tracking (backend) — VERIFIED

### Context

- Continued directly from the previous entry: Phase 5 was the natural next step because the decision rule
  (`backend\src\domain\credential-validity.js`) and the append-only `gate_events` table already existed but
  nothing called them.
- No new migration was needed: `gate_events`, its three indexes and the partial unique index
  `ux_gate_events_dedup` were already created by `0001_init.sql`.

### Task 1 — Gate verification, scan recording and the inside list — VERIFIED

**New file `backend\src\data\gate-events.js`** — all SQL for `gate_events`, deliberately with no UPDATE and
no DELETE (the table is append-only). Exports `toGateEventView`, `insertGateEvent`,
`findRecentApprovedScan` (the duplicate window), `listGateEvents`, `countGateEvents` and
`listInsidePeople`. The inside query uses a `ROW_NUMBER()` window statement rather than a correlated
sub-select so it stays portable to PostgreSQL.

**New file `backend\src\routes\gate.routes.js`** — three routes, each with an explicit access declaration:

| Route | Access | Purpose |
|---|---|---|
| `POST /api/gate/verify` | administrator, security_staff | run the authoritative check and record the scan |
| `GET /api/gate/events` | administrator, security_staff | read the append-only history, with filters |
| `GET /api/inside` | administrator, security_staff | who is currently on site, and which entries were never closed |

How the scan works: the code is looked up in `credentials`, the holder's **current** `people.status` is read
on every scan, and `evaluateCredential()` decides against today's Plant-3 date. Nothing is cached and no
client value influences the verdict. The gate is resolved from the seeded row (`P3-MAIN`) rather than
accepted from the request, and the timestamp comes from the server clock.

**Outcome mapping (new, in `credential-validity.js`)** — `gateResultFor()` is the only place that turns a
verdict into what the gate displays:

- `valid` → **APPROVED**
- `not_found`, `expired`, `not_yet_valid`, `suspended`, `terminated`, `person_suspended`,
  `person_terminated` → **REJECTED** (the check ran and the answer is "no")
- `indeterminate` → **UNABLE TO VERIFY** (the check could not be carried out)

This distinction is deliberate: an unknown barcode is a completed check whose answer is "no", so it is a
rejection; only a check that could not run is "unable to verify". `not_found` is listed as an example
`reason_code` alongside `expired` and `suspended` in the schema, which is consistent with that reading.
Both outcomes deny entry, so the fail-closed property is unaffected.

**Fail closed, twice over.** (a) If the authoritative lookup throws, the verdict becomes `indeterminate` →
UNABLE TO VERIFY. (b) If an approval cannot be **written** to `gate_events`, it is downgraded to UNABLE TO
VERIFY, because telling a guard "APPROVED" for an entry that was never recorded would defeat the entire
point of the audit trail. The response reports the truth via `recorded`.

**Duplicate and concurrency handling.** A repeated approval of the same credential, gate and direction
inside `scan.duplicate_window_seconds` (provisional 5 s, read from `settings`) is collapsed onto the row
that already exists and returned as `duplicate: true`. The duplicate check and the insert run inside a
single `db.transaction`, and the partial unique index `ux_gate_events_dedup` remains the database-level
backstop.

**Two supporting changes:**

- `backend\src\data\settings.js` gained `mainGateId()` (resolves `P3-MAIN`, throws if missing) and
  `readIntegerSetting()` (a bad setting value cannot widen the duplicate window).
- `backend\src\lib\time.js`: `toIso()` no longer strips milliseconds. This was a **real bug found by a
  failing test**, not a cosmetic change — see below.

### Bug found and fixed — same-second events ordered arbitrarily

The first test run failed on one assertion: after scanning an entry and then an exit, the person was still
listed as inside. Cause: `toIso()` truncated timestamps to whole seconds, so the entry and the exit were
written with **identical** `occurred_at` **and** `created_at`, and `ORDER BY occurred_at DESC, created_at
DESC` then had nothing left to break the tie. "Who is on site" was therefore non-deterministic for any two
scans in the same second. Fixed by keeping fixed-width milliseconds, which makes string order identical to
chronological order everywhere. Only one place stripped them (`toIso`), and every other comparison in the
codebase already used `Date.parse`, so the change is contained.

### Task 2 — Tests — VERIFIED

New file `backend\tests\gate.test.js` (26 tests) booting the real Express app against a migrated temporary
database. Coverage: anonymous 401s on all three routes; security staff allowed to scan, read and see the
inside list; missing/blank code; unknown direction; an extra `result` field supplied by the client being
refused; approved scan with the event row verified column by column; the gate response proven to carry
identification only (no phone, email or visit details); unknown code; expired; not-yet-valid; suspended
card; terminated card; suspended holder; terminated holder; a credential with an unreadable stored date;
repeated scan collapsing; the opposite direction not collapsing; a 6-way concurrent burst producing exactly
one row; the duplicate window boundary exercised through the real data function; rejected scans never
collapsing into an approval; both forced backend failures (lookup and insert) returning UNABLE TO VERIFY
with no approved row written; history filtering; and the inside list, including an entry from a previous
plant day reported with `missingExit: true`.

| Command | Result |
|---|---|
| `npm test` | **`# tests 92 / # suites 20 / # pass 92 / # fail 0`** (was 66 tests / 14 suites; +26 tests) |
| `npm run migrate` | `discovered: 2 / pending: 0 / 0 applied, 2 already current` (still idempotent) |

### Deliberately deferred (recorded, not silently dropped)

- `POST /api/gate/events` for offline/queued scans → **Phase 9**. Until offline mode exists it serves no
  scenario that `POST /api/gate/verify` does not already cover, and a client-supplied timestamp path would
  widen the attack surface for no benefit.
- `POST /api/gate/events/:id/correction` → **Phase 8**. `gate_events` has no `correction_of` column, so the
  endpoint needs a schema migration plus an admin tool; that belongs with the audit/reporting work.
- The frontend gate screen is not built (it needs the frontend redirected off Supabase first).

### Open items carried forward

1. **Deployment topology** — one laptop, or one server the gate laptops reach over the network? The user
   is confirming with the mentor. Blocks Phase 11.
2. Two `*`-marked rows in `PERMISSION-MATRIX.md` still need ABB confirmation.
3. `scan.duplicate_window_seconds` is provisional (5 s).
4. Whether an approved scan should auto-decide entry vs exit, or the operator states it. Currently the
   operator/kiosk must state `direction`, with no default, because guessing would invent a business rule.
5. "One live credential per kind per person" is enforced in application code, not by a partial unique
   index — changing that alters the approved schema, so it needs approval first.
6. The frontend still talks to Supabase and must be redirected to this backend. There is still **no CORS**
   on the backend.
7. The ID-card / visitor-pass components and their print/PDF output are not adapted yet (Phase 4's
   remaining half).
8. Pre-existing and unchanged: the UTF-16 `take_screenshots.cjs`, 35 npm audit vulnerabilities, and
   `@zxing/library@0.23.0` declaring Node ≥ 24 while we run 22.16.

### Next recommended task

Adapt the frontend to this backend — first the Supabase redirect (CORS + `credentials: "include"`), then the
ID-card / visitor-pass components and the gate screen. The backend now has the API the gate screen needs.

---

## 2026-10-17 — Session: one root, one command, and the treatment plan

### Context — the user's requests this session

1. Fix the many problems in the system and in login.
2. One root only — stop running the frontend and the backend separately.
3. Remove the separate command used to create the admin.
4. Either build a simple login/signup, or remove login for now and add it later.
5. Analyse the whole system; build a proper SQLite database, a proper frontend and a proper backend.
6. Build a professional system with real feature/design/dashboard advancement.
7. Maintain `tasks.md`, `phases.md`, `memory.md` and the other `project info` documents continuously.
8. Remove the unwanted files.
9. **New this session:** the folder `barcode-student-verification-system-add-srs-document` is the user's
   own earlier college system, supplied as a **feature and dashboard reference only**. Do not copy its
   code; use it to decide which features and what kind of dashboard the ABB system should have.

### Decisions taken (with the user)

| Question | Answer |
|---|---|
| Login/signup now, or later? | **Remove login for now**; add it later. |
| Which dead files to delete? | **All the listed ones** — `dist\`, `.wrangler\`, `take_screenshots.cjs`, `src\integrations\supabase\*`, the college `README.md`, `backend\package*.json`. |
| Language support? | **English only** — the Swahili pack and the language switcher were removed. |

### Task 1 — Collapse two roots into one — VERIFIED (configuration)

The project previously ran as two projects: the frontend at the root and a second npm project inside
`backend\`, each with its own `package.json`, needing two installs and two commands. That split is gone.

| File | Change |
|---|---|
| `package.json` | Single root manifest. The backend dependencies (`express`, `better-sqlite3`, `zod`, `cookie-parser`) were merged in; `concurrently` was added; `@supabase/supabase-js`, `@tanstack/react-start`, `@cloudflare/vite-plugin`, `@lovable.dev/vite-tanstack-config` and `@zxing/*` were removed. `@radix-ui/react-navigation-menu` was pinned to `^1.2.14` to match what is installed. |
| `vite.config.ts` | Rewritten as a plain Vite config: `tanstackRouter`, `react`, `tailwindcss`, `tsConfigPaths`; dev server on `:8080` proxying `/api` → `http://127.0.0.1:4000`; build output `dist\`. |
| `backend\src\config.js` | Now derives `projectRoot` and `staticDir` (`dist\`), and adds `autoSignIn` and `localAdmin`. |
| `backend\src\app.js` | Replaced the hard-coded public-route allowlist with a computed one, added `mountSpa()` (static `dist\` + SPA fallback that skips `/api`) and exported `spaBuildExists()`. |
| `backend\src\server.js` | Ensures the local admin, decides whether to serve the built SPA, and logs `url` / `servingFrontend` / `loginDisabled`. |
| `index.html`, `src\main.tsx`, `src\router.tsx`, `src\routes\__root.tsx` | Replaced the TanStack-Start SSR entry with a plain SPA entry; page metadata moved into `index.html`; `HeadContent`/`Scripts`/`shellComponent` removed. |

**Deleted this session (all approved by the user):** `src\start.ts`, `src\server.ts`,
`src\lib\error-page.ts`, `src\lib\error-capture.ts`, `src\integrations\supabase\client.ts`,
`src\components\LanguageSwitcher.tsx`, `src\locales\sw.json`, `src\routes\login.tsx`,
`take_screenshots.cjs`, `wrangler.jsonc`, `bun.lock`, `README.md`, `backend\scripts\bootstrap-admin.js`,
`backend\package.json`, `backend\package-lock.json`, and the directories `dist\`, `.wrangler\`,
`src\integrations\`.

**Result:** `npm run dev` now starts both processes from one root; `npm run build && npm start` will
serve the API and the UI from a single Node process on `:4000`, so no CORS is needed at all (the earlier
CORS blocker in this log is therefore obsolete).

### Task 2 — Remove login for now — VERIFIED (code), behaviour not yet smoke-tested

- `AUTH_AUTO_SIGNIN` (default `true`) drives `config.autoSignIn`.
- `backend\src\auth\local-account.js` — `ensureLocalAdmin(db)` inserts one administrator only if absent and
  never overwrites an existing row.
- `POST /api/auth/local` is registered as a public route **only when** `autoSignIn` is on, so the widening
  of the public surface is explicit and one flag reverts it.
- The browser calls it automatically on load (`src\lib\auth-context.tsx`), and `ServerUnreachable`
  replaces the old `/login` redirect when the API cannot be reached.

### Task 3 — Rewrite the planning documents — DONE

`project info\phases.md` and `project info\tasks.md` were rewritten around the real state and the new
roadmap (Phases A–G), including a screen-by-screen mapping of the reference project onto the ABB system.
`project info\memory.md` was corrected: it no longer claims the root has no application code, and it now
records the single-root layout, the real command list, the removed dependencies and the reference
project's role.

### Still open at the end of this session

1. **`src\routes\_authenticated\verify.tsx` is the one screen still importing the deleted Supabase
   client**, so it currently breaks the build. Rewriting it onto `/api/gate/*` is in progress (Phase A9).
2. `src\lib\idcard.ts` and `src\lib\offline.ts` are still college-shaped (Phase A10/A11).
3. `npm run typecheck` / `npm run build` / `npm start` / `npm test` have not yet been re-run after the
   merge and must be recorded before Phase A is called done (Phase A13).
4. The reference folder and its `.zip` sit inside the project root and must be excluded from lint/build.
5. All Phase B–G work is not started. See `phases.md`.

---

## 2026-10-17 — Session: close out Phase A (Supabase-free frontend, verified build)

### Context

Continuing Phase A. Goal: finish **A9–A13** so no screen touches Supabase and the whole system builds,
runs and tests green. On entry, `verify.tsx` had already been rewritten but the locale file was still
college-shaped, and `verify.tsx`, `inside.tsx`, `logs.tsx` and `dashboard.tsx` referenced locale keys
that no longer existed (they rendered raw key strings).

### Task A9 — `verify.tsx` rewritten onto the ABB API — VERIFIED

- `src\routes\_authenticated\verify.tsx` no longer imports `@/integrations/supabase/client` or `@/lib/offline`.
- Every scan goes through `gateApi.verify(code, direction)`; the inside count and the liveness probe use
  `gateApi.inside()`; Manual Lookup uses `peopleApi.search()`.
- Three verdicts render distinctly: **APPROVED** (green), **REJECTED** (red), **UNABLE TO VERIFY** (amber).
  A failed request itself produces UNABLE TO VERIFY with `reasonCode = "server_unreachable"` — it can
  never look like a pass.
- A case-insensitive search for `supabase` across `src\` returns **no matches**.

### Task i18n — locale repaired — VERIFIED

- `src\locales\en.json`: the whole `verify.*` block was rewritten for the ABB gate screen
  (`result_approved` / `result_rejected` / `result_unable`, holder, worker ref, contractor, institution,
  valid until, category and status labels, kiosk, direction, server health, shift counters).
- Repaired the broken keys: `inside.*` (`stat_workers`, `stat_interns`, `missing_exit`,
  `missing_exit_count`, `missing_exit_hint`, `since_at`, `minutes_ago`, `hours_ago`, `filtered_count`,
  `total_count`, `cat_*`, `type_*`, `sort_since_*`), `logs.result_all|result_approved|result_rejected|result_unable|records_of_total|col_result|col_person|col_category`,
  `dash.chart_capped|series_scans`, and `common.active_people`.
- Cross-checked with a throwaway script (written outside the project, then deleted) that flattens
  `en.json` and scans every `t("…")` literal in `src\`. **Result: 895 keys defined, 231 used, 0 missing.**

### Task A10 — `src\lib\idcard.ts` rewritten for ABB — VERIFIED (typecheck)

- `IdCardStudent` (college fields) replaced with `IdCardData` (`credentialId`, `kind`, `fullName`,
  `category`, `workerRef`, `contractorCompany`, `institutionName`, `validFrom`, `validTo`, `photoDataUrl`).
- The barcode payload is the **opaque credential id** (CODE128) — no personal data is encoded.
- Branding is ABB Plant 3; the header bar uses ABB red `#ed1c24`. Exports `generateIdCardPDF`,
  `downloadIdCard`, `downloadBulkIdCards`, `generateGatePassPDF`, `printGatePass`, `downloadGatePass`,
  `qrDataUrl`.
- No screen consumes it yet — it is wired up in Phase B6.

### Task A11 — dead college offline cache removed — VERIFIED

- Deleted `src\lib\offline.ts` (unreferenced after A9). Removed the now-unused `idb` dependency from
  `package.json`; no file under `src\` imports `idb`.

### Task A12 — active credential exposed to gate-staff search — VERIFIED

- `GET /api/people/search` returns `activeCredentialId` so Manual Lookup can hand a code to
  `/api/gate/verify`. `backend\tests\people.test.js` still asserts that no phone, email or visit detail
  is added to that response. **99/99 tests pass.**

### Task A13 — prove it runs — VERIFIED

Commands run from the project root, with their actual results:

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — **0 errors** |
| `npm run build` | exit 0 — `✓ built in 1m 54s`; `dist\` produced (`dist\index.html` 1.99 kB + `dist\assets\*`) |
| `npm test` | exit 0 — **99 tests, 99 pass, 0 fail**, 23 suites, 8.6 s |
| `npm start` | server up; `GET /api/health` → **200** `{"status":"ok","database":"ready","time":"…"}`; `GET /` → **200**, 1992 bytes, references the built SPA assets — **one process serves the API and the UI** |

### Fix applied — `npm test` script

`node --test backend/tests/` fails on Windows: Node tries to `require` that path as a module and throws
`MODULE_NOT_FOUND`. Changed the script to `node --test "backend/tests/**/*.test.js"`, which runs all six
test files correctly.

### Phase A is complete

One root, one `npm install`, one `npm run dev`, one `npm start`; no Supabase anywhere; the gate screen
verifies through the local SQLite backend and fails closed; the build, the type check and the backend
suite are all green.

### Next recommended task

**Phase B1 — `src\routes\_authenticated\register.tsx`.** Until people and credentials can be created in
the UI, the gate screen has nothing to verify. Add its nav entry to `_authenticated.tsx` at the same time.

---

## 2026-10-17 — Session: Phase B1 — People & Credentials screen — VERIFIED

### What was built

- **New:** `src\routes\_authenticated\register.tsx` (≈1,100 lines) — the People & Credentials admin
  screen. It is the first UI that can put a person and a credential into the database, so the gate
  screen finally has something to verify.
  - list of people with a debounced search box, category filter (worker/intern/visitor), status filter
    (active/suspended/terminated) and limit/offset pagination (`peopleApi.list`);
  - create-person dialog with **per-category required fields only** — worker→`workerRef` +
    `contractorCompany`, intern→`institutionName`, visitor→`purposeOfVisit` + `personToMeet`; the
    backend's `details[]` array is rendered inline on the matching field;
  - person detail panel — profile, credential table with the computed `isValid` / `reasonCode` /
    `reasonText`, and a status-change block that requires a reason of ≥ 3 characters;
  - issue credential (`id_card` / `gate_pass`), renew validity, suspend / terminate / reactivate — all
    through `credentialsApi`, all with a reason;
  - print / download the ID card and gate pass (single) plus **bulk ID-card download** for the selected
    rows, using the already-rewritten `src\lib\idcard.ts`;
  - CSV export of the selected rows or the current page;
  - **administrator-only** — a `security_staff` visitor is redirected to `/verify`, mirroring the API's
    403.
- **Modified:** `src\routes\_authenticated.tsx` — added the `Users` icon import and the nav item
  `{ to: "/register", labelKey: "nav.register", icon: Users, adminOnly: true }`.
- **Modified:** `src\locales\en.json` — added `nav.register` and a 90-key `reg` block.
- **Modified:** `project info\Architecture.md` §4 — corrected the stale `src\integrations\supabase\`
  tree entry (the folder and the `@supabase/*` dependencies are gone) and listed the live
  `_authenticated` screens.

### Verification

| Command | Result |
|---|---|
| i18n checker (throwaway, `%TEMP%`) | **985 keys defined · 320 used · 0 missing** |
| `npm run typecheck` | exit 0 — **0 errors** (one TS2352 fixed: index-assignment loop replaced with conditional spreads) |
| `npm run build` | exit 0 — `✓ built in 1m 10s`; `dist\assets\register-De9CZntc.js 125.88 kB │ gzip: 33.88 kB` (own chunk — the new screen does not bloat the initial bundle) |
| `npm test` | exit 0 — **99 tests, 99 pass, 0 fail** |

### End-to-end smoke test of the new API surfaces — VERIFIED

Run against an **isolated throwaway database** (`DB_PATH=%TEMP%\abb-smoke\smoke.db`, freshly migrated);
`backend\data\abb-plant3.db` was never touched. **14/14 passed:**

`POST /api/auth/local` → 200 admin session · `GET /api/health` → 200 ·
`POST /api/people` worker → 201 · duplicate `workerRef` → 409 · intern missing `institutionName` → 400
with `error.details:[{path:"institutionName",message:"Required."}]` · visitor → 201 ·
`POST /api/credentials` `id_card` → 201 · duplicate live kind → 409 · `/status` suspend → 200 ·
`GET /api/people/:id` → 200 person + 1 credential · `GET /api/people` → `{people,total:2,limit,offset}` ·
`GET /api/people/search` → `{people:[…]}` · `gate_pass` → 201.

This also confirmed the two response shapes the frontend depends on are correct: `ApiError` reads
`body.error.details` (`src\lib\api.ts`), and `peopleApi.search` reads `{ people }`.

### Then deleted

`%TEMP%\abb-smoke\` (script + DB) removed; no throwaway file was written into the project.

### Next recommended task

**Phase B3 (edit an existing person) + B6 (barcode round-trip) + B7 (bulk CSV import).** B1, B2, B4, B5
and B8 are done; B3's status-change half is done but a full person **edit** (PATCH) is not; B7 (bulk CSV
import with a per-row error report) is not started.

---

## 2026-10-17 — Session: Phase B finished — B3, B6, B7 — ALL VERIFIED

### What was built (all in `src\routes\_authenticated\register.tsx`)

- **B3 — edit an existing person.** A new `EditPersonDialog`, opened from an **Edit details** button in
  the person detail dialog. It PATCHes via `peopleApi.update`, sending **only the fields that actually
  changed and never an empty string** (the API rejects `""` where a value is expected and cannot clear a
  stored field). Changing the category re-renders the per-category required fields; the backend's
  `details[]` (it re-runs `missingCategoryFields()` after the merge) is shown inline, exactly as in the
  create form. An unchanged form reports "Nothing changed" instead of sending an empty PATCH.
- **B7 — bulk CSV import.** A new `ImportCsvDialog` in the page toolbar: download a blank template,
  choose a CSV, then import. Each row is parsed with header **aliasing** (`category`/`type`,
  `full_name`/`name`, `worker_ref`/`ref`, …), validated client-side against the same per-category rules
  as the API, then created one at a time. A summary reports how many rows imported and lists **every
  failed row with its line number and reason**; nothing is silently dropped. Blank rows are skipped.
- Both are administrator-only, like the rest of the screen. 26 new `reg.*` locale keys added.

### Verification (2026-10-17)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — **0 errors** |
| `npm test` | exit 0 — **99 tests, 99 pass, 0 fail** (the `people — updates` suite already exercises PATCH, incl. category change and empty change-set rejection) |
| `npm run build` | exit 0 — `✓ built in 48.37s`; `dist\assets\register-DNuqZpb7.js 136.48 kB │ gzip: 36.21 kB` |
| **B6 barcode round-trip smoke test** | **6/6 passed** on an isolated throwaway DB — create worker → issue `id_card` → `POST /api/gate/verify` with the credential id returned **approved** for entry **and** exit, and an unknown code returned **rejected** (fails closed). The real DB was never touched; the temp DB and script were deleted afterwards. |

**B6 conclusion:** the value a card barcode encodes is the credential id, and the gate accepts exactly
that value — so a scanned card resolves back to its credential.

**Phase B is complete (B1–B8). The next phase is C — gate operations.**

### Also updated

`project info\Architecture.md` §4 (stale `integrations/supabase/` entry removed),
`project info\HANDOVER-PROMPT.md` (rewritten as a current-state resume prompt),
`project info\tasks.md` (feature checklist + Phase B complete), `project info\phases.md`, `NEXT-SESSION.md`.

---

## 2026-10-17 — Session: Phase C — gate operations (C4, C7, C8) — ALL VERIFIED

### What was built

- **C4 — kiosk mode (confirmed).** `verify.tsx` already carried the kiosk shell. Verified that it
  requests full screen, hides the mode switcher / recent list / header toolbar while on, and that the
  verdict panel closes itself (5 s on APPROVED, 12 s otherwise) and refocuses the scanner input. No
  change was needed.
- **C7 — visitor walk-in.** A **Visitor walk-in** button on the gate header (administrator only,
  because it writes personal data) opens `WalkInDialog`. One submit does three things in order:
  `POST /api/people` (category `visitor`, with the category's required fields) → `POST /api/credentials`
  (kind `gate_pass`, valid **today only**, using the plant date) → `POST /api/gate/verify` with the new
  credential for an **entry**. The verdict is then shown in the normal result overlay, so the pass the
  guard just created is the pass the server checks. `verify()` gained an optional direction override so
  the walk-in always records an entry rather than inheriting the toggle. **No new backend route.**
- **C8 — report an incident.** A **Report incident** button on the gate header (gate roles) opens
  `IncidentDialog`: severity (low/medium/high/critical), a title and optional details, plus an optional
  link to the person from the last scan. New backend: `backend\src\data\incidents.js`,
  `backend\src\routes\incidents.routes.js` (`POST /api/incidents`, access `GATE_ROLES`) and
  `createIncidentSchema`. The report is dated by the server, filed against the Plant 3 main gate and the
  signed-in operator, and written to `audit_log` as `incident.create`. **No new migration** — the
  `incidents` table already existed in `0001_init.sql`.
- 26 new `verify.*` locale keys added.

### Verification (2026-10-17)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — **0 errors** |
| `npm test` | exit 0 — **99 tests, 99 pass, 0 fail** |
| `npm run build` | exit 0 — `✓ built in 5m 35s`; `dist\assets\verify-CP4clejz.js 194.80 kB │ gzip: 54.70 kB` |
| **Gate-operations smoke test** | **11/11 passed** on an isolated throwaway DB |

The 11/11 smoke test proved, against the real app (not a mock):

- local sign-in returns a session cookie;
- `POST /api/incidents` → **201**, the row is `open` and carries a `gateId`;
- a bad severity → **400**; a title under 3 characters → **400** with `error.details[]`; an unknown
  `personId` → **400**;
- no session → **401**;
- exactly one `incident.create` row landed in `audit_log`;
- the **C7 walk-in chain** works end to end: create visitor → issue a today-only `gate_pass` → verify
  entry → **approved**.

The real database (`backend\data\abb-plant3.db`) was never touched; the temp database and script were
deleted afterwards.

**Phase C is complete except C5 (emergency lockdown) and C6 (operator override), which remain PENDING
DECISION. The next phase is D — compliance and monitoring.**

### Also updated

`project info\tasks.md` (feature checklist: C4/C7/C8 moved to added; Phase C section rewritten with the
C4–C8 detail; D2 noted as backend-partially-done; "Immediate next task" → Phase D),
`project info\phases.md` (Phase C ✅ COMPLETE except C5/C6; status + backend list updated).

---

## 2026-10-17 — Session: Phase D — compliance and monitoring (D1–D7) — ALL VERIFIED

### What was built — backend

- **D1 / D7 — canteen.** New `backend\src\data\canteen.js` (append-only SQL for `canteen_events`) and
  `backend\src\routes\canteen.routes.js` (`POST /api/canteen/verify`, `GET /api/canteen/events`,
  access `GATE_ROLES`). One approved entry per person per local calendar day, enforced inside a
  `db.transaction` on top of the existing `ux_canteen_one_per_day` unique index. A same-day repeat is
  recorded as a **friendly refusal** (`reasonCode: "already_entered_today"`) rather than an error, and a
  concurrent race resolves to exactly one APPROVED (the unique violation is caught and the refusal row is
  written).
- **D2 — incidents read/triage.** `backend\src\data\incidents.js` gained `incidentColumns`,
  `listIncidents` (LEFT JOINs `people` + `users` for `person_name` / `reported_by_name`), `countIncidents`
  and `setIncidentStatus`. `incidents.routes.js` now registers `GET /api/incidents` and
  `PATCH /api/incidents/:id` (both `GATE_ROLES`); the `PATCH` writes an `incident.status` audit row with
  `oldValue` / `newValue` / `reason`. **No new migration.**
- **D3 — announcements.** New `backend\src\data\announcements.js` + `announcements.routes.js`:
  `GET /api/announcements` (GATE_ROLES, active-and-unexpired unless `includeInactive`),
  `POST /api/announcements` and `POST /api/announcements/:id/deactivate` (both `ADMINISTRATOR_ONLY`;
  deactivate is soft — `is_active = 0`).
- **D4 — watchlist.** New migration `backend\migrations\0003_watchlist.sql` (table + 3 indexes), plus
  `backend\src\data\watchlist.js` and `backend\src\routes\watchlist.routes.js` (`GET` / `POST` for gate
  read, `POST` / `POST /:id/deactivate` admin-only; `POST` validates that `personId` exists → 400).
  `findActiveWatchlistForPerson` / `findActiveWatchlistByBarcode` feed the gate.
- **D4 — gate alert (advisory).** `gate.routes.js` resolves a watchlist match **inside its own
  `try/catch`** — a lookup failure logs and yields `null`, and a match is added to the verify response
  alongside the verdict. It can never change a verdict, so it cannot turn a refusal into a pass.
- **D5 — audit viewer.** New `backend\src\data\audit.js` (`parseSnapshot` degrades malformed JSON to
  `null`) + `audit.routes.js` (`GET /api/audit`, `ADMINISTRATOR_ONLY`, joins `users` for `actor_name`,
  returns `actions` for the filter).
- **Schemas.** `backend\src\validation\schemas.js` gained `queryBool()` (so `?includeInactive=false`
  really means false), `listIncidentsQuerySchema`, `updateIncidentSchema`, `verifyCanteenSchema`,
  `listCanteenEventsQuerySchema`, `createAnnouncementSchema`, `listAnnouncementsQuerySchema`,
  `createWatchlistSchema`, `listWatchlistQuerySchema` and `listAuditQuerySchema`.
- **Registration.** `backend\src\app.js` registers canteen, announcements, watchlist and audit after
  incidents. `assertPublicRoutes(registrar.inventory)` still passes — no public route was added.

### What was built — frontend

- `src\lib\api.ts` — new `canteenApi`, `announcementsApi`, `watchlistApi` and `auditApi` clients;
  expanded `IncidentView` (`personName` / `reportedByName`), `incidentsApi.list` / `.setStatus`, and
  `GateVerification.watchlist`.
- **New screens:** `canteen.tsx` (scanner-style input, verdict panel, today's log, served-today count),
  `incidents.tsx` (status/severity filters + triage), `announcements.tsx` (admin posting +
  soft-deactivate), `watchlist.tsx` (admin add/deactivate, detain banner), `audit.tsx`
  (administrator-only viewer with action filter and before/after snapshots).
- **Modified:** `_authenticated.tsx` (`NAV_ITEMS` now 12 entries; first 4 still drive the mobile bar),
  `verify.tsx` (watchlist alert rendered in the verdict overlay as **advisory**), `dashboard.tsx`
  (announcements banner), `src\locales\en.json` (new `ctn.*` and `aud.*` blocks plus Phase D additions
  to `ann.*` and `verify.watchlist_*`).

### Verification (2026-10-17) — batched once at the end of the phase

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — **0 errors** (after the route tree regenerated) |
| `npm run build` | exit 0 — `✓ built in 1m 33s`; canteen / incidents / announcements / watchlist / audit each emitted their own chunk |
| `npm test` | exit 0 — **112 tests, 112 pass, 0 fail**, 28 suites |

**New `backend\tests\compliance.test.js` (13 tests, all pass)** proves:

- canteen: a second same-day entry is refused with the human-readable `already_entered_today`; exactly
  one APPROVED row exists for the day; the concurrent `Promise.all` race yields exactly
  `["approved","rejected"]`;
- incidents triage: the status change is recorded and audited;
- announcements and watchlist: `security_staff` receives **403 and writes no row** on the
  administrators-only routes;
- audit viewer: `security_staff` receives 403 on `GET /api/audit`;
- watchlist at the gate: a flagged person's scan is still **approved** *and* returns
  `watchlist.level === "detain"` — the alert is advisory and never overrides the verdict.

**Phase D is complete (D1–D7). The next phase is E — insight: dashboard and reports.**
C5/C6 (lockdown/override) remain PENDING DECISION.

### Also updated

`project info\tasks.md` (feature checklist: compliance & monitoring moved to added; Phase D section
rewritten with the D1–D7 detail; status snapshot → 112/112; "Immediate next task" → Phase E),
`project info\phases.md` (Phase D ✅ COMPLETE; reference-mapping table + status updated),
`NEXT-SESSION.md` (phase table, backend/frontend lists, evidence table, next task → Phase E).

---

## 2026-10-17 — Session: Phase E1/E2 + QR cards + register UX — ALL VERIFIED

The user asked for the work to be **batched** rather than verified at each step: build several
features, then run the checks once. That is what happened — four changes landed before any command
was run.

### What was built

**E1 — `GET /api/dashboard/summary` (one call replaces 4 + 8 + 7).**

- New `backend\src\data\dashboard.js` — `buildDashboardSummary(db, {days, now})` returns `counts`
  (today), `inside` (total + missingExit + byCategory), `categorySplit`, 24 `hourly` buckets, a
  `daily` series of `days` entries, and `watchlist.active`.
- New `backend\src\routes\dashboard.routes.js` — `GET /api/dashboard/summary`, access
  `["administrator","security_staff"]`, `dashboardSummaryQuerySchema` (`days` 1–31, default 7).
- `backend\src\data\gate-events.js` gained `listScanFacts(db, {from, to})` — one aggregate read of
  raw `gate_events` rows (`to` exclusive), LEFT JOINed to `people.category`.
- `backend\src\lib\time.js` gained `hourInZone`, `startOfDayIso` and `isEntryUnclosed`.
- `backend\src\data\watchlist.js` gained `countLiveWatchlist` (active **and** not expired).
- `backend\src\routes\gate.routes.js` — its duplicate local `entryIsUnclosed` was deleted in favour
  of the shared `isEntryUnclosed` from `time.js`.
- **Why JS, not SQL:** SQLite cannot convert a stored UTC instant to an IANA zone, so all day/hour
  bucketing is done in JS after pulling a UTC range. This keeps the plant timezone correct (a night
  shift cannot get a UTC-derived "today") and keeps the code portable to PostgreSQL.
  `scans === approved + rejected + unable` holds in every bucket.
- New `backend\tests\dashboard.test.js` — **15 tests**.

**E2 — dashboard v2.** `src\routes\_authenticated\dashboard.tsx` rewritten to load the whole page
from the single summary call (30 s refetch) plus the live feed (15 s) and the announcements banner
(120 s). Now shows inside-by-category, the missing-exit flag, a category-split chart, an hourly
stacked chart, a 7-day trend and a watchlist alert. `src\lib\api.ts` gained `DashboardSummary` /
`ScanCounts` / `dashboardApi`. New `dash.*` keys in `src\locales\en.json`.

**Identity card: CODE128 → QR.** `src\lib\idcard.ts` rewritten. The card face is now exactly the
**ABB logo** (drawn, so a card can never print with a missing image), the **holder name**, the
**QR**, the **category** (worker / visitor / intern), **Issued** and **Valid till**. The QR encodes
the same **opaque credential id** as before — never personal data. All builders are now `async`
(QRs are rendered before the PDF is written); `downloadBulkIdCards` resolves every QR first.
Removed: jsbarcode, CODE128, `workerRef`, `contractorCompany`, `institutionName`, `validFrom`, the
visitor photo. `src\routes\_authenticated\verify.tsx` camera readers became **QR-first** (written in
the object form `{ format: "qr_reader", config: { supplements: [] } }` because this build's type
union for the string form predates the library's QR support), with the linear readers kept so an
older printed card still scans.

**`/register` UX rework.** `src\routes\_authenticated\register.tsx` — three **category tiles** (only
that category's required fields shown), register-and-issue in a single dialog with a live QR preview
and Download / Print, a **visitor group** dialog (N visitors → N individually-audited QR passes, with
a per-row outcome and "download all"), and a clearer **3-step CSV import** (columns shown inline, a
pre-import valid/invalid summary, a post-import created/failed summary and a failures CSV). 51 new
`reg.*` locale keys; 10 orphan keys removed.

### Verification (2026-10-17) — batched once, at the end

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — **0 errors** |
| `npm run build` | exit 0 — `✓ built in 2m 29s` (`dashboard`, `register`, `verify` each own a chunk) |
| `npm test` | exit 0 — **127 tests, 127 pass, 0 fail**, 29 suites (15 new in `dashboard.test.js`) |

**Conclusion:** the dashboard loads in a single request and every figure is derived from
`gate_events`; the card still carries the credential id (now as a QR), so a scanned card resolves to
its credential exactly as before. **E1 and E2 are done; E3 and E4 remain.**

**Operational note:** USB scanner guns must be set to **QR mode** — a gun left in linear/CODE128 mode
cannot read the new card.

### Also updated

`project info\tasks.md` (feature checklist: dashboard v2 / identity card & gate pass (QR) / register
UX moved to added; A10 CODE128 line marked SUPERSEDED; Phase E section rewritten with E1/E2 detail;
status snapshot → 127/127; still-remaining list; "Immediate next task" → E3),
`project info\phases.md` (Phase E 🔄 in progress, E1/E2 ✅), `NEXT-SESSION.md`.

---

## 2026-10-17 — Session: Phases E + F complete, G1–G3 green, the system runs — ALL VERIFIED

The user's request was: *"fix the isses i can see there are erros in bakend folder and src folders  fix
the error and make the running system  and update the project info folders files"*, continuing the
earlier instruction to *"complete the phase E,F, fast and then do the testing in phase G"*. Again the
work was batched: build several features, then run the checks.

### What was built

**E3 — the date-range scan report.**

- New `backend\src\data\reports.js` — `buildScanReport(db, {from, to, now})` returns `counts`,
  `days`/`daily[]` (capped at `MAX_DAYS = 366`), `byCategory[]`, `byDirection[]`, `byGate[]`,
  `topReasons[]` (capped at `TOP_REASONS = 12`), `uniquePeople` and `generatedAt`.
- New `backend\src\routes\reports.routes.js` — `GET /api/reports/scans?from=&to=`, access
  `["administrator","security_staff"]`, `scanReportQuerySchema`.
- It reuses `listScanFacts` and the dashboard's `scans === approved + rejected + unable` rule, so a CSV
  exported here reconciles exactly with the dashboard. The payload is **counts and reason codes only** —
  no name, phone, email, worker reference or purpose of visit (asserted). Day bucketing is in JS for the
  same reason as the dashboard (SQLite cannot do IANA zones).
- New screen `src\routes\_authenticated\reports.tsx` (date range, charts, CSV/PDF export); `/reports` is
  now entry 5 of `NAV_ITEMS`.
- New `backend\tests\reports.test.js` — **16 tests**.

**E4 — figure definitions (documentation, no code).** `project info\Architecture.md` gained **§17**:
the single source (`gate_events`), the reconciliation rule, why bucketing is in JS, a definition for
every dashboard figure, the same for every report figure, what the report deliberately omits, and which
suite proves each one.

**F1 — the public card check.**

- New `backend\src\data\public-check.js` (`lookupCardStatus`) and
  `backend\src\routes\check.routes.js` (`GET /api/check/:code`, `PUBLIC`). It returns
  `{valid, status, reasonCode, reasonText, kind, category, validTo}` — deliberately nothing personal.
- The verdict calls `evaluateCredential`, the same pure rule the gate and the canteen use, so the page
  and the gate can never disagree; an unknown code is an **answer** (`status: "not_found"`), not an
  error.
- New screen `src\routes\check.tsx`.
- `GET /api/check/:code` was added as the **fourth** entry of the asserted public-route allowlist.
- New `backend\tests\check.test.js` — **11 tests**, all without a cookie, including a payload-leak test
  (the serialised response must not contain `fullName`, `phone`, `employeeEmail`, `workerRef`,
  `contractorCompany`, `institutionName`, `purposeOfVisit`, `personToMeet`, `photoPath`, `plantId`, nor
  the holder's name or worker reference **value**) and a **gate-parity** test (`page.card.valid ===
  (gate.result === "approved")` and the same `reasonCode`, for both a good and an expired card).

**F3 — real login and signup (the temporary bypass was deleted, not flag-disabled).**

- Removed: `AUTH_AUTO_SIGNIN`, `config.autoSignIn`, `AUTO_SIGNIN_PUBLIC_ROUTE`, `publicRouteAllowlist()`
  and `authApi.localSignIn()`. `ensureLocalAdmin()` became `ensureFirstAdmin()`, which creates the first
  administrator **only while the `users` table is empty**.
- Added `POST /api/auth/signup` — creates a **disabled** `security_staff` account; the caller cannot
  choose a role (sending `role: "administrator"` is 400 and writes **no row**) and cannot sign in until
  approved. Audited as `auth.signup` with `actor_user_id = null`. It issues **no session**.
- Added `PATCH /api/users/:id` (administrator-only enable/disable) with two lockout guards: an
  administrator cannot disable their own account, and the last active administrator cannot be disabled.
  Audited as `user.enable` / `user.disable`. Disabling an account makes its **existing** session fail
  with 401 on `GET /api/auth/me` (the middleware re-reads `is_active` on every request).
- 12-char minimum password on signup.
- New screens `src\routes\login.tsx` and `src\routes\signup.tsx`; `users.tsx` gained account approval.
- New `backend\tests\accounts.test.js` — **18 tests**, including "the declared public allowlist is
  exactly `["GET /api/check/:code","GET /api/health","POST /api/auth/login","POST /api/auth/signup"]`".

**The bug that made login unreachable (the real `src\` error).** `/login` and `/signup` existed but
nothing sent an anonymous visitor to them: both `src\routes\index.tsx` and
`src\routes\_authenticated.tsx` did `if (!user) return <ServerUnreachable />;`, so a signed-out visitor
saw an **outage notice** instead of the sign-in form. Both now distinguish the two cases:

- `serverUnreachable` (the API is genuinely not answering) ⇒ `<ServerUnreachable />`;
- `!user` (nobody is signed in) ⇒ `<Navigate to="/login" replace />`.

### Also cleaned up

- `public\manifest.json` was still advertising the **college** system ("ABB — Barcode Verification",
  "Arusha Technical College main gate barcode student verification", `categories: ["education",…]`,
  "Open the gate barcode scanner"), and its two data-URI icons were barcode stripes. Rewritten for
  "ABB · Plant 3 Gate Verification" with QR-shaped icons.
- The dead **`jsbarcode`** dependency was removed from `package.json` (no remaining importer in `src\`
  since the card moved to QR).

### Verification (2026-10-17) — batched once, at the end

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — **0 errors** |
| `npx eslint .` | **exit 1, 263 problems (256 errors, 7 warnings)** → `npx eslint . --fix` → **exit 0**, only the 7 pre-existing `react-refresh/only-export-components` warnings remain |
| `npm run build` | exit 0 — `✓ built in 2m 1s` |
| `npm test` | exit 0 — **173 tests, 173 pass, 0 fail**, 34 suites |
| `npm start` | listening on `http://127.0.0.1:4000`, `servingFrontend: true`, **routes: 38**, `"database":"ready"` |

The 256 eslint errors were almost all `prettier/prettier` — `Delete ␍` (CRLF) on subagent-written files
plus long-line wrapping in `src\lib\api.ts`, `backend\tests\reports.test.js` and `src\routes\check.tsx`.
`--fix` cleared them all; the 7 warnings are in generated shadcn/ui files and were deliberately left.

Live probes against `npm start`: `GET /api/health` → **200** · `GET /api/check/does-not-exist` → **200**
with `{"card":{"valid":false,"status":"not_found",…}}` · `GET /api/auth/me` → **401** · `GET /login` →
**200** (1987-byte SPA shell) · `POST /api/auth/signup` → **201** `{"pendingApproval":true,…}` · then
signing in with that new account → **401** (correct: it is disabled until approved).

**Conclusion:** Phases E and F are complete (F2 skipped by decision) and G1–G3 are green. The system
runs and login is reachable. **G4 (repository-wide secret sweep) is the only unblocked item left.**

### Also updated

`project info\Architecture.md` (status, tech-stack corrections, frontend tree, rewritten §6 with the
4-route allowlist, new §17 figure definitions), `project info\phases.md` (the "where the project
actually is" block, Phase E ✅, Phase F ✅, Phase G 🔄 G1–G3, and the closing "Current status" section),
`project info\tasks.md` (status snapshot → 173/173 and real login, feature checklist additions for
Reports / public card check / login-signup, Phase E/F/G sections, known issues, "Immediate next task" →
G4), `project info\memory.md` (`ensureFirstAdmin`, real login/signup, the 4-route public surface, the
`jsbarcode` removal, stale-values list), `NEXT-SESSION.md` (auth block, phase table, backend route list,
NAV_ITEMS 13, evidence table, next task → G4).

