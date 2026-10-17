import {
  findActiveCredentialOfKind,
  findCredentialById,
  insertCredential,
  setCredentialStatus,
  toCredentialView,
  updateCredentialValidity,
} from "../data/credentials.js";
import { findPersonById } from "../data/people.js";
import { siteToday } from "../data/settings.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, notFound } from "../lib/errors.js";
import {
  createCredentialSchema,
  credentialStatusSchema,
  credentialValiditySchema,
  idParamSchema,
} from "../validation/schemas.js";

/**
 * Credential lifecycle is administrator-only. Issuing, extending, suspending and
 * terminating all write to `audit_log` with the actor, the before/after values
 * and the stated reason, so "who changed whose pass, and why" is always
 * answerable. Credentials are never deleted: an expired or terminated pass stays
 * on record as evidence.
 */
const ADMINISTRATOR_ONLY = ["administrator"];

function currentView(credential, personStatus, today) {
  return toCredentialView(credential, { personStatus, today });
}

export function registerCredentialRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "POST",
    path: "/api/credentials",
    access: ADMINISTRATOR_ONLY,
    body: createCredentialSchema,
    handler: (req, res, next) => {
      const { personId, kind, validFrom, validTo } = req.body;

      const person = findPersonById(db, personId);
      if (!person) return next(notFound("No such person."));
      if (person.status !== "active") {
        return next(conflict("A credential cannot be issued to a suspended or terminated person."));
      }

      // One live credential of each kind per person; use the status endpoint to
      // suspend the old one first if it is being replaced.
      if (findActiveCredentialOfKind(db, personId, kind)) {
        return next(
          conflict(
            `This person already holds an active ${kind === "id_card" ? "ID card" : "gate pass"}.`,
          ),
        );
      }

      const id = insertCredential(db, { personId, kind, validFrom, validTo }, req.user.id);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "credential.issue",
        entityType: "credential",
        entityId: id,
        newValue: { personId, kind, validFrom, validTo },
      });

      const today = siteToday(db);
      res.status(201).json({
        credential: currentView(findCredentialById(db, id), person.status, today),
      });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/credentials/:id/validity",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: credentialValiditySchema,
    handler: (req, res, next) => {
      const credential = findCredentialById(db, req.params.id);
      if (!credential) return next(notFound("No such credential."));
      if (credential.status === "terminated") {
        return next(conflict("A terminated credential cannot be renewed."));
      }

      const { validFrom, validTo, reason } = req.body;
      updateCredentialValidity(db, credential.id, { validFrom, validTo });

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "credential.validity_change",
        entityType: "credential",
        entityId: credential.id,
        oldValue: { validFrom: credential.valid_from, validTo: credential.valid_to },
        newValue: { validFrom, validTo },
        reason,
      });

      const person = findPersonById(db, credential.person_id);
      res.json({
        credential: currentView(
          findCredentialById(db, credential.id),
          person?.status,
          siteToday(db),
        ),
      });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/credentials/:id/status",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: credentialStatusSchema,
    handler: (req, res, next) => {
      const credential = findCredentialById(db, req.params.id);
      if (!credential) return next(notFound("No such credential."));

      const { status, reason } = req.body;
      if (credential.status !== status) {
        setCredentialStatus(db, credential.id, status);
        writeAudit(db, {
          actorUserId: req.user.id,
          action: "credential.status_change",
          entityType: "credential",
          entityId: credential.id,
          oldValue: { status: credential.status },
          newValue: { status },
          reason,
        });
      }

      const person = findPersonById(db, credential.person_id);
      res.json({
        credential: currentView(
          findCredentialById(db, credential.id),
          person?.status,
          siteToday(db),
        ),
      });
    },
  });
}
