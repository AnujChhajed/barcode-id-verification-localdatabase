import {
  countPeople,
  findLikelyDuplicate,
  findPersonById,
  insertPerson,
  listPeople,
  setPersonStatus,
  toPersonView,
  toVerificationView,
  updatePerson,
} from "../data/people.js";
import {
  activeCredentialIdsForPeople,
  listCredentialsForPerson,
  toCredentialView,
} from "../data/credentials.js";
import { plantThreeId, siteToday } from "../data/settings.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  createPersonSchema,
  idParamSchema,
  listPeopleQuerySchema,
  missingCategoryFields,
  personStatusSchema,
  searchPeopleQuerySchema,
  updatePersonSchema,
} from "../validation/schemas.js";

/**
 * People and credential records are personal data, so:
 *   - creating / editing / suspending is administrator-only;
 *   - gate staff may only run the read-only verification search, which returns
 *     identification fields and nothing else.
 * Route handlers never test the role themselves — the access declaration below
 * is the single decision point.
 */
const ADMINISTRATOR_ONLY = ["administrator"];
const GATE_ROLES = ["administrator", "security_staff"];

function isUniqueViolation(error) {
  return String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

function missingDetails(missing) {
  return badRequest(
    "Required details are missing for this category.",
    missing.map((field) => ({ path: field, message: "Required." })),
  );
}

export function registerPeopleRoutes({ registrar, db }) {
  // -------------------------------------------------------------------------
  // Gate search: identification only, for a scan or a manual lookup.
  // IMPORTANT: registered before `/api/people/:id` so "search" is never read as
  // an identifier.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "GET",
    path: "/api/people/search",
    access: GATE_ROLES,
    query: searchPeopleQuerySchema,
    handler: (req, res) => {
      const { q, limit } = req.validatedQuery;
      const rows = listPeople(db, { q, limit, offset: 0 });
      const codes = activeCredentialIdsForPeople(
        db,
        rows.map((row) => row.id),
      );
      res.json({
        people: rows.map((row) => ({
          ...toVerificationView(row),
          // The code the guard would otherwise read off the card. Present so a
          // broken card does not stop the gate; the verdict is still decided
          // server-side by `POST /api/gate/verify`.
          activeCredentialId: codes.get(row.id) ?? null,
        })),
      });
    },
  });

  // -------------------------------------------------------------------------
  // Full register: administrator only.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "GET",
    path: "/api/people",
    access: ADMINISTRATOR_ONLY,
    query: listPeopleQuerySchema,
    handler: (req, res) => {
      const filters = req.validatedQuery;
      const rows = listPeople(db, filters);
      res.json({
        people: rows.map(toPersonView),
        total: countPeople(db, filters),
        limit: filters.limit,
        offset: filters.offset,
      });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/people",
    access: ADMINISTRATOR_ONLY,
    body: createPersonSchema,
    handler: (req, res, next) => {
      const input = req.body;

      const missing = missingCategoryFields(input.category, input);
      if (missing.length) return next(missingDetails(missing));

      const duplicate = findLikelyDuplicate(db, input);
      if (duplicate) {
        return next(conflict("A person with the same name, category and phone already exists."));
      }

      let id;
      try {
        id = insertPerson(db, { ...input, plantId: plantThreeId(db) }, req.user.id);
      } catch (error) {
        // Backstop for the unique index on (plant_id, worker_ref).
        if (isUniqueViolation(error)) {
          return next(conflict("That worker reference is already registered."));
        }
        throw error;
      }

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "person.create",
        entityType: "person",
        entityId: id,
        newValue: { category: input.category, fullName: input.fullName },
      });

      res.status(201).json({ person: toPersonView(findPersonById(db, id)) });
    },
  });

  registrar.defineRoute({
    method: "GET",
    path: "/api/people/:id",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    handler: (req, res, next) => {
      const person = findPersonById(db, req.params.id);
      if (!person) return next(notFound("No such person."));

      const today = siteToday(db);
      const credentials = listCredentialsForPerson(db, person.id).map((row) =>
        toCredentialView(row, { personStatus: person.status, today }),
      );

      res.json({ person: toPersonView(person), credentials });
    },
  });

  registrar.defineRoute({
    method: "PATCH",
    path: "/api/people/:id",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: updatePersonSchema,
    handler: (req, res, next) => {
      const stored = findPersonById(db, req.params.id);
      if (!stored) return next(notFound("No such person."));

      // A category change can invalidate a previously complete record, so the
      // merged result is re-checked, not just the submitted fields.
      const merged = { ...toPersonView(stored), ...req.body };
      const missing = missingCategoryFields(merged.category, merged);
      if (missing.length) return next(missingDetails(missing));

      const changed = Object.keys(req.body);
      updatePerson(db, stored.id, req.body);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "person.update",
        entityType: "person",
        entityId: stored.id,
        oldValue: Object.fromEntries(changed.map((field) => [field, toPersonView(stored)[field]])),
        newValue: req.body,
      });

      res.json({ person: toPersonView(findPersonById(db, stored.id)) });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/people/:id/status",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: personStatusSchema,
    handler: (req, res, next) => {
      const stored = findPersonById(db, req.params.id);
      if (!stored) return next(notFound("No such person."));

      const { status, reason } = req.body;
      if (stored.status !== status) {
        setPersonStatus(db, stored.id, status);
        writeAudit(db, {
          actorUserId: req.user.id,
          action: "person.status_change",
          entityType: "person",
          entityId: stored.id,
          oldValue: { status: stored.status },
          newValue: { status },
          reason,
        });
      }

      res.json({ person: toPersonView(findPersonById(db, stored.id)) });
    },
  });

  registrar.defineRoute({
    method: "GET",
    path: "/api/people/:id/credentials",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    handler: (req, res, next) => {
      const person = findPersonById(db, req.params.id);
      if (!person) return next(notFound("No such person."));

      const today = siteToday(db);
      res.json({
        credentials: listCredentialsForPerson(db, person.id).map((row) =>
          toCredentialView(row, { personStatus: person.status, today }),
        ),
      });
    },
  });
}
