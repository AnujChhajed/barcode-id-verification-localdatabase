import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

const ADMIN = {
  username: "admin.user",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "Admin User",
  email: "admin@example.test",
};
const STAFF = {
  username: "gate.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "Gate Staff",
};

let context;
let server;
let adminCookie;
let staffCookie;

before(async () => {
  context = createTestContext();
  seedUser(context.db, ADMIN);
  seedUser(context.db, STAFF);
  server = await startServer(context.app);
});

after(async () => {
  if (server) await server.close();
  context?.cleanup();
});

describe("public surface", () => {
  test("health is reachable without a session", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/health");
    assert.equal(res.status, 200);
    assert.equal(json.status, "ok");
  });

  test("an unregistered route is 404, never 200", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/not-a-route");
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "NOT_FOUND");
  });
});

describe("authentication", () => {
  test("protected endpoints reject anonymous callers with 401", async () => {
    const probes = [
      ["GET", "/api/users"],
      ["GET", "/api/settings"],
      ["GET", "/api/auth/me"],
      ["POST", "/api/auth/logout"],
    ];
    for (const [method, path] of probes) {
      const { res } = await request(server.baseUrl, method, path, {
        body: method === "GET" ? undefined : {},
      });
      assert.equal(res.status, 401, `${method} ${path} should require a session`);
    }
  });

  test("a wrong password is rejected with 401 and no session cookie", async () => {
    const { res, cookie } = await login(server.baseUrl, ADMIN.username, "wrong-password-value");
    assert.equal(res.status, 401);
    assert.equal(cookie, null);
  });

  test("an invalid login body is rejected with 400", async () => {
    const { res, json } = await postJson(server.baseUrl, "/api/auth/login", {
      username: ADMIN.username,
    });
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "BAD_REQUEST");
  });

  test("a tampered session cookie is rejected", async () => {
    const { res } = await request(server.baseUrl, "GET", "/api/auth/me", {
      cookie: "abb_session=not-a-real-token",
    });
    assert.equal(res.status, 401);
  });

  test("the administrator can sign in and read its own identity", async () => {
    const result = await login(server.baseUrl, ADMIN.username, ADMIN.password);
    assert.equal(result.res.status, 200);
    assert.ok(result.cookie, "expected a session cookie");
    adminCookie = result.cookie;

    const { res, json } = await request(server.baseUrl, "GET", "/api/auth/me", {
      cookie: adminCookie,
    });
    assert.equal(res.status, 200);
    assert.equal(json.user.role, "administrator");
    assert.equal(json.user.password_hash, undefined);
  });

  test("an administrator can sign in with their email address", async () => {
    const result = await login(server.baseUrl, "ADMIN@EXAMPLE.TEST", ADMIN.password);
    assert.equal(result.res.status, 200);
    assert.ok(result.cookie, "expected a session cookie");
    assert.equal(result.json.user.username, ADMIN.username);
  });

  test("security staff can sign in", async () => {
    const result = await login(server.baseUrl, STAFF.username, STAFF.password);
    assert.equal(result.res.status, 200);
    staffCookie = result.cookie;
    assert.ok(staffCookie);
  });

  test("logout revokes the session immediately", async () => {
    const temporary = await login(server.baseUrl, STAFF.username, STAFF.password);
    const out = await postJson(server.baseUrl, "/api/auth/logout", {}, temporary.cookie);
    assert.equal(out.res.status, 200);

    const afterwards = await request(server.baseUrl, "GET", "/api/auth/me", {
      cookie: temporary.cookie,
    });
    assert.equal(afterwards.res.status, 401);
  });

  test("repeated failures are rate limited with 429", async () => {
    const victim = "rate.limit.target";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const { res } = await login(server.baseUrl, victim, "wrong-password-value");
      assert.equal(res.status, 401, `attempt ${attempt} should be 401`);
    }
    const { res, json } = await login(server.baseUrl, victim, "wrong-password-value");
    assert.equal(res.status, 429);
    assert.equal(json.error.code, "TOO_MANY_REQUESTS");
  });
});

describe("role authorization — security staff must be denied administrator endpoints", () => {
  test("security staff CANNOT list users", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/users", {
      cookie: staffCookie,
    });
    assert.equal(res.status, 403);
    assert.equal(json.error.code, "FORBIDDEN");
    assert.equal(json.users, undefined);
  });

  test("security staff CANNOT create users", async () => {
    const { res } = await postJson(
      server.baseUrl,
      "/api/users",
      {
        username: "sneaky.admin",
        fullName: "Sneaky",
        role: "administrator",
        password: "long-enough-pass-123",
      },
      staffCookie,
    );
    assert.equal(res.status, 403);
    assert.equal(
      context.db.prepare("SELECT id FROM users WHERE username = ?").get("sneaky.admin"),
      undefined,
    );
  });

  test("security staff CANNOT change settings", async () => {
    const { res } = await request(server.baseUrl, "PUT", "/api/settings", {
      body: { key: "session.timeout_minutes", value: "9999" },
      cookie: staffCookie,
    });
    assert.equal(res.status, 403);
    const stored = context.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("session.timeout_minutes");
    assert.equal(stored.value, "30");
  });
});

describe("administrator capabilities", () => {
  test("administrator CAN list users without exposing hashes", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/users", {
      cookie: adminCookie,
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(json.users));
    assert.equal(JSON.stringify(json).includes("scrypt$"), false);
  });

  test("administrator CAN create a user", async () => {
    const { res, json } = await postJson(
      server.baseUrl,
      "/api/users",
      {
        username: "second.admin",
        fullName: "Second Admin",
        role: "administrator",
        password: "second-admin-pass-123",
      },
      adminCookie,
    );
    assert.equal(res.status, 201);
    assert.equal(json.user.username, "second.admin");
    assert.equal(json.user.passwordHash, undefined);
  });

  test("a duplicate username is rejected with 409", async () => {
    const { res, json } = await postJson(
      server.baseUrl,
      "/api/users",
      {
        username: "second.admin",
        fullName: "Duplicate",
        role: "security_staff",
        password: "another-pass-123456",
      },
      adminCookie,
    );
    assert.equal(res.status, 409);
    assert.equal(json.error.code, "CONFLICT");
  });

  test("administrator CAN change a setting and it is audited", async () => {
    const { res, json } = await request(server.baseUrl, "PUT", "/api/settings", {
      body: { key: "session.timeout_minutes", value: "45" },
      cookie: adminCookie,
    });
    assert.equal(res.status, 200);
    assert.equal(json.setting.value, "45");

    const audit = context.db
      .prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY occurred_at DESC")
      .get("session.timeout_minutes");
    assert.equal(audit.action, "setting.update");
  });
});

describe("settings visibility", () => {
  test("security staff sees only the gate-relevant subset", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/settings", {
      cookie: staffCookie,
    });
    assert.equal(res.status, 200);
    const keys = json.settings.map((setting) => setting.key);
    assert.ok(keys.includes("session.timeout_minutes"));
    assert.equal(keys.includes("expiry.reminder_days"), false);
  });

  test("administrator sees every setting", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/settings", {
      cookie: adminCookie,
    });
    assert.equal(res.status, 200);
    const keys = json.settings.map((setting) => setting.key);
    assert.ok(keys.includes("expiry.reminder_days"));
    assert.ok(keys.includes("canteen.entries_per_person_day"));
  });
});
