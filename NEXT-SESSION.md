# NEXT-SESSION.md — resume from here

> Read this first, then `project info\memory.md` → `project info\phases.md` → `project info\tasks.md`,
> then the newest entry in `WORKLOG.md`. Update this file at the end of every session.
>
> **Starting a brand-new chat/account?** Paste `project info\HANDOVER-PROMPT.md` as the first message —
> it is the self-contained version of this file plus the project rules, meant to be copied wholesale.

---

## Current state (2026-10-17)

**Project root:** `c:\Users\ADMIN\Downloads\ABB Security gate\ABB ID verification using supabase\Anuj ABB Id verification system\`

**It is one project now.** The frontend and backend are no longer separate roots and there is no separate
admin command:

```
Anuj ABB Id verification system\
  index.html  vite.config.ts  package.json        <- the only package.json
  src\                                            <- React SPA (TanStack Router, no SSR)
  backend\
    migrations\*.sql    scripts\    src\    tests\    data\abb-plant3.db
  public\     project info\     barcode-student-verification-system-add-srs-document\  <- reference only
```

**Commands — there are no others:**

| Command | Purpose |
|---|---|
| `npm install` | Everything, once, from the root. |
| `npm run dev` | API `:4000` + Vite `:8080` together. Open `http://localhost:8080`. |
| `npm run build` | Build the SPA to `dist\`. |
| `npm start` | Production: one process serving API **and** UI on `:4000`. |
| `npm run migrate` | Apply pending migrations. |
| `npm test` | Backend test suite. |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint. |

**Login and signup are real (Phase F3, done 2026-10-17).** `/login` is a password form and `/signup`
creates an account request that an administrator approves on `/users`. The temporary auto sign-in
(`AUTH_AUTO_SIGNIN`, `POST /api/auth/local`) was **deleted**, not flag-disabled. On a fresh install the
first administrator is created while the `users` table is empty, from `ABB_LOCAL_ADMIN_*` (username
`admin`).

**The public surface is exactly four routes**, asserted in both directions at startup:
`GET /api/health`, `POST /api/auth/login`, `POST /api/auth/signup`, `GET /api/check/:code`.

**Reference project:** `barcode-student-verification-system-add-srs-document\` is the user's older college
system — **features and dashboard layout only, never copy its code.** See the mapping table in `phases.md`.

### Phase status

| Phase | Status |
|---|---|
| **A — One root, one command, a running system** | ✅ **complete and verified 2026-10-17** |
| **B — People & credential management** | ✅ **complete and verified** (B1–B8) |
| **C — Gate operations (kiosk, walk-in, incident) ** | ✅ **complete except C5/C6** (lockdown/override — pending decision) |
| **D — Compliance (canteen, incidents, announcements, watchlist, audit)** | ✅ **complete and verified 2026-10-17** (D1–D7) |
| **E — Insight (dashboard summary endpoint, dashboard v2, reports)** | ✅ **complete and verified 2026-10-17** (E1–E4) |
| **F — Public `/check` page, expiry reminders, real login** | ✅ **complete 2026-10-17** (F1 ✅, F3 ✅; **F2 skipped by decision**) |
| G — Hardening, tests, offline, deployment | 🔄 **in progress — G1/G2/G3 done; G4 partly; G5/G6 blocked on a decision** |

### Backend status — done and covered by tests

`GET /api/health` (public) · `POST /api/auth/login` (public) · **`POST /api/auth/signup` (public)** ·
`POST /api/auth/logout` · `GET /api/auth/me` · `GET|POST /api/users` · **`PATCH /api/users/:id`
(approve/disable an account)** · `GET|PUT /api/settings` · `GET /api/people/search` ·
`GET|POST /api/people` · `GET|PATCH /api/people/:id` · `POST /api/people/:id/status` ·
`GET /api/people/:id/credentials` · `POST /api/credentials` · `POST /api/credentials/:id/validity` ·
`POST /api/credentials/:id/status` · `POST /api/gate/verify` · `GET /api/gate/events` ·
`GET /api/inside` · `POST|GET /api/incidents` · `PATCH /api/incidents/:id` · `POST /api/canteen/verify` ·
`GET /api/canteen/events` · `GET|POST /api/announcements` · `POST /api/announcements/:id/deactivate` ·
`GET|POST /api/watchlist` · `POST /api/watchlist/:id/deactivate` · `GET /api/audit` ·
`GET /api/dashboard/summary` · **`GET /api/reports/scans`** · **`GET /api/check/:code` (public)**.

The pure fail-closed rule lives in `backend\src\domain\credential-validity.js`; `gate_events` is
append-only (`backend\src\data\gate-events.js` has no UPDATE and no DELETE). The watchlist gate alert
is **advisory** — it is resolved inside its own `try/catch` in `gate.routes.js` and can never change a
verdict. The public `/check` verdict calls the same `evaluateCredential` rule as the gate, so the two
can never disagree.

### Frontend status — all screens are on the new API

`dashboard.tsx`, `inside.tsx`, `logs.tsx`, `verify.tsx`, `register.tsx`, `users.tsx`, `settings.tsx`,
plus the Phase D screens `canteen.tsx`, `incidents.tsx`, `announcements.tsx`, `watchlist.tsx`,
`audit.tsx`, and the shell (`_authenticated.tsx`, `index.tsx`, `auth-context.tsx`,
`ServerUnreachable.tsx`).

- **No Supabase anywhere** — a case-insensitive search for `supabase` across `src\` returns no matches.
- `NAV_ITEMS` in `_authenticated.tsx` now drives 13 entries: dashboard, verify, inside, logs, **reports**,
  canteen, incidents, announcements, watchlist, register, users, audit, settings (`mobileNavItems` = first
  4). **No NAV_ITEMS entry is outstanding any more.**
- Three **public** screens exist outside the authenticated shell: `src\routes\login.tsx`,
  `src\routes\signup.tsx`, `src\routes\check.tsx`. `index.tsx` sends an anonymous visitor to `/login`
  and shows `<ServerUnreachable />` only for a genuine API outage.
- `dashboard.tsx` is **v2** — the whole page loads from one `GET /api/dashboard/summary` call, and it
  renders the announcements banner and the watchlist alert; the gate verdict overlay renders the
  **advisory** watchlist alert (`verify.tsx`).
- `src\lib\idcard.ts` is rewritten for ABB — ID card + gate pass, **QR of the opaque credential id**
  (card face: ABB logo, name, QR, category, Issued, Valid till). It is consumed by `register.tsx`.
  `verify.tsx` camera readers are **QR-first**. `printGatePass` is still unused by any screen.
- `register.tsx` has the reworked create flow (category tiles, register-and-issue in one dialog),
  the **visitor group** dialog (N visitors → N QR passes) and the clearer **3-step CSV import**.
- `src\lib\offline.ts` and the `idb` dependency are **deleted**; offline mode is Phase G5 (blocked).
- `src\locales\en.json` is fully repaired for ABB and extended with `ctn.*`, `aud.*`, `dash.*` and the
  Phase D additions to `ann.*` and `verify.watchlist_*`.

### Last verified evidence (2026-10-17, Phases E + F and G1–G3)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 — **0 errors** |
| `npx eslint .` | exit 0 — **0 errors**, 7 pre-existing `react-refresh` warnings |
| `npm run build` | exit 0 — `✓ built in 2m 1s` |
| `npm test` | exit 0 — **173 tests, 173 pass, 0 fail**, 34 suites |
| `npm start` | listening on `http://127.0.0.1:4000`, `servingFrontend: true`, **38 routes**, database ready |

Live probes against `npm start`: `GET /api/health` → 200 · `GET /api/check/does-not-exist` → 200 with
`{"card":{"valid":false,"status":"not_found",…}}` · `GET /api/auth/me` → 401 · `GET /login` → 200 (SPA
shell) · `POST /api/auth/signup` → 201 `{"pendingApproval":true}` and that new account then fails to
sign in (401), which is correct: it is disabled until an administrator approves it.

---

## The single next task

**Phase G4 — the repository-wide secret sweep.**

Phases A–F are complete and verified. G1, G2 and G3 are done; the system builds, tests green and runs
(`npm start` serves the API **and** the SPA from one process). G4 is the only unblocked item left.

1. **G4 — sweep the whole repository** (not just the new public route) for a database path or password in
   browser code, `VITE_*` variables, tokens, SMTP credentials, API keys, and any personal data leaking
   through a screen, a CSV/PDF export, a log line or a QR payload. The public `/check` payload already
   has a leak test; the rest of the repository has not been swept. Then re-check the 35 inherited
   `npm audit` vulnerabilities.

**Loose ends recorded, not urgent:** `users.routes.js` and `settings.routes.js` build SQL inline instead
of going through `backend\src\data\`; optional person fields (`email`, `address`) have no migration yet.

**Operational:** set the gate scanner guns to **QR mode** — the card is a QR now.

**[!] PENDING DECISION — ask before building:** C5 (emergency lockdown), C6 (operator override),
F2 (expiry reminders, the user chose to skip), G5 (offline policy), G6 (deployment topology / backup).

---

## Guardrails

- **Inspect before editing.** Never assume a file matches a document.
- **Do not copy the reference project's code.** Read it for features and dashboard ideas only.
- **Do not re-split the roots**, reintroduce Supabase, or add a second component style — reuse
  `src\components\ui\*`.
- **Fail closed.** A technical failure must render UNABLE TO VERIFY, never APPROVED.
- **Never widen the public route surface** without adding it to the asserted allowlist deliberately.
- Ask before deleting files, changing security policy, or running migrations against real data.
- Update `tasks.md`, `phases.md`, `memory.md`, `WORKLOG.md` and this file at the end of every session.

---

## Open questions — do NOT invent answers

1. **Lockdown and override policy** (Phase C5/C6): may a gate operator lock the gate down or override a
   denial, and what must be recorded?
2. **Reminder schedule, recipient, wording, and whether ABB has an SMTP server** (Phase F2).
3. **Deployment topology** (Phase G6): is the SQLite file on one gate laptop, or on a central machine that
   gate laptops reach over the network? How many machines at once? Blocks deployment and backup design.
4. **Offline policy** (Phase G5): allowed at all? What data-age limit?
5. Mandatory vs optional fields beyond the per-category minimum (phone, contractor company, email).
6. Two `*`-marked rows in `PERMISSION-MATRIX.md` (security-staff read scope for incidents/reports/settings).
7. Canteen boundary details beyond "once per person per local day", and whether exceptions exist.
8. `scan.duplicate_window_seconds` = 5 s is provisional.
9. "One live credential per kind per person" is application-enforced, not database-enforced.
10. ABB branding assets, card dimensions, and the ID-issuance approval process.

---

## Loose ends to close

- The reference folder and its `.zip` must be excluded from ESLint and `.gitignore` (typecheck already
  ignores them because `tsconfig.json` only includes `src/**`).
- The old notes about **CORS** in this file's history are **obsolete** — one origin now serves both the API
  and the UI, and the dev server proxies `/api`.
- `users.routes.js` and `settings.routes.js` still build SQL inline while the people/credential/gate routes
  go through `src\data\`; move them onto the data layer when next touched.
- `take_screenshots.cjs` (the UTF-16 lint blocker) was deleted; re-check `npm run format` after Phase A.
- 35 npm audit vulnerabilities in the inherited shell — re-check in Phase G3.
- No Git repository exists (deferred by the user).
