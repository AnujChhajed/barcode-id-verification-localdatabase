import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

/**
 * Phase D — compliance and monitoring.
 *
 * Covers canteen (one entry per person per day, including concurrently),
 * incidents triage, announcements, watchlist (including the gate alert) and the
 * administrator-only audit viewer. Negative authorization is asserted for every
 * administrator-only route: a security-staff caller must be refused AND no row
 * may be written.
 */

const ADMIN = {
  username: "d.admin",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "D Admin",
};
const STAFF = {
  username: "d.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "D Staff",
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

/** A worker with a live credential, ready to be scanned. */
async function issueFor(fullName, { window = OPEN_WINDOW, kind = "id_card" } = {}) {
  sequence += 1;
  const created = await postJson(
    server.baseUrl,
    "/api/people",
    { category: "worker", fullName, workerRef: `D-${sequence}` },
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
  return { person, credential: issued.json.credential };
}

const canteen = (code, cookie = staffCookie) =>
  postJson(server.baseUrl, "/api/canteen/verify", { code }, cookie);

describe("canteen", () => {
  test("a valid card is approved once a day", async () => {
    const { credential } = await issueFor("Canteen One");
    const first = await canteen(credential.id);
    assert.equal(first.res.status, 200);
    assert.equal(first.json.result, "approved");
    assert.equal(first.json.alreadyEntered, false);
    assert.equal(first.json.recorded, true);
    assert.equal(first.json.person.fullName, "Canteen One");
  });

  test("the second same-day entry for the same person is refused and recorded", async () => {
    const { credential } = await issueFor("Canteen Two");
    const first = await canteen(credential.id);
    assert.equal(first.json.result, "approved");

    const second = await canteen(credential.id);
    assert.equal(second.res.status, 200);
    assert.equal(second.json.result, "rejected");
    assert.equal(second.json.reasonCode, "already_entered_today");
    assert.equal(second.json.alreadyEntered, true);

    // Exactly one APPROVED row, but the refusal itself is on record.
    const approved = context.db
      .prepare("SELECT COUNT(*) AS n FROM canteen_events WHERE result = 'approved'")
      .get().n;
    const refused = context.db
      .prepare(
        "SELECT COUNT(*) AS n FROM canteen_events WHERE result = 'rejected' AND reason_code = 'already_entered_today'",
      )
      .get().n;
    assert.equal(approved, 2, "one approved per person across the two people above");
    assert.equal(refused, 1);
  });

  test("two simultaneous scans cannot both be approved", async () => {
    const { credential } = await issueFor("Canteen Race");
    const [a, b] = await Promise.all([canteen(credential.id), canteen(credential.id)]);
    const results = [a.json.result, b.json.result].sort();
    assert.deepEqual(results, ["approved", "rejected"]);
    const approved = context.db
      .prepare(
        "SELECT COUNT(*) AS n FROM canteen_events WHERE person_id = ? AND result = 'approved'",
      )
      .get(credential.personId).n;
    assert.equal(approved, 1, "the unique index must keep exactly one approved row");
  });

  test("an unknown code is rejected, never approved", async () => {
    const answer = await canteen("does-not-exist");
    assert.equal(answer.json.result, "rejected");
    assert.equal(answer.json.reasonCode, "not_found");
  });

  test("a scan without a session is refused", async () => {
    const { res } = await canteen("anything", null);
    assert.equal(res.status, 401);
  });
});

describe("incidents triage", () => {
  test("a filed report can be listed and moved to investigating then closed", async () => {
    const filed = await postJson(
      server.baseUrl,
      "/api/incidents",
      { title: "Triage me", severity: "high" },
      staffCookie,
    );
    assert.equal(filed.res.status, 201);
    const id = filed.json.incident.id;

    const listed = await request(server.baseUrl, "GET", "/api/incidents?status=open", {
      cookie: staffCookie,
    });
    assert.equal(listed.res.status, 200);
    assert.ok(listed.json.incidents.some((i) => i.id === id));

    const updated = await request(server.baseUrl, "PATCH", `/api/incidents/${id}`, {
      cookie: staffCookie,
      body: { status: "investigating", reason: "looking into it" },
    });
    assert.equal(updated.res.status, 200);
    assert.equal(updated.json.incident.status, "investigating");

    const auditRow = context.db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'incident.status' AND entity_id = ?",
      )
      .get(id).n;
    assert.equal(auditRow, 1);
  });

  test("updating a missing incident is a 404", async () => {
    const { res } = await request(server.baseUrl, "PATCH", "/api/incidents/nope", {
      cookie: staffCookie,
      body: { status: "closed" },
    });
    assert.equal(res.status, 404);
  });
});

describe("announcements", () => {
  test("staff can read but not post", async () => {
    const forbidden = await postJson(
      server.baseUrl,
      "/api/announcements",
      { title: "Not allowed", body: "staff must not post" },
      staffCookie,
    );
    assert.equal(forbidden.res.status, 403);
    assert.equal(context.db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, 0);

    const posted = await postJson(
      server.baseUrl,
      "/api/announcements",
      { title: "Gate drill at 4pm", body: "Expect a practice lockdown.", severity: "warning" },
      adminCookie,
    );
    assert.equal(posted.res.status, 201);

    const listed = await request(server.baseUrl, "GET", "/api/announcements", {
      cookie: staffCookie,
    });
    assert.equal(listed.res.status, 200);
    assert.equal(listed.json.announcements.length, 1);
    assert.equal(listed.json.announcements[0].title, "Gate drill at 4pm");
  });

  test("staff cannot withdraw an announcement", async () => {
    const list = await request(server.baseUrl, "GET", "/api/announcements", {
      cookie: adminCookie,
    });
    const id = list.json.announcements[0].id;
    const { res } = await postJson(
      server.baseUrl,
      `/api/announcements/${id}/deactivate`,
      {},
      staffCookie,
    );
    assert.equal(res.status, 403);
    assert.equal(
      context.db.prepare("SELECT is_active FROM announcements WHERE id = ?").get(id).is_active,
      1,
    );
  });
});

describe("watchlist", () => {
  test("staff can read but not add; admin can add", async () => {
    const forbidden = await postJson(
      server.baseUrl,
      "/api/watchlist",
      { fullName: "Nobody", reason: "nope", level: "info" },
      staffCookie,
    );
    assert.equal(forbidden.res.status, 403);
    assert.equal(context.db.prepare("SELECT COUNT(*) AS n FROM watchlist").get().n, 0);

    const added = await postJson(
      server.baseUrl,
      "/api/watchlist",
      { fullName: "Flagged Person", reason: "Banned from site", level: "deny" },
      adminCookie,
    );
    assert.equal(added.res.status, 201);
    assert.equal(added.json.entry.isActive, true);
  });

  test("a scan of a flagged person returns the alert alongside the verdict", async () => {
    const { person, credential } = await issueFor("Watch Target");
    const added = await postJson(
      server.baseUrl,
      "/api/watchlist",
      {
        fullName: "Watch Target",
        reason: "Under investigation",
        level: "detain",
        personId: person.id,
      },
      adminCookie,
    );
    assert.equal(added.res.status, 201);

    const scan = await postJson(
      server.baseUrl,
      "/api/gate/verify",
      { code: credential.id, direction: "entry" },
      staffCookie,
    );
    assert.equal(scan.res.status, 200);
    assert.equal(
      scan.json.result,
      "approved",
      "the alert is advisory — it does not change the verdict",
    );
    assert.ok(scan.json.watchlist, "expected a watchlist alert");
    assert.equal(scan.json.watchlist.level, "detain");
  });

  test("an unflagged person has no alert", async () => {
    const { credential } = await issueFor("Clean Person");
    const scan = await postJson(
      server.baseUrl,
      "/api/gate/verify",
      { code: credential.id, direction: "entry" },
      staffCookie,
    );
    assert.equal(scan.json.watchlist, null);
  });
});

describe("audit viewer", () => {
  test("only an administrator can read the audit trail", async () => {
    const denied = await request(server.baseUrl, "GET", "/api/audit", { cookie: staffCookie });
    assert.equal(denied.res.status, 403);

    const allowed = await request(server.baseUrl, "GET", "/api/audit", { cookie: adminCookie });
    assert.equal(allowed.res.status, 200);
    assert.ok(Array.isArray(allowed.json.entries));
    assert.ok(allowed.json.total > 0, "the actions taken above must appear in the audit trail");
    assert.ok(allowed.json.entries.some((e) => e.action === "watchlist.create"));
  });
});
