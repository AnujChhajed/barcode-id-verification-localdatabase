# Handover Prompt — ABB Plant 3 ID Verification System

> **How to use this file.** This is for a **new Antigravity / AI account or developer session** with no memory of previous chats.
> Everything needed to resume work immediately with zero context loss is documented here and in `project info/checklist.md`.
>
> **Last updated:** 2026-10-18 (Session 4 — Repair and ID-Card Prompt Implementation Completed)
> **Test Status:** 173 backend tests passing (173/173), 0 typecheck errors, clean Vite production build.

---

## 1. Quick Resume Summary

You are working on the **ABB Plant 3 Security Gate Verification & ID Management System**.
The application **runs and is fully functional**.
**Strict Scope:** Work ONLY in:
`c:\Users\ADMIN\Downloads\ABB Security gate\ABB ID verification using supabase\Anuj ABB Id verification system\`
(DO NOT edit, delete, or modify `Sagar Barcode id verification Project`).

**Project Master Checklist:**
Always read `project info/checklist.md` first. It has the exhaustive item-by-item status of what was requested in `project info/update and changes prompt.txt`, what has been implemented, and what has been verified.

---

## 2. System Architecture & Commands

- **Single Project Root:** One `package.json` at root.
  * `npm run dev`: Starts Express 5 API on `:4000` + Vite 7 on `:8080` concurrently.
  * `npm run build`: Builds client SPA to `dist/`.
  * `npm start`: Runs single production Node process serving API & static UI on `:4000`.
  * `npm test`: Runs Node native test suite (`node --test backend/tests/*.test.js`). 173 tests, 173 pass.
  * `npm run typecheck`: Runs `tsc --noEmit`. 0 errors.
- **Database:** Local SQLite database at `backend/data/abb-plant3.db` using `better-sqlite3`.
  * Applied migrations: `0001_init.sql`, `0002_seed_plant3.sql`, `0003_incidents_announcements.sql`, `0004_short_id.sql`.
  * Normalized PostgreSQL migration proposal documented in `project info/Architecture.md`.
- **Security:**
  * Password hashing via standard `scrypt`.
  * Server-side session tokens (SHA-256 stored).
  * No password hashes or plain-text credentials are ever returned or displayed in tables.

---

## 3. What Was Implemented in the Latest Update (2026-10-18)

1. **Short Unique IDs & Database Schema:**
   - Added `short_id TEXT` to `people` table with unique index `ux_people_short_id`.
   - Seed records backfilled: Jane Doe (`W101`), ANUJ (`I101`), Vipul (`I102`), Vivek (`I103`).
   - Server-side generator auto-assigns prefixes:
     * Worker: `W101, W102, W103...`
     * Intern: `I101, I102, I103...`
     * Visitor: `V101, V102, V103...`
     * Group Pass: `GRP101, GRP102...`
   - Gate & canteen lookups resolve both physical Code 128 short IDs (`W101`) and UUIDs.

2. **Professional Portrait CR80 ID Card (~54 × 85.6 mm):**
   - Portrait vertical layout only (`src/lib/idcard.ts`).
   - Official ABB logo centered at the top.
   - Category centered title ONLY: "WORKER" / "INTERN" / "VISITOR" (no "CATEGORY:" label).
   - Centered photograph with clean placeholder fallback.
   - Full name clearly readable with letter-spacing.
   - Short ID: `ID NO. W101`.
   - Compact 1D Code 128 barcode encoding the short ID with quiet zones.
   - Validity date near bottom: `VALID UNTIL: DD MMM YYYY`.
   - Footer: `ABB PLANT 3`.
   - Applied to both single ID card print/download and bulk ZIP download.

3. **Gate Verification & Automatic IN/OUT (`verify.tsx`):**
   - Automatic gate IN/OUT: Server detects previous state (`outside` -> `entry`, `inside` -> `exit`).
   - Manual Override Dialog: Operator can force ENTRY or EXIT with a mandatory audit reason.
   - 1.2s cooldown debounce on identical scans to prevent multiple Enter / camera frame duplicate triggers.
   - Corner confirmation toasts:
     * Success entry: `ENTRY RECORDED — [ID]`
     * Success exit: `EXIT RECORDED — [ID]`
     * Rejected: `ACCESS DENIED — [REASON]`
     * Service failure: `UNABLE TO VERIFY — TRY AGAIN`
   - `ResultOverlay` displays prominent `ID NO. [W101...]`, current gate action (`GATE IN` / `GATE OUT`), and direct link to person record.

4. **Canteen Verification Screen (`canteen.tsx`):**
   - 1 approved meal entry per person per local calendar day enforced at DB level.
   - Supports 1D Code 128 short ID barcode scanning.
   - 1.2s debounce.
   - Corner confirmation toasts:
     * Success: `CANTEEN ENTRY RECORDED — [ID]`
     * Duplicate: `ALREADY USED TODAY — [ID]`
     * Rejected: `ACCESS DENIED — [REASON]`
     * Failure: `UNABLE TO VERIFY — TRY AGAIN`

5. **Combined Access Logs & Reports (`logs.tsx`):**
   - Unifies Access Logs and Reports on `/logs` via `<Tabs>`:
     * Access Logs (filterable table, CSV export, PDF export).
     * Reports & Analytics (embedded `ReportsView` with Recharts BarChart, daily tallies, category breakdown, reason breakdown).
     * Daily Attendance (first in / last out).
     * Denied Frequency (rejection frequency analytics).
   - `/logs?tab=reports` activates reports tab automatically.
   - Existing `/reports` route renders `ReportsView` without breaking.

6. **Navigation Streamlined (`_authenticated.tsx`):**
   - Clean 8-item primary navigation:
     1. Dashboard (`/dashboard`)
     2. Gate Scan (`/verify`)
     3. Who's Inside (`/inside`)
     4. Logs & Reports (`/logs`)
     5. Canteen (`/canteen`)
     6. People & Credentials (`/register`)
     7. Users (`/users`)
     8. Settings (`/settings`)
   - Incidents, Announcements, Watchlist, and Audit Trail removed from primary sidebar (backend routes and audit trail preserved).

7. **Login & Users Polish:**
   - Show/hide password toggle (Eye/EyeOff icons) on login form password field (`login.tsx`).
   - Users page (`users.tsx`) displays Account ID, Username, Full Name & Email, Role, Status, Created Date, Last Login Date.
   - Safe password reset modal (`ResetPasswordDialog`) on `/users` with show/hide password toggle.
   - Audited backend endpoint: `POST /api/users/:id/password` (administrator-only).

---

## 4. Verification & Testing Evidence

- **Backend tests:** `npm test` -> 173 tests, 34 test suites, 173 passing, 0 failing.
- **Typecheck:** `npx tsc --noEmit` -> 0 errors.
- **Vite production build:** `npm run build` -> built in 1m 11s, exit code 0.
