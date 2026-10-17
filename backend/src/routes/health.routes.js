import { PUBLIC } from "../auth/middleware.js";
import { nowIso } from "../lib/time.js";

export function registerHealthRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/health",
    access: PUBLIC,
    handler: (req, res) => {
      let database = "ready";
      try {
        db.prepare("SELECT 1 AS ok").get();
      } catch {
        database = "unavailable";
      }
      // Deliberately returns no configuration, counts, paths or versions.
      res.json({
        status: database === "ready" ? "ok" : "degraded",
        database,
        time: nowIso(),
      });
    },
  });
}
