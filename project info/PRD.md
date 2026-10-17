# Product Requirements Document (PRD)

## ABB ID Verification and Gate Security System — Plant 3

**Status:** Requirements captured. Read `memory.md` first for the verified workspace facts and locked
decisions, and `rules.md` for the confirmed-vs-pending business rules.

**Verified baseline:** no application code exists in the project root yet. The interface shell is to be
reused from the existing college application; its data model, backend and business logic are replaced.

---

## 1. Purpose

The system helps authorized security personnel verify whether a person is permitted to enter or exit
ABB Plant 3.

It manages person records and credentials, validates access, records gate events, and provides dashboards
and reports.

This is an adaptation of an existing ID/barcode verification application. Working UI, scanning, ID
printing, PDF/CSV export, offline queue and i18n must be reused rather than rebuilt.

---

## 2. Objectives

- Verify identity and current access authorization at the gate.
- Manage contract workers, temporary workers, internship students and visitors.
- Support barcode/QR scanning and manual search.
- Maintain credential validity and access status.
- Record entry and exit events.
- Identify expired, revoked, invalid and unknown credentials.
- Provide authorized dashboards, searches and reports.
- Maintain an audit trail of important operations.
- Protect personal information and enforce role-based access.
- Preserve existing working features.

---

## 3. Scope

### 3.1 Initial scope

**ABB Plant 3 only.** There is exactly **one physical gate**, `"Plant 3 - Main Gate"`.

The system manages:
- Contract and temporary workers
- Internship students
- Visitors
- Their credentials and access validity
- Entry/exit tracking, canteen verification, dashboards, reports and audit history

It is not intended to replace ABB's HR system for permanent employees.

### 3.2 Exclusions

- Plant 1 or Plant 2 workflows or screens
- A replacement for ABB's HR or identity systems
- Automatic access approval based purely on barcode contents
- Unapproved biometric or facial-recognition functionality
- Production use with real personal data before the required security review and approvals

---

## 4. User roles

**[Confirmed]** Two roles. The exact permission matrix requires owner approval.

### Administrator
- Manage workers, interns and visitors.
- Generate and print IDs.
- Extend validity; deactivate IDs.
- Manage gates and system settings.
- View reports and incidents.
- Manage authorized users and permissions.

### Security Operator
- Scan or search for a credential.
- View the minimum information needed for verification.
- Record entry and exit events.
- Review verification outcomes and relevant history.
- Report security incidents.
- **Must not** extend validity, modify sensitive records, or change settings unless explicitly
  authorized.

### Optional roles
Canteen operator; read-only/report user.

**Permissions must be enforced in the backend.** Hiding an interface control is not a security control,
and this system's database provides no access control of its own.

---

## 5. Functional requirements

### FR-01: Person management

Authorized users can create, view, search, update and deactivate person records, review validity and
status, and attach an approved photograph where policy requires it.

Each record has a unique internal identifier. Required fields come from the requirements document and
ABB policy — not invention. Validate required values and prevent accidental duplicates. Collect only
what is necessary for approved operational purposes.

### FR-02: ID and credential management

- Associate each ID/pass with the correct person record.
- Generate a barcode or QR code using the existing libraries.
- Support printing and PDF output.
- Use an **opaque identifier** in the code; never encode personal information.
- Resolve every scan against the authoritative record and current status.
- Support authorized renewal, suspension, deactivation and revocation.

A barcode or QR code is a lookup mechanism, not proof that access is authorized.

### FR-03: Gate verification

The workflow:

1. Accept a barcode/QR scan or an authorized manual search.
2. Find the corresponding record.
3. Check that it exists and is active.
4. Check the validity dates.
5. Check the suspension/revocation status.
6. Check that access is permitted for Plant 3.
7. Determine the outcome.
8. Record the event and the reason.

The interface must clearly show one of:

- **APPROVED** — the current checks passed.
- **REJECTED** — a known authorization rule failed, with the reason.
- **UNABLE TO VERIFY** — the system could not reliably establish authorization.

A network error, missing record, stale offline data or server failure must never silently grant access.

### FR-04: Entry and exit tracking

- Entry and exit recorded as separate events.
- Events include the person, UTC timestamp, event type, operator and gate.
- Current-inside status derived from event history under a documented policy.
- Duplicate scans and inconsistent sequences detected where feasible.
- Entries without an exit are identifiable for review.
- Authorized corrections record the actor, timestamp, reason and previous value.
- Historical events are never silently rewritten; events are append-only.
- Daily entry/exit reports are available.

### FR-05: Expiry and renewal

**[Confirmed]** required:

- Enforce validity dates during every verification.
- Display upcoming expirations and expired credentials.
- Send an email reminder before expiry on a configurable schedule.
- Send a notification on expiry, directing the recipient to the administrator.
- Let an administrator extend, suspend or terminate, with a new expiry date **and a reason**, recording
  the approver and time.
- Retain expired records for historical reporting; never delete them.
- Record reminder delivery failures and surface them to administrators.
- Use a reliable server-side scheduled process.

Email reminders are a convenience, never the control. Expiry is enforced by verification regardless of
whether a reminder was delivered.

### FR-06: Canteen verification

**[Confirmed]** in scope. A separate screen that scans the barcode/QR, checks eligibility and same-day
usage, allows the first eligible entry for the day, rejects a second with a clear message, saves the
successful entry's date and time, prevents simultaneous scans from creating duplicates, and provides
canteen usage reports. Default rule: **one entry per person per local day**.

The final limit boundary and any exception process require confirmation.

### FR-07: Dashboard and reports

**[Confirmed]** dashboard figures: total active workers and interns, total visitors, today's entries and
exits, people currently inside Plant 3, rejected gate verifications, IDs expiring soon, expired IDs and
passes, recent incidents, recent gate activity.

**[Confirmed]** reports: daily entry and exit, worker and intern records, visitor records, expired ID
reports, canteen usage, incident reports, rejected verification reports — with CSV and PDF export where
applicable, restricted by role.

Report definitions, date ranges and the time zone must be explicit. Preserve the existing export and PDF
functionality.

### FR-08: Existing feature review

Inspect the existing shell for: dashboard, barcode scanner, manual search, person management, visitor
passes, attendance-style reports, incident management, announcements, gate management, settings, offline
scanning and PDF generation.

These are **features to inspect**, not assumptions that they work. Preserve what is useful and test it
before changing it.

### FR-09: Audit history

Important actions must be auditable: record creation and updates; credential issuance, renewal,
suspension and revocation; permission and configuration changes; gate-event corrections; other
privileged operations.

Audit records identify the actor, timestamp, action, affected record and reason.

Never log passwords, keys, tokens or unnecessary sensitive data, and keep business audit history separate
from diagnostic logs.

---

## 6. Non-functional requirements

### Security

- Authenticated access for every protected operation.
- Least privilege; default deny.
- **All authorization enforced in the backend** — the database provides no access control.
- No secret of any kind reaches the browser: no database path, database password, SMTP password or API
  key in frontend code or `VITE_*` variables.
- Photographs and documents served only through authenticated, permission-checked endpoints.
- Server-side validation of all important input.
- No unnecessary personal data in errors, logs or barcode payloads.
- Database file protected with restricted filesystem permissions, scheduled backups and encryption at
  rest where the machine could be stolen.

### Reliability

- Fail closed for authorization.
- Return `UNABLE TO VERIFY` when current authorization cannot be reliably established.
- Safe retries; no duplicate events or duplicate canteen uses.
- Clear error messages.
- Back up before risky changes; document and test recovery.

### Usability

- The gate workflow must be fast and unambiguous.
- APPROVED, REJECTED and UNABLE TO VERIFY must be visually distinct.
- Clear labels and useful validation messages.
- Approved ABB branding only.

### Maintainability

- Inspect the inherited stack before changing it.
- Incremental, reviewable changes.
- Document configuration, database changes, setup, tests and known limitations.
- Keep the project resumable across sessions.

---

## 7. Acceptance criteria

Before production approval, verify that:

1. Authorized users can manage supported person records.
2. Each credential resolves to the correct record.
3. Barcode/QR contents expose no personal information.
4. Valid access passes the required authorization checks.
5. Expired, revoked, suspended, invalid and unknown credentials do not grant access.
6. System failures return `UNABLE TO VERIFY` rather than approval.
7. Entry and exit events are recorded and reviewable.
8. Privileged actions are protected by backend-enforced permissions, **proven by negative tests**.
9. Important changes and corrections are auditable.
10. A second same-day canteen entry is rejected, including under simultaneous requests.
11. Reports reconcile with the underlying event data and match their documented definitions.
12. Existing working features have been regression-tested.
13. Required ABB policy and security decisions are resolved.
14. Backup, restore and recovery procedures are documented and tested.

---

## 8. Open questions

Confirm with the project owner or ABB. **Do not invent answers.**

- Which fields are mandatory for each person category?
- Who may issue, approve, renew, suspend, revoke, correct and export records?
- What exactly does the end date mean, and what is the default validity per category?
- What reminder period, recipient address and wording are required?
- Is offline verification permitted, and with what freshness limit?
- What is the duplicate-scan window and behaviour?
- Does an approved scan record entry/exit automatically, or does the operator choose?
- What is the canteen limit boundary and exception process?
- Which ABB branding assets are approved; what card layout and issuance approval process apply?
- What privacy, retention, deletion and data-residency requirements apply?
- **What is the deployment topology — one laptop or one server, and how many machines use the app?**
- What backup schedule and encryption-at-rest requirement apply?
- Is an ABB SMTP server and credentials available?
- What is the approved release process?

---

## 9. Development approach

1. Inspect the existing repository and preserve current work.
2. Read the requirements document in full. It is a **DOCX**, not a PDF, at
   `local database\barcode-id-verification\project info\requirement pdf for friend.docx`.
3. Identify the actual application root and technology stack.
4. Compare the requirements with the existing implementation.
5. Document the real architecture and its gaps.
6. Confirm the business and security decisions listed in §8.
7. Implement one small task at a time.
8. Run the relevant checks after each change and report actual results.
9. Update `tasks.md`, `WORKLOG.md` and `NEXT-SESSION.md`.
10. Obtain approval before destructive operations, schema migrations, or any deployment.

---

## 10. Note for the implementing agent

This document describes intended requirements. It does not prove that any feature is implemented.

Inspect the requirements document and the current code before changing anything. Preserve existing work,
report uncertainty honestly, surface conflicts instead of silently resolving them, and ask before major or
destructive changes.

Do not claim a feature works unless it has been verified and tested.
