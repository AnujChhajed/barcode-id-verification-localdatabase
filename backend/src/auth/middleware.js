import { config } from "../config.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { findActiveSession, touchSession } from "./sessions.js";

/**
 * Centralised authentication + role authorization.
 *
 * Every route MUST declare one of:
 *   - `PUBLIC`        no authentication (kept to an explicit, asserted allowlist)
 *   - `AUTHENTICATED` any signed-in user, regardless of role
 *   - `[roles...]`    only those roles
 *
 * An empty list, a missing declaration, or an unknown value is DENIED. Route
 * handlers never inspect `req.user.role` themselves — that is the whole point:
 * one place decides, and it is covered by negative tests.
 */

export const PUBLIC = "public";
export const AUTHENTICATED = "authenticated";

/** Re-write `sessions.last_seen_at` at most this often, to avoid a write per request. */
const TOUCH_INTERVAL_MS = 60_000;

export function isValidAccessDeclaration(access) {
  if (access === PUBLIC || access === AUTHENTICATED) return true;
  return (
    Array.isArray(access) && access.length > 0 && access.every((role) => typeof role === "string")
  );
}

export function createAuthorize({ db }) {
  const selectUser = db.prepare(
    "SELECT id, username, full_name, role, is_active FROM users WHERE id = ?",
  );

  return function authorize(access) {
    return function authorizeMiddleware(req, res, next) {
      if (access === PUBLIC) return next();

      const token = req.cookies?.[config.sessionCookieName];
      const session = findActiveSession(db, token);
      if (!session) return next(unauthorized());

      const user = selectUser.get(session.user_id);
      if (!user || !user.is_active) return next(unauthorized("This account is not active."));

      const lastSeen = Date.parse(session.last_seen_at ?? "");
      if (Number.isNaN(lastSeen) || Date.now() - lastSeen > TOUCH_INTERVAL_MS) {
        try {
          touchSession(db, session.id);
        } catch {
          // Session liveness is best-effort; never fail a request over it.
        }
      }

      req.user = {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
      };
      req.sessionId = session.id;

      if (access === AUTHENTICATED) return next();

      const allowedRoles = Array.isArray(access) ? access : [];
      if (!allowedRoles.includes(user.role)) {
        logger.warn("authorization denied", {
          userId: user.id,
          role: user.role,
          method: req.method,
          path: req.originalUrl,
        });
        return next(forbidden());
      }

      return next();
    };
  };
}
