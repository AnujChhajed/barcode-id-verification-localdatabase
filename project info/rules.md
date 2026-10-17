# Business Rules — ABB ID Verification and Gate Security System

**Scope:** ABB Plant 3 only
**Status:** Rules marked **[Confirmed]** come from the requirements document. Rules marked **[Pending]**
require confirmation from ABB or the project owner. **Do not invent answers to pending items.**

Enforce these rules in the backend. Frontend checks are for usability only and are never a security
control.

---

## 1. Purpose

Defines the rules for managing people, issuing IDs/passes, verifying access, recording gate events,
handling expiry, and producing reports.

---

## 2. Person categories

**[Confirmed]** Three categories:

1. Contract or temporary workers
2. Internship students
3. Visitors

The system does not replace ABB's HR system for permanent employees.

**[Pending]** Whether any additional category is required.

---

## 3. Minimum data collection

**[Confirmed]** Required fields per the requirements document:

- **Contract / temporary worker:** full name, worker ID (or an auto-generated unique ID), photograph,
  phone number, contractor company name, work start date, work end date / ID validity date, assigned
  location ABB Plant 3.
- **Internship student:** full name, auto-generated unique ID, photograph, phone number,
  college/institution name, internship start date, internship end date, assigned location ABB Plant 3.
- **Visitor:** visitor name, mobile number, purpose of visit, employee/person to meet, employee email
  (if required), visit date, gate pass validity, photograph (if required).

Practical rules:

- Additional fields are optional unless ABB policy requires them.
- Keep the entry form short and clear; security staff must be able to register quickly.
- Mark only genuinely mandatory fields as required and validate them before saving.
- Prevent accidental duplicate records.
- Do not collect Aadhaar or other identity-document details unless ABB has approved the exact need,
  access controls and retention policy.

**[Pending]** Final confirmation of mandatory vs optional fields per category.

---

## 4. Identifiers and credentials

- Each person record has a unique internal identifier.
- Each issued credential/pass has a unique identifier.
- A credential links to exactly one person record.
- The barcode/QR payload contains an **opaque identifier or token — never personal details**.
- Every scan is resolved against current authoritative data at verification time.
- **Possession or copying of a code never grants access by itself.**
- A lost, replaced, revoked or suspended credential must no longer authorize access.
- Printed cards and screenshots are not a bypass; the live check decides.

---

## 5. Validity rules

- Every credential has a start date and an end date.
- The start date must not be later than the end date.
- A credential is date-valid only while the current time falls within its validity period.
- Validity is checked at every verification — not only when the ID is created.
- An expired credential is rejected even if the record still exists and even if no reminder was sent.
- Timestamps are stored in UTC and displayed in the approved local time zone.
- Changing an expiry updates the database and the verification rules, not merely the printed card.

**[Confirmed]** Every ID/pass has a validity or expiry date and expiry is enforced at the gate.

**[Pending]** Whether the end date means the end of that calendar day or an exact time, and the default
duration per category.

---

## 6. Verification outcomes

Every verification attempt produces exactly one of:

### APPROVED
Only when the system has reliably confirmed the credential is valid, active, in date, and permitted for
Plant 3.

### REJECTED
When a known rule prevents access: unknown credential; expired credential; revoked or suspended
credential; inactive record; access not permitted for this gate or context; another confirmed policy
restriction. The operator sees a clear reason.

### UNABLE TO VERIFY
When authorization cannot be reliably established: database or backend unavailable; required data
unavailable; session or service failure; offline data not permitted or too old under the approved policy.

**Security rule:** a technical failure must never be converted into APPROVED. Follow ABB's approved
manual escalation procedure when the system cannot verify access.

---

## 7. Gate event rules

- Entry and exit are recorded as separate event types.
- An event stores: timestamp (UTC), person/credential reference, gate, authenticated operator,
  verification outcome, and a reason where applicable.
- Record the event only after the operation actually succeeded. **Do not show success to the operator
  if the event was not saved.**
- Retries must not create unintended duplicate events.
- Current-inside status is derived from event history under a documented policy.
- An entry with no matching exit is flagged for review under the approved process.
- Historical gate events are never silently rewritten. Any authorized correction records the operator,
  timestamp, reason, and the previous value.
- Gate events are append-only.

**[Confirmed]** Entry and exit are tracked separately; the system shows who is currently inside; missing
exits are identifiable; authorized corrections are audited.

**[Pending]** Whether an approved scan records the event automatically or the operator selects entry vs
exit; how unmatched events are resolved.

---

## 8. Duplicate scans and concurrent requests

- Repeated scans must not create duplicate entry events or duplicate canteen uses.
- Legitimate later events must not be blocked merely because the person was scanned earlier.
- Critical duplicate prevention is enforced by database constraints and transactions, never by the
  client alone.
- Simultaneous scans must be handled safely.
- The operator receives a clear message when a scan is treated as a duplicate or needs review.

**[Pending]** The duplicate-detection window and the exact behaviour for rapid repeated scans.

---

## 9. Expiry, renewal, suspension and revocation

**[Confirmed]** from the requirements document:

- Track upcoming expiries automatically.
- Send an email reminder before expiry according to a **configurable** reminder period.
- Send a notification when the credential actually expires, telling the recipient to contact the
  administrator for an extension.
- Show upcoming and expired records on the administrator dashboard.
- An administrator may extend validity, suspend, or terminate.
- An extension requires the new expiry date **and a reason**.
- Record who approved the change and when.
- Without an approved extension, the ID becomes expired and is rejected at the gate.
- Expired records are retained for historical reporting — **never deleted**.
- If email delivery fails, record the failure and make it visible to the administrator.
- Use a reliable scheduled process, not something that only runs when someone opens the app.

Additional rules:

- Only authorized roles may extend validity or change credential status.
- Record previous and new values for important changes.
- Renewal must not erase the credential's history.
- Revoked or suspended credentials fail verification.
- Expiry fails verification regardless of whether a reminder was delivered.
- A credential is not reactivated without the required authorization.
- Sending an email never extends validity.

**[Pending]** The exact reminder interval value, the recipient address source, the email wording, whether
extensions require a second approver, and the expiry boundary.

---

## 10. Person record changes

- Only authorized users may create, edit, deactivate or reactivate records.
- Validate all changes before saving.
- Preserve audit history.
- Do not hard-delete a record needed to explain historical gate events; use deactivation or the approved
  retention workflow.
- A change of category or validity must not bypass credential rules.
- Show security operators only the minimum personal information needed for verification.

---

## 11. Roles and permissions

**[Confirmed]** Two roles:

**Administrator**
- Manage workers, interns and visitors.
- Generate and print IDs.
- Extend validity; deactivate IDs.
- Manage gates and system settings.
- View reports and incidents.
- Manage authorized users and permissions.

**Security Operator**
- Scan and verify IDs.
- Search for people.
- Record entry and exit.
- View the information required for verification.
- Report security incidents.
- View relevant gate activity.
- **Must not** extend validity, modify sensitive records, or change system settings unless specifically
  authorized.

Optional roles: canteen operator, read-only/report user.

**Permissions are enforced in the backend. Hiding a control in the UI does not make an operation
secure.** Every denial path must be covered by a negative test.

**[Pending]** The exact permission matrix — who may issue, approve, renew, suspend, revoke, correct,
export and delete.

---

## 12. Canteen rules

**[Confirmed]** in scope — the requirements document defines a canteen verification screen:

- Scan the barcode/QR code.
- Check eligibility.
- Check whether the person has already used their permitted entry that day.
- Allow the first eligible entry.
- Reject a second entry the same day with a clear message.
- Save the successful entry's date and time.
- Prevent simultaneous scans from creating duplicate successful entries.
- Provide canteen usage reports.
- Default rule: **one entry per person per day**, reset by the configured local date.

Additional rules: count only successful transactions; enforce the limit in the database; record rejected
attempts for authorized review; define an exception process.

**[Pending]** Whether the limit is once per calendar day, per meal, or another schedule; the applicable
local day and time zone; whether exceptions are allowed.

---

## 13. Barcode/QR and printing rules

**[Confirmed]** the ID/pass is a small portrait card showing the ABB logo, photograph (optional), name,
category (worker / intern / visitor), barcode or QR code, issue date and validity/expiry date. Printing
and PDF download are required. Administrators may regenerate or deactivate. Do not print unnecessary
sensitive personal information.

Rules:

- Generate codes only for validly created credentials.
- Each code resolves to its intended credential.
- Never place sensitive personal details in the code.
- Display only approved fields on the printed card.
- Live verification reflects current status regardless of what is printed.
- A printed card or screenshot must not bypass server-side verification.

**[Pending]** Final card size, orientation, front/back layout, required fields, and approved ABB branding.

---

## 14. Error handling and logs

- Show the user a clear message stating what to do next.
- Never display raw stack traces, database internals, file paths or secret values to users.
- Record technical errors in protected diagnostic logs.
- Keep business audit history separate from diagnostic logs.
- Never log passwords, access tokens, keys, or unnecessary personal data.
- Include a request/correlation identifier where practical.
- Never report an operation as successful if saving or processing failed.
- Log important administrative changes and gate-event corrections.

---

## 15. Reports and calculations

**[Confirmed]** required reports: daily entry/exit, worker and intern records, visitor records, expired ID
reports, canteen usage, incident reports, rejected verification reports. CSV and PDF export where
applicable, restricted to authorized roles.

**[Confirmed]** dashboard figures: active workers and interns, visitors, today's entries and exits,
people currently inside Plant 3, rejected verifications, IDs expiring soon, expired IDs and passes, recent
incidents, recent gate activity.

Rules:

- Use a consistent time zone and documented date-range rules.
- Define the meaning of every dashboard total.
- Distinguish people, credentials, scan attempts, successful events and rejected events.
- Do not count a scan treated as a duplicate as a separate successful entry.
- Derive current-inside status using the approved entry/exit rules.
- Make corrections and missing events visible in the relevant reports.
- Restrict reports and exports by role.

---

## 16. Security and failure rules

- Enforce authorization in the backend — **there is no database-level access control to rely on**.
- Use database constraints, foreign keys and unique indexes for integrity and duplicate prevention.
- Never trust client-supplied role, validity or approval values.
- If authoritative verification fails, return UNABLE TO VERIFY.
- Notification failure must never change credential validity.
- A missing audit entry must never be silently replaced with a success message.
- Back up the database before risky changes; follow the approved recovery procedure.
- Keep the database file outside any shared network folder.

---

## 17. Open decisions before production

1. Required vs optional fields per person category.
2. The exact expiry boundary and default validity duration per category.
3. The full role and permission matrix.
4. Entry/exit recording method and unmatched-event resolution.
5. Duplicate-scan behaviour and time window.
6. Renewal, suspension and revocation approval flow.
7. Reminder schedule, recipient source and email wording.
8. Canteen limit boundary and exception process.
9. Offline verification policy, if any.
10. Photo and identity-document requirements.
11. Data retention, deletion and correction policy.
12. ID layout, size and approved branding.
13. Report definitions and export permissions.
14. **Deployment topology, backup schedule, and whether encryption at rest is required.**
15. Whether an ABB SMTP server and credentials are available.

---

## 18. Documented deviation from the requirements document

The requirements document (§14) states that the existing Supabase integration should be retained for the
time being. **The project owner and their mentor have decided instead to use a local SQLite database
behind a backend API.** This deviation is recorded deliberately so that no reader believes it was an
oversight, and it carries the consequence described in `Architecture.md` §6: **all authorization must be
implemented and tested in the backend, because SQLite provides no Row Level Security.**

---

## 19. Instructions to the implementing agent

Read `memory.md`, `PRD.md`, `Architecture.md`, the requirements DOCX and the current code before
implementing.

Treat every **[Pending]** item as unresolved. Do not silently invent company policy. Implement confirmed
rules in the trusted layer, add tests covering both success and failure paths, and keep `tasks.md` updated
with progress and unresolved questions.
