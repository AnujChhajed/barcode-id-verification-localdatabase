import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { createTestContext, request, seedUser, startServer } from "./helpers.js";

const ALLOWED = "http://localhost:8080";
const BLOCKED = "http://evil.example";

let context;
let server;

before(async () => {
  context = createTestContext({ corsOrigins: [ALLOWED] });
  server = await startServer(context.app);
});

after(async () => {
  await server.close();
  context.cleanup();
});

describe("cors — allowed origin", () => {
  test("a preflight is answered without a session and with the exact origin echoed", async () => {
    const { res } = await request(server.baseUrl, "OPTIONS", "/api/gate/verify", {
      origin: ALLOWED,
    });

    assert.equal(res.status, 204);
    // `*` is illegal with credentials — the exact origin must be reflected back.
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(res.headers.get("access-control-allow-headers") ?? "", /content-type/);
    assert.equal(res.headers.get("vary"), "Origin");
  });

  test("a real response carries the CORS headers", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/health", { origin: ALLOWED });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED);
    assert.equal(json.status, "ok");
  });
});

describe("cors — origin that is not allowed", () => {
  test("no CORS headers are returned, so the browser discards the response", async () => {
    const { res } = await request(server.baseUrl, "GET", "/api/health", { origin: BLOCKED });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
  });

  test("a request with no Origin header is unaffected", async () => {
    const { res } = await request(server.baseUrl, "GET", "/api/health");

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});

describe("cors — it is not an authorization control", () => {
  test("an allowed origin still gets 401 on a protected route without a session", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/inside", { origin: ALLOWED });

    assert.equal(res.status, 401);
    assert.equal(json.error.code, "UNAUTHORIZED");
    // The browser may read the refusal — that is all CORS grants.
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED);
  });

  test("a logged-in cross-origin caller is authorized normally", async () => {
    seedUser(context.db, {
      username: "cors.staff",
      password: "correct-horse-battery",
      role: "security_staff",
    });

    const login = await request(server.baseUrl, "POST", "/api/auth/login", {
      body: { username: "cors.staff", password: "correct-horse-battery" },
      origin: ALLOWED,
    });
    assert.equal(login.res.status, 200);

    const cookie = (login.res.headers.getSetCookie?.() ?? [])
      .find((value) => value.startsWith("abb_session="))
      ?.split(";")[0];
    assert.ok(cookie, "expected a session cookie");

    const { res, json } = await request(server.baseUrl, "GET", "/api/inside", {
      origin: ALLOWED,
      cookie,
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(json.inside));
  });
});
