import { config } from "../config.js";
import { newId } from "../lib/ids.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/time.js";
import { hashPassword } from "./password.js";

/**
 * The very first administrator account.
 *
 * A fresh install has an empty `users` table, which would mean nobody could
 * ever sign in — there would be no way to reach `/users` and create an account.
 * So exactly one is created, and only while the table is empty.
 *
 * Every later start leaves the table alone, so changing the password is not
 * undone by a restart. Override the defaults with `ABB_LOCAL_ADMIN_*` before
 * any real deployment.
 */

function findLocalAdmin(db) {
  return (
    db
      .prepare("SELECT * FROM users WHERE username = ? AND is_active = 1")
      .get(config.localAdmin.username) ?? null
  );
}

/** How many accounts exist at all — used only to decide whether to bootstrap. */
export function countUsers(db) {
  return db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
}

/**
 * Creates the first administrator only when no accounts exist at all.
 * Returns the new account, or `null` when the table already had users.
 */
export function ensureFirstAdmin(db) {
  if (countUsers(db) > 0) return null;

  const { username, password, fullName, email } = config.localAdmin;
  const id = newId();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO users
       (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, 'administrator', 1, ?, ?, NULL)`,
  ).run(id, username, email, fullName, hashPassword(password), timestamp, timestamp);

  logger.warn(
    `no user accounts existed — created the "${username}" administrator account. Change its password.`,
    { username },
  );

  return findLocalAdmin(db);
}
