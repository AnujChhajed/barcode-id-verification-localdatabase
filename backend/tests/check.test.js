import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

/**
 * F1 — the public `/check` page.
 *
 * The one unauthenticated read in the API. Two properties carry all the risk:
 *
 *   1. It must disclose nothing about a person that the holder does not already
 *      know. No name, no phone number, no employee email, no worker reference.
 *   2. Its verdict must be the gate's verdict. It calls the same
 *      `evaluateCredential`, so a card this page calls unusable can never be
 *      approved at the gate — asserted here by scanning the same code both ways.
 */

const ADMIN = {
  username: "chk.admin",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "Check Admin",
};
const STAFF = {
  username: "chk.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "Check Staff",
};

const OPEN_WINDOW = { validFrom: "2000-01-01", validTo: "2099-12-31" };
const PAST_WINDOW = { validFrom: "2020-01-01", validTo: "2020-12-31" };

let context;
let server;
let adminCookie;
let staffCookie;
let sequence = 0;

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

/** No session cookie is passed — that is the point of every test in this file. */
const check = (code) => request(server.baseUrl, "GET", `/api/check/${encodeURIComponent(code)}`);

const scan = (code, direction = "entry") =>
  postJson(server.baseUrl, "/api/gate/verify", { code, direction }, staffCookie);

async function createPerson(category, fullName) {
  sequence += 1;
  const extras =
    category === "worker"
      ? { workerRef: `CHK-${sequence}` }
      : category === "intern"
        ? { institutionName: "Check Institute" }
        : { purposeOfVisit: "Meeting", personToMeet: "Plant Manager" };

  const { res, json } = await postJson(
    server.baseUrl,
    "/api/people",
    { category, fullName, ...extras },
    adminCookie,
  );
  assert.equal(res.status, 201, `person not created: ${JSON.stringify(json)}`);
  return json.person;
}

async function issue(personId, window = OPEN_WINDOW, kind = "id_card") {
  const { res, json } = await postJson(
    server.baseUrl,
    "/api/credentials",
    { personId, kind, ...window },
    adminCookie,
  );
  assert.equal(res.status, 201, `credential not issued: ${JSON.stringify(json)}`);
  return json.credential;
}

describe("GET /api/check/:code", () => {
  test("is reachable without a session, and answers with a card", async () => {
    const worker = await createPerson("worker", "Check Worker");
    const credential = await issue(worker.id);

    const { res, json } = await check(credential.id);
    assert.equal(res.status, 200);
    assert.ok(json.card, "the payload must be wrapped in `card`");
  });

  test("an active card reports valid, its kind and its last valid day", async () => {
    const intern = await createPerson("intern", "Check Intern");
    const credential = await issue(intern.id);

    const { json } = await check(credential.id);
    assert.equal(json.card.valid, true);
    assert.equal(json.card.status, "valid");
    assert.equal(json.card.reasonCode, null);
    assert.equal(json.card.kind, "id_card");
    assert.equal(json.card.category, "intern");
    assert.equal(json.card.validTo, OPEN_WINDOW.validTo);
  });

  test("discloses nothing about the holder beyond the card itself", async () => {
    const worker = await createPerson("worker", "Privacy Sensitive");
    const credential = await issue(worker.id);

    const { json } = await check(credential.id);
    const serialised = JSON.stringify(json);

    // The field names must be absent...
    for (const field of [
      "fullName",
      "phone",
      "employeeEmail",
      "workerRef",
      "contractorCompany",
      "institutionName",
      "purposeOfVisit",
      "personToMeet",
      "photoPath",
      "plantId",
    ]) {
      assert.ok(!serialised.includes(field), `the payload must not carry ${field}`);
    }
    // ...and so must the values behind them.
    assert.ok(!serialised.includes("Privacy Sensitive"), "the holder's name must not leak");
    assert.ok(!serialised.includes(`CHK-${sequence}`), "the worker reference must not leak");
  });

  test("an expired card says so — and it is not valid", async () => {
    const worker = await createPerson("worker", "Check Expired");
    const credential = await issue(worker.id, PAST_WINDOW);

    const { json } = await check(credential.id);
    assert.equal(json.card.valid, false);
    assert.equal(json.card.status, "expired");
    assert.equal(json.card.reasonCode, "expired");
    assert.equal(typeof json.card.reasonText, "string");
  });

  test("a suspended credential says so, even though its dates are fine", async () => {
    const worker = await createPerson("worker", "Check Suspended Card");
    const credential = await issue(worker.id);

    const changed = await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/status`,
      { status: "suspended", reason: "security review" },
      adminCookie,
    );
    assert.equal(changed.res.status, 200);

    const { json } = await check(credential.id);
    assert.equal(json.card.valid, false);
    assert.equal(json.card.status, "suspended");
  });

  test("a suspended holder refuses the card while the card itself is live", async () => {
    const worker = await createPerson("worker", "Check Suspended Person");
    const credential = await issue(worker.id);

    const changed = await postJson(
      server.baseUrl,
      `/api/people/${worker.id}/status`,
      { status: "suspended", reason: "security review" },
      adminCookie,
    );
    assert.equal(changed.res.status, 200);

    const { json } = await check(credential.id);
    assert.equal(json.card.valid, false);
    assert.equal(json.card.status, "person_suspended");
  });

  test("a visitor pass reports the visitor category and its kind", async () => {
    const visitor = await createPerson("visitor", "Check Visitor");
    const pass = await issue(visitor.id, OPEN_WINDOW, "gate_pass");

    const { json } = await check(pass.id);
    assert.equal(json.card.valid, true);
    assert.equal(json.card.kind, "gate_pass");
    assert.equal(json.card.category, "visitor");
  });

  test("an unknown code is an answer, not an error", async () => {
    const { res, json } = await check("code-that-matches-nothing");
    assert.equal(res.status, 200);
    assert.equal(json.card.valid, false);
    assert.equal(json.card.status, "not_found");
    assert.equal(json.card.reasonCode, "not_found");
    assert.equal(json.card.kind, null);
    assert.equal(json.card.category, null);
    assert.equal(json.card.validTo, null);
  });

  test("an over-long code is refused with 400 rather than looked up", async () => {
    const { res, json } = await check("x".repeat(200));
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "BAD_REQUEST");
  });

  test("the verdict matches what the gate decides, for a card that is good and one that is not", async () => {
    const good = await createPerson("worker", "Check Parity Good");
    const goodCard = await issue(good.id);
    const bad = await createPerson("worker", "Check Parity Bad");
    const badCard = await issue(bad.id, PAST_WINDOW);

    for (const [code, expected] of [
      [goodCard.id, "approved"],
      [badCard.id, "rejected"],
    ]) {
      const page = await check(code);
      const gate = await scan(code);

      assert.equal(gate.res.status, 200);
      assert.equal(gate.json.result, expected, `the gate should decide ${expected} for ${code}`);
      assert.equal(
        page.json.card.valid,
        gate.json.result === "approved",
        `the public page and the gate must agree about ${code}`,
      );
      assert.equal(page.json.card.reasonCode, gate.json.reasonCode);
    }
  });

  test("the route is registered exactly once, and it is public", () => {
    const matches = context.app.locals.routeInventory.filter(
      (route) => route.path === "/api/check/:code",
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].access, "public");
    assert.equal(matches[0].method, "GET");
  });
});
