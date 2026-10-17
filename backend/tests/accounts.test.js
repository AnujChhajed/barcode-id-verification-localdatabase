import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

/**
 * F3 — the sign-in surface.
 *
 * Two things must hold no matter how the UI behaves, so they are asserted
 * against the API directly:
 *
 *   1. `POST /api/auth/signup` can only ever create a DISABLED, non-admin
 *      account. Signing up is a request for access, never a grant of it.
 *   2. `PATCH /api/users/:id` — the approval — is administrator-only, cannot
 *      lock the plant out, and kills the target's sessions when it disables.
 */

const ADMIN = {
  username: "acct.admin",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "Account Admin",
};
const SECOND_ADMIN = {
  username: "acct.admin2",
  password: "second-admin-pass-123",
  role: "administrator",
  fullName: "Second Account Admin",
};
const STAFF = {
  username: "acct.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "Account Staff",
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
  adminCookie = (await login(server.baseUrl, ADMIN.username, ADMIN.password)).cookie;
  staffCookie = (await login(server.baseUrl, STAFF.username, STAFF.password)).cookie;
});

after(async () => {
  if (server) await server.close();
  context?.cleanup();
});

const signup = (body) => postJson(server.baseUrl, "/api/auth/signup", body);

const storedUser = (username) =>
  context.db
    .prepare("SELECT id, username, role, is_active, password_hash FROM users WHERE username = ?")
    .get(username);

const sessionCookies = (response) =>
  (response.headers.getSetCookie?.() ?? []).filter((value) => value.startsWith("abb_session="));

const patchUser = (id, isActive, cookie = adminCookie) =>
  request(server.baseUrl, "PATCH", `/api/users/${id}`, { body: { isActive }, cookie });

describe("POST /api/auth/signup", () => {
  const REQUEST = {
    username: "new.hire",
    fullName: "New Hire",
    password: "a-long-enough-pass-123",
    email: "new.hire@example.test",
  };

  test("needs no session, and issues none", async () => {
    const { res } = await signup(REQUEST);
    assert.equal(res.status, 201);
    assert.equal(
      sessionCookies(res).length,
      0,
      "signup must not sign the caller in — there is nothing to sign into yet",
    );
  });

  test("creates a DISABLED security_staff account, never an administrator", async () => {
    const row = storedUser(REQUEST.username);
    assert.ok(row, "the account should exist");
    assert.equal(row.role, "security_staff");
    assert.equal(row.is_active, 0, "a self-service account must start disabled");
  });

  test("the disabled account cannot sign in", async () => {
    const { res, cookie } = await login(server.baseUrl, REQUEST.username, REQUEST.password);
    assert.equal(res.status, 401);
    assert.equal(cookie, null);
  });

  test("the response never echoes the password or the hash", async () => {
    const { json } = await signup({ ...REQUEST, username: "new.hire2" });
    const serialised = JSON.stringify(json);
    assert.equal(serialised.includes(REQUEST.password), false);
    assert.equal(serialised.includes("scrypt$"), false);
  });

  test("a caller cannot choose their own role", async () => {
    const { res, json } = await signup({
      ...REQUEST,
      username: "sneaky.signup",
      role: "administrator",
    });
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "BAD_REQUEST");
    assert.equal(storedUser("sneaky.signup"), undefined, "no account may be created");
  });

  test("a duplicate username is refused with 409", async () => {
    const { res, json } = await signup({ ...REQUEST, username: ADMIN.username });
    assert.equal(res.status, 409);
    assert.equal(json.error.code, "CONFLICT");
  });

  test("an invalid body is refused with 400 and creates nothing", async () => {
    const probes = [
      { username: "short.pass", fullName: "Short", password: "too-short" },
      { username: "no.name", password: "a-long-enough-pass-123" },
      { username: "bad name", fullName: "Bad", password: "a-long-enough-pass-123" },
    ];
    for (const body of probes) {
      const { res, json } = await signup(body);
      assert.equal(res.status, 400, `${JSON.stringify(body)} should be refused`);
      assert.equal(json.error.code, "BAD_REQUEST");
      assert.equal(storedUser(body.username), undefined);
    }
  });

  test("it is audited with no actor, because there was nobody to attribute it to", async () => {
    const audit = context.db
      .prepare(
        "SELECT actor_user_id, action FROM audit_log WHERE entity_id = ? AND action = 'auth.signup'",
      )
      .get(storedUser(REQUEST.username).id);
    assert.ok(audit, "the signup must be recorded");
    assert.equal(audit.action, "auth.signup");
    assert.equal(audit.actor_user_id, null);
  });
});

describe("PATCH /api/users/:id — approving an account", () => {
  test("security staff CANNOT enable an account, and nothing is written", async () => {
    const target = storedUser("new.hire");
    const { res, json } = await patchUser(target.id, true, staffCookie);
    assert.equal(res.status, 403);
    assert.equal(json.error.code, "FORBIDDEN");
    assert.equal(storedUser("new.hire").is_active, 0, "the row must be untouched");
  });

  test("an administrator CAN enable it, and then it can sign in", async () => {
    const target = storedUser("new.hire");
    const { res, json } = await patchUser(target.id, true);
    assert.equal(res.status, 200);
    assert.equal(json.user.isActive, true);

    const signedIn = await login(server.baseUrl, "new.hire", "a-long-enough-pass-123");
    assert.equal(signedIn.res.status, 200);
    assert.ok(signedIn.cookie, "the approved account should now get a session");
  });

  test("enabling is audited with the actor and the before/after values", async () => {
    const audit = context.db
      .prepare(
        "SELECT actor_user_id, action, old_value, new_value FROM audit_log WHERE entity_id = ? AND action = 'user.enable'",
      )
      .get(storedUser("new.hire").id);
    assert.equal(audit.action, "user.enable");
    assert.equal(audit.actor_user_id, storedUser(ADMIN.username).id);
  });

  test("an administrator cannot disable the account they are signed in with", async () => {
    const { res, json } = await patchUser(storedUser(ADMIN.username).id, false);
    assert.equal(res.status, 409);
    assert.equal(json.error.code, "CONFLICT");
    assert.equal(storedUser(ADMIN.username).is_active, 1);
  });

  test("disabling a different account takes effect and invalidates its session", async () => {
    // Give the target a live session first, so we can watch it die.
    const before = await login(server.baseUrl, "new.hire", "a-long-enough-pass-123");
    assert.ok(before.cookie);

    const target = storedUser("new.hire");
    const { res, json } = await patchUser(target.id, false);
    assert.equal(res.status, 200);
    assert.equal(json.user.isActive, false);

    const after = await request(server.baseUrl, "GET", "/api/auth/me", { cookie: before.cookie });
    assert.equal(after.res.status, 401, "a disabled account must lose its sessions immediately");
  });

  test("an unknown account is 404, not a silent success", async () => {
    const { res, json } = await patchUser("no-such-user-id", false);
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "NOT_FOUND");
  });

  test("a body that is not a boolean is refused with 400", async () => {
    const { res, json } = await request(
      server.baseUrl,
      "PATCH",
      `/api/users/${storedUser("acct.staff").id}`,
      { body: { isActive: "yes" }, cookie: adminCookie },
    );
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "BAD_REQUEST");
  });

  test("an anonymous caller cannot reach it", async () => {
    const { res } = await request(
      server.baseUrl,
      "PATCH",
      `/api/users/${storedUser("acct.staff").id}`,
      {
        body: { isActive: true },
      },
    );
    assert.equal(res.status, 401);
  });

  test("disabling one of two administrators is allowed while another remains active", async () => {
    const created = await postJson(
      server.baseUrl,
      "/api/users",
      {
        username: SECOND_ADMIN.username,
        fullName: SECOND_ADMIN.fullName,
        role: "administrator",
        password: SECOND_ADMIN.password,
      },
      adminCookie,
    );
    assert.equal(created.res.status, 201);

    const { res } = await patchUser(created.json.user.id, false);
    assert.equal(res.status, 200);
    assert.equal(storedUser(SECOND_ADMIN.username).is_active, 0);
  });
});

describe("public surface allowlist", () => {
  test("is exactly the four documented routes", () => {
    const declared = context.app.locals.routeInventory
      .filter((route) => route.access === "public")
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    assert.deepEqual(declared, [
      "GET /api/check/:code",
      "GET /api/health",
      "POST /api/auth/login",
      "POST /api/auth/signup",
    ]);
  });

  test("the new public routes are registered exactly once each", () => {
    for (const path of ["/api/auth/signup", "/api/check/:code"]) {
      const matches = context.app.locals.routeInventory.filter((route) => route.path === path);
      assert.equal(matches.length, 1, `${path} should be registered once`);
    }
  });
});
