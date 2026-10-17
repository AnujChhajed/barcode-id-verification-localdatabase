import {
  APPROVED,
  REASON_TEXT,
  REJECTED,
  UNABLE_TO_VERIFY,
  evaluateCredential,
  gateResultFor,
} from "../domain/credential-validity.js";
import {
  countApprovedForDay,
  countCanteenEvents,
  findApprovedEntryForDay,
  insertCanteenEvent,
  listCanteenEvents,
  toCanteenEventView,
} from "../data/canteen.js";
import { findCredentialById, toCredentialView } from "../data/credentials.js";
import { findPersonById, toVerificationView } from "../data/people.js";
import { siteToday } from "../data/settings.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/time.js";
import { listCanteenEventsQuerySchema, verifyCanteenSchema } from "../validation/schemas.js";

/**
 * Canteen entry verification.
 *
 * This reuses the SAME authoritative check as the gate (`evaluateCredential`)
 * against the same credential and the same holder status, so a suspended card
 * cannot buy lunch. The extra rule is the one the canteen actually owns: an
 * approved entry is limited to ONE per person per local calendar day. That rule
 * is enforced at the database level by `ux_canteen_one_per_day`, so two
 * simultaneous scans cannot both succeed.
 *
 * Every attempt is written to the append-only `canteen_events` table, including
 * refusals, and a scan that cannot be recorded is never shown as approved.
 */
const GATE_ROLES = ["administrator", "security_staff"];

const ALREADY_ENTERED_TEXT = "This person has already had a canteen entry today.";

function isUniqueViolation(error) {
  return String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

/**
 * Records one canteen scan inside a single transaction. A repeat same-day
 * attempt is turned into a recorded refusal rather than an error, so the guard
 * sees a clear "already entered today" answer and the attempt stays on record.
 *
 * @returns {{eventId: string|null, alreadyEntered: boolean, recorded: boolean}}
 */
function createCanteenRecorder(db) {
  return db.transaction((entry) => {
    if (entry.result === APPROVED && entry.personId) {
      const existing = findApprovedEntryForDay(db, entry.personId, entry.entryDate);
      if (existing) {
        const id = insertCanteenEvent(db, {
          ...entry,
          result: REJECTED,
          reasonCode: "already_entered_today",
          reasonText: ALREADY_ENTERED_TEXT,
        });
        return { eventId: id, alreadyEntered: true, recorded: true };
      }
    }

    try {
      return { eventId: insertCanteenEvent(db, entry), alreadyEntered: false, recorded: true };
    } catch (error) {
      // Two scans landed on the same instant and the unique index kept one.
      if (isUniqueViolation(error)) {
        const id = insertCanteenEvent(db, {
          ...entry,
          result: REJECTED,
          reasonCode: "already_entered_today",
          reasonText: ALREADY_ENTERED_TEXT,
        });
        return { eventId: id, alreadyEntered: true, recorded: true };
      }
      throw error;
    }
  });
}

export function registerCanteenRoutes({ registrar, db }) {
  const recordCanteen = createCanteenRecorder(db);

  // -------------------------------------------------------------------------
  // The canteen scan. Returns a verdict and records it.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "POST",
    path: "/api/canteen/verify",
    access: GATE_ROLES,
    body: verifyCanteenSchema,
    handler: (req, res) => {
      const { code } = req.body;
      const now = new Date();
      const occurredAt = nowIso(now);

      let credential = null;
      let person = null;
      let today = siteToday(db, now);
      let reason;
      let outcome;

      try {
        credential = findCredentialById(db, code) ?? null;
        // A credential whose holder cannot be read is never an approval.
        person = credential ? (findPersonById(db, credential.person_id) ?? null) : null;
        reason = evaluateCredential(credential, person?.status, today);
        outcome = gateResultFor(reason);
      } catch (error) {
        logger.error("canteen verification could not read authoritative data", {
          error: error?.message,
        });
        reason = { valid: false, code: "indeterminate", text: REASON_TEXT.indeterminate };
        outcome = UNABLE_TO_VERIFY;
      }

      let scan = { eventId: null, alreadyEntered: false, recorded: false };
      try {
        scan = recordCanteen({
          credentialId: credential?.id ?? null,
          personId: person?.id ?? null,
          entryDate: today,
          result: outcome,
          reasonCode: reason.code,
          reasonText: reason.text,
          occurredAt,
          operatorUserId: req.user.id,
        });
      } catch (error) {
        logger.error("canteen event could not be recorded", { error: error?.message });
      }

      if (scan.alreadyEntered) {
        reason = { valid: false, code: "already_entered_today", text: ALREADY_ENTERED_TEXT };
        outcome = REJECTED;
      } else if (outcome === APPROVED && !scan.recorded) {
        // An approval that was not written down must not be shown as an approval.
        reason = { valid: false, code: "indeterminate", text: REASON_TEXT.indeterminate };
        outcome = UNABLE_TO_VERIFY;
      }

      res.json({
        result: outcome,
        reasonCode: reason.code,
        reasonText: reason.text,
        entryDate: today,
        occurredAt,
        alreadyEntered: scan.alreadyEntered,
        recorded: scan.recorded,
        eventId: scan.eventId,
        person: person ? toVerificationView(person) : null,
        credential: credential ? toCredentialView(credential) : null,
      });
    },
  });

  // -------------------------------------------------------------------------
  // The canteen history and today's tally. Read-only.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "GET",
    path: "/api/canteen/events",
    access: GATE_ROLES,
    query: listCanteenEventsQuerySchema,
    handler: (req, res) => {
      const filters = req.validatedQuery;
      const today = filters.date ?? siteToday(db);
      res.json({
        events: listCanteenEvents(db, filters).map(toCanteenEventView),
        total: countCanteenEvents(db, filters),
        servedToday: countApprovedForDay(db, today),
        date: today,
        limit: filters.limit,
        offset: filters.offset,
      });
    },
  });
}
