# Architecture Document

## ABB ID Verification and Gate Security System — Plant 3

**Status:** Implemented. This document started as the agreed design and now describes a running system:
one project root, a React SPA in `src\`, an Express + SQLite API in `backend\`. Read `memory.md` first
for the verified workspace facts and locked decisions, then `phases.md` for what is actually built.

> **Verification rule:** this document is the *intended* architecture. Where it and the repository
> disagree, the repository wins. Facts below marked "built" were checked against source and tests on
> 2026-10-17 (`npm test` → 173/173).

---

## 1. Purpose

This document describes how the system is structured, how its parts communicate, and how security and
data integrity are maintained.

The application reuses the existing college application's interface shell and replaces its data model,
backend and business logic. Do not rebuild the interface. Do not reuse the abandoned `local database\`
implementation.

---

## 2. Technology stack

| Layer | Technology | Status |
|---|---|---|
| UI | React 19.2 + TypeScript 5.8 | Inherited from the shell |
| Build tool | Vite 7.3 | Inherited |
| Routing | TanStack **Router only** (file-based, `@tanstack/router-plugin/vite`) | Inherited, **Start/SSR removed** |
| Server state | TanStack Query | Inherited |
| Styling | Tailwind CSS v4 + shadcn/ui (`new-york`, `slate`, CSS variables) | Inherited, **unchanged** |
| Icons | `lucide-react` | Inherited |
| i18n | `react-i18next` — **English only** (`src\locales\en.json`) | Swahili removed |
| QR generation | `qrcode` | **`jsbarcode` removed 2026-10-17 — QR only** |
| Camera scanning | `@ericblade/quagga2` (**QR-first**; linear readers retained) | Inherited |
| ID card / PDF | `jspdf` + `src\lib\idcard.ts` | Inherited, rewritten |
| CSV export / import | `papaparse` | Inherited |
| Charts | `recharts` | Inherited |
| Validation | `zod` — shared shape between client and server | Inherited, extended |
| Notifications UI | `sonner` | Inherited |
| **Offline cache** | *none* — IndexedDB / `idb` were deleted in Phase A11 | Removed |
| **Backend API** | Node ≥ 22 + Express 5 (ESM) | **Built** |
| **Database** | SQLite (`better-sqlite3`), WAL mode, server-side only | **Built** |
| **Authentication** | Own implementation — `scrypt` hashing + hashed server-side sessions | **Built** |
| **Authorization** | Own role-based middleware in the route registrar (SQLite has no RLS) | **Built** |
| **Expiry reminders** | Scheduler inside the backend + SMTP | **Not built — Phase F2 pending decision** |
| **Supabase** | Not used at runtime; client, types and `src\integrations\` deleted | **Removed** |

Inspecting `package.json` and the source is still required before relying on any row.

---

## 3. High-level architecture

```text
        Security Operator / Administrator
                      |
                      v
        React Frontend (shell, unchanged styling)
                      |
                      |   HTTPS, session cookie / bearer token
                      v
        Local Backend API  (Node)
        |-- authentication        (login, sessions, expiry, revocation)
        |-- authorization         <-- THE ONLY AUTHORIZATION LAYER
        |-- validation            (zod, server-side)
        |-- audit-log writer
                      |
                      v
        Data-access layer  (all SQL lives here, nowhere else)
                      |
                      v
        SQLite database file (WAL)  +  photo files on disk
                      |
                      v
        Scheduler  -->  SMTP  (expiry reminders; failures recorded)

        Browser  -X->  SQLite      The browser never touches the database.
```

### Component responsibilities

**Frontend**
- Renders dashboards, forms, records, reports, scanning and manual search.
- Shows verification outcomes and friendly error messages.
- Performs input validation only for usability. **It is never a security boundary.**

**Backend API**
- The single trusted layer. Authenticates every request, enforces every authorization rule, validates
  every input, writes every audit entry, and owns all database access.
- Returns one consistent error shape and never leaks internals.

**Data-access layer**
- The only place SQL appears. Grouped by domain (e.g. `people`, `credentials`, `gateEvents`,
  `canteen`, `audit`). Keeps SQLite replaceable with PostgreSQL later.

**Database (SQLite)**
- Stores people, credentials, gate events, canteen use, audit history, settings and users.
- Enforces integrity through constraints, foreign keys and unique indexes — **but not access control**.

**Photo storage**
- Photographs live outside the web root and are served only through authenticated,
  permission-checked endpoints. No public URLs.

**Scheduler**
- Runs inside the always-on backend process. Identifies credentials approaching expiry, sends the
  approved reminders, and records successes and failures.

---

## 4. Frontend structure

The shell's structure is retained. The documented layout is:

```text
src/
├── components/
│   ├── ui/                 (45 shadcn/ui components — unchanged)
│   └── ...
├── lib/                    (api.ts, auth-context.tsx, idcard.ts, i18n.ts, …)
├── locales/                (en.json only)
└── routes/
    ├── index.tsx           (/)          signed in → role home; anonymous → /login
    ├── login.tsx           (/login)     PUBLIC — password sign-in
    ├── signup.tsx          (/signup)    PUBLIC — request an account (created disabled)
    ├── check.tsx           (/check)     PUBLIC — card-status lookup, no personal data
    ├── __root.tsx          providers + 404/error components
    └── _authenticated/     (dashboard, verify, inside, logs, reports, canteen,
                             incidents, announcements, watchlist, register,
                             users, audit, settings)
```

The `src/integrations/` folder (Supabase client) and `@supabase/*` dependencies have been **removed**;
nothing under `src/` references Supabase.

Verify against the actual repository before moving or renaming anything.

### The three screens that do not require a session

`/login`, `/signup` and `/check` are the only public pages, and they map one-to-one onto the only three
public API routes besides the health probe. `/check` is the card holder's own lookup: it takes one
opaque code and answers whether that card may be used today. It renders no name, no phone number and no
employee email, because anyone on the plant network can reach it without signing in.

### Main application areas

**Authentication** — login, logout, session handling, protected routes.
**Dashboard** — totals, current-inside count, recent gate activity, alerts for expired/expiring IDs.
**People** — contract/temporary worker, internship student and visitor records with status and validity.
**Gate verification** — scanning, manual search, outcome, event recording.
**Credentials** — ID/pass generation, validity, renewal, suspension, revocation, printing/PDF.
**Canteen** — verification screen and usage records.
**Reports** — gate activity, entry/exit, expired and expiring credentials, rejected verifications, canteen.
**Administration** — users and roles, gates, settings, audit history.

Incidents, announcements, watchlist, notifications and offline scanning are retained where they remain
within the approved scope. Do not remove a feature merely because it is not listed here.

---

## 5. Database architecture

**SQLite is the chosen database, confirmed by the project's mentor/sir.** It is accessed only by the
backend process. The browser never sees the file path or any database credential.

### Operating rules

- **WAL mode** enabled, with a deliberate, documented single-writer usage model.
- One writer at a time; concurrent reads are allowed. This suits a gate plus an administrator. It will
  **not** scale like a server database — confirm the expected concurrency (see `memory.md` §7).
- **Never** place the database file on a shared network folder. SQLite over SMB/NFS breaks file locking
  and can corrupt the database. If more than one machine uses the app, the API server holds the file.
- Foreign keys enabled. Unique indexes are used to enforce duplicate prevention.
- Timestamps stored in UTC; displayed in the approved local time zone.
- Scheduled backups with a **tested** restore. Encryption at rest if the machine could be stolen — it
  holds personal data and photographs.
- Migrations are versioned, reversible where feasible, and tracked in a `schema_migrations` table.

### Schema to be designed

The college README listed `students`, `access_logs`, `gates`, `settings`, `incidents`, `announcements`,
`watchlist`, `notifications`. That listing is unverified and college-shaped; design the ABB schema fresh
and do not carry the college field names across.

The design must cover at least:

- **People** — one record per person, with category (worker / internship student / visitor), status, and
  the approved per-category fields. Confirm whether one table with a category field or separate tables
  per category best fits the differing field sets.
- **Credentials** — one or more per person over time; opaque code/token, category, issue date, start and
  end date, status (active / suspended / revoked / expired), and who approved any change.
- **Gate events** — append-only entry/exit events with timestamp, gate, operator, outcome and reason.
- **Canteen records** — successful uses with a per-day uniqueness constraint, plus rejected attempts.
- **Gates** — Plant 3 has exactly one gate, `"Plant 3 - Main Gate"`. Model it as data so more gates can
  be added later without a rewrite.
- **Users and roles** — login identities and their roles.
- **Audit log** — administrative changes and corrections with actor, timestamp, action, target, reason.
- **Notification log** — reminder attempts, delivery status and failures.
- **Settings** — approved configuration such as the reminder period.

### Data relationships

A person has one or more credentials over time; a credential belongs to exactly one person; a gate event
references a person or credential and a gate; a credential change records its approver; a person may have
at most the permitted number of successful canteen uses per day.

### Schema-change procedure

1. Inspect the current schema and migration history.
2. Explain the change and its purpose.
3. Identify compatibility and data-loss risks.
4. Prepare a reversible migration where feasible.
5. Test outside production.
6. **Obtain approval before applying it.**
7. Verify existing features still work.

---

## 6. Authentication and authorization

**Authentication is built in the backend** — SQLite provides none. Use a vetted library for password
hashing (never a hand-rolled hash) and maintain server-side sessions with expiry and revocation. Never
issue a role that the client can edit, and never trust a role value sent by the browser.

**Roles:** **Administrator** and **Security Operator** are implemented. Canteen Operator and Read-only
were not required and do not exist. The permission matrix is in `PERMISSION-MATRIX.md`.

### How it is enforced (built)

Every route is declared through `backend\src\http\route.js`:

```js
registrar.defineRoute({ method, path, access, params, body, query, handler })
```

- **A route cannot exist without an explicit `access`.** The registrar throws at startup if `access` is
  missing, empty or not one of the three valid shapes. There is no default, so forgetting to declare
  authorization fails the boot rather than opening the route.
- `access` is one of: `PUBLIC` (`"public"`), `AUTHENTICATED` (`"authenticated"`), or an explicit role
  array such as `["administrator"]`. Unknown values are denied.
- The authorization middleware is always the **first** guard in the chain, ahead of validation, so an
  unauthenticated caller never receives validation feedback about a protected request's shape.
- Route handlers never read `req.user.role`. One middleware decides; the negative tests assert it.

### The public-route allowlist is asserted in both directions

`backend\src\app.js` holds `BASE_PUBLIC_ROUTES` and calls `assertPublicRoutes()` before the app is
returned. It fails the **startup** if either:

- a route declares `PUBLIC` and is *not* in the list (a route cannot be made public by accident), or
- the list contains an entry that matches *no* registered public route (a stale entry is caught).

The complete public surface is four routes:

| Route | Why it is public |
|---|---|
| `GET /api/health` | Liveness probe; returns `{status, database, time}` and nothing else. |
| `POST /api/auth/login` | You cannot require a session in order to obtain one. Rate-limited per username + IP. |
| `POST /api/auth/signup` | A **request** for access, not a grant — see below. |
| `GET /api/check/:code` | The holder's own card status. Requires already holding the opaque code; cannot list or search. |

**Signup is safe by construction, not by policy.** Two properties do all the work: `signupSchema` has no
`role` field and the INSERT hard-codes `'security_staff'`, so a caller cannot choose their own
privilege; and the row is inserted with `is_active = 0`, so it cannot sign in until an administrator
enables it on `/users` via `PATCH /api/users/:id`. That PATCH also refuses to let an administrator
disable their own account, and refuses to disable the last enabled administrator. Disabling an account
takes effect immediately for its live sessions, because the authorization middleware re-reads
`is_active` on every request.

### Authorization requirements

- Enforce every permission in the backend. There are **no RLS policies** to rely on.
- Apply least privilege; default to deny.
- Apply checks centrally in middleware, not hand-written per route.
- Restrict creation, update, deactivation, exports and administrative actions by role.
- Protect role assignment itself — a user must not be able to elevate their own privileges.
- **Test with negative tests:** a security-operator account calling an administrator endpoint must be
  *denied*, and the denial must be asserted by a test.
- Hiding a button is not a security control.

---

## 7. Gate verification architecture

```text
Scan barcode/QR  or  manual search
                |
                v
        Identify credential
                |
                v
   Backend retrieves current authoritative data
   (authenticated request; never a cached client copy alone)
                |
                v
   Check: exists -> active -> within validity ->
          not suspended/revoked -> permitted for Plant 3
                |
                v
       Determine outcome
        /       |        \
   APPROVED  REJECTED  UNABLE TO VERIFY
        |
        v
  Record the gate event (only after the write succeeds)
```

### The safety rule

A successful scan is not authorization. If the system cannot reliably confirm current status, it must
show **UNABLE TO VERIFY** and must never silently approve.

Offline verification is permitted only under an approved policy covering which records are cached, the
maximum data age, how offline scans are recorded, how conflicts are reconciled on sync, and exactly what
the operator does when validity cannot be checked. **No policy has been approved yet.**

---

## 8. Entry and exit data flow

Each event records: person/credential reference, event type (entry or exit), UTC timestamp, gate,
authenticated operator, outcome, and a reason where applicable.

- Events are **append-only**. Never silently rewrite history.
- Corrections require authorization and record actor, timestamp, reason, and the previous value.
- Repeated scans and retries must not create unintended duplicate events — enforced by constraints and
  transactions.
- Current-inside status is derived from event history under an agreed policy.
- Entries without a matching exit are flagged for review.
- The gate screen must state plainly whether the next action is entry or exit.

---

## 9. Credential generation and printing

1. Retrieve the authorised person's current record.
2. Render the approved card layout.
3. Display only the approved fields.
4. Generate the barcode/QR code from an **opaque identifier** — no personal data in the payload.
5. Include validity information where required.
6. Support printing and PDF output.

Final layout, dimensions, branding and mandatory fields require approval. The shell's existing ID-card
and visitor-pass components are to be adapted, not replaced.

---

## 10. Expiry and email notifications

A scheduler inside the always-on backend process:

- Finds credentials matching the approved reminder rule.
- Sends the reminder to the approved contact address where one exists.
- Tells the recipient to contact the administrator for an extension.
- Records the attempt and its delivery status, including failures.
- Avoids sending duplicate reminders unintentionally.

An administrator may extend, suspend or terminate a credential, and must enter the new expiry date **and
a reason**; the approver and time are recorded. Expired credentials are rejected by normal verification
**even if the email service failed** — reminders are a convenience, never the control.

Reminder schedule, recipient source, wording and boundaries remain unconfirmed.

---

## 11. Error handling, logging and monitoring

**User-facing errors:** clear, actionable messages; never stack traces, database internals, file paths or
secret values. Include a correlation identifier where practical so support can trace the failure.

**Audit log vs diagnostic log:** keep them separate. Audit history records business actions and
authorised corrections. Diagnostic logs record technical failures without unnecessary personal data.

**Failures to handle explicitly:** database or service unavailable; invalid or expired session;
unauthorized action; unknown code; expired or revoked credential; invalid input; duplicate or conflicting
scan; photo/PDF failure; email failure; constraint or transaction error.

**Never show success when the operation failed.** If verification cannot be completed, show UNABLE TO
VERIFY.

---

## 12. Security and personal data

- HTTPS in any networked deployment.
- All secrets in server-side environment configuration, outside source control. Never in `VITE_*`.
- The browser receives no database path, database password, SMTP password or API key.
- Validate all important input on the server; client validation is for usability only.
- Serve photographs only through authenticated, permission-checked endpoints.
- Rate-limit login and other sensitive operations.
- Protect exports and audit history by role.
- Define retention and deletion rules with ABB; never delete records needed to explain historical events.
- Restrict filesystem permissions on the database file to the service account.
- Back up regularly and document, and **test**, restoration.

---

## 13. Testing architecture

Use the tools already present in the shell. Tests must execute the **real** implementation — not a
re-implementation of the rules.

Required coverage:

- Unit tests for validity and authorization rules.
- Integration tests against a real temporary database.
- **Authorization tests per role, including negative tests that assert denial.**
- Gate outcomes: valid, expired, revoked, suspended, unknown and malformed credentials.
- Duplicate-scan handling and concurrent requests.
- Entry/exit consistency, current-inside derivation, missing exits.
- Expiry enforcement and renewal; reminder failure not affecting validity.
- Error handling and failure fallbacks (must fail closed).
- Regression tests for the retained shell features.
- Production build check.

**Do not claim a test passed unless it was run and its result checked.** The abandoned project's suite
passed 18/18 while never executing the real gate logic and while its API had no authorization at all —
that is the failure mode these rules exist to prevent.

---

## 14. Deployment and environments

- Keep development, testing and production configuration separate.
- Confirm the **topology** before building: one laptop, or one server holding the database file with
  gate laptops connecting over the network. Never a shared network folder.
- Confirm environment variables without exposing their values.
- Confirm migrations, backup and a tested restore before go-live.
- Review authentication, authorization, photo access and role assignment.
- Test the production build and the supported scanner/browser combination used at the gate.
- Confirm monitoring, error reporting and recovery procedures.
- **Obtain explicit approval before deploying or modifying production data.**

---

## 15. Architecture decisions still required

1. Deployment topology and expected concurrency (see `memory.md` §7).
2. Whether the person model is one table with a category field or separate per-category tables.
3. The approved role and permission matrix.
4. The gate and event model — whether a scan implies the event type or the operator chooses it.
5. Whether offline scanning is permitted, and its policy.
6. The expiry boundary, reminder schedule and renewal approval flow.
7. The canteen limit and exception process.
8. Backup, retention, encryption and hosting arrangements.
9. Whether an ABB SMTP server and credentials are available.

---

## 16. Instructions to the implementing agent

Inspect the actual repository before implementing. Use this document as the intended architecture, not as
proof that any described component exists.

Preserve working code and existing data. Explain conflicts and propose the smallest safe change. Do not
create duplicate systems, replace the stack, apply migrations or perform destructive operations without
approval. Implement incrementally and test before moving on.

---

## 17. Figure definitions — every dashboard and report number

**Phase E4.** Every figure the dashboard and the report page display is derived on the server and
defined here, so a number shown on a screen can always be traced back to one rule over one table. Nothing
is counted in the browser.

### 17.1 The single source

Both screens read the **same append-only table**: `gate_events`. One row is written per scan attempt,
including the rejected and the unverifiable ones. There is no UPDATE and no DELETE in
`backend\src\data\gate-events.js`.

| Screen | Endpoint | Aggregator |
|---|---|---|
| Dashboard | `GET /api/dashboard/summary?days=1..31` | `backend\src\data\dashboard.js` → `buildDashboardSummary` |
| Reports | `GET /api/reports/scans?from=YYYY-MM-DD&to=YYYY-MM-DD` | `backend\src\data\reports.js` → `buildScanReport` |

Both call `listScanFacts(db, { from, to })`, which returns the raw rows of the window with the person's
category joined on. `from` is inclusive; `to` is exclusive and is always the start of the day **after**
the last day the operator asked for, so a single-day window is exactly one day.

### 17.2 The reconciliation rule

> **`scans === approved + rejected + unable`** — in every bucket, on both screens.

`scans` is the count of rows in the range; the three verdicts are the counts of the three stored `result`
values. Because every row has exactly one `result`, the identity holds by construction, and the test
suites assert it per bucket (daily, hourly, by category, by direction, by gate). **A CSV exported from
the report page therefore reconciles exactly with the dashboard.**

The mapping from a stored verdict to a chart key is total, with no fall-through to a "success" bucket:
`approved → approved`, `rejected → rejected`, **anything else → unable**.

### 17.3 Why bucketing happens in JavaScript, not SQL

SQLite cannot convert a stored UTC instant into an IANA time zone. A SQL `strftime` would silently answer
in UTC, which puts a night shift on the wrong calendar day and makes "today" wrong. So the rows are
fetched by UTC range and then bucketed in JS with `dateKeyInZone()` / `hourInZone()` against the plant
time zone. The same code runs unchanged on PostgreSQL, which is the stated migration path.

The plant clock comes from the `site.timezone` setting (default `Asia/Kolkata`) via `siteToday(db)`. Both
screens echo the zone they used in the response (`timezone`), so a wrong setting is visible rather than
silent.

### 17.4 Dashboard figures

| Figure | Definition |
|---|---|
| `today` | The plant's current calendar date, `YYYY-MM-DD`, from `siteToday(db)`. |
| `asOf` | The instant the summary was computed, ISO-8601 UTC. |
| `counts` | Today's scans only: `{ scans, approved, rejected, unable }`, satisfying the rule in §17.2. |
| `inside.total` | Number of people whose most recent **approved** event has no later event that closes it, resolved by `listInsidePeople(db)`. Derived from event history, never stored. |
| `inside.byCategory` | The same people split into `worker` / `intern` / `visitor` / `unknown`, by the person's current `category`. |
| `inside.missingExit` | A **flag count**, not an assumption: people whose last approved event was an entry and whose day has already rolled over (`isEntryUnclosed`). It never moves anyone out of `inside.total`. |
| `categorySplit[]` | Today's scans grouped by the scanned person's category, `unknown` included, each row satisfying §17.2. |
| `hourly[]` | 24 buckets for **today**, indexed by plant-local hour 0–23, each `{ hour, approved, rejected, unable }`. A scan whose timestamp cannot be read is counted in `counts` but in no hour bucket. |
| `daily[]` | One entry per day of the requested window, oldest first, over `days` (1–31), each satisfying §17.2. A day with no scans reports **zeros, not a missing row** — that is what keeps the chart continuous. |
| `watchlist.active` | Count of live (non-deactivated) watchlist entries, from `countLiveWatchlist(db)`. **Advisory only** — it never changes a verdict. |

The whole summary is **one** HTTP request and **one** range query over `gate_events`, replacing the
earlier 4 + 8 + 7 calls.

### 17.5 Report figures

| Figure | Definition |
|---|---|
| `counts` | Every scan in `[from, to]` inclusive: `{ scans, approved, rejected, unable }`. Identical definition to the dashboard's, over a chosen range. |
| `days` / `daily[]` | The same continuous-series rule as §17.4, capped at `MAX_DAYS = 366` — the schema's maximum window — so the day list can never run away. |
| `byCategory[]` | The range grouped by the scanned person's category, `worker` / `intern` / `visitor` / `unknown`. An unrecognised code is its own bucket, never dropped. |
| `byDirection[]` | The range grouped by the stored `direction` (`entry` / `exit`). The direction is chosen by the operator and never inferred. |
| `byGate[]` | The range grouped by `gate_id`, labelled from the `gates` table (`gateNameMap`), sorted by scans descending. Accounts for every scan in the range. |
| `topReasons[]` | The **"why was someone turned away"** list: scans that carry a `reason_code`, grouped by code, sorted by count descending (ties broken by code), capped at `TOP_REASONS = 12`. This is the only place the report names a reason, and it names no individual. |
| `uniquePeople` | `COUNT(DISTINCT person_id)` over the range — holders, **ignoring scans with no record** (an unknown code identifies nobody, so it must not inflate the count). |
| `generatedAt` | When the report was computed, ISO-8601 UTC. |

### 17.6 What the report deliberately does not contain

The report is **counts and reason codes only**. It carries no name, phone number, employee email, worker
reference or purpose of visit — asserted by a test that serialises the whole payload and fails if any of
those field names appears. Widening it to include people would be a visible, auditable change to one
file (`backend\src\routes\reports.routes.js`).

It is readable by **both gate roles**, `administrator` and `security_staff`, because a security operator
sees the same operational picture an administrator does.

### 17.7 Where this is proven

| Suite | What it proves |
|---|---|
| `backend\tests\dashboard.test.js` | 15 tests — the summary reconciles with the stored rows, the series is continuous, and category/hour buckets account for every scan. |
| `backend\tests\reports.test.js` | 16 tests — the report total equals `COUNT(*)` of the stored rows inside the window, every bucket sums to `scans`, the gate label comes from the `gates` table, and no personal field leaks. |
