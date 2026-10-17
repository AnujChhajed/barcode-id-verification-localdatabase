import { hashToken, newToken } from "../lib/ids.js";
import { addMinutes, isPast, nowIso } from "../lib/time.js";

/**
 * Server-side sessions.
 *
 * The raw token lives only in the client cookie; the database stores its
 * SHA-256 hash. Sessions expire, can be revoked individually (logout) or in
 * bulk (password change, account suspension), and are validated fail-closed.
 */

export function createSession(db, { userId, timeoutMinutes }) {
  const token = newToken();
  const sessionId = hashToken(token);
  const now = new Date();
  const createdAt = nowIso(now);
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, revoked_at, last_seen_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(sessionId, userId, createdAt, addMinutes(now, timeoutMinutes), createdAt);
  return { token, sessionId, expiresAt: addMinutes(now, timeoutMinutes) };
}

/** Returns the session row only when it is present, unrevoked and unexpired. */
export function findActiveSession(db, token, now = new Date()) {
  if (typeof token !== "string" || token.length === 0) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(hashToken(token));
  if (!row) return null;
  if (row.revoked_at) return null;
  if (isPast(row.expires_at, now)) return null;
  return row;
}

export function touchSession(db, sessionId, now = new Date()) {
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(now), sessionId);
}

export function revokeSession(db, sessionId) {
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(
    nowIso(),
    sessionId,
  );
}

export function revokeAllSessionsForUser(db, userId) {
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(
    nowIso(),
    userId,
  );
}

/** Housekeeping: drop sessions that expired or were revoked before `beforeIso`. */
export function purgeStaleSessions(db, beforeIso) {
  return db
    .prepare(
      "DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)",
    )
    .run(beforeIso, beforeIso).changes;
}
