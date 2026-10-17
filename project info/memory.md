# memory.md — Persistent Project Context

**Last verified:** 2026-10-17 (Phases E and F complete, Phase G1–G3 green, real login/signup restored;
`npm test` 173/173)
**Read this file first.** It contains the established facts, locked decisions, and safe working
instructions. Do not contradict it based on older notes.

---

## 1. Project identity

- **Project:** ABB ID Verification and Gate Security System — Plant 3.
- **Purpose:** Build a secure ID issuance and gate verification system for ABB Plant 3.
- **Scope:** Plant 3 only. Do not build Plant 1 or Plant 2 screens. Design the data model so more
  plants can be added later, but expose only Plant 3 in the UI.
- **Approach:** Reuse the existing application shell (UI, scanning, ID printing, PDF/CSV, offline
  queue, i18n) and build a new ABB domain, backend and database on top of it. Do not rebuild the
  interface, and do not reuse the abandoned backend.

---

## 2. Verified workspace facts

These were established by direct inspection on 2026-10-16, and **corrected on 2026-10-17** after the
frontend and backend were merged into a single project. Treat them as fact.

| Folder | What it actually is | Use |
|---|---|---|
| `Anuj ABB Id verification system\` | **The project root, and now the only project.** It holds the React app (`src\`), the Node + SQLite API (`backend\`), one `package.json`, `vite.config.ts`, `index.html`, `public\` and `project info\`. | Build here |
| `...\barcode-student-verification-system-add-srs-document\` (+ its `.zip`) | The user's own earlier **college** system, supplied as a **feature and dashboard reference only**. Supabase-shaped and college-shaped. | **Reference for features only. Never copy its code.** |
| `Sagar Barcode id verfication Project\barcode-student-verification\` | **The original college application** (Git commit `b655ebb`). The UI shell was copied from it. | Read-only source. **Do not modify.** |
| `local database\barcode-id-verification\` | A later, **abandoned** attempt with an unauthenticated API and tests that never executed the real logic. | **Do not use as a base.** |

- **One root, one `package.json`, one `npm install`.** The frontend and backend are no longer separate.
  `npm run dev` starts the API on `:4000` and Vite on `:8080` together; Vite proxies `/api` to the API,
  so the browser sees one origin and the session cookie needs no CORS.
- **`npm run build` → `dist\`, then `npm start`** runs **one** Node process that serves both the API and
  the built SPA on `:4000`.
- **The separate admin-bootstrap command was deleted.** `ensureFirstAdmin()` runs inside the server
  process and creates the first administrator **only while the `users` table is empty**. (It was named
  `ensureLocalAdmin()` until Phase F3.)
- **Login and signup are real (Phase F3, done 2026-10-17).** `/login` is a password form; `/signup`
  creates a request for an account that an administrator approves on `/users`. The temporary bypass
  was **deleted entirely**, not flag-disabled: `AUTH_AUTO_SIGNIN`, `config.autoSignIn`,
  `AUTO_SIGNIN_PUBLIC_ROUTE`, `publicRouteAllowlist()` and `POST /api/auth/local` no longer exist.
- **The public surface is exactly four routes**, asserted in both directions at startup:
  `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/signup`, `GET /api/check/:code`. A route
  cannot be registered without an explicit `access`, and `app.js` refuses to boot if the allowlist and
  the registered public routes disagree either way.
- **`@lovable.dev/vite-tanstack-config`, the Cloudflare target, the SSR worker and `@supabase/supabase-js`
  are all gone.** `vite.config.ts` is now a plain Vite config with explicit plugins.
- **The UI is English only.** The Swahili locale pack and the language switcher were removed; the i18n
  layer itself is kept (`en.json`), so another language means adding one file.
- **The UI design is unchanged and correct.** All 45 `src\components\ui\*` shadcn/ui components are the
  inherited ones. Reuse them; do not introduce a second component style.
- **The requirements document is a DOCX, not a PDF:** `project info\requirement pdf for friend.docx`.

### Stale values — do not trust

Git remote `github.com/sagarkale8177/barcode-student-verification`; branch `feature/abb-frontend-theme`;
Supabase project id `gxhhvgqujolqpxxmxtto`; any workspace path recorded in the abandoned project's
`memory.md`; **any claim that this project root contains no application code** (it does, since
2026-10-17); any claim that Supabase is a runtime dependency (it is not); **any claim that the frontend
and backend are separate roots or that a separate admin command exists** (neither is true any more);
**any claim that login is removed, that `AUTH_AUTO_SIGNIN` exists, or that `POST /api/auth/local`
exists** (all three were deleted in Phase F3 — `/login`, `/signup` and `/check` are the public screens).

---

## 3. Locked decisions

| Decision | Reason |
|---|---|
| **Database = SQLite, server-side only** | Confirmed by the user's mentor/sir. This **deliberately overrides the requirements document §14**, which says to retain Supabase — see `rules.md` §18. The earlier Supabase recommendation was withdrawn. |
| **Build in `Anuj ABB Id verification system\`** | The user's chosen clean root. |
| **Reuse the shell, replace the domain** | Keeps the working UI. Replaces the college data model. |
| **No MongoDB** | This is a relational problem with joins, constraints and an append-only audit trail. |
| **Supabase is not used at runtime** | The Supabase client, its types and `src\integrations\` were **deleted on 2026-10-17**; the dependency was removed from `package.json`. No caller may be reintroduced. |
| **One project root** | Frontend and backend merged on 2026-10-17: one `package.json`, one `npm install`, one process in production. Do not re-split them. |
| **All SQL behind one data-access layer** | Keeps the backend replaceable. |
| **Schema as versioned, portable SQL migrations** | Plain SQL, explicit types, no SQLite-only constructs, so a later move to PostgreSQL is mechanical. |

### The consequence that must never be forgotten

**SQLite has no Row Level Security and no built-in authentication.** The database enforces nothing.
Every authorization decision must be implemented and tested in the backend. An endpoint that returns
people or gate logs without an authentication and role check is a critical defect. This was precisely
the abandoned project's failure: its API served all data with no auth, and its tests passed anyway.

---

## 4. Technology stack and how to run it

**Frontend (actual):** React 19.2, TypeScript 5.8, Vite 7.3, TanStack Router (file-based, via
`@tanstack/router-plugin/vite`), TanStack Query, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui
(`new-york`, base colour `slate`, CSS variables), `lucide-react`, `react-i18next` (English only),
`recharts`, `jspdf`, `qrcode`, `@ericblade/quagga2`, `zod`, `sonner`, `papaparse`.

> **`jsbarcode` is gone.** On 2026-10-17 the identity card moved from a CODE128 barcode to a **QR
> code** (`src\lib\idcard.ts` now uses `qrcode` only), and the now-unused `jsbarcode` dependency was
> **removed from `package.json`**. The card carries a QR, never a barcode.

There is **no TanStack Start and no SSR**. The app is a client-rendered SPA: `index.html` →
`src\main.tsx` → `RouterProvider`. All page metadata lives in `index.html`.

**Backend (built):** Node ≥ 22, Express 5 (ESM), `better-sqlite3`, `zod`, `cookie-parser`, server-side
sessions (only a SHA-256 hash of the token is stored), Node `scrypt` password hashing, a centralized
role-based route registrar, and an audit-log writer kept separate from the diagnostic logger.
Layout: `backend\src\{config,app,server}.js`, `backend\src\routes\*`, `backend\src\data\*` (all SQL),
`backend\src\domain\*` (pure rules), `backend\src\auth\*`, `backend\src\http\*`, `backend\src\lib\*`,
`backend\migrations\*.sql`, `backend\tests\*`.

**Database (built):** SQLite, created only by migrations. `journal_mode = WAL`, `foreign_keys = ON`,
`busy_timeout = 5000`, `synchronous = NORMAL`, `trusted_schema = OFF`. `0001_init.sql` creates 14
tables and 19 indexes (portable conventions: opaque TEXT ids, ISO-8601 UTC TEXT timestamps,
`YYYY-MM-DD` date-only validity, INTEGER 0/1 booleans, no triggers). `0002_seed_plant3.sql` seeds
Plant 3 and its single main gate. The database file is `backend\data\abb-plant3.db`.

**Commands — these are the only ones that exist:**

| Command | What it does |
|---|---|
| `npm install` | Installs everything for the frontend and the backend together (one `package.json`). |
| `npm run dev` | API on `:4000` **and** Vite on `:8080` at the same time; open `http://localhost:8080`. |
| `npm run dev:api` | Only the API process (`node --watch`). |
| `npm run dev:web` | Only the Vite dev server. |
| `npm run build` | Builds the SPA into `dist\`. |
| `npm start` | **Production:** one process serving the API **and** the built UI on `:4000`. |
| `npm run migrate` | Applies pending SQL migrations (idempotent). |
| `npm test` | The backend test suite (`node --test backend/tests/`). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` / `npm run format` | ESLint / Prettier. |

**There is no separate frontend command, no separate backend command and no separate admin command.**

### The reference project

`barcode-student-verification-system-add-srs-document\` is the user's own earlier **college** system and
is a **feature and dashboard reference only** (see `phases.md` for the screen-by-screen mapping). Its
code is Supabase-shaped and college-shaped and must **not** be copied. It is excluded from `typecheck`,
ESLint and the build.

The college `README` listed these tables: `students`, `access_logs`, `gates`, `settings`, `incidents`,
`announcements`, `watchlist`, `notifications`. That listing is unverified and the model is college-shaped;
the ABB schema was designed fresh. Three of those concepts are adopted as new ABB work — a watchlist
(Phase D4, needs migration `0003`), an incident register (Phase D2) and announcements (Phase D3);
`students` becomes `people` + `credentials`.

---

## 5. Users and key concepts

- Contract and temporary workers
- Internship students
- Visitors

The system does not replace ABB's HR system for permanent employees.

**A barcode or QR code is a lookup key, not authorization.** Possession of a code must never be treated
as permission to enter. Every scan is resolved against current authoritative data and the applicable
rules before an outcome is shown.

---

## 6. Security principles

- Unknown, expired, revoked, suspended or ineligible credentials must never be approved.
- If authorization cannot be reliably established (network failure, missing record, stale offline data,
  server error), show **UNABLE TO VERIFY**. A technical failure must never become APPROVED.
- Enforce permissions in the backend. Hiding a button is not authorization.
- Never expose secrets to the frontend: no database path, database password, SMTP password or API key in
  browser code, `VITE_*` variables, logs or the repository.
- Do not encode personal information in the barcode/QR payload; use an opaque identifier.
- Validity is enforced at verification time, independently of email reminders.
- Duplicate prevention and canteen limits are enforced by database constraints and transactions, not by
  client checks.
- Keep business audit history separate from diagnostic logs. Never log passwords, tokens or keys.
- Back up the database file on a schedule, test a restore, and protect it at rest.

---

## 7. Open questions — do not invent answers

Required fields per category and who may create/update each record; the exact permission matrix; the
expiry boundary (end of day vs exact time); reminder schedule and recipient source; duplicate-scan
window and behaviour; whether a scan records entry/exit automatically or the operator chooses;
offline verification policy and freshness limit; canteen limit and exceptions; branding assets, card
layout and issuance approval; retention and privacy rules; **deployment topology — does the SQLite file
live on one gate laptop or on a central machine that gate laptops reach over the network, and how many
machines use the app at once**; backup and encryption requirements; who administers the server machine;
whether an ABB SMTP server and credentials are available.

Never treat an open question as a settled business rule. Ask when the decision affects safety,
security, privacy or architecture.

---

## 8. Required AI working behaviour

**At the start of every session:**
1. Read this file, then `tasks.md`, `NEXT-SESSION.md` and the latest `WORKLOG.md`.
2. Inspect the workspace and current Git status; check for unfinished work.
3. Summarise the verified state, the unknowns, and the single next task.
4. Do not restart the project because the session or account changed.

**While implementing:**
- Inspect the actual code before editing. Never assume a feature exists because a document says so.
- One task at a time: state the change, the exact files, the risks, then implement, test, and report the
  real result.
- Preserve working features, existing data and uncommitted work.
- Do not modify the Sagar reference folder. Do not copy anything from `local database\`.
- Do not delete files, reset repositories, run destructive commands, apply migrations, modify production
  data, or deploy without explicit approval.
- Run the relevant checks after a change and report exactly what ran. **Never claim a test passed or a
  feature works unless it was actually verified.**
- Never report success when the operation failed; fail closed and say so.

---

## 9. Documentation set

| File | Role |
|---|---|
| `PRD.md` | What the system must do |
| `Architecture.md` | How it is structured and built |
| `rules.md` | Business and security rules, confirmed vs pending |
| `phases.md` | Staged development plan |
| `memory.md` | This file — verified facts, decisions, working protocol |
| `tasks.md` | Actionable checklist and current progress |
| `WORKLOG.md` | Created when code is seeded — changes, commands, results |
| `NEXT-SESSION.md` | Created when code is seeded — the exact next step |

At the end of each session, update `tasks.md`, `WORKLOG.md` and `NEXT-SESSION.md`. Preserve existing
useful content; do not overwrite notes blindly.

---

## 10. Progress-status rule

Do not claim any feature, database or security control is complete based on these documents alone.
Verify against the repository and test evidence, and mark a task complete only when its acceptance
criteria have been checked and recorded.

**Most important rule:** inspect first, preserve existing work, verify before claiming, and ask before
destructive or high-impact actions.
