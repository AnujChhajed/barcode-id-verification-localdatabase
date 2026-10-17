import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { insertGateEvent } from "../src/data/gate-events.js";
import { mainGateId, siteTimezone, siteToday } from "../src/data/settings.js";
import { addDaysToDateKey, startOfDayIso } from "../src/lib/time.js";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

const ADMIN = {
  username: "rep.admin",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "Rep Admin",
};
const STAFF = {
  username: "rep.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "Rep Staff",
};

const OPEN_WINDOW = { validFrom: "2000-01-01", validTo: "2099-12-31" };

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

/** The plant's today plus the two days before it. */
function window(days = 3) {
  const to = siteToday(context.db);
  return { from: addDaysToDateKey(to, -(days - 1)), to };
}

function report(cookie = staffCookie, { from, to } = window()) {
  return request(server.baseUrl, "GET", `/api/reports/scans?from=${from}&to=${to}`, { cookie });
}

const PER_CATEGORY = {
  worker: () => ({ workerRef: `REP-${sequence}` }),
  intern: () => ({ institutionName: "Test Institute" }),
  visitor: () => ({ purposeOfVisit: "Meeting", personToMeet: "Plant Manager" }),
};

async function createPerson(category, fullName) {
  sequence += 1;
  const { res, json } = await postJson(
    server.baseUrl,
    "/api/people",
    { category, fullName, ...PER_CATEGORY[category]() },
    adminCookie,
  );
  assert.equal(res.status, 201, `person not created: ${JSON.stringify(json)}`);
  return json.person;
}

async function issue(personId, kind = "id_card") {
  const { res, json } = await postJson(
    server.baseUrl,
    "/api/credentials",
    { personId, kind, ...OPEN_WINDOW },
    adminCookie,
  );
  assert.equal(res.status, 201, `credential not issued: ${JSON.stringify(json)}`);
  return json.credential;
}

const scan = (code, direction = "entry") =>
  postJson(server.baseUrl, "/api/gate/verify", { code, direction }, staffCookie);

/** Rows the database holds inside the report window, counted independently. */
function storedRows({ from, to }) {
  const timezone = siteTimezone(context.db);
  return context.db
    .prepare("SELECT COUNT(*) AS n FROM gate_events WHERE occurred_at >= ? AND occurred_at < ?")
    .get(startOfDayIso(from, timezone), startOfDayIso(addDaysToDateKey(to, 1), timezone)).n;
}

describe("GET /api/reports/scans", () => {
  test("requires a session", async () => {
    const { from, to } = window();
    const { res } = await request(
      server.baseUrl,
      "GET",
      `/api/reports/scans?from=${from}&to=${to}`,
    );
    assert.equal(res.status, 401);
  });

  test("both gate roles may read it", async () => {
    assert.equal((await report(adminCookie)).res.status, 200);
    assert.equal((await report(staffCookie)).res.status, 200);
  });

  test("refuses a window that is missing, backwards or too long", async () => {
    const { from, to } = window();
    const cases = [
      "/api/reports/scans",
      `/api/reports/scans?from=${from}`,
      `/api/reports/scans?to=${to}`,
      `/api/reports/scans?from=${to}&to=${from}`,
      "/api/reports/scans?from=2020-13-01&to=2020-13-02",
      "/api/reports/scans?from=2020-01-01&to=2025-01-01",
    ];
    for (const path of cases) {
      const { res, json } = await request(server.baseUrl, "GET", path, { cookie: staffCookie });
      assert.equal(res.status, 400, `${path} should be refused`);
      assert.equal(json.error.code, "BAD_REQUEST");
    }
  });

  test("counts the window and reconciles with the rows actually written", async () => {
    const worker = await createPerson("worker", "Report Counter");
    const credential = await issue(worker.id);
    await scan(credential.id, "entry");
    await scan("code-that-matches-nothing", "exit");

    const range = window();
    const { res, json } = await report(staffCookie, range);
    assert.equal(res.status, 200);

    assert.equal(
      json.counts.scans,
      json.counts.approved + json.counts.rejected + json.counts.unable,
    );
    assert.ok(json.counts.approved >= 1, "the valid card should be approved");
    assert.ok(json.counts.rejected >= 1, "an unknown code must be a rejection, not a pass");
    assert.equal(
      json.counts.scans,
      storedRows(range),
      "the report total must match the stored rows in the window",
    );
  });

  test("the daily series covers every day of the window, oldest first", async () => {
    const range = window(3);
    const { json } = await report(staffCookie, range);

    assert.equal(json.days, 3);
    assert.equal(json.daily.length, 3);
    assert.equal(json.daily[0].date, range.from);
    assert.equal(json.daily[2].date, range.to);

    for (const day of json.daily) {
      assert.equal(day.scans, day.approved + day.rejected + day.unable);
    }
    const seriesTotal = json.daily.reduce((sum, day) => sum + day.scans, 0);
    assert.equal(
      seriesTotal,
      json.counts.scans,
      "the series must account for every row in the window",
    );
  });

  test("a window that never had a scan reports zeros, not a missing day", async () => {
    // A date far enough back that the seeded plant data cannot reach it.
    const { json } = await report(staffCookie, { from: "2001-01-01", to: "2001-01-03" });
    assert.equal(json.counts.scans, 0);
    assert.equal(json.daily.length, 3);
    assert.ok(json.daily.every((day) => day.scans === 0));
  });

  test("the category split accounts for every scan in the window", async () => {
    const intern = await createPerson("intern", "Report Intern");
    const credential = await issue(intern.id);
    await scan(credential.id, "entry");

    const { json } = await report();
    const internRow = json.byCategory.find((row) => row.category === "intern");
    const unknownRow = json.byCategory.find((row) => row.category === "unknown");

    assert.ok(internRow.approved >= 1, "the intern's approved scan must be attributed to interns");
    assert.ok(unknownRow.scans >= 1, "an unrecognised code must be its own bucket, not dropped");
    assert.equal(
      json.byCategory.reduce((sum, row) => sum + row.scans, 0),
      json.counts.scans,
    );
  });

  test("the direction split separates entries from exits", async () => {
    const { json } = await report();
    const entry = json.byDirection.find((row) => row.direction === "entry");
    const exit = json.byDirection.find((row) => row.direction === "exit");

    assert.ok(entry.scans >= 1);
    assert.ok(exit.scans >= 1, "the unknown-code scan was an exit");
    assert.equal(
      json.byDirection.reduce((sum, row) => sum + row.scans, 0),
      json.counts.scans,
    );
  });

  test("the gate breakdown is labelled from the gates table and accounts for every scan", async () => {
    const { json } = await report();
    assert.ok(json.byGate.length >= 1);

    const total = json.byGate.reduce((sum, row) => sum + row.scans, 0);
    assert.equal(total, json.counts.scans);

    for (const row of json.byGate) {
      const gate = context.db.prepare("SELECT name FROM gates WHERE id = ?").get(row.gateId);
      assert.ok(gate, `gate ${row.gateId} must exist`);
      assert.equal(row.gateName, gate.name, "the label must come from the gates table");
      assert.equal(row.scans, row.approved + row.rejected + row.unable);
    }
  });

  test("the reason table names why a scan was refused", async () => {
    const { json } = await report();
    const notFound = json.topReasons.find((row) => row.reasonCode === "not_found");
    assert.ok(notFound, "a scan of an unknown code must appear with its reason code");
    assert.ok(notFound.count >= 1);
    assert.ok(typeof notFound.reasonText === "string" || notFound.reasonText === null);
  });

  test("uniquePeople counts distinct holders, ignoring scans with no record", async () => {
    const range = window();
    const { json } = await report(staffCookie, range);
    const timezone = siteTimezone(context.db);
    const expected = context.db
      .prepare(
        `SELECT COUNT(DISTINCT person_id) AS n FROM gate_events
         WHERE person_id IS NOT NULL AND occurred_at >= ? AND occurred_at < ?`,
      )
      .get(
        startOfDayIso(range.from, timezone),
        startOfDayIso(addDaysToDateKey(range.to, 1), timezone),
      ).n;

    assert.equal(json.uniquePeople, expected);
  });

  test("a single-day window is exactly one day", async () => {
    const today = siteToday(context.db);
    const { json } = await report(staffCookie, { from: today, to: today });
    assert.equal(json.days, 1);
    assert.equal(json.daily.length, 1);
    assert.equal(json.daily[0].date, today);
    assert.equal(json.daily[0].scans, json.counts.scans);
  });

  test("reports the plant clock, not the server's", async () => {
    const { json } = await report();
    assert.equal(json.timezone, siteTimezone(context.db));
    assert.ok(!Number.isNaN(Date.parse(json.generatedAt)));
  });

  test("never leaks a person's details — counts and reason codes only", async () => {
    const { json } = await report();
    const serialised = JSON.stringify(json);
    for (const field of ["fullName", "phone", "employeeEmail", "workerRef", "purposeOfVisit"]) {
      assert.ok(!serialised.includes(field), `the report must not carry ${field}`);
    }
  });

  test("a row whose timestamp cannot be dated does not break the report", async () => {
    insertGateEvent(context.db, {
      credentialId: null,
      personId: null,
      gateId: mainGateId(context.db),
      direction: "entry",
      result: "rejected",
      reasonCode: "not_found",
      reasonText: "unreadable row",
      occurredAt: "not-a-date",
      operatorUserId: null,
    });

    const { res, json } = await report();
    assert.equal(res.status, 200);
    assert.ok(Number.isInteger(json.counts.scans));
  });

  test("the route is registered exactly once, for both gate roles", async () => {
    const matches = context.app.locals.routeInventory.filter(
      (route) => route.path === "/api/reports/scans",
    );
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].access, ["administrator", "security_staff"]);
  });
});
