# NEXT-SESSION.md — resume from here

> Read this first, then `project info\checklist.md` → `project info\memory.md` → `project info\phases.md` → `project info\tasks.md`,
> then the newest entry in `WORKLOG.md`.
>
> **Starting a brand-new chat/account?** Paste `project info\HANDOVER-PROMPT.md` as the first message —
> it is the self-contained version of this file plus the project rules, meant to be copied wholesale.

---

## Current state (2026-10-18 — Post Update & Changes Execution)

**Project root:** `c:\Users\ADMIN\Downloads\ABB Security gate\ABB ID verification using supabase\Anuj ABB Id verification system\`

**Single Project Root:**
- `package.json` at root.
- `npm run dev`: API `:4000` + Vite `:8080` concurrently.
- `npm run build`: Production bundle (`dist/`).
- `npm start`: Single Node process serving API + UI on `:4000`.
- `npm test`: Node test runner -> **173 tests, 34 suites, 173 passed (100%)**.
- `npm run typecheck`: TypeScript -> **0 errors**.

### Latest Delivered Upgrades (2026-10-18):
1. **Short IDs & Schema Migration (`0004_short_id.sql`):**
   - Unique column `short_id` on `people`.
   - Seed data backfilled (`W101`, `I101`, `I102`, `I103`).
   - Auto-generated prefixes: `W101...` (Worker), `I101...` (Intern), `V101...` (Visitor), `GRP101...` (Group Pass).
   - Backend lookups in gate and canteen support both short IDs and UUIDs.
2. **Portrait CR80 Vertical ID Cards (~54 × 85.6 mm):**
   - ABB logo centered at the top.
   - Category title only: "WORKER" / "INTERN" / "VISITOR".
   - Centered photograph.
   - Full name with uppercase tracking.
   - `ID NO. W101`.
   - Compact 1D Code 128 barcode encoding the short ID.
   - `VALID UNTIL: DD MMM YYYY`.
   - `ABB PLANT 3` footer.
   - Both single and bulk ZIP download support Code 128 barcodes.
3. **Automatic Gate IN/OUT & Debounce:**
   - Server detects direction (`outside` -> `entry`, `inside` -> `exit`).
   - Manual Override Dialog with mandatory written audit reason.
   - 1.2s cooldown debounce on identical scans.
   - Corner confirmation toasts on every scan attempt.
   - `ResultOverlay` displays prominent short ID, gate state, and person record link.
4. **Canteen Verification Screen:**
   - 1 approved entry per day enforced at DB level.
   - Code 128 short ID barcode scanning.
   - Corner confirmation toasts.
5. **Combined Access Logs & Reports (`/logs`):**
   - 4 tabs: Access Logs, Reports & Analytics, Daily Attendance, Denied Frequency.
   - Preserves standalone `/reports` route.
6. **Navigation Streamlined:**
   - 8 primary navigation items: Dashboard, Gate Scan, Who's Inside, Logs & Reports, Canteen, People & Credentials, Users, Settings.
7. **Login & Users Polish:**
   - Show/hide password toggle on login form password input.
   - User table displays Account ID, Username, Name, Role, Status, Created Date, Last Login Date.
   - Safe `POST /api/users/:id/password` route + `ResetPasswordDialog` modal for administrators.
