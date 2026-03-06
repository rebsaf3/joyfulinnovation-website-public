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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-test-"));
  db = openDb(path.join(tmpDir, "test.db"));
  sender = createEmailSender();
  app = createApp(db, { emailSender: sender });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── POST /api/auth/register ─────────────────────────────────────────────

describe("POST /api/auth/register", () => {
  it("registers a new user and returns user data", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Acme Corp" })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBe("alice@co.com");
    expect(res.body.companyId).toBeDefined();
  });

  it("auto-logs in after registration (session set)", async () => {
    const agent = request.agent(app);

    await agent
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Acme Corp" })
      .expect(201);

    // Should be able to access /api/auth/me without logging in again
    const res = await agent.get("/api/auth/me").expect(200);
    expect(res.body.email).toBe("alice@co.com");
  });

  it("creates the company if it does not exist", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "New Corp" })
      .expect(201);

    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(res.body.companyId);
    expect(company.name).toBe("New Corp");
  });

  it("does not allow registering into an existing company by name (requires invite)", async () => {
    const agent1 = request.agent(app);
    const agent2 = request.agent(app);

    const res1 = await agent1
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Shared Corp" })
      .expect(201);

    const res2 = await agent2
      .post("/api/auth/register")
      .send({ email: "bob@co.com", password: "securepass456", companyName: "Shared Corp" })
      .expect(409);

    expect(res1.body.companyId).toBeDefined();
    expect(res2.body.error).toMatch(/already exists/i);
  });

  it("returns 409 for duplicate email", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Acme Corp" })
      .expect(201);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "anotherpass1", companyName: "Acme Corp" })
      .expect(409);

    expect(res.body.error).toMatch(/already exists/i);
  });

  it("returns 400 when fields are missing", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123" })
      .expect(400);

    await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", companyName: "Acme" })
      .expect(400);

    await request(app)
      .post("/api/auth/register")
      .send({ password: "securepass123", companyName: "Acme" })
      .expect(400);
  });

  it("returns 400 for short password", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "short", companyName: "Acme Corp" })
      .expect(400);

    expect(res.body.error).toMatch(/8 characters/i);
  });
});

// ── POST /api/auth/login ────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Acme Corp" });
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@co.com", password: "securepass123" })
      .expect(200);

    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBe("alice@co.com");
    expect(res.body.companyId).toBeDefined();
  });

  it("establishes a session after login", async () => {
    const agent = request.agent(app);

    await agent
      .post("/api/auth/login")
      .send({ email: "alice@co.com", password: "securepass123" })
      .expect(200);

    const res = await agent.get("/api/auth/me").expect(200);
    expect(res.body.email).toBe("alice@co.com");
  });

  it("returns 401 for wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@co.com", password: "wrongpassword" })
      .expect(401);

    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 401 for nonexistent user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@co.com", password: "securepass123" })
      .expect(401);

    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 400 when fields are missing", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ email: "alice@co.com" })
      .expect(400);

    await request(app)
      .post("/api/auth/login")
      .send({ password: "securepass123" })
      .expect(400);
  });
});

// ── POST /api/auth/logout ───────────────────────────────────────────────

describe("POST /api/auth/logout", () => {
  it("destroys the session", async () => {
    const agent = request.agent(app);

    await agent
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Acme Corp" })
      .expect(201);

    await agent.post("/api/auth/logout").expect(200);

    // Session should be gone — /me should return 401
    await agent.get("/api/auth/me").expect(401);
  });
});

// ── GET /api/auth/me ────────────────────────────────────────────────────

describe("GET /api/auth/me", () => {
  it("returns 401 when not authenticated", async () => {
    await request(app).get("/api/auth/me").expect(401);
  });

  it("returns user info when authenticated", async () => {
    const agent = request.agent(app);

    await agent
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Acme Corp" })
      .expect(201);

    const res = await agent.get("/api/auth/me").expect(200);
    expect(res.body.email).toBe("alice@co.com");
    expect(res.body.companyId).toBeDefined();
  });
});

// ── Protected route access ──────────────────────────────────────────────

describe("protected routes require authentication", () => {
  it("returns 401 for /api/compare without auth", async () => {
    await request(app)
      .post("/api/compare")
      .expect(401);
  });

  it("returns 401 for /api/runs/:id without auth", async () => {
    await request(app)
      .get("/api/runs/some-id")
      .expect(401);
  });

  it("returns 401 for /api/runs/:id/verify without auth", async () => {
    await request(app)
      .post("/api/runs/some-id/verify")
      .expect(401);
  });

  it("returns 401 for /api/runs/:id/responses without auth", async () => {
    await request(app)
      .get("/api/runs/some-id/responses")
      .expect(401);
  });

  it("returns 401 for /api/runs/:id/audit without auth", async () => {
    await request(app)
      .get("/api/runs/some-id/audit")
      .expect(401);
  });

  it("returns 401 for /api/runs/:id/audit/results without auth", async () => {
    await request(app)
      .get("/api/runs/some-id/audit/results")
      .expect(401);
  });
});

// ── Company scoping ─────────────────────────────────────────────────────

describe("company scoping", () => {
  function csvBuffer(headers, rows) {
    return Buffer.from(
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    );
  }

  it("prevents users from accessing runs belonging to another company", async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    // Register two users in different companies
    await agentA
      .post("/api/auth/register")
      .send({ email: "alice@a.com", password: "securepass123", companyName: "Company A" })
      .expect(201);

    await agentB
      .post("/api/auth/register")
      .send({ email: "bob@b.com", password: "securepass456", companyName: "Company B" })
      .expect(201);

    // Company A creates a comparison run
    const licenses = csvBuffer(
      ["email", "name", "product"],
      [["x@a.com", "X", "Photoshop"]]
    );
    const adUsers = csvBuffer(
      ["email", "name", "department"],
      [["y@a.com", "Y", "Design"]]
    );

    const compareRes = await agentA
      .post("/api/compare")
      .attach("licenses", licenses, "licenses.csv")
      .attach("adUsers", adUsers, "ad_users.csv")
      .expect(200);

    const runId = compareRes.body.runId;

    // Company A can access their own run
    await agentA.get(`/api/runs/${runId}`).expect(200);

    // Company B cannot access Company A's run
    await agentB.get(`/api/runs/${runId}`).expect(404);
    await agentB.get(`/api/runs/${runId}/responses`).expect(404);
    await agentB.get(`/api/runs/${runId}/audit`).expect(404);
    await agentB.get(`/api/runs/${runId}/audit/results`).expect(404);
    await agentB.post(`/api/runs/${runId}/verify`).send({}).expect(404);
  });

  it("allows /api/confirm without authentication (public token-based)", async () => {
    // /api/confirm is public — it uses tokens, not sessions
    const res = await request(app)
      .post("/api/confirm")
      .send({ token: "bogus", response: "yes" })
      .expect(404); // 404 means it got past auth, just token not found

    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── Password security ───────────────────────────────────────────────────

describe("password security", () => {
  it("does not store passwords in plaintext", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Acme Corp" })
      .expect(201);

    const user = db.prepare("SELECT password_hash FROM users WHERE email = ?").get("alice@co.com");
    expect(user.password_hash).not.toBe("securepass123");
    expect(user.password_hash).toMatch(/^\$2[aby]\$/); // bcrypt hash prefix
  });
});

// ── POST /api/auth/forgot-password ─────────────────────────────────────

describe("POST /api/auth/forgot-password", () => {
  it("sends a reset email for an existing user (log-only sender)", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "alice@co.com", password: "securepass123", companyName: "Acme Corp" })
      .expect(201);

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "alice@co.com" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe("alice@co.com");
    expect(sender.sent[0].text).toContain("/reset#token=");
  });

  it("does not leak whether a user exists", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@co.com" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(sender.sent).toHaveLength(0);
  });
});
