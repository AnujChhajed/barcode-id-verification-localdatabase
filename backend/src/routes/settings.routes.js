import { writeAudit } from "../lib/audit.js";
import { nowIso } from "../lib/time.js";
import { updateSettingSchema } from "../validation/schemas.js";

/**
 * Security staff may READ settings, but only the keys the gate screen needs.
 * Everything else is administrator-only.
 */
const GATE_READABLE_KEYS = new Set([
  "site.timezone",
  "session.timeout_minutes",
  "scan.duplicate_window_seconds",
]);

export function registerSettingsRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/settings",
    access: ["administrator", "security_staff"],
    handler: (req, res) => {
      const rows = db.prepare("SELECT key, value, updated_at FROM settings ORDER BY key").all();
      const visible =
        req.user.role === "administrator"
          ? rows
          : rows.filter((row) => GATE_READABLE_KEYS.has(row.key));
      res.json({
        settings: visible.map((row) => ({
          key: row.key,
          value: row.value,
          updatedAt: row.updated_at,
        })),
      });
    },
  });

  registrar.defineRoute({
    method: "PUT",
    path: "/api/settings",
    access: ["administrator"],
    body: updateSettingSchema,
    handler: (req, res) => {
      const { key, value } = req.body;
      const timestamp = nowIso();
      const previous = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);

      db.prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      ).run(key, value, timestamp, req.user.id);

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "setting.update",
        entityType: "setting",
        entityId: key,
        oldValue: previous ? { value: previous.value } : null,
        newValue: { value },
      });

      res.json({ setting: { key, value, updatedAt: timestamp } });
    },
  });
}
