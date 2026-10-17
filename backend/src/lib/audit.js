import { newId } from "./ids.js";
import { nowIso } from "./time.js";

/**
 * Business audit trail. Every privileged or state-changing action goes here.
 *
 * Rules:
 *   - Append only. Never updated or deleted.
 *   - Never stores passwords, tokens, keys or unnecessary personal data.
 *   - `oldValue` / `newValue` are JSON snapshots; callers must pass only the
 *     fields that actually changed and that are safe to retain.
 */
export function writeAudit(db, entry) {
  db.prepare(
    `INSERT INTO audit_log
       (id, actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, occurred_at)
     VALUES
       (@id, @actor_user_id, @action, @entity_type, @entity_id, @old_value, @new_value, @reason, @occurred_at)`,
  ).run({
    id: newId(),
    actor_user_id: entry.actorUserId ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    old_value: entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
    new_value: entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
    reason: entry.reason ?? null,
    occurred_at: nowIso(),
  });
}
