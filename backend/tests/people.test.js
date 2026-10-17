import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createTestContext, login, postJson, request, seedUser, startServer } from "./helpers.js";

const ADMIN = {
  username: "people.admin",
  password: "administrator-pass-123",
  role: "administrator",
  fullName: "People Admin",
};
const STAFF = {
  username: "people.staff",
  password: "security-staff-pass-123",
  role: "security_staff",
  fullName: "People Staff",
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

const createPerson = (body, cookie = adminCookie) =>
  postJson(server.baseUrl, "/api/people", body, cookie);

describe("people — access control", () => {
  test("anonymous callers are rejected with 401", async () => {
    const probes = [
      ["GET", "/api/people"],
      ["GET", "/api/people/search?q=an"],
      ["GET", "/api/people/does-not-matter"],
      ["POST", "/api/people"],
    ];
    for (const [method, path] of probes) {
      const { res } = await request(server.baseUrl, method, path, {
        body: method === "GET" ? undefined : { category: "worker", fullName: "x" },
      });
      assert.equal(res.status, 401, `${method} ${path} should require a session`);
    }
  });

  test("security staff may run the verification search", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/people/search?q=an", {
      cookie: staffCookie,
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(json.people));
  });

  test("security staff may NOT read the full register", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/people", {
      cookie: staffCookie,
    });
    assert.equal(res.status, 403);
    assert.equal(json.error.code, "FORBIDDEN");
    assert.equal(json.people, undefined);
  });

  test("security staff may NOT create a person", async () => {
    const { res } = await createPerson(
      { category: "worker", fullName: "Sneaky Worker", workerRef: "SNEAK-1" },
      staffCookie,
    );
    assert.equal(res.status, 403);
    assert.equal(
      context.db.prepare("SELECT id FROM people WHERE worker_ref = ?").get("SNEAK-1"),
      undefined,
    );
  });

  test("security staff may NOT edit or suspend a person", async () => {
    const created = await createPerson({
      category: "worker",
      fullName: "Boundary Worker",
      workerRef: "BOUND-1",
    });
    assert.equal(created.res.status, 201);
    const { person } = created.json;

    const patched = await request(server.baseUrl, "PATCH", `/api/people/${person.id}`, {
      body: { fullName: "Renamed By Staff" },
      cookie: staffCookie,
    });
    assert.equal(patched.res.status, 403);

    const suspended = await postJson(
      server.baseUrl,
      `/api/people/${person.id}/status`,
      { status: "suspended", reason: "staff attempt" },
      staffCookie,
    );
    assert.equal(suspended.res.status, 403);

    const stored = context.db
      .prepare("SELECT full_name, status FROM people WHERE id = ?")
      .get(person.id);
    assert.equal(stored.full_name, "Boundary Worker");
    assert.equal(stored.status, "active");
  });

  test("security staff may NOT read a person's full profile", async () => {
    const created = await createPerson({
      category: "worker",
      fullName: "Profile Worker",
      workerRef: "PROF-1",
    });
    const { res } = await request(server.baseUrl, "GET", `/api/people/${created.json.person.id}`, {
      cookie: staffCookie,
    });
    assert.equal(res.status, 403);
  });
});

describe("people — per-category required fields", () => {
  test("a worker without a worker reference is rejected", async () => {
    const { res, json } = await createPerson({ category: "worker", fullName: "No Reference" });
    assert.equal(res.status, 400);
    assert.ok(json.error.details.some((detail) => detail.path === "workerRef"));
  });

  test("an intern without an institution is rejected", async () => {
    const { res, json } = await createPerson({ category: "intern", fullName: "No Institution" });
    assert.equal(res.status, 400);
    assert.ok(json.error.details.some((detail) => detail.path === "institutionName"));
  });

  test("a visitor without a purpose and host is rejected", async () => {
    const { res, json } = await createPerson({ category: "visitor", fullName: "No Purpose" });
    assert.equal(res.status, 400);
    const paths = json.error.details.map((detail) => detail.path);
    assert.ok(paths.includes("purposeOfVisit"));
    assert.ok(paths.includes("personToMeet"));
  });

  test("an unknown category is rejected", async () => {
    const { res } = await createPerson({ category: "contractor", fullName: "Wrong Category" });
    assert.equal(res.status, 400);
  });

  test("unknown fields, bad phone numbers and bad emails are rejected", async () => {
    const unknownField = await createPerson({
      category: "worker",
      fullName: "Extra Field",
      workerRef: "EXTRA-1",
      salaryRupees: 10,
    });
    assert.equal(unknownField.res.status, 400);

    const badPhone = await createPerson({
      category: "worker",
      fullName: "Bad Phone",
      workerRef: "BADPHONE-1",
      phone: "not-a-phone",
    });
    assert.equal(badPhone.res.status, 400);

    const badEmail = await createPerson({
      category: "visitor",
      fullName: "Bad Email",
      purposeOfVisit: "Meeting",
      personToMeet: "Someone",
      employeeEmail: "not-an-email",
    });
    assert.equal(badEmail.res.status, 400);
  });
});

describe("people — creation, duplicates and retrieval", () => {
  let worker;

  test("a worker can be created and read back", async () => {
    const { res, json } = await createPerson({
      category: "worker",
      fullName: "Ravi Kumar",
      workerRef: "W-1001",
      contractorCompany: "Sharma Enterprises",
      phone: "9876543210",
    });
    assert.equal(res.status, 201);
    worker = json.person;
    assert.equal(worker.category, "worker");
    assert.equal(worker.status, "active");
    assert.equal(worker.workerRef, "W-1001");
    // The filesystem photo location must never be disclosed.
    assert.equal(worker.photoPath, undefined);
    assert.equal(worker.hasPhoto, false);
    assert.equal(worker.plantId, "plant-p3");

    const read = await request(server.baseUrl, "GET", `/api/people/${worker.id}`, {
      cookie: adminCookie,
    });
    assert.equal(read.res.status, 200);
    assert.equal(read.json.person.fullName, "Ravi Kumar");
    assert.deepEqual(read.json.credentials, []);
  });

  test("a name, category and phone triple cannot be entered twice", async () => {
    const { res, json } = await createPerson({
      category: "worker",
      fullName: "Ravi Kumar",
      workerRef: "W-1002",
      phone: "9876543210",
    });
    assert.equal(res.status, 409);
    assert.equal(json.error.code, "CONFLICT");
  });

  test("a duplicate worker reference is rejected by the database", async () => {
    const { res, json } = await createPerson({
      category: "worker",
      fullName: "Different Person",
      workerRef: "W-1001",
    });
    assert.equal(res.status, 409);
    assert.equal(json.error.code, "CONFLICT");
  });

  test("an intern and a visitor can be created", async () => {
    const intern = await createPerson({
      category: "intern",
      fullName: "Sneha Rao",
      institutionName: "NIT Trichy",
    });
    assert.equal(intern.res.status, 201);
    assert.equal(intern.json.person.institutionName, "NIT Trichy");

    const visitor = await createPerson({
      category: "visitor",
      fullName: "Vendor Visitor",
      purposeOfVisit: "Annual maintenance",
      personToMeet: "Plant Manager",
      employeeEmail: "manager@abb.example",
    });
    assert.equal(visitor.res.status, 201);
    assert.equal(visitor.json.person.purposeOfVisit, "Annual maintenance");
  });

  test("the register can be filtered and counted", async () => {
    const all = await request(server.baseUrl, "GET", "/api/people", { cookie: adminCookie });
    assert.equal(all.res.status, 200);
    assert.equal(all.json.total, all.json.people.length);

    const workers = await request(server.baseUrl, "GET", "/api/people?category=worker", {
      cookie: adminCookie,
    });
    assert.equal(workers.res.status, 200);
    assert.ok(workers.json.people.every((person) => person.category === "worker"));

    const byName = await request(server.baseUrl, "GET", "/api/people?q=kumar", {
      cookie: adminCookie,
    });
    assert.ok(byName.json.people.some((person) => person.workerRef === "W-1001"));
  });

  test("an invalid filter value is rejected", async () => {
    const { res } = await request(server.baseUrl, "GET", "/api/people?category=alien", {
      cookie: adminCookie,
    });
    assert.equal(res.status, 400);
  });

  test("the search returns identification only, never contact details", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/people/search?q=Ravi", {
      cookie: staffCookie,
    });
    assert.equal(res.status, 200);
    const found = json.people.find((person) => person.id === worker.id);
    assert.ok(found, "expected the worker in the search results");
    assert.equal(found.fullName, "Ravi Kumar");
    assert.equal(found.phone, undefined);
    assert.equal(found.employeeEmail, undefined);
    assert.equal(found.purposeOfVisit, undefined);
  });

  test("the search refuses an empty term", async () => {
    const { res } = await request(server.baseUrl, "GET", "/api/people/search?q=", {
      cookie: staffCookie,
    });
    assert.equal(res.status, 400);
  });

  test("an unknown identifier is a 404, not an empty 200", async () => {
    const { res, json } = await request(server.baseUrl, "GET", "/api/people/not-a-real-id", {
      cookie: adminCookie,
    });
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "NOT_FOUND");
  });
});

describe("people — updates", () => {
  let person;

  before(async () => {
    const created = await createPerson({
      category: "worker",
      fullName: "Update Subject",
      workerRef: "UPD-1",
    });
    person = created.json.person;
  });

  test("an administrator can change profile fields", async () => {
    const { res, json } = await request(server.baseUrl, "PATCH", `/api/people/${person.id}`, {
      body: { contractorCompany: "New Contractor Pvt Ltd" },
      cookie: adminCookie,
    });
    assert.equal(res.status, 200);
    assert.equal(json.person.contractorCompany, "New Contractor Pvt Ltd");
  });

  test("changing category without the new category's required fields is rejected", async () => {
    const { res, json } = await request(server.baseUrl, "PATCH", `/api/people/${person.id}`, {
      body: { category: "intern" },
      cookie: adminCookie,
    });
    assert.equal(res.status, 400);
    assert.ok(json.error.details.some((detail) => detail.path === "institutionName"));

    const stored = context.db.prepare("SELECT category FROM people WHERE id = ?").get(person.id);
    assert.equal(stored.category, "worker");
  });

  test("changing category with the required fields succeeds", async () => {
    const { res, json } = await request(server.baseUrl, "PATCH", `/api/people/${person.id}`, {
      body: { category: "intern", institutionName: "Anna University" },
      cookie: adminCookie,
    });
    assert.equal(res.status, 200);
    assert.equal(json.person.category, "intern");
  });

  test("an empty change set is rejected", async () => {
    const { res } = await request(server.baseUrl, "PATCH", `/api/people/${person.id}`, {
      body: {},
      cookie: adminCookie,
    });
    assert.equal(res.status, 400);
  });

  test("updates are recorded in the audit log", async () => {
    const row = context.db
      .prepare(
        "SELECT action FROM audit_log WHERE entity_id = ? AND action = 'person.update' ORDER BY occurred_at DESC",
      )
      .get(person.id);
    assert.equal(row.action, "person.update");
  });
});

describe("people — status changes", () => {
  let person;

  before(async () => {
    const created = await createPerson({
      category: "visitor",
      fullName: "Status Subject",
      purposeOfVisit: "Audit",
      personToMeet: "Safety Officer",
    });
    person = created.json.person;
  });

  test("a status change without a reason is rejected", async () => {
    const { res } = await postJson(
      server.baseUrl,
      `/api/people/${person.id}/status`,
      { status: "suspended" },
      adminCookie,
    );
    assert.equal(res.status, 400);
  });

  test("an administrator can suspend and then terminate, with the reason recorded", async () => {
    const suspended = await postJson(
      server.baseUrl,
      `/api/people/${person.id}/status`,
      { status: "suspended", reason: "Contract dispute under review" },
      adminCookie,
    );
    assert.equal(suspended.res.status, 200);
    assert.equal(suspended.json.person.status, "suspended");

    const terminated = await postJson(
      server.baseUrl,
      `/api/people/${person.id}/status`,
      { status: "terminated", reason: "Contract ended" },
      adminCookie,
    );
    assert.equal(terminated.res.status, 200);
    assert.equal(terminated.json.person.status, "terminated");

    const audit = context.db
      .prepare(
        "SELECT reason FROM audit_log WHERE entity_id = ? AND action = 'person.status_change' ORDER BY occurred_at",
      )
      .all(person.id);
    assert.equal(audit.length, 2);
    assert.equal(audit[0].reason, "Contract dispute under review");
    assert.equal(audit[1].reason, "Contract ended");
  });
});
