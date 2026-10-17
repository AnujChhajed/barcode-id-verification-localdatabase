import { hashPassword } from "../auth/password.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, notFound } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { createUserSchema, idParamSchema, updateUserStatusSchema } from "../validation/schemas.js";

/** Administrator-only. Security staff must never reach these routes. */
const ADMINISTRATOR_ONLY = ["administrator"];

const USER_COLUMNS = "id, username, email, full_name, role, is_active, created_at, last_login_at";

function toUserView(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export function registerUserRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/users",
    access: ADMINISTRATOR_ONLY,
    handler: (req, res) => {
      // Explicit column list: the password hash can never leave the database.
      const rows = db
        .prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY username COLLATE NOCASE`)
        .all();
      res.json({ users: rows.map(toUserView) });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/users",
    access: ADMINISTRATOR_ONLY,
    body: createUserSchema,
    handler: (req, res, next) => {
      const { username, fullName, role, password, email } = req.body;

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
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
        ).run(
          id,
          username,
          email ?? null,
          fullName,
          hashPassword(password),
          role,
          timestamp,
          timestamp,
        );
      } catch (error) {
        if (String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT")) {
          return next(conflict("That username is already taken."));
        }
        throw error;
      }

      writeAudit(db, {
        actorUserId: req.user.id,
        action: "user.create",
        entityType: "user",
        entityId: id,
        newValue: { username, fullName, role },
      });

      const created = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
      res.status(201).json({ user: toUserView(created) });
    },
  });

  /**
   * Enable or disable a sign-in account.
   *
   * This is what approves a self-service signup: `/api/auth/signup` always
   * creates a DISABLED account, and nothing else in the system can turn it on.
   * Two guards keep an administrator from locking the plant out:
   *
   *   - an administrator cannot disable their own account (no self-lockout),
   *   - the last enabled administrator cannot be disabled at all, which would
   *     otherwise leave nobody able to re-enable it.
   */
  registrar.defineRoute({
    method: "PATCH",
    path: "/api/users/:id",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: updateUserStatusSchema,
    handler: (req, res, next) => {
      const { id } = req.validatedParams;
      const { isActive } = req.body;

      const target = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
      if (!target) return next(notFound("No such user account."));

      if (!isActive) {
        if (target.id === req.user.id) {
          return next(conflict("You cannot disable the account you are signed in with."));
        }
        if (target.role === "administrator") {
          const others = db
            .prepare(
              "SELECT COUNT(*) AS total FROM users WHERE role = 'administrator' AND is_active = 1 AND id <> ?",
            )
            .get(id).total;
          if (others === 0) {
            return next(conflict("This is the last active administrator account."));
          }
        }
      }

      db.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").run(
        isActive ? 1 : 0,
        nowIso(),
        id,
      );

      writeAudit(db, {
        actorUserId: req.user.id,
        action: isActive ? "user.enable" : "user.disable",
        entityType: "user",
        entityId: id,
        oldValue: { isActive: target.is_active === 1 },
        newValue: { isActive },
      });

      const updated = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
      res.json({ user: toUserView(updated) });
    },
  });
}
