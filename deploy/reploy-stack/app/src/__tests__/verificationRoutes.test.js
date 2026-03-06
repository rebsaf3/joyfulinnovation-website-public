const path = require("path");
const fs = require("fs");
const os = require("os");
const request = require("supertest");
const { createApp } = require("../app");
const { openDb } = require("../db");
const { createEmailSender } = require("../emailSender");

let db;
let app;
let tmpDir;
let sender;
let agent;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-test-"));
  db = openDb(path.join(tmpDir, "test.db"));
  sender = createEmailSender(); // log-only mode
  app = createApp(db, { emailSender: sender });

  // Create an authenticated agent
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
  return Buffer.from(
    [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
  );
}

/** Upload two CSVs and return the runId */
async function createRun() {
  const licenses = csvBuffer(
    ["email", "name", "product"],
    [
      ["alice@co.com", "Alice", "Photoshop"],
      ["bob@co.com", "Bob", "Slack"],
    ]
  );
  const adUsers = csvBuffer(
    ["email", "name", "department"],
    [
      ["alice@co.com", "Alice", "Design"],
      ["carol@co.com", "Carol", "Engineering"],
    ]
  );

  const res = await agent
    .post("/api/compare")
    .attach("licenses", licenses, "licenses.csv")
    .attach("adUsers", adUsers, "ad_users.csv")
    .expect(200);

  return res.body.runId;
}

// ── POST /api/runs/:id/verify ────────────────────────────────────────────

describe("POST /api/runs/:id/verify", () => {
  it("sends verification emails for all inactive users", async () => {
    const runId = await createRun();

    const res = await agent
      .post(`/api/runs/${runId}/verify`)
      .send({ baseUrl: "https://app.example.com" })
      .expect(200);

    expect(res.body.sent).toBe(2); // bob only-in-A, carol only-in-B
    expect(res.body.failed).toBe(0);
    expect(res.body.details).toHaveLength(2);

    // Verify emails were captured by the log-only sender
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0].subject).toContain("access");
  });

  it("returns 404 for a nonexistent run", async () => {
    const res = await agent
      .post("/api/runs/nonexistent/verify")
      .send({})
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  it("includes unique tokens in sent emails", async () => {
    const runId = await createRun();

    await agent
      .post(`/api/runs/${runId}/verify`)
      .send({ baseUrl: "https://app.example.com" })
      .expect(200);

    const tokens = sender.sent.map((e) => {
      const match = e.text.match(/token=([a-f0-9]+)/);
      return match[1];
    });

    expect(new Set(tokens).size).toBe(2);
  });
});

// ── POST /api/confirm ────────────────────────────────────────────────────

describe("POST /api/confirm", () => {
  /** Helper: create a run, send verification emails, and return tokens */
  async function setupWithTokens() {
    const runId = await createRun();

    await agent
      .post(`/api/runs/${runId}/verify`)
      .send({ baseUrl: "https://app.example.com" })
      .expect(200);

    // Extract tokens from sent emails
    const tokens = sender.sent.map((e) => {
      const match = e.text.match(/token=([a-f0-9]+)/);
      return match[1];
    });

    return { runId, tokens };
  }

  it("records a 'yes' response with user identity and audit status", async () => {
    const { tokens } = await setupWithTokens();

    const res = await request(app)
      .post("/api/confirm")
      .send({ token: tokens[0], response: "yes" })
      .expect(200);

    expect(res.body.recorded).toBe(true);
    expect(res.body.alreadyResponded).toBe(false);
    expect(res.body.response).toBe("yes");
    expect(res.body.userId).toBeDefined();
    expect(res.body.userKey).toBeDefined();
    expect(res.body.email).toBeDefined();
    expect(res.body.auditStatus).toBe("confirmed");
  });

  it("records a 'no' response with revoked audit status", async () => {
    const { tokens } = await setupWithTokens();

    const res = await request(app)
      .post("/api/confirm")
      .send({ token: tokens[0], response: "no" })
      .expect(200);

    expect(res.body.recorded).toBe(true);
    expect(res.body.response).toBe("no");
    expect(res.body.auditStatus).toBe("revoked");
  });

  it("updates inactive_users audit_status in the database", async () => {
    const { tokens } = await setupWithTokens();

    const res = await request(app)
      .post("/api/confirm")
      .send({ token: tokens[0], response: "yes" })
      .expect(200);

    const user = db
      .prepare("SELECT audit_status FROM inactive_users WHERE id = ?")
      .get(res.body.userId);
    expect(user.audit_status).toBe("confirmed");
  });

  it("writes to audit_log on confirmation", async () => {
    const { runId, tokens } = await setupWithTokens();

    await request(app)
      .post("/api/confirm")
      .send({ token: tokens[0], response: "yes" })
      .expect(200);

    const logs = db
      .prepare("SELECT * FROM audit_log WHERE run_id = ? AND action = 'confirmed'")
      .all(runId);
    expect(logs).toHaveLength(1);
    expect(logs[0].user_key).toBeDefined();
    expect(logs[0].created_at).toBeDefined();
  });

  it("handles duplicate responses gracefully", async () => {
    const { tokens } = await setupWithTokens();

    await request(app)
      .post("/api/confirm")
      .send({ token: tokens[0], response: "yes" })
      .expect(200);

    const res = await request(app)
      .post("/api/confirm")
      .send({ token: tokens[0], response: "no" })
      .expect(200);

    expect(res.body.recorded).toBe(false);
    expect(res.body.alreadyResponded).toBe(true);
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app)
      .post("/api/confirm")
      .send({ token: "bogus", response: "yes" })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 when token or response is missing", async () => {
    await request(app)
      .post("/api/confirm")
      .send({ token: "abc" })
      .expect(400);

    await request(app)
      .post("/api/confirm")
      .send({ response: "yes" })
      .expect(400);
  });

  it("returns 400 for invalid response values", async () => {
    const { tokens } = await setupWithTokens();

    const res = await request(app)
      .post("/api/confirm")
      .send({ token: tokens[0], response: "maybe" })
      .expect(400);

    expect(res.body.error).toMatch(/yes.*no/i);
  });
});

// ── GET /api/runs/:id/responses ──────────────────────────────────────────

describe("GET /api/runs/:id/responses", () => {
  it("returns a complete response summary", async () => {
    const runId = await createRun();

    // Send verifications
    await agent
      .post(`/api/runs/${runId}/verify`)
      .send({ baseUrl: "https://app.example.com" })
      .expect(200);

    // Respond to one
    const token = sender.sent[0].text.match(/token=([a-f0-9]+)/)[1];
    await request(app)
      .post("/api/confirm")
      .send({ token, response: "yes" })
      .expect(200);

    const res = await agent
      .get(`/api/runs/${runId}/responses`)
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.sent).toBe(2);
    expect(res.body.responded).toBe(1);
    expect(res.body.pending).toBe(1);
    expect(res.body.yes).toBe(1);
    expect(res.body.no).toBe(0);
    expect(res.body.details).toHaveLength(2);
  });

  it("returns 404 for a nonexistent run", async () => {
    await agent
      .get("/api/runs/nonexistent/responses")
      .expect(404);
  });

  it("returns zeroes when no emails have been sent", async () => {
    const runId = await createRun();

    const res = await agent
      .get(`/api/runs/${runId}/responses`)
      .expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.pending).toBe(0);
  });
});

// ── GET /api/runs/:id/audit ───────────────────────────────────────────────

describe("GET /api/runs/:id/audit", () => {
  it("returns the chronological audit log for a run", async () => {
    const runId = await createRun();

    // Send verifications (creates verification_sent log entries)
    await agent
      .post(`/api/runs/${runId}/verify`)
      .send({ baseUrl: "https://app.example.com" })
      .expect(200);

    // Record a response (creates confirmed log entry)
    const token = sender.sent[0].text.match(/token=([a-f0-9]+)/)[1];
    await request(app)
      .post("/api/confirm")
      .send({ token, response: "yes" })
      .expect(200);

    const res = await agent
      .get(`/api/runs/${runId}/audit`)
      .expect(200);

    expect(res.body.runId).toBe(runId);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(3); // 2 verification_sent + 1 confirmed

    const actions = res.body.entries.map((e) => e.action);
    expect(actions).toContain("verification_sent");
    expect(actions).toContain("confirmed");

    // Every entry has required fields
    for (const entry of res.body.entries) {
      expect(entry.user_key).toBeDefined();
      expect(entry.email).toBeDefined();
      expect(entry.created_at).toBeDefined();
    }
  });

  it("returns 404 for a nonexistent run", async () => {
    await agent
      .get("/api/runs/nonexistent/audit")
      .expect(404);
  });

  it("returns empty entries when no audit events exist", async () => {
    const runId = await createRun();

    const res = await agent
      .get(`/api/runs/${runId}/audit`)
      .expect(200);

    expect(res.body.entries).toEqual([]);
  });
});

// ── GET /api/runs/:id/audit/results ──────────────────────────────────────

describe("GET /api/runs/:id/audit/results", () => {
  it("returns per-user audit statuses with counts", async () => {
    const runId = await createRun();

    // Send verifications
    await agent
      .post(`/api/runs/${runId}/verify`)
      .send({ baseUrl: "https://app.example.com" })
      .expect(200);

    // One confirms yes, one does not respond
    const token = sender.sent[0].text.match(/token=([a-f0-9]+)/)[1];
    await request(app)
      .post("/api/confirm")
      .send({ token, response: "yes" })
      .expect(200);

    const res = await agent
      .get(`/api/runs/${runId}/audit/results`)
      .expect(200);

    expect(res.body.runId).toBe(runId);
    expect(res.body.total).toBe(2);
    expect(res.body.confirmed).toBe(1);
    expect(res.body.pending).toBe(1);
    expect(res.body.revoked).toBe(0);
    expect(res.body.users).toHaveLength(2);

    // Each user record has the expected shape
    for (const user of res.body.users) {
      expect(user.user_key).toBeDefined();
      expect(user.email).toBeDefined();
      expect(user.audit_status).toBeDefined();
    }
  });

  it("shows all users as pending before any emails are sent", async () => {
    const runId = await createRun();

    const res = await agent
      .get(`/api/runs/${runId}/audit/results`)
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.pending).toBe(2);
    expect(res.body.confirmed).toBe(0);
    expect(res.body.revoked).toBe(0);
  });

  it("returns 404 for a nonexistent run", async () => {
    await agent
      .get("/api/runs/nonexistent/audit/results")
      .expect(404);
  });
});

// ── GET /confirm ─────────────────────────────────────────────────────────

describe("GET /confirm", () => {
  it("serves the confirmation landing page", async () => {
    const res = await request(app)
      .get("/confirm")
      .expect(200);

    expect(res.text).toContain("<!DOCTYPE html>");
    expect(res.text).toContain("Confirm Access");
  });
});
