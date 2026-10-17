import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { openDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { newId } from "../src/lib/ids.js";
import { nowIso } from "../src/lib/time.js";

/** Fresh database in a temp directory, migrated and wrapped in an Express app. */
export function createTestContext({ rateLimit, corsOrigins } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "abb-plant3-test-"));
  const db = openDatabase(path.join(directory, "test.db"));
  runMigrations(db);
  const app = createApp({ db, rateLimit, corsOrigins });
  return {
    db,
    app,
    directory,
    cleanup() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function seedUser(db, { username, password, role, fullName = "Test User", email = null }) {
  const id = newId();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO users
       (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
  ).run(id, username, email, fullName, hashPassword(password), role, timestamp, timestamp);
  return id;
}

export async function startServer(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractSessionCookie(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  const session = cookies.find((value) => value.startsWith("abb_session="));
  return session ? session.split(";")[0] : null;
}

export async function request(baseUrl, method, path, { body, cookie, origin } = {}) {
  const verb = method.toUpperCase();
  const payload =
    body !== undefined && verb !== "GET" && verb !== "HEAD" ? JSON.stringify(body) : undefined;
  const response = await fetch(`${baseUrl}${path}`, {
    method: verb,
    headers: {
      ...(payload ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    body: payload,
  });
  return { res: response, json: await safeJson(response) };
}

export const postJson = (baseUrl, path, body, cookie) =>
  request(baseUrl, "POST", path, { body: body ?? {}, cookie });

export async function login(baseUrl, username, password) {
  const { res, json } = await request(baseUrl, "POST", "/api/auth/login", {
    body: { username, password },
  });
  return { res, json, cookie: extractSessionCookie(res) };
}
