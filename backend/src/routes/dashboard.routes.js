import { buildDashboardSummary } from "../data/dashboard.js";
import { dashboardSummaryQuerySchema } from "../validation/schemas.js";

/**
 * The dashboard's single read endpoint.
 *
 * It replaces the fan-out of per-figure requests the screen used to make: today
 * is a slice of one range query over the append-only `gate_events`, so every
 * number on the dashboard comes from the same snapshot and reconciles
 * (scans === approved + rejected + unable).
 *
 * Both gate roles may read it. It exposes counts only — no personal data — so
 * a security operator sees the same operational picture as an administrator.
 */
const DASHBOARD_ROLES = ["administrator", "security_staff"];

export function registerDashboardRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/dashboard/summary",
    access: DASHBOARD_ROLES,
    query: dashboardSummaryQuerySchema,
    handler: (req, res) => {
      res.json(buildDashboardSummary(db, { days: req.validatedQuery.days }));
    },
  });
}
