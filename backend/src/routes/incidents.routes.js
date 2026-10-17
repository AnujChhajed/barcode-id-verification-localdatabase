import {
  countIncidents,
  findIncidentById,
  insertIncident,
  listIncidents,
  setIncidentStatus,
  toIncidentView,
} from "../data/incidents.js";
import { findPersonById } from "../data/people.js";
import { mainGateId } from "../data/settings.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import {
  createIncidentSchema,
  idParamSchema,
  listIncidentsQuerySchema,
  updateIncidentSchema,
} from "../validation/schemas.js";

/**
 * Incidents filed from the gate, and their triage.
 *
 * A guard must be able to record what just happened without leaving the gate
 * screen, so filing is open to the gate roles. The gate is resolved server-side
 * (never accepted from the client), and the report is written to the audit log
 * as well as the `incidents` table.
 *
 * Reading and triaging is also a gate-role concern: the operator who took the
 * report is the one who follows it up. Every status change writes an audit row.
 */
const GATE_ROLES = ["administrator", "security_staff"];

export function registerIncidentRoutes({ registrar, db }) {
  // -------------------------------------------------------------------------
  // File a report.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "POST",
    path: "/api/incidents",
    access: GATE_ROLES,
    body: createIncidentSchema,
    handler: (req, res, next) => {
      const input = req.body;

      // Linking to a person is optional, but never to a person that is not on
      // file — a dangling reference would make the report unusable later.
      if (input.personId && !findPersonById(db, input.personId)) {
        return next(badRequest("The person this incident refers to does not exist."));
      }

      const id = insertIncident(db, { ...input, gateId: mainGateId(db) }, req.user.id);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "incident.create",
        entityType: "incident",
        entityId: id,
        newValue: {
          title: input.title,
          severity: input.severity,
          personId: input.personId ?? null,
        },
      });

      res.status(201).json({ incident: toIncidentView(findIncidentById(db, id)) });
    },
  });

  // -------------------------------------------------------------------------
  // The incident register. Read-only.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "GET",
    path: "/api/incidents",
    access: GATE_ROLES,
    query: listIncidentsQuerySchema,
    handler: (req, res) => {
      const filters = req.validatedQuery;
      res.json({
        incidents: listIncidents(db, filters).map(toIncidentView),
        total: countIncidents(db, filters),
        limit: filters.limit,
        offset: filters.offset,
      });
    },
  });

  // -------------------------------------------------------------------------
  // Triage: move a report between open / investigating / closed.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "PATCH",
    path: "/api/incidents/:id",
    access: GATE_ROLES,
    params: idParamSchema,
    body: updateIncidentSchema,
    handler: (req, res, next) => {
      const { id } = req.validatedParams;
      const existing = findIncidentById(db, id);
      if (!existing) return next(notFound("That incident does not exist."));

      const { status, reason } = req.body;
      setIncidentStatus(db, id, status);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "incident.status",
        entityType: "incident",
        entityId: id,
        oldValue: { status: existing.status },
        newValue: { status },
        reason: reason ?? null,
      });

      res.json({ incident: toIncidentView(findIncidentById(db, id)) });
    },
  });
}
