# Handover Prompt — ABB Plant 3 ID Verification System

> **How to use this file.** This is for a **new Trae account/session** with no memory of the previous
> conversation. Open this project in Trae, then **copy everything below the line** into the new chat as
> your first message. It is written as instructions *to the agent* — read it all before doing anything.
>
> It was last updated on **2026-10-17**, after Phase D (compliance and monitoring) was built and
> verified. If you are resuming much later, cross-check the newest entry in `WORKLOG.md`.

---

## Your task

You are **continuing** work on the **ABB Plant 3 Security Gate Verification & ID Management System**.
The application **already exists and runs**. Do **not** start over, re-seed, or re-plan the whole
project — pick up exactly where it stopped.

Project root (work here):

`c:\Users\ADMIN\Downloads\ABB Security gate\ABB ID verification using supabase\Anuj ABB Id verification system\`

**Before writing any code, read these, in this order:** `project info\memory.md` →
`project info\phases.md` → `project info\tasks.md` → the newest entry in `WORKLOG.md` → `NEXT-SESSION.md`.
`tasks.md` opens with a plain-language **feature checklist** ("what is ADDED and what is REMAINING").

---

## 1. What this project is

An industrial-grade gate-security system for **ABB Plant 3** (exactly **one gate**:
`"Plant 3 - Main Gate"`). It registers contract/temporary workers, internship students and visitors;
issues them an ID card or a gate pass; and verifies those credentials at the gate — with a photo,
a fail-closed decision, and a permanent audit trail.

It is **not** a student system, and it does **not** use Supabase. The database is **local SQLite**,
reached only by the backend process (confirmed by the user's mentor).

---

## 2. Current state — one project, one command, already running

The frontend and backend are a **single project root**:

- one `package.json`, one `npm install`, at the root;
- `npm run dev` → API on `:4000` + Vite on `:8080` together, Vite proxying `/api` to the API;
- `npm run build` → `dist\`; `npm start` → **one** Node process serving the API **and** the built UI
  on `:4000`;
- there is **no** separate admin/frontend/backend command, and **no CORS** (one origin).

```
Anuj ABB Id verification system\
  index.html  vite.config.ts  package.json        <- the only package.json
  src\                                            <- React SPA (TanStack Router, no SSR)
  backend\
    migrations\*.sql    scripts\    src\    tests\    data\abb-plant3.db
  public\   project info\   barcode-student-verification-system-add-srs-document\  <- reference only
```

**Commands — there are no others:**

| Command | Purpose |
|---|---|
| `npm install` | Everything, once, from the root. |
| `npm run dev` | API `:4000` + Vite `:8080` together. Open `http://localhost:8080`. |
| `npm run build` | Build the SPA to `dist\`. |
| `npm start` | Production: one process serving API **and** UI on `:4000`. |
| `npm run migrate` | Apply pending migrations. |
| `npm test` | Backend test suite (currently **99 tests, 99 pass**). |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint. |

**Auth is temporarily off.** `AUTH_AUTO_SIGNIN=true` → `ensureLocalAdmin()` runs in-process and the
browser auto-signs-in via `POST /api/auth/local`. One env flag reverts it. Real login/signup is Phase F3.
Default local admin: username `admin`, password `abb-plant3` (overridable via `ABB_LOCAL_ADMIN_*`).

**Tech stack.** Frontend: React 19.2, TypeScript 5.8, Vite 7.3, TanStack Router (file-based) + TanStack
Query v5, Tailwind CSS v4, shadcn/ui, `lucide-react`, `react-i18next`, `recharts`, `jsPDF`, `jsbarcode`,
`qrcode`, `@ericblade/quagga2`, `papaparse`, `sonner`. Backend: Node ≥ 22, Express 5 (ESM),
`better-sqlite3`, `zod`, `cookie-parser`, server-side sessions, `scrypt` password hashing.

---

## 3. What is already built and verified (2026-10-17)

- **Foundation:** single root; SQLite (WAL, `foreign_keys=ON`, `busy_timeout=5000`) with versioned SQL
  migrations (`0001_init.sql` = 14 tables / 19 indexes; `0002_seed_plant3.sql` = Plant 3 + main gate);
  centralised backend role-based authorization (there is **no RLS**); a business audit log separate from
  diagnostic logs; fail-closed gate logic. No Supabase anywhere in `src\`.
- **Sign-in:** temporary automatic local-administrator sign-in (login screen removed for now).
- **Gate scan `/verify`:** Entry/Exit toggle (never inferred); HID/USB scanner input with auto-submit;
  camera scanning (Quagga2) with the HTTPS note; manual lookup; three distinct verdicts
  (**APPROVED / REJECTED (with reason) / UNABLE TO VERIFY**); session summary + recent scans; every scan
  recorded in the append-only `gate_events` table.
- **Who's Inside `/inside`:** who is currently inside, worker/intern/visitor counts, entries with no
  recorded exit flagged, search/filter/sort, CSV export.
- **Access Logs `/logs`:** full scan audit trail with decision/direction/gate filters, search by scanned
  code, tabs (all logs / today's attendance / denied frequency), CSV export.
- **Dashboard `/dashboard`:** totals + currently-inside, hourly-scans chart, decision split, 7-day series,
  live recent-activity list.
- **People & Credentials `/register` (administrator only) — built this session:** list with search,
  category filter, status filter, pagination; create person (worker/intern/visitor) with per-category
  required fields; server-side `details[]` errors shown inline; person detail panel; credential history
  with computed validity; issue ID card / gate pass; renew/suspend/terminate/reactivate (each with a
  reason); person status change with a reason; download single ID card and gate pass; bulk ID-card
  download; CSV export; security staff redirected away (matches the API's 403).
- **Users `/users`** (list + create with role) and **Settings `/settings`** (read/update).
- **Gate operations (Phase C):** kiosk mode; **visitor walk-in** on `/verify` (register → today-only
  gate pass → recorded entry); **report an incident** from the gate.
- **Compliance & monitoring (Phase D) — built this session:** **Canteen `/canteen`** (one approved entry
  per person per local day, enforced by a DB unique index; same-day repeats recorded as a friendly
  refusal) · **Incidents `/incidents`** (status/severity filters + triage) · **Announcements
  `/announcements`** (admin post, soft-deactivate, dashboard banner) · **Watchlist `/watchlist`**
  (admin add/deactivate + an **advisory** alert on the gate screen that can never change a verdict) ·
  **Audit viewer `/audit`** (administrator only, action filter, before/after snapshots).
- **Verified:** `npm run typecheck` 0 errors · `npm run build` succeeds · `npm test` **112/112**
  (13 new in `compliance.test.js`) · `npm start` serves `GET /api/health` (200) **and** `GET /` (200, the
  built SPA) from one process.

**Backend endpoints that exist:** `GET /api/health` · `POST /api/auth/login` · `POST /api/auth/local` ·
`POST /api/auth/logout` · `GET /api/auth/me` · `GET|POST /api/users` · `GET|PUT /api/settings` ·
`GET /api/people/search` · `GET|POST /api/people` · `GET|PATCH /api/people/:id` ·
`POST /api/people/:id/status` · `GET /api/people/:id/credentials` · `POST /api/credentials` ·
`POST /api/credentials/:id/validity` · `POST /api/credentials/:id/status` · `POST /api/gate/verify` ·
`GET /api/gate/events` · `GET /api/inside` · `POST|GET /api/incidents` · `PATCH /api/incidents/:id` ·
`POST /api/canteen/verify` · `GET /api/canteen/events` · `GET|POST /api/announcements` ·
`POST /api/announcements/:id/deactivate` · `GET|POST /api/watchlist` ·
`POST /api/watchlist/:id/deactivate` · `GET /api/audit`.

**Not built on the backend yet:** dashboard summary, reports.

---

## 4. What is REMAINING (the work you will do)

**Phase E — Insight: dashboard and reports** (the current phase). Phases A, B, C and D are complete
and verified.

- **E1 — `GET /api/dashboard/summary`.** One call returning today's counts, inside totals, category
  split, hourly buckets and a 7-day series, replacing the dashboard's current 4 + 8 + 7 calls.
- **E2 — Dashboard v2** built on that single call (the announcements banner already shipped in D3).
- **E3 — `reports.tsx`** with date-range reports and CSV / PDF export, restricted by role.
- **E4 —** document every dashboard figure's definition in `project info\Architecture.md`.

**Still outstanding from Phase C:** **C5 (emergency lockdown)** and **C6 (operator override)** — both
**PENDING DECISION**. Do not build them without asking the user for the policy.

**Then:** Phase F (public `/check` page, expiry reminders, real login) and Phase G (tests, hardening,
offline, deployment). Full detail in `project info\phases.md`.

---

## 5. Hard constraints — do NOT break these

1. **Keep it one project root.** Never re-split into separate `frontend/` and `backend/` roots, and never
   add a second command to start the admin/frontend/backend separately.
2. **Local SQLite, not Supabase.** Even though the reference project uses Supabase, this project stays on
   the local database. Do not add `@supabase/*`.
3. **Do not copy the reference project's code.** `barcode-student-verification-system-add-srs-document\`
   is the user's older college system — use it for **features and dashboard layout ideas only**. Adapt,
   never paste. It is **read-only**.
4. **No RLS.** SQLite enforces nothing, so **every authorization check is backend code**, applied
   centrally. Hiding a button is not a security control.
5. **Fail closed.** Any network error, missing record, or server failure must produce **UNABLE TO VERIFY**,
   never APPROVED.
6. **Never widen the public route surface** without deliberately adding it to the asserted allowlist.
7. **Business audit history is separate from diagnostic logs.** Never log passwords, tokens or
   unnecessary personal data.
8. **Credentials are personal data.** The barcode payload is the **opaque credential id**, never personal
   data. Gate-staff search returns identification only (no phone/email/visit detail).

---

## 6. Working rules

1. **Inspect before editing.** Read the real code; never assume a file matches a document.
2. **One task at a time.** State what you will change, the exact files, risks and dependencies, then
   implement, test, and report the **real** results.
3. **Never claim something works unless you verified it.** Report the exact command and its output. If
   verification cannot complete, report "unable to verify".
4. **After every task, update the tracking documents:** `project info\tasks.md`, `project info\phases.md`,
   `WORKLOG.md`, `NEXT-SESSION.md`, and `project info\memory.md` when architecture or decisions change.
   This is a standing instruction the user cares about — they read these files to see progress.
5. **Ask before:** deleting files, changing security policy, running migrations against **real** data, or
   copying/overwriting substantial code. (For experiments, point `DB_PATH` at a throwaway file — the
   default is `backend\data\abb-plant3.db`; `:memory:` is also supported.)
6. **Reuse the existing UI.** Use the `src\components\ui\*` shadcn components and the design tokens in
   `src\styles.css` (ABB red `--sidebar-primary: #ed1c24`, `--success`, `--warning`). Do not add a second
   component style.
7. **English only** (the Swahili locale was removed).

---

## 7. Open questions — do NOT invent answers

Ask the user rather than choosing when a decision affects security, data integrity or architecture:

1. **Lockdown / operator-override policy** (C5/C6) — may a gate operator lock the gate down or override a
   denial, and what must be recorded?
2. **Expiry reminders** (F2) — interval, recipient source, wording, and whether ABB has an SMTP server.
3. **Deployment topology** (G6) — is the SQLite file on one gate laptop, or on a central machine that gate
   laptops reach over the network? How many machines at once?
4. **Offline policy** (G5) — permitted at all, and what data-age limit?
5. Mandatory vs optional fields beyond the per-category minimum.
6. Canteen boundary details beyond "once per person per local day".
7. ABB branding assets, final card dimensions, and the ID-issuance approval process.

---

## 8. Suggested first actions

1. Read the five documents named at the top and the newest `WORKLOG.md` entry.
2. Run `npm run typecheck`, `npm test` and `npm run build` to confirm the baseline is still green before
   changing anything.
3. Start **B3 (edit an existing person)** in `src\routes\_authenticated\register.tsx`, then B7 (CSV
   import), then B6 (barcode round-trip) — or whatever the user asks for.
4. Update the tracking documents when the task is done, and tell the user plainly what changed.
