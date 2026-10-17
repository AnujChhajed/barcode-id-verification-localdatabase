import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { insertGateEvent } from "../src/data/gate-events.js";
import { mainGateId, siteTimezone, siteToday } from "../src/data/settings.js";
import { addDaysToDateKey, dateKeyInZone, nowIso, startOfDayIso } from "../src/lib/time.js";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

const ADMIN = {
  username: "dash.admin",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "Dash Admin",
};
const STAFF = {
  username: "dash.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "Dash Staff",
};

const OPEN_WINDOW = { validFrom: "2000-01-01", validTo: "2099-12-31" };
const DEFAULT_DAYS = 7;

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

function summary(cookie = staffCookie, query = "") {
  return request(server.baseUrl, "GET", `/api/dashboard/summary${query}`, { cookie });
}

const PER_CATEGORY = {
  worker: () => ({ workerRef: `DASH-${sequence}` }),
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

const scan = (code, direction = "entry", cookie = staffCookie) =>
  postJson(server.baseUrl, "/api/gate/verify", { code, direction }, cookie);

/** How many event rows the database holds for the plant's today. */
function storedScansToday() {
  const timezone = siteTimezone(context.db);
  const localToday = siteToday(context.db);
  return context.db
    .prepare("SELECT occurred_at FROM gate_events")
    .all()
    .filter((row) => dateKeyInZone(new Date(row.occurred_at), timezone) === localToday).length;
}

describe("GET /api/dashboard/summary", () => {
  test("requires a session", async () => {
    const { res } = await request(server.baseUrl, "GET", "/api/dashboard/summary");
    assert.equal(res.status, 401);
  });

  test("both gate roles may read it; security staff are not refused", async () => {
    assert.equal((await summary(adminCookie)).res.status, 200);
    assert.equal((await summary(staffCookie)).res.status, 200);
  });

  test("rejects an out-of-range or unparseable `days`", async () => {
    for (const query of ["?days=0", "?days=99", "?days=abc", "?days=-1"]) {
      const { res, json } = await summary(staffCookie, query);
      assert.equal(res.status, 400, `${query} should be refused`);
      assert.equal(json.error.code, "BAD_REQUEST");
    }
  });

  test("counts today's scans, reconciling with the rows actually written", async () => {
    const worker = await createPerson("worker", "Scan Counter");
    const credential = await issue(worker.id);
    await scan(credential.id, "entry");
    await scan("code-that-matches-nothing", "exit");

    const { json } = await summary();
    const { counts } = json;

    assert.equal(counts.scans, counts.approved + counts.rejected + counts.unable);
    assert.ok(counts.approved >= 1, "the valid card should be approved");
    assert.ok(counts.rejected >= 1, "an unknown code must be a rejection, not a pass");

    // The headline number is the number of rows in the table for today — counted
    // independently here, not read back from the response.
    assert.equal(counts.scans, storedScansToday(), "today's scan count must match the stored rows");
  });

  test("today's scans are bucketed into the 24 plant hours", async () => {
    const { json } = await summary();
    assert.equal(json.hourly.length, 24);
    assert.deepEqual(
      json.hourly.map((b) => b.hour),
      Array.from({ length: 24 }, (_, h) => h),
    );

    const inHours = json.hourly.reduce((sum, b) => sum + b.approved + b.rejected + b.unable, 0);
    assert.equal(inHours, json.counts.scans, "every scan of today must land in exactly one hour");
  });

  test("the daily series covers the window and ends on the plant's today", async () => {
    const { json } = await summary();
    assert.equal(json.daily.length, DEFAULT_DAYS);
    assert.equal(json.daily[DEFAULT_DAYS - 1].date, json.today);

    const timezone = json.timezone;
    const windowStart = startOfDayIso(json.daily[0].date, timezone);
    // The window's upper bound is the start of TOMORROW — today is included.
    const windowEnd = startOfDayIso(addDaysToDateKey(json.today, 1), timezone);
    assert.ok(windowStart < windowEnd, "the window must be ordered oldest first");

    const inWindow = context.db
      .prepare("SELECT COUNT(*) AS n FROM gate_events WHERE occurred_at >= ? AND occurred_at < ?")
      .get(windowStart, windowEnd).n;
    const seriesTotal = json.daily.reduce((sum, day) => sum + day.scans, 0);
    assert.equal(seriesTotal, inWindow, "the series must account for every row in the window");

    for (const day of json.daily) {
      assert.equal(day.scans, day.approved + day.rejected + day.unable);
    }
  });

  test("`days` shortens the window without changing today's counts", async () => {
    const long = (await summary(staffCookie, "?days=7")).json;
    const short = (await summary(staffCookie, "?days=3")).json;

    assert.equal(short.days, 3);
    assert.equal(short.daily.length, 3);
    assert.equal(short.daily[2].date, long.today);
    assert.deepEqual(short.counts, long.counts);
    assert.deepEqual(
      short.daily.map((d) => d.date),
      long.daily.slice(-3).map((d) => d.date),
    );
  });

  test("the category split attributes a scan to the holder's category", async () => {
    const intern = await createPerson("intern", "Split Intern");
    const credential = await issue(intern.id);
    await scan(credential.id, "entry");

    const { json } = await summary();
    const internRow = json.categorySplit.find((row) => row.category === "intern");
    const unknownRow = json.categorySplit.find((row) => row.category === "unknown");

    assert.ok(internRow.approved >= 1, "the intern's approved scan must be attributed to interns");
    assert.ok(
      unknownRow.scans >= 1,
      "a scan of an unrecognised code must be its own bucket, not dropped",
    );

    const splitTotal = json.categorySplit.reduce((sum, row) => sum + row.scans, 0);
    assert.equal(splitTotal, json.counts.scans, "the split must account for every scan of today");
  });

  test("inside totals come from the holder's record, not the client", async () => {
    const visitor = await createPerson("visitor", "Inside Visitor");
    const credential = await issue(visitor.id, "gate_pass");
    await scan(credential.id, "entry");

    const { json } = await summary();
    assert.ok(json.inside.total >= 1);
    assert.ok(
      json.inside.byCategory.visitor >= 1,
      "the visitor who just entered must be counted as a visitor on site",
    );
    const byCategoryTotal = Object.values(json.inside.byCategory).reduce((a, b) => a + b, 0);
    assert.equal(json.inside.total, byCategoryTotal);
  });

  test("an entry left open from a previous plant day is flagged, not assumed gone", async () => {
    const worker = await createPerson("worker", "Yesterday Stayer");
    const credential = await issue(worker.id);

    // 26 hours ago is always a different plant day, whatever the offset.
    insertGateEvent(context.db, {
      credentialId: credential.id,
      personId: worker.id,
      gateId: mainGateId(context.db),
      direction: "entry",
      result: "approved",
      reasonCode: null,
      reasonText: null,
      occurredAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
      operatorUserId: null,
    });

    const { json } = await summary();
    assert.ok(
      json.inside.missingExit >= 1,
      "an entry with no exit on its own plant day must be reported as unclosed",
    );
    // An entry made today has simply not been exited yet — that is normal.
    assert.ok(json.inside.missingExit <= json.inside.total);
  });

  test("the watchlist figure counts only alerts that would actually fire", async () => {
    const before = (await summary()).json.watchlist.active;

    const created = await postJson(
      server.baseUrl,
      "/api/watchlist",
      { fullName: "Live Alert", reason: "dashboard test", level: "warn" },
      adminCookie,
    );
    assert.equal(created.res.status, 201, JSON.stringify(created.json));

    const expired = await postJson(
      server.baseUrl,
      "/api/watchlist",
      {
        fullName: "Stale Alert",
        reason: "dashboard test",
        level: "info",
        expiresAt: nowIso(new Date(Date.now() - 3_600_000)),
      },
      adminCookie,
    );
    assert.equal(expired.res.status, 201, JSON.stringify(expired.json));

    const after = (await summary()).json.watchlist.active;
    assert.equal(after, before + 1, "the expired alert must not be counted as live");
  });

  test("reports the plant clock, not the server's or the browser's", async () => {
    const { json } = await summary();
    assert.equal(json.timezone, siteTimezone(context.db));
    assert.equal(json.today, siteToday(context.db));
    assert.ok(!Number.isNaN(Date.parse(json.asOf)), "asOf must be a readable instant");
  });

  test("never leaks a person's details — counts only", async () => {
    const { json } = await summary();
    const serialised = JSON.stringify(json);
    for (const field of ["fullName", "phone", "employeeEmail", "workerRef", "purposeOfVisit"]) {
      assert.ok(!serialised.includes(field), `the summary must not carry ${field}`);
    }
  });

  test("the route is registered exactly once", async () => {
    const matches = context.app.locals.routeInventory.filter(
      (route) => route.path === "/api/dashboard/summary",
    );
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].access, ["administrator", "security_staff"]);
  });

  test("a row whose timestamp cannot be dated does not break the summary", async () => {
    // A single unreadable timestamp must not make the whole dashboard throw —
    // the operator would be left with no picture at all.
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

    const { res, json } = await summary();
    assert.equal(res.status, 200);
    assert.ok(Number.isInteger(json.counts.scans));
  });
});
