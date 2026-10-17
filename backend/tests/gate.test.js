import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { findRecentApprovedScan, insertGateEvent } from "../src/data/gate-events.js";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

const ADMIN = {
  username: "gate.admin",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "Gate Admin",
};
const STAFF = {
  username: "gate.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "Gate Staff",
};

const GATE_ID = "gate-p3-main";
const OPEN_WINDOW = { validFrom: "2000-01-01", validTo: "2099-12-31" };
const PAST_WINDOW = { validFrom: "2020-01-01", validTo: "2020-12-31" };
const FUTURE_WINDOW = { validFrom: "2090-01-01", validTo: "2099-12-31" };

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

const scan = (code, direction, cookie = staffCookie) =>
  postJson(server.baseUrl, "/api/gate/verify", { code, direction }, cookie);

/** A worker with a live credential, optionally already suspended or terminated. */
async function issueFor(fullName, { window = OPEN_WINDOW, kind = "id_card", personStatus } = {}) {
  sequence += 1;
  const created = await postJson(
    server.baseUrl,
    "/api/people",
    { category: "worker", fullName, workerRef: `GATE-${sequence}` },
    adminCookie,
  );
  assert.equal(created.res.status, 201, `person not created: ${JSON.stringify(created.json)}`);
  const person = created.json.person;

  const issued = await postJson(
    server.baseUrl,
    "/api/credentials",
    { personId: person.id, kind, ...window },
    adminCookie,
  );
  assert.equal(issued.res.status, 201, `credential not issued: ${JSON.stringify(issued.json)}`);

  if (personStatus) {
    const changed = await postJson(
      server.baseUrl,
      `/api/people/${person.id}/status`,
      { status: personStatus, reason: "gate test setup" },
      adminCookie,
    );
    assert.equal(changed.res.status, 200, `status not changed: ${JSON.stringify(changed.json)}`);
  }

  return { person, credential: issued.json.credential };
}

function approvedCountFor(credentialId) {
  return context.db
    .prepare(
      "SELECT COUNT(*) AS n FROM gate_events WHERE credential_id = ? AND result = 'approved'",
    )
    .get(credentialId).n;
}

function eventRows(filters) {
  const clauses = [];
  const params = [];
  for (const [column, value] of Object.entries(filters)) {
    clauses.push(`${column} = ?`);
    params.push(value);
  }
  return context.db
    .prepare(`SELECT * FROM gate_events WHERE ${clauses.join(" AND ")} ORDER BY created_at`)
    .all(...params);
}

/** An ISO instant offset from now by `minutes` (negative = in the past). */
function isoFrom(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function assertIdentificationOnly(person) {
  for (const field of ["phone", "employeeEmail", "purposeOfVisit", "personToMeet"]) {
    assert.equal(Object.hasOwn(person, field), false, `gate view leaked ${field}`);
  }
}

/**
 * Forces a specific statement to fail, so a backend failure can be simulated
 * without breaking the rest of the request path. The real route, the real data
 * layer and the real database are all still exercised.
 */
async function withFailingPrepare(match, run) {
  const original = context.db.prepare;
  context.db.prepare = function patched(sql, ...rest) {
    if (String(sql).includes(match)) throw new Error("forced backend failure");
    return original.call(context.db, sql, ...rest);
  };
  try {
    return await run();
  } finally {
    context.db.prepare = original;
  }
}

describe("gate — access control", () => {
  test("anonymous callers are rejected with 401", async () => {
    const probes = [
      ["POST", "/api/gate/verify"],
      ["GET", "/api/gate/events"],
      ["GET", "/api/inside"],
    ];
    for (const [method, path] of probes) {
      const { res } = await request(server.baseUrl, method, path, {
        body: method === "POST" ? { code: "x", direction: "entry" } : undefined,
      });
      assert.equal(res.status, 401, `${method} ${path} should require a session`);
    }
  });

  test("security staff may scan and read the history and the inside list", async () => {
    const { credential } = await issueFor("Staff Scanner Subject");
    const verified = await scan(credential.id, "entry");
    assert.equal(verified.res.status, 200);

    assert.equal(
      (await request(server.baseUrl, "GET", "/api/gate/events", { cookie: staffCookie })).res
        .status,
      200,
    );
    assert.equal(
      (await request(server.baseUrl, "GET", "/api/inside", { cookie: staffCookie })).res.status,
      200,
    );
  });
});

describe("gate — request validation", () => {
  test("a missing or blank code is refused", async () => {
    for (const body of [{ direction: "entry" }, { code: "   ", direction: "entry" }, {}]) {
      const { res, json } = await postJson(server.baseUrl, "/api/gate/verify", body, staffCookie);
      assert.equal(res.status, 400);
      assert.equal(json.error.code, "BAD_REQUEST");
    }
  });

  test("an unknown direction is refused rather than guessed", async () => {
    const { res } = await postJson(
      server.baseUrl,
      "/api/gate/verify",
      { code: "anything", direction: "sideways" },
      staffCookie,
    );
    assert.equal(res.status, 400);
  });

  test("an unknown extra field is refused", async () => {
    const { res } = await postJson(
      server.baseUrl,
      "/api/gate/verify",
      { code: "anything", direction: "entry", result: "approved" },
      staffCookie,
    );
    assert.equal(res.status, 400, "a client must not be able to state the result");
  });
});

describe("gate — verdicts", () => {
  test("a live credential is approved and the holder is identified only", async () => {
    const { person, credential } = await issueFor("Approved Worker");
    const { res, json } = await scan(credential.id, "entry");

    assert.equal(res.status, 200);
    assert.equal(json.result, "approved");
    assert.equal(json.reasonCode, null);
    assert.equal(json.direction, "entry");
    assert.equal(json.duplicate, false);
    assert.equal(json.recorded, true);
    assert.ok(json.eventId);
    assert.equal(json.person.id, person.id);
    assert.equal(json.person.fullName, "Approved Worker");
    assert.equal(json.credential.status, "active");
    assertIdentificationOnly(json.person);

    const rows = eventRows({ id: json.eventId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, "approved");
    assert.equal(rows[0].gate_id, GATE_ID);
    assert.equal(rows[0].direction, "entry");
    assert.equal(rows[0].credential_id, credential.id);
    assert.equal(rows[0].person_id, person.id);
    assert.equal(
      rows[0].operator_user_id,
      context.db.prepare("SELECT id FROM users WHERE username = ?").get(STAFF.username).id,
    );
  });

  test("an unknown code is rejected and the scan is still recorded", async () => {
    const { res, json } = await scan("00000000-0000-0000-0000-000000000000", "entry");

    assert.equal(res.status, 200);
    assert.equal(json.result, "rejected");
    assert.equal(json.reasonCode, "not_found");
    assert.equal(json.person, null);
    assert.equal(json.credential, null);
    assert.equal(json.recorded, true);

    const rows = eventRows({ id: json.eventId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, "rejected");
    assert.equal(rows[0].reason_code, "not_found");
    assert.equal(rows[0].credential_id, null);
    assert.equal(rows[0].person_id, null);
  });

  test("an expired credential is rejected", async () => {
    const { credential } = await issueFor("Expired Worker", { window: PAST_WINDOW });
    const { json } = await scan(credential.id, "entry");
    assert.equal(json.result, "rejected");
    assert.equal(json.reasonCode, "expired");
  });

  test("a credential that is not valid yet is rejected", async () => {
    const { credential } = await issueFor("Future Worker", { window: FUTURE_WINDOW });
    const { json } = await scan(credential.id, "entry");
    assert.equal(json.result, "rejected");
    assert.equal(json.reasonCode, "not_yet_valid");
  });

  test("a suspended credential is rejected", async () => {
    const { credential } = await issueFor("Suspended Card");
    await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/status`,
      { status: "suspended", reason: "gate test" },
      adminCookie,
    );
    const { json } = await scan(credential.id, "entry");
    assert.equal(json.result, "rejected");
    assert.equal(json.reasonCode, "suspended");
  });

  test("a terminated credential is rejected", async () => {
    const { credential } = await issueFor("Terminated Card");
    await postJson(
      server.baseUrl,
      `/api/credentials/${credential.id}/status`,
      { status: "terminated", reason: "gate test" },
      adminCookie,
    );
    const { json } = await scan(credential.id, "entry");
    assert.equal(json.result, "rejected");
    assert.equal(json.reasonCode, "terminated");
  });

  test("a suspended holder is rejected even though the card is active", async () => {
    const { credential } = await issueFor("Suspended Holder", { personStatus: "suspended" });
    const { json } = await scan(credential.id, "entry");
    assert.equal(json.result, "rejected");
    assert.equal(json.reasonCode, "person_suspended");
  });

  test("a terminated holder is rejected even though the card is active", async () => {
    const { credential } = await issueFor("Terminated Holder", { personStatus: "terminated" });
    const { json } = await scan(credential.id, "entry");
    assert.equal(json.result, "rejected");
    assert.equal(json.reasonCode, "person_terminated");
  });

  test("a credential with an unreadable window is UNABLE TO VERIFY, never approved", async () => {
    const { credential } = await issueFor("Corrupt Window Worker");
    // Simulates a record damaged by a bad migration or a manual edit: a value the
    // rule cannot read. It must fail closed.
    context.db.prepare("UPDATE credentials SET valid_from = '' WHERE id = ?").run(credential.id);

    const { res, json } = await scan(credential.id, "entry");
    assert.equal(res.status, 200);
    assert.equal(json.result, "unable_to_verify");
    assert.equal(json.reasonCode, "indeterminate");
    assert.equal(approvedCountFor(credential.id), 0);
  });
});

describe("gate — repeated and concurrent scans", () => {
  test("a repeated approval inside the window is collapsed to one event", async () => {
    const { credential } = await issueFor("Double Tap Worker");

    const first = await scan(credential.id, "entry");
    const second = await scan(credential.id, "entry");

    assert.equal(first.json.result, "approved");
    assert.equal(first.json.duplicate, false);
    assert.equal(second.json.result, "approved");
    assert.equal(second.json.duplicate, true);
    assert.equal(second.json.eventId, first.json.eventId);
    assert.equal(approvedCountFor(credential.id), 1);
  });

  test("the opposite direction is a separate event, not a duplicate", async () => {
    const { credential } = await issueFor("Two Way Worker");
    await scan(credential.id, "entry");
    const exit = await scan(credential.id, "exit");

    assert.equal(exit.json.result, "approved");
    assert.equal(exit.json.duplicate, false);
    assert.equal(approvedCountFor(credential.id), 2);
  });

  test("a burst of concurrent scans of the same credential writes exactly one event", async () => {
    const { credential } = await issueFor("Concurrent Worker");

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => scan(credential.id, "entry")),
    );

    for (const { res, json } of responses) {
      assert.equal(res.status, 200);
      assert.equal(json.result, "approved");
    }
    assert.equal(approvedCountFor(credential.id), 1);
  });

  test("the duplicate window is honoured, not just the same second", async () => {
    const { credential } = await issueFor("Window Worker");
    const { json } = await scan(credential.id, "entry");

    const now = new Date(json.occurredAt);
    const inside = findRecentApprovedScan(context.db, {
      credentialId: credential.id,
      gateId: GATE_ID,
      direction: "entry",
      since: new Date(now.getTime() - 60_000).toISOString(),
    });
    const outside = findRecentApprovedScan(context.db, {
      credentialId: credential.id,
      gateId: GATE_ID,
      direction: "entry",
      since: new Date(now.getTime() + 60_000).toISOString(),
    });

    assert.ok(inside, "the scan should be found inside the window");
    assert.equal(outside, undefined, "a scan older than the window must not count");
  });

  test("a rejected scan is never collapsed into an approval", async () => {
    const { json: first } = await scan("11111111-1111-1111-1111-111111111111", "entry");
    const { json: second } = await scan("11111111-1111-1111-1111-111111111111", "entry");

    assert.equal(first.result, "rejected");
    assert.equal(second.result, "rejected");
    assert.notEqual(first.eventId, second.eventId);
  });
});

describe("gate — fail closed under backend failure", () => {
  test("a failed lookup returns UNABLE TO VERIFY and records the attempt", async () => {
    const { credential } = await issueFor("Lookup Failure Worker");

    const { json } = await withFailingPrepare("FROM credentials WHERE id", () =>
      scan(credential.id, "entry"),
    );

    assert.equal(json.result, "unable_to_verify");
    assert.equal(json.reasonCode, "indeterminate");
    assert.equal(json.person, null);
    assert.equal(approvedCountFor(credential.id), 0);

    const rows = eventRows({ id: json.eventId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, "unable_to_verify");
  });

  test("an approval that cannot be written down is downgraded to UNABLE TO VERIFY", async () => {
    const { credential } = await issueFor("Write Failure Worker");

    const { res, json } = await withFailingPrepare("INSERT INTO gate_events", () =>
      scan(credential.id, "entry"),
    );

    assert.equal(res.status, 200);
    assert.equal(json.result, "unable_to_verify");
    assert.equal(json.reasonCode, "indeterminate");
    assert.equal(json.recorded, false);
    assert.equal(json.eventId, null);
    assert.equal(approvedCountFor(credential.id), 0);
  });
});

describe("gate — events and inside status", () => {
  test("the history can be listed and filtered", async () => {
    const { person, credential } = await issueFor("History Worker");
    await scan(credential.id, "entry");

    const { res, json } = await request(
      server.baseUrl,
      "GET",
      `/api/gate/events?personId=${person.id}`,
      { cookie: staffCookie },
    );
    assert.equal(res.status, 200);
    assert.equal(json.total, 1);
    assert.equal(json.events[0].personId, person.id);
    assert.equal(json.events[0].personName, "History Worker");
    assert.equal(json.events[0].personCategory, "worker");
    assert.equal(json.events[0].direction, "entry");
    assert.equal(json.events[0].result, "approved");

    const filtered = await request(server.baseUrl, "GET", "/api/gate/events?result=rejected", {
      cookie: staffCookie,
    });
    assert.equal(filtered.res.status, 200);
    assert.equal(
      filtered.json.events.every((event) => event.result === "rejected"),
      true,
    );

    const invalid = await request(server.baseUrl, "GET", "/api/gate/events?result=maybe", {
      cookie: staffCookie,
    });
    assert.equal(invalid.res.status, 400);

    // A date range that contains the scan returns it; one that ends before it
    // does not. Both bounds are inclusive instants.
    const inside = await request(
      server.baseUrl,
      "GET",
      `/api/gate/events?from=${encodeURIComponent(isoFrom(-1))}&to=${encodeURIComponent(isoFrom(1))}`,
      { cookie: staffCookie },
    );
    assert.equal(inside.res.status, 200);
    assert.equal(
      inside.json.events.some((event) => event.personId === person.id),
      true,
    );

    const before = await request(
      server.baseUrl,
      "GET",
      `/api/gate/events?to=${encodeURIComponent(isoFrom(-1))}`,
      { cookie: staffCookie },
    );
    assert.equal(before.res.status, 200);
    assert.equal(
      before.json.events.some((event) => event.personId === person.id),
      false,
    );

    const malformed = await request(server.baseUrl, "GET", "/api/gate/events?from=yesterday", {
      cookie: staffCookie,
    });
    assert.equal(malformed.res.status, 400);
  });

  test("an entry on the current plant day is shown as inside without a missing exit", async () => {
    const { person, credential } = await issueFor("Inside Worker");
    await scan(credential.id, "entry");

    const { json } = await request(server.baseUrl, "GET", "/api/inside", { cookie: staffCookie });
    const row = json.inside.find((item) => item.person.id === person.id);

    assert.ok(row, "the person should be listed as inside");
    assert.equal(row.missingExit, false);
    assertIdentificationOnly(row.person);
  });

  test("an exit removes the person from the inside list", async () => {
    const { person, credential } = await issueFor("Leaving Worker");
    await scan(credential.id, "entry");
    await scan(credential.id, "exit");

    const { json } = await request(server.baseUrl, "GET", "/api/inside", { cookie: staffCookie });
    assert.equal(
      json.inside.some((item) => item.person.id === person.id),
      false,
    );
  });

  test("an entry with no exit on the same day is flagged, not hidden", async () => {
    const { person, credential } = await issueFor("Missing Exit Worker");
    insertGateEvent(context.db, {
      credentialId: credential.id,
      personId: person.id,
      gateId: GATE_ID,
      direction: "entry",
      result: "approved",
      reasonCode: null,
      reasonText: null,
      occurredAt: "2020-01-02T03:00:00Z",
      operatorUserId: null,
    });

    const { json } = await request(server.baseUrl, "GET", "/api/inside", { cookie: staffCookie });
    const row = json.inside.find((item) => item.person.id === person.id);

    assert.ok(row, "a never-closed entry must still be visible");
    assert.equal(row.missingExit, true);
    assert.equal(row.since, "2020-01-02T03:00:00Z");
  });

  test("a rejected scan does not put anybody inside", async () => {
    const { person, credential } = await issueFor("Rejected Scan Worker", { window: PAST_WINDOW });
    await scan(credential.id, "entry");

    const { json } = await request(server.baseUrl, "GET", "/api/inside", { cookie: staffCookie });
    assert.equal(
      json.inside.some((item) => item.person.id === person.id),
      false,
    );
  });
});
