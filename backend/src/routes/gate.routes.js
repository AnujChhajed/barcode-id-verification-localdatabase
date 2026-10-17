import {
  APPROVED,
  REASON_TEXT,
  UNABLE_TO_VERIFY,
  evaluateCredential,
  gateResultFor,
} from "../domain/credential-validity.js";
import { findCredentialById, toCredentialView } from "../data/credentials.js";
import {
  countGateEvents,
  findRecentApprovedScan,
  insertGateEvent,
  listGateEvents,
  listInsidePeople,
  toGateEventView,
} from "../data/gate-events.js";
import { findPersonById, toVerificationView } from "../data/people.js";
import {
  findActiveWatchlistByBarcode,
  findActiveWatchlistForPerson,
  toWatchlistView,
} from "../data/watchlist.js";
import { mainGateId, readIntegerSetting, siteTimezone, siteToday } from "../data/settings.js";
import { logger } from "../lib/logger.js";
import { addSeconds, isEntryUnclosed, nowIso } from "../lib/time.js";
import { listGateEventsQuerySchema, verifyGateSchema } from "../validation/schemas.js";

/**
 * Gate verification and event tracking.
 *
 * Every scan runs the same authoritative check (`evaluateCredential`) against
 * the stored credential and the holder's current status, and every scan writes
 * a row to the append-only `gate_events` table — including the ones that are
 * rejected. Nothing here trusts the client: the gate, the timestamp and the
 * verdict are all decided by the server.
 *
 * FAIL CLOSED: a verdict can only be APPROVED after a successful check AND a
 * successful write. If either is in doubt the answer is UNABLE TO VERIFY, which
 * is a refusal, not a pass.
 */
const GATE_ROLES = ["administrator", "security_staff"];

/** Provisional window; the agreed value is still an open question (see tasks.md). */
const DEFAULT_DUPLICATE_WINDOW_SECONDS = 5;

function isUniqueViolation(error) {
  return String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

/**
 * Records one scan, collapsing a repeated scan of the same credential, in the
 * same direction, at the same gate inside the window into the existing row.
 *
 * The check and the insert run inside a single transaction so two concurrent
 * requests cannot both decide they are the first; `ux_gate_events_dedup` is the
 * database-level backstop if they somehow do.
 *
 * @returns {{eventId: string|null, duplicate: boolean, recorded: boolean}}
 */
function createScanRecorder(db) {
  return db.transaction((scan) => {
    if (scan.result === APPROVED && scan.credentialId) {
      const windowSeconds = readIntegerSetting(
        db,
        "scan.duplicate_window_seconds",
        DEFAULT_DUPLICATE_WINDOW_SECONDS,
        { min: 0, max: 300 },
      );
      const previous = findRecentApprovedScan(db, {
        credentialId: scan.credentialId,
        gateId: scan.gateId,
        direction: scan.direction,
        since: addSeconds(new Date(scan.occurredAt), -windowSeconds),
      });
      if (previous) return { eventId: previous.id, duplicate: true, recorded: true };
    }

    try {
      return { eventId: insertGateEvent(db, scan), duplicate: false, recorded: true };
    } catch (error) {
      // Two requests landed on the same instant and the unique index kept one.
      if (isUniqueViolation(error)) return { eventId: null, duplicate: true, recorded: true };
      throw error;
    }
  });
}

export function registerGateRoutes({ registrar, db }) {
  const recordScan = createScanRecorder(db);

  // -------------------------------------------------------------------------
  // The scan. Returns a verdict and records it.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "POST",
    path: "/api/gate/verify",
    access: GATE_ROLES,
    body: verifyGateSchema,
    handler: (req, res) => {
      const { code, direction } = req.body;
      const now = new Date();
      const occurredAt = nowIso(now);

      let gateId = null;
      let credential = null;
      let person = null;
      let today = null;
      let reason;
      let outcome;

      try {
        gateId = mainGateId(db);
        credential = findCredentialById(db, code) ?? null;
        // A credential whose holder record cannot be read is never an approval.
        person = credential ? (findPersonById(db, credential.person_id) ?? null) : null;
        today = siteToday(db, now);
        reason = evaluateCredential(credential, person?.status, today);
        outcome = gateResultFor(reason);
      } catch (error) {
        logger.error("gate verification could not read authoritative data", {
          error: error?.message,
        });
        reason = { valid: false, code: "indeterminate", text: REASON_TEXT.indeterminate };
        outcome = UNABLE_TO_VERIFY;
      }

      let scan = { eventId: null, duplicate: false, recorded: false };
      if (gateId) {
        try {
          scan = recordScan({
            credentialId: credential?.id ?? null,
            personId: person?.id ?? null,
            gateId,
            direction,
            result: outcome,
            reasonCode: reason.code,
            reasonText: reason.text,
            occurredAt,
            operatorUserId: req.user.id,
          });
        } catch (error) {
          logger.error("gate event could not be recorded", { error: error?.message });
        }
      }

      // An approval that was not written down must not be shown as an approval:
      // the guard would wave someone in on the strength of an entry that does
      // not exist. The scan is downgraded instead.
      if (outcome === APPROVED && !scan.recorded) {
        reason = { valid: false, code: "indeterminate", text: REASON_TEXT.indeterminate };
        outcome = UNABLE_TO_VERIFY;
      }

      // A watchlist alert is ADVISORY: it is shown next to the verdict and never
      // changes it. A failure to read the watchlist must not turn a refusal into
      // a pass, so it is looked up separately and a miss is simply "no alert".
      let watchlist = null;
      try {
        const match =
          findActiveWatchlistForPerson(db, person?.id) ??
          findActiveWatchlistByBarcode(db, credential?.id ?? code);
        if (match) watchlist = toWatchlistView(match);
      } catch (error) {
        logger.error("watchlist lookup failed", { error: error?.message });
      }

      res.json({
        result: outcome,
        reasonCode: reason.code,
        reasonText: reason.text,
        direction,
        occurredAt,
        duplicate: scan.duplicate,
        recorded: scan.recorded,
        eventId: scan.eventId,
        person: person ? toVerificationView(person) : null,
        credential: credential ? toCredentialView(credential) : null,
        watchlist,
      });
    },
  });

  // -------------------------------------------------------------------------
  // The scan history. Read-only; gate_events is append-only.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "GET",
    path: "/api/gate/events",
    access: GATE_ROLES,
    query: listGateEventsQuerySchema,
    handler: (req, res) => {
      const filters = req.validatedQuery;
      res.json({
        events: listGateEvents(db, filters).map(toGateEventView),
        total: countGateEvents(db, filters),
        limit: filters.limit,
        offset: filters.offset,
      });
    },
  });

  // -------------------------------------------------------------------------
  // Who is currently on site: the latest approved event of each person.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "GET",
    path: "/api/inside",
    access: GATE_ROLES,
    handler: (req, res) => {
      const timezone = siteTimezone(db);
      const today = siteToday(db);
      res.json({
        asOf: nowIso(),
        today,
        inside: listInsidePeople(db).map((row) => ({
          person: toVerificationView(row),
          credentialId: row.credential_id,
          gateId: row.gate_id,
          since: row.occurred_at,
          // An entry with no matching exit on the same plant day is flagged, not
          // assumed absent — the exit may simply not have been scanned yet.
          missingExit: isEntryUnclosed(row.occurred_at, timezone, today),
        })),
      });
    },
  });
}
