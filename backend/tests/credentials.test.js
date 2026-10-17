import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { evaluateCredential } from "../src/domain/credential-validity.js";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

const ADMIN = {
  username: "cred.admin",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "Credential Admin",
};
const STAFF = {
  username: "cred.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "Credential Staff",
};

/** A window that always covers today, and one that never does. */
const OPEN_WINDOW = { validFrom: "2000-01-01", validTo: "2099-12-31" };
const PAST_WINDOW = { validFrom: "2020-01-01", validTo: "2020-12-31" };
const FUTURE_WINDOW = { validFrom: "2090-01-01", validTo: "2099-12-31" };

let context;
let server;
let adminCookie;
let staffCookie;
let workerSequence = 0;

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

async function addWorker(fullName) {
  workerSequence += 1;
  const { res, json } = await postJson(
    server.baseUrl,
    "/api/people",
    { category: "worker", fullName, workerRef: `CRED-${workerSequence}` },
    adminCookie,
  );
  assert.equal(res.status, 201, `could not create the test person: ${JSON.stringify(json)}`);
  return json.person;
}

const issue = (body) => postJson(server.baseUrl, "/api/credentials", body, adminCookie);

describe("credentials — access control", () => {
  test("anonymous callers are rejected with 401", async () => {
    const probes = [
      ["POST", "/api/credentials"],
      ["POST", "/api/credentials/whatever/validity"],
      ["POST", "/api/credentials/whatever/status"],
    ];
    for (const [method, path] of probes) {
      const { res } = await request(server.baseUrl, method, path, { body: {} });
      assert.equal(res.status, 401, `${method} ${path} should require a session`);
    }
  });

  test("security staff may NOT issue, extend or suspend a credential", async () => {
    const person = await addWorker("Staff Attempt Subject");
    const issued = await postJson(
      server.baseUrl,
      "/api/credentials",
      { personId: person.id, kind: "id_card", ...OPEN_WINDOW },
      staffCookie,
    );
    assert.equal(issued.res.status, 403);

    const renewed = await postJson(
      server.baseUrl,
      "/api/credentials/any-id/validity",
      { ...OPEN_WINDOW, reason: "staff attempt" },
      staffCookie,
    );
    assert.equal(renewed.res.status, 403);

    const suspended = await postJson(
      server.baseUrl,
      "/api/credentials/any-id/status",
      { status: "suspended", reason: "staff attempt" },
      staffCookie,
    );
    assert.equal(suspended.res.status, 403);

    const stored = context.db
      .prepare("SELECT COUNT(*) AS total FROM credentials WHERE person_id = ?")
      .get(person.id);
    assert.equal(stored.total, 0);
  });
});

describe("credentials — issuing", () => {
  let person;

  before(async () => {
    person = await addWorker("Issue Subject");
  });

  test("an end date before the start date is rejected", async () => {
    const { res, json } = await issue({
      personId: person.id,
      kind: "id_card",
      validFrom: "2026-06-01",
      validTo: "2026-05-01",
    });
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "BAD_REQUEST");
  });

  test("a malformed or impossible date is rejected", async () => {
    const malformed = await issue({
      personId: person.id,
      kind: "id_card",
      validFrom: "01-06-2026",
      validTo: "2026-06-30",
    });
    assert.equal(malformed.res.status, 400);

    const impossible = await issue({
      personId: person.id,
      kind: "id_card",
      validFrom: "2026-02-31",
      validTo: "2026-06-30",
    });
    assert.equal(impossible.res.status, 400);
  });

  test("an unknown person is a 404", async () => {
    const { res, json } = await issue({
      personId: "no-such-person",
      kind: "id_card",
      ...OPEN_WINDOW,
    });
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "NOT_FOUND");
  });

  test("an ID card can be issued and is reported valid", async () => {
    const { res, json } = await issue({ personId: person.id, kind: "id_card", ...OPEN_WINDOW });
    assert.equal(res.status, 201);
    assert.equal(json.credential.kind, "id_card");
    assert.equal(json.credential.status, "active");
    assert.equal(json.credential.isValid, true);
    assert.equal(json.credential.reasonCode, null);
    // The payload printed on the card carries no personal data.
    assert.equal(typeof json.credential.id, "string");
    assert.equal(JSON.stringify(json).includes("Issue Subject"), false);
  });

  test("a second live credential of the same kind is rejected", async () => {
    const { res, json } = await issue({ personId: person.id, kind: "id_card", ...OPEN_WINDOW });
    assert.equal(res.status, 409);
    assert.equal(json.error.code, "CONFLICT");
  });

  test("a gate pass is a separate credential and is allowed alongside the ID card", async () => {
    const { res, json } = await issue({ personId: person.id, kind: "gate_pass", ...OPEN_WINDOW });
    assert.equal(res.status, 201);
    assert.equal(json.credential.kind, "gate_pass");

    const listed = await request(server.baseUrl, "GET", `/api/people/${person.id}/credentials`, {
      cookie: adminCookie,
    });
    assert.equal(listed.res.status, 200);
    assert.equal(listed.json.credentials.length, 2);
    assert.ok(listed.json.credentials.every((credential) => credential.isValid === true));
  });

  test("a credential cannot be issued to a suspended person", async () => {
    const suspendedPerson = await addWorker("Suspended Subject");
    const suspended = await postJson(
      server.baseUrl,
      `/api/people/${suspendedPerson.id}/status`,
      { status: "suspended", reason: "under investigation" },
      adminCookie,
    );
    assert.equal(suspended.res.status, 200);

    const { res, json } = await issue({
      personId: suspendedPerson.id,
      kind: "id_card",
      ...OPEN_WINDOW,
    });
    assert.equal(res.status, 409);
    assert.equal(json.error.code, "CONFLICT");
  });
});

describe("credentials — lifecycle", () => {
  let person;

  before(async () => {
    person = await addWorker("Lifecycle Subject");
  });

  test("issuing is audited", async () => {
    const issued = await issue({ personId: person.id, kind: "id_card", ...OPEN_WINDOW });
    assert.equal(issued.res.status, 201);

    const audit = context.db
      .prepare("SELECT action, actor_user_id FROM audit_log WHERE entity_id = ?")
      .get(issued.json.credential.id);
    assert.equal(audit.action, "credential.issue");
    assert.ok(audit.actor_user_id);
  });

  test("validity can be extended and the change is audited", async () => {
    const credential = (
      await request(server.baseUrl, "GET", `/api/people/${person.id}/credentials`, {
        cookie: adminCookie,
      })
    ).json.credentials[0];

    const { res, json } = await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/validity`,
      { validFrom: "2000-01-01", validTo: "2098-12-31", reason: "Contract extended by six months" },
      adminCookie,
    );
    assert.equal(res.status, 200);
    assert.equal(json.credential.validTo, "2098-12-31");

    const audit = context.db
      .prepare(
        "SELECT action, reason FROM audit_log WHERE entity_id = ? AND action = 'credential.validity_change'",
      )
      .get(credential.id);
    assert.equal(audit.reason, "Contract extended by six months");
  });

  test("a validity change without a reason is rejected", async () => {
    const credential = context.db
      .prepare("SELECT id FROM credentials WHERE person_id = ?")
      .get(person.id);
    const { res } = await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/validity`,
      { validFrom: "2000-01-01", validTo: "2098-12-31" },
      adminCookie,
    );
    assert.equal(res.status, 400);
  });

  test("a credential id that does not exist is a 404", async () => {
    const { res } = await postJson(
      server.baseUrl,
      "/api/credentials/no-such-credential/status",
      { status: "suspended", reason: "not applicable" },
      adminCookie,
    );
    assert.equal(res.status, 404);
  });

  test("suspending a credential makes it invalid immediately", async () => {
    const credential = context.db
      .prepare("SELECT id FROM credentials WHERE person_id = ?")
      .get(person.id);

    const { res, json } = await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/status`,
      { status: "suspended", reason: "ID card handed back for reprinting" },
      adminCookie,
    );
    assert.equal(res.status, 200);
    assert.equal(json.credential.status, "suspended");
    assert.equal(json.credential.isValid, false);
    assert.equal(json.credential.reasonCode, "suspended");
  });

  test("a suspended credential can be reactivated", async () => {
    const credential = context.db
      .prepare("SELECT id FROM credentials WHERE person_id = ?")
      .get(person.id);

    const { res, json } = await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/status`,
      { status: "active", reason: "Replacement card issued" },
      adminCookie,
    );
    assert.equal(res.status, 200);
    assert.equal(json.credential.isValid, true);
  });

  test("a terminated credential cannot be renewed", async () => {
    const credential = context.db
      .prepare("SELECT id FROM credentials WHERE person_id = ?")
      .get(person.id);

    const terminated = await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/status`,
      { status: "terminated", reason: "Holder left the site" },
      adminCookie,
    );
    assert.equal(terminated.res.status, 200);
    assert.equal(terminated.json.credential.isValid, false);
    assert.equal(terminated.json.credential.reasonCode, "terminated");

    const renewed = await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/validity`,
      { validFrom: "2000-01-01", validTo: "2098-12-31", reason: "attempted renewal" },
      adminCookie,
    );
    assert.equal(renewed.res.status, 409);
  });
});

describe("credentials — validity is derived and fails closed", () => {
  test("an expired credential is not valid", async () => {
    const person = await addWorker("Expired Subject");
    const { json } = await issue({ personId: person.id, kind: "id_card", ...PAST_WINDOW });
    assert.equal(json.credential.isValid, false);
    assert.equal(json.credential.reasonCode, "expired");
  });

  test("a credential that has not started yet is not valid", async () => {
    const person = await addWorker("Future Subject");
    const { json } = await issue({ personId: person.id, kind: "id_card", ...FUTURE_WINDOW });
    assert.equal(json.credential.isValid, false);
    assert.equal(json.credential.reasonCode, "not_yet_valid");
  });

  test("terminating the holder invalidates their credential", async () => {
    const person = await addWorker("Terminated Subject");
    const issued = await issue({ personId: person.id, kind: "id_card", ...OPEN_WINDOW });
    assert.equal(issued.json.credential.isValid, true);

    await postJson(
      server.baseUrl,
      `/api/people/${person.id}/status`,
      { status: "terminated", reason: "Contract ended" },
      adminCookie,
    );

    const list = await request(server.baseUrl, "GET", `/api/people/${person.id}/credentials`, {
      cookie: adminCookie,
    });
    assert.equal(list.res.status, 200);
    assert.equal(list.json.credentials[0].isValid, false);
    assert.equal(list.json.credentials[0].reasonCode, "person_terminated");
  });

  test("the rule itself refuses to guess when an input is unreadable", () => {
    const credential = { status: "active", valid_from: "2026-01-01", valid_to: "2026-12-31" };

    assert.equal(evaluateCredential(null, "active", "2026-06-01").code, "not_found");
    assert.equal(evaluateCredential(credential, "active", "not-a-date").code, "indeterminate");
    assert.equal(evaluateCredential(credential, "active", undefined).code, "indeterminate");
    assert.equal(
      evaluateCredential({ ...credential, status: "unknown-status" }, "active", "2026-06-01").code,
      "indeterminate",
    );
    assert.equal(
      evaluateCredential(
        { status: "active", valid_from: "?", valid_to: "?" },
        "active",
        "2026-06-01",
      ).code,
      "indeterminate",
    );
    // The end date is inclusive: the credential is valid THROUGH that day.
    assert.equal(evaluateCredential(credential, "active", "2026-12-31").valid, true);
    assert.equal(evaluateCredential(credential, "active", "2027-01-01").code, "expired");
    assert.equal(evaluateCredential(credential, "active", "2026-01-01").valid, true);
  });
});
