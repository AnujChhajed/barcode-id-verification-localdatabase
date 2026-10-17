import {
  countAuditEntries,
  listAuditActions,
  listAuditEntries,
  toAuditView,
} from "../data/audit.js";
import { listAuditQuerySchema } from "../validation/schemas.js";

/**
 * The business audit trail, read-only and administrator-only.
 *
 * This is the record of privileged actions (who issued, suspended, extended,
 * flagged or triaged what, and why). It is deliberately separate from the
 * diagnostic logs, and it is never shown to gate staff as an editable surface.
 */
const ADMINISTRATOR_ONLY = ["administrator"];

export function registerAuditRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/audit",
    access: ADMINISTRATOR_ONLY,
    query: listAuditQuerySchema,
    handler: (req, res) => {
      const filters = req.validatedQuery;
      res.json({
        entries: listAuditEntries(db, filters).map(toAuditView),
        total: countAuditEntries(db, filters),
        actions: listAuditActions(db),
        limit: filters.limit,
        offset: filters.offset,
      });
    },
  });
}
