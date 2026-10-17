# Permission Matrix — ABB Plant 3 Security Gate Verification & ID Management System

**Status: PROPOSAL — awaiting approval.** No database or code enforces this yet.

With SQLite there is **no Row Level Security**. Every rule below must be implemented as
**centralised backend authorization middleware** (default deny), and proven by **negative tests**
(a `security_staff` account calling an administrator endpoint must be **denied**). Hiding a button
in the UI is not a security control.

---

## 1. Roles

| Role | Code | Purpose |
|---|---|---|
| Administrator | `administrator` | Manages people, credentials, gates, settings, users; views all reports and incidents. |
| Security Staff | `security_staff` | Scans/verifies IDs, searches people, records entry/exit, views verification information, reports incidents, views relevant gate activity. |

Security staff **must not** be able to extend validity, modify sensitive records, or change system
settings unless specifically authorised.

---

## 2. Action matrix

Legend: **A** = administrator, **S** = security staff, **—** = denied.

| # | Action | A | S | Notes |
|---|---|:--:|:--:|---|
| 1 | Log in / log out | ✔ | ✔ | Rate-limited; server-side sessions. |
| 2 | View own session / identity | ✔ | ✔ | |
| 3 | Search people for verification | ✔ | ✔ | Returns only the fields needed for verification. |
| 4 | View a person's full profile | ✔ | — | Security staff see the verification view only. |
| 5 | View a person's photo | ✔ | ✔ | Only via an authenticated, permission-checked endpoint. |
| 6 | Create / edit a person (worker, intern, visitor) | ✔ | — | Required fields validated server-side. |
| 7 | Suspend / terminate a person | ✔ | — | Reason + actor + timestamp recorded. |
| 8 | Issue / regenerate a credential (ID or pass) | ✔ | — | |
| 9 | Print / download a credential PDF | ✔ | ✔ | Security staff may reprint for the holder. |
| 10 | Extend / suspend / terminate a credential | ✔ | — | New expiry date + reason + approver recorded. |
| 11 | Verify a credential at the gate (scan) | ✔ | ✔ | **Never** approves on barcode alone. |
| 12 | Record an entry or exit event | ✔ | ✔ | Append-only. |
| 13 | Correct a missed/wrong scan | ✔ | — | Requires a reason; writes `audit_log`; append-only events. |
| 14 | View gate event history / logs | ✔ | ✔ | Security staff see activity relevant to the gate. |
| 15 | View "who is currently inside Plant 3" | ✔ | ✔ | |
| 16 | Canteen verification (scan) | ✔ | ✔ | One approved entry per person per local day. |
| 17 | View canteen usage reports | ✔ | — | |
| 18 | Create an incident | ✔ | ✔ | |
| 19 | View / edit / close incidents | ✔ | ✔* | Security staff may view and update ones they reported. |
| 20 | View reports (entry/exit, people, expired IDs, rejected) | ✔ | ✔* | Security staff limited to gate-relevant, non-personal reports. |
| 21 | Export reports to CSV / PDF | ✔ | ✔* | Same restriction as viewing. |
| 22 | View the dashboard | ✔ | ✔ | Figures restricted to the role's data. |
| 23 | Manage gates | ✔ | — | |
| 24 | Read settings | ✔ | ✔* | Only settings needed for the gate screen. |
| 25 | Change settings | ✔ | — | |
| 26 | Manage users and permissions | ✔ | — | |
| 27 | View the business audit log | ✔ | — | |
| 28 | Post / manage announcements | ✔ | — | Security staff may **read** them. |
| 29 | Read announcements | ✔ | ✔ | |
| 30 | View email-delivery failures | ✔ | — | |

\* subject to the restriction noted in the "Notes" column — to be confirmed with ABB.

---

## 3. Backend endpoints (proposed)

Public endpoints are the **only** unauthenticated ones and must stay this short:

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/api/health` | GET | **public** (no data) |
| `/api/auth/login` | POST | **public** (rate-limited) |
| `/api/auth/logout` | POST | A, S |
| `/api/auth/me` | GET | A, S |
| `/api/people/search` | GET | A, S (verification fields only) |
| `/api/people` | POST | A |
| `/api/people/:id` | GET | A |
| `/api/people/:id` | PATCH | A |
| `/api/people/:id/status` | POST | A (suspend/terminate) |
| `/api/people/:id/photo` | GET | A, S (permission-checked) |
| `/api/credentials` | POST | A |
| `/api/credentials/:id/validity` | POST | A (extend) |
| `/api/credentials/:id/status` | POST | A (suspend/terminate) |
| `/api/gate/verify` | POST | A, S (returns APPROVED / REJECTED / UNABLE TO VERIFY) |
| `/api/gate/events` | POST | A, S (record entry/exit) |
| `/api/gate/events` | GET | A, S |
| `/api/gate/events/:id/correction` | POST | A (reason required) |
| `/api/inside` | GET | A, S |
| `/api/canteen/verify` | POST | A, S (and the canteen app, via its own authenticated service account) |
| `/api/canteen/reports` | GET | A |
| `/api/incidents` | GET, POST | A, S |
| `/api/incidents/:id` | PATCH | A, S* |
| `/api/announcements` | GET | A, S |
| `/api/announcements` | POST, PATCH | A |
| `/api/gates` | GET | A, S |
| `/api/gates` | POST, PATCH | A |
| `/api/settings` | GET | A, S* |
| `/api/settings` | PUT | A |
| `/api/users` | GET, POST, PATCH | A |
| `/api/reports/:report` | GET | A, S* |
| `/api/audit` | GET | A |
| `/api/notifications/failures` | GET | A |

---

## 4. Non-negotiable enforcement rules

1. **Default deny.** A route is inaccessible unless it is explicitly listed as public or explicitly
   granted to the caller's role. No hand-written per-route checks.
2. **Fail closed.** Any network error, missing record, stale offline data, or server failure yields
   **UNABLE TO VERIFY** — never APPROVED.
3. **Barcode alone is never sufficient.** The record is always validated against current authoritative
   data (status, validity window, permission).
4. **No secrets or personal paths to the browser.** The client receives no SQLite path, DB password,
   SMTP password, or API key, and photographs are served only through permission-checked endpoints.
5. **Server-side validation** on every write, in addition to the form.
6. **Append-only events.** `gate_events` and `canteen_events` are never updated or deleted; corrections
   add rows and an `audit_log` entry carrying actor, timestamp and reason.
7. **Duplicate/concurrency safety** enforced by database constraints and transactions
   (`ux_canteen_one_per_day`, `ux_gate_events_dedup`), not only in the UI.

---

## 5. Open items affecting this matrix

- Confirm the two rows marked \* (exact security-staff read scope for incidents, reports, settings).
- Confirm the permission matrix with the ABB stakeholder (handover open question #2).
- The `scan.duplicate_window_seconds` value (defaulted to 5 s) is provisional.
