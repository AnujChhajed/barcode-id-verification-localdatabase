/**
 * The single authoritative answer to "may this credential be used today?".
 *
 * This module is intentionally pure — no database, no clock, no request. The
 * caller supplies the stored credential, the status of the person it belongs
 * to, and the local calendar date. That makes it reusable by credential
 * management, gate verification and canteen verification, and it makes the rule
 * testable in isolation.
 *
 * FAIL CLOSED: any input that cannot be evaluated yields `valid: false` with a
 * reason code. There is no path through this function that guesses a yes.
 *
 * Reason codes are stable strings; they are stored in
 * `gate_events.reason_code` / `canteen_events.reason_code`.
 */

/** `valid: true` — the credential may be presented. */
export const VALID = { valid: true, code: null, text: null };

function invalid(code, text) {
  return { valid: false, code, text };
}

export const REASON_TEXT = {
  not_found: "No credential matches this code.",
  indeterminate: "The credential could not be checked.",
  not_yet_valid: "The credential is not valid yet.",
  expired: "The credential has expired.",
  suspended: "The credential is suspended.",
  terminated: "The credential has been terminated.",
  person_suspended: "The holder is suspended.",
  person_terminated: "The holder is no longer registered.",
};

/**
 * @param {object|null|undefined} credential  row with `status`, `valid_from`, `valid_to`
 * @param {string} personStatus               `active` | `suspended` | `terminated`
 * @param {string} today                      local calendar date, `YYYY-MM-DD`
 * @returns {{valid: boolean, code: string|null, text: string|null}}
 */
export function evaluateCredential(credential, personStatus, today) {
  if (!credential) return invalid("not_found", REASON_TEXT.not_found);

  // An unreadable date can never produce an approval.
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return invalid("indeterminate", REASON_TEXT.indeterminate);
  }

  // The holder's status is checked first: suspending a person must take effect
  // immediately, whatever the credential says.
  if (personStatus === "terminated")
    return invalid("person_terminated", REASON_TEXT.person_terminated);
  if (personStatus === "suspended")
    return invalid("person_suspended", REASON_TEXT.person_suspended);
  if (personStatus !== "active") return invalid("indeterminate", REASON_TEXT.indeterminate);

  if (credential.status === "terminated") return invalid("terminated", REASON_TEXT.terminated);
  if (credential.status === "suspended") return invalid("suspended", REASON_TEXT.suspended);
  if (credential.status !== "active") return invalid("indeterminate", REASON_TEXT.indeterminate);

  const { valid_from: from, valid_to: to } = credential;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
    return invalid("indeterminate", REASON_TEXT.indeterminate);
  }

  // `valid_to` is inclusive: the credential is valid THROUGH that day.
  if (today < from) return invalid("not_yet_valid", REASON_TEXT.not_yet_valid);
  if (today > to) return invalid("expired", REASON_TEXT.expired);

  return VALID;
}

/** Convenience boolean for views that only need the flag. */
export function isValidCredential(credential, personStatus, today) {
  return evaluateCredential(credential, personStatus, today).valid;
}

/** The three outcomes the gate is allowed to display. */
export const APPROVED = "approved";
export const REJECTED = "rejected";
export const UNABLE_TO_VERIFY = "unable_to_verify";

/**
 * Maps a validity verdict onto the gate's outcome.
 *
 * The distinction is deliberate and load-bearing:
 *   - `not_found` means the authoritative check RAN and the answer is "no" —
 *     the code matches no credential. That is a rejection, not a failure.
 *   - `indeterminate` means the check could NOT be carried out (unreadable date,
 *     unknown status, missing dependent record). That is UNABLE TO VERIFY.
 *
 * Only a verdict that actually came back valid can ever produce APPROVED, so no
 * amount of upstream breakage can push a scan through the gate.
 */
export function gateResultFor(validity) {
  if (validity?.valid === true) return APPROVED;
  return validity?.code === "indeterminate" ? UNABLE_TO_VERIFY : REJECTED;
}
