import { buildScanReport } from "../data/reports.js";
import { scanReportQuerySchema } from "../validation/schemas.js";

/**
 * Reports — the date-range view of the same append-only `gate_events` the
 * dashboard reads.
 *
 * Both gate roles may read it. The report is counts and reason codes only: it
 * names no individual, so a security operator sees the same operational picture
 * as an administrator, and widening it later to include people would be a
 * visible, auditable change to this one file.
 */
const REPORT_ROLES = ["administrator", "security_staff"];

export function registerReportsRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/reports/scans",
    access: REPORT_ROLES,
    query: scanReportQuerySchema,
    handler: (req, res) => {
      const { from, to } = req.validatedQuery;
      res.json(buildScanReport(db, { from, to }));
    },
  });
}
