import { AUTHENTICATED, PUBLIC } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSession, revokeSession } from "../auth/sessions.js";
import { config } from "../config.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, tooManyRequests, unauthorized } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/time.js";
import { loginSchema, signupSchema } from "../validation/schemas.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict",
  secure: config.sessionCookieSecure,
  path: "/",
};

/**
 * A throwaway hash verified when the username does not exist, so a missing
 * account and a wrong password cost the same time — no username enumeration.
 */
const ABSENT_USER_HASH = hashPassword("absent-user-placeholder");

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    email: row.email ?? null,
  };
}

export function registerAuthRoutes({ registrar, db, rateLimiter, sessionTimeoutMinutes }) {
  const selectUserByUsername = db.prepare("SELECT * FROM users WHERE username = ?");
  const selectUserByEmail = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE");

  registrar.defineRoute({
    method: "POST",
    path: "/api/auth/login",
    access: PUBLIC,
    body: loginSchema,
    handler: (req, res, next) => {
      const { username, password } = req.body;
      const rateKey = `login:${username.toLowerCase()}:${req.ip ?? "unknown"}`;

      if (!rateLimiter.check(rateKey).allowed) {
        logger.warn("login rate limited", { username });
        return next(tooManyRequests());
      }

      const user = selectUserByUsername.get(username) ?? selectUserByEmail.get(username);
      const passwordOk = verifyPassword(password, user ? user.password_hash : ABSENT_USER_HASH);

      if (!user || !passwordOk || !user.is_active) {
        logger.warn("login failed", { username });
        return next(unauthorized("Invalid username or password."));
      }

      rateLimiter.reset(rateKey);

      const session = createSession(db, { userId: user.id, timeoutMinutes: sessionTimeoutMinutes });
      db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
      writeAudit(db, {
        actorUserId: user.id,
        action: "auth.login",
        entityType: "user",
        entityId: user.id,
      });

      res.cookie(config.sessionCookieName, session.token, {
        ...COOKIE_OPTIONS,
        expires: new Date(session.expiresAt),
      });
      logger.info("login succeeded", { userId: user.id, role: user.role });
      res.json({ user: publicUser(user), expiresAt: session.expiresAt });
    },
  });

  // ---------------------------------------------------------------------------
  // Self-service signup.
  //
  // Two rules make this safe to expose without a session:
  //
  //   1. The caller cannot choose a role. Every account this route creates is
  //      `security_staff` — never an administrator.
  //   2. The account is created DISABLED. It cannot sign in until an
  //      administrator enables it on `/users`, so a signup is a request for
  //      access, not a grant of it.
  //
  // No session is issued here, for the same reason: there is nothing to sign
  // into yet.
  // ---------------------------------------------------------------------------
  registrar.defineRoute({
    method: "POST",
    path: "/api/auth/signup",
    access: PUBLIC,
    body: signupSchema,
    handler: (req, res, next) => {
      const { username, fullName, password, email } = req.body;

      const taken = db
        .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
        .get(username);
      if (taken) return next(conflict("That username is already taken."));

      const id = newId();
      const timestamp = nowIso();
      try {
        db.prepare(
          `INSERT INTO users
             (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, 'security_staff', 0, ?, ?, NULL)`,
        ).run(id, username, email ?? null, fullName, hashPassword(password), timestamp, timestamp);
      } catch (error) {
        if (String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
          return next(conflict("That username is already taken."));
        }
        throw error;
      }

      // Audited with no actor: the account did not exist a moment ago, so there
      // is nobody to attribute the request to.
      writeAudit(db, {
        actorUserId: null,
        action: "auth.signup",
        entityType: "user",
        entityId: id,
        newValue: { username, fullName, role: "security_staff", isActive: false },
      });

      logger.info("signup requested — awaiting administrator approval", { userId: id });
      res.status(201).json({ pendingApproval: true, user: { username, fullName } });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/auth/logout",
    access: AUTHENTICATED,
    handler: (req, res) => {
      if (req.sessionId) revokeSession(db, req.sessionId);
      writeAudit(db, {
        actorUserId: req.user.id,
        action: "auth.logout",
        entityType: "user",
        entityId: req.user.id,
      });
      res.clearCookie(config.sessionCookieName, COOKIE_OPTIONS);
      res.json({ ok: true });
    },
  });

  registrar.defineRoute({
    method: "GET",
    path: "/api/auth/me",
    access: AUTHENTICATED,
    handler: (req, res) => {
      res.json({ user: req.user });
    },
  });
}
