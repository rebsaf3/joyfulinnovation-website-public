const path = require("path");
const fs = require("fs");
const os = require("os");
const request = require("supertest");
const { createApp } = require("../app");
const { openDb } = require("../db");

let db;
let app;
let tmpDir;
let agent;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-test-"));
  db = openDb(path.join(tmpDir, "test.db"));
  app = createApp(db);

  // Create an authenticated agent for all protected-route tests
  agent = request.agent(app);
  await agent
    .post("/api/auth/register")
    .send({ email: "test@co.com", password: "securepass123", companyName: "TestCo" });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function csvBuffer(headers, rows) {
  const lines = [headers.join(","), ...rows.map((r) => r.join(","))];
  return Buffer.from(lines.join("\n"));
}

// ── POST /api/compare ───────────────────────────────────────────────────

describe("POST /api/compare", () => {
  it("returns a comparison report when two valid CSVs are uploaded", async () => {
    const licenses = csvBuffer(
      ["email", "name", "product"],
      [
        ["alice@co.com", "Alice", "Photoshop"],
        ["bob@co.com", "Bob", "Slack"],
        ["carol@co.com", "Carol", "Zoom"],
      ]
    );
    const adUsers = csvBuffer(
      ["email", "name", "department"],
      [
        ["alice@co.com", "Alice", "Design"],
        ["dave@co.com", "Dave", "Engineering"],
      ]
    );

    const res = await agent
      .post("/api/compare")
      .attach("licenses", licenses, "licenses.csv")
      .attach("adUsers", adUsers, "ad_users.csv")
      .expect(200);

    expect(res.body.runId).toBeDefined();
    expect(res.body.report.summary.totalFileA).toBe(3);
    expect(res.body.report.summary.totalFileB).toBe(2);
    expect(res.body.report.summary.matchedUsers).toBe(1);
    expect(res.body.report.summary.onlyInFileA).toBe(2);
    expect(res.body.report.summary.onlyInFileB).toBe(1);
    expect(res.body.report.matches).toEqual(["alice@co.com"]);
  });

  it("returns 400 when the licenses file is missing", async () => {
    const adUsers = csvBuffer(["email"], [["a@b.com"]]);

    const res = await agent
      .post("/api/compare")
      .attach("adUsers", adUsers, "ad.csv")
      .expect(400);

    expect(res.body.error).toMatch(/Both files are required/);
  });

  it("returns 400 when the adUsers file is missing", async () => {
    const licenses = csvBuffer(["email"], [["a@b.com"]]);

    const res = await agent
      .post("/api/compare")
      .attach("licenses", licenses, "lic.csv")
      .expect(400);

    expect(res.body.error).toMatch(/Both files are required/);
  });

  it("returns 400 when no files are provided", async () => {
    const res = await agent
      .post("/api/compare")
      .expect(400);

    expect(res.body.error).toMatch(/Both files are required/);
  });

  it("returns 400 for non-CSV file types", async () => {
    const txt = Buffer.from("not,a,csv");
    const csv = csvBuffer(["email"], [["a@b.com"]]);

    const res = await agent
      .post("/api/compare")
      .attach("licenses", txt, "data.exe")
      .attach("adUsers", csv, "ad.csv")
      .expect(400);

    expect(res.body.error).toMatch(/CSV/i);
  });

  it("persists the run so it can be retrieved", async () => {
    const licenses = csvBuffer(["email"], [["a@b.com"]]);
    const adUsers = csvBuffer(["email"], [["a@b.com"]]);

    const res = await agent
      .post("/api/compare")
      .attach("licenses", licenses, "lic.csv")
      .attach("adUsers", adUsers, "ad.csv")
      .expect(200);

    const runId = res.body.runId;

    const run = await agent
      .get(`/api/runs/${runId}`)
      .expect(200);

    expect(run.body.id).toBe(runId);
    expect(run.body.report_json.summary.matchedUsers).toBe(1);
  });

  it("also saves inactive users to the database", async () => {
    const licenses = csvBuffer(
      ["email", "name"],
      [["only-in-lic@co.com", "Lonely"]]
    );
    const adUsers = csvBuffer(
      ["email", "name"],
      [["only-in-ad@co.com", "Solo"]]
    );

    const res = await agent
      .post("/api/compare")
      .attach("licenses", licenses, "lic.csv")
      .attach("adUsers", adUsers, "ad.csv")
      .expect(200);

    const runId = res.body.runId;

    // Verify inactive users were persisted
    const rows = db
      .prepare("SELECT * FROM inactive_users WHERE run_id = ?")
      .all(runId);
    expect(rows).toHaveLength(2);
  });
});

// ── GET /api/runs/:id ───────────────────────────────────────────────────

describe("GET /api/runs/:id", () => {
  it("returns 404 for a nonexistent run", async () => {
    const res = await agent
      .get("/api/runs/does-not-exist")
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── Static file serving ─────────────────────────────────────────────────

describe("GET /", () => {
  it("serves the HTML upload page", async () => {
    const res = await request(app)
      .get("/")
      .expect(200);

    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).toContain("Software Licenses");
    expect(res.text).toContain("Active Directory");
  });
});
