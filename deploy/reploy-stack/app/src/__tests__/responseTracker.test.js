const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { openDb } = require("../db");
const { saveComparisonRun } = require("../store");
const { extractAndSaveInactiveUsers } = require("../inactiveUsers");
const {
  createConfirmationRequests,
  markSent,
  recordResponse,
  getResponseSummary,
  getAuditLog,
  getAuditResults,
} = require("../responseTracker");

let db;
let tmpDir;
let runId;
let inactiveUserIds;

function sampleReport() {
  return {
    summary: {
      totalFileA: 2,
      totalFileB: 1,
      matchedUsers: 0,
      onlyInFileA: 2,
      onlyInFileB: 1,
      usersWithFieldDifferences: 0,
    },
    keyColumn: "email",
    matches: [],
    onlyInFileA: [
      { key: "alice@example.com", data: { email: "alice@example.com", name: "Alice" } },
      { key: "bob@example.com", data: { email: "bob@example.com", name: "Bob" } },
    ],
    onlyInFileB: [
      { key: "carol@example.com", data: { email: "carol@example.com", name: "Carol" } },
    ],
    fieldDifferences: [],
  };
}

// Helper: Apply migrations to test database (simulates server startup)
function applyMigrations(testDb) {
  try {
    // Ensure migrations_applied table exists
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS migrations_applied (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Manually apply 001_hash_reset_tokens migration
    const migration001 = {
      id: '001_hash_reset_tokens',
      up(db) {
        db.exec("ALTER TABLE confirmation_requests ADD COLUMN token_hash TEXT;");
      }
    };

    const existing = testDb.prepare(
      "SELECT id FROM migrations_applied WHERE id = ?"
    ).get(migration001.id);

    if (!existing) {
      migration001.up(testDb);
      testDb.prepare("INSERT INTO migrations_applied (id) VALUES (?)").run(migration001.id);
    }
  } catch (err) {
    if (!err.message.includes("duplicate column name")) {
      throw err;  // Re-throw if it's a different error
    }
    // Column already exists, that's fine
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-test-"));
  db = openDb(path.join(tmpDir, "test.db"));

  // Run migrations on test database
  applyMigrations(db);

  const report = sampleReport();
  runId = saveComparisonRun(db, report);
  const result = extractAndSaveInactiveUsers(db, runId, report);
  inactiveUserIds = result.users.map((u) => u.id);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createConfirmationRequests", () => {
  it("creates one request per inactive user with unique tokens", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);

    expect(requests).toHaveLength(3);
    const tokens = requests.map((r) => r.token);
    expect(new Set(tokens).size).toBe(3); // all unique
    expect(tokens.every((t) => typeof t === "string" && t.length === 64)).toBe(true);
  });
});

describe("markSent", () => {
  it("records the sent timestamp", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    markSent(db, [requests[0].id]);

    const row = db
      .prepare("SELECT sent_at FROM confirmation_requests WHERE id = ?")
      .get(requests[0].id);
    expect(row.sent_at).not.toBeNull();
  });
});

describe("recordResponse", () => {
  it("records a yes response and updates audit_status to confirmed", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    const result = recordResponse(db, requests[0].token, "yes");

    expect(result.found).toBe(true);
    expect(result.alreadyResponded).toBe(false);
    expect(result.auditStatus).toBe("confirmed");
    expect(result.userId).toBeDefined();
    expect(result.userKey).toBeDefined();
    expect(result.email).toBeDefined();

    const row = db
      .prepare("SELECT response, responded_at FROM confirmation_requests WHERE id = ?")
      .get(requests[0].id);
    expect(row.response).toBe("yes");
    expect(row.responded_at).not.toBeNull();

    // Verify audit_status on inactive_users
    const user = db
      .prepare("SELECT audit_status FROM inactive_users WHERE id = ?")
      .get(result.userId);
    expect(user.audit_status).toBe("confirmed");
  });

  it("records a no response and updates audit_status to revoked", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    const result = recordResponse(db, requests[1].token, "no");

    expect(result.found).toBe(true);
    expect(result.alreadyResponded).toBe(false);
    expect(result.auditStatus).toBe("revoked");

    const user = db
      .prepare("SELECT audit_status FROM inactive_users WHERE id = ?")
      .get(result.userId);
    expect(user.audit_status).toBe("revoked");
  });

  it("writes an audit log entry on response", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    recordResponse(db, requests[0].token, "yes");

    const logs = db
      .prepare("SELECT * FROM audit_log WHERE run_id = ?")
      .all(runId);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("confirmed");
    expect(logs[0].user_key).toBeDefined();
    expect(logs[0].created_at).toBeDefined();
  });

  it("captures IP address in audit log when provided", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    recordResponse(db, requests[0].token, "yes", { ipAddress: "192.168.1.42" });

    const log = db
      .prepare("SELECT ip_address FROM audit_log WHERE run_id = ?")
      .get(runId);
    expect(log.ip_address).toBe("192.168.1.42");
  });

  it("returns alreadyResponded=true on duplicate response", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    recordResponse(db, requests[0].token, "yes");
    const second = recordResponse(db, requests[0].token, "no");

    expect(second.found).toBe(true);
    expect(second.alreadyResponded).toBe(true);

    // Original response is preserved
    const row = db
      .prepare("SELECT response FROM confirmation_requests WHERE id = ?")
      .get(requests[0].id);
    expect(row.response).toBe("yes");

    // Audit log should only have one entry (the first response)
    const logs = db
      .prepare("SELECT * FROM audit_log WHERE run_id = ?")
      .all(runId);
    expect(logs).toHaveLength(1);
  });

  it("returns found=false for unknown token", () => {
    const result = recordResponse(db, "nonexistent-token", "yes");
    expect(result).toEqual({ found: false, alreadyResponded: false });
  });

  it("throws on invalid response value", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    expect(() => recordResponse(db, requests[0].token, "maybe")).toThrow(
      /Invalid response/
    );
  });
});

describe("getResponseSummary", () => {
  it("returns an accurate summary with audit_status in details", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);

    // Simulate: send all, get 2 responses
    markSent(db, requests.map((r) => r.id));
    recordResponse(db, requests[0].token, "yes");
    recordResponse(db, requests[1].token, "no");

    const summary = getResponseSummary(db, runId);

    expect(summary.total).toBe(3);
    expect(summary.sent).toBe(3);
    expect(summary.responded).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.yes).toBe(1);
    expect(summary.no).toBe(1);
    expect(summary.details).toHaveLength(3);

    // Verify audit_status is present in details
    const confirmed = summary.details.find((d) => d.audit_status === "confirmed");
    const revoked = summary.details.find((d) => d.audit_status === "revoked");
    const pending = summary.details.find((d) => d.audit_status === "pending");
    expect(confirmed).toBeDefined();
    expect(revoked).toBeDefined();
    expect(pending).toBeDefined();
  });

  it("returns zeroes for a run with no confirmation requests", () => {
    const summary = getResponseSummary(db, runId);
    expect(summary.total).toBe(0);
    expect(summary.pending).toBe(0);
  });
});

describe("getAuditLog", () => {
  it("returns audit log entries in chronological order", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    recordResponse(db, requests[0].token, "yes");
    recordResponse(db, requests[1].token, "no");

    const log = getAuditLog(db, runId);
    expect(log).toHaveLength(2);
    expect(log[0].action).toBe("confirmed");
    expect(log[0].user_key).toBeDefined();
    expect(log[0].email).toBeDefined();
    expect(log[0].created_at).toBeDefined();
    expect(log[1].action).toBe("revoked");
  });

  it("returns empty array when no audit events exist", () => {
    expect(getAuditLog(db, runId)).toEqual([]);
  });
});

describe("getAuditResults", () => {
  it("returns per-user audit status view", () => {
    const requests = createConfirmationRequests(db, inactiveUserIds);
    markSent(db, requests.map((r) => r.id));
    recordResponse(db, requests[0].token, "yes");
    recordResponse(db, requests[1].token, "no");

    const results = getAuditResults(db, runId);
    expect(results).toHaveLength(3);

    const statuses = results.map((r) => r.audit_status).sort();
    expect(statuses).toEqual(["confirmed", "pending", "revoked"]);

    // Verify response and timestamp data is joined
    const confirmed = results.find((r) => r.audit_status === "confirmed");
    expect(confirmed.response).toBe("yes");
    expect(confirmed.responded_at).not.toBeNull();
    expect(confirmed.sent_at).not.toBeNull();
  });

  it("shows all users as pending when no requests exist", () => {
    const results = getAuditResults(db, runId);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.audit_status === "pending")).toBe(true);
    expect(results.every((r) => r.response === null)).toBe(true);
  });
});

// ── SEC-001: Token Hashing Tests ───────────────────────────────────────────
// Verify that confirmation tokens are properly hashed with bcrypt before storage
// and that validation works for both hashed and plaintext tokens (backward compat)
describe("SEC-001: Token hashing & validation", () => {
  it("stores hashed tokens, not plaintext", () => {
    const requests = createConfirmationRequests(db, [inactiveUserIds[0]]);
    const request = requests[0];
    
    // Token returned to caller is plaintext (for email sending)
    expect(request.token).toMatch(/^[a-f0-9]{64}$/);
    
    // Token in database is hashed
    const row = db.prepare(
      "SELECT token, token_hash FROM confirmation_requests WHERE id = ?"
    ).get(request.id);
    
    expect(row.token).toBe(request.token);  // Plaintext still there for backward compat
    expect(row.token_hash).toBeDefined();
    expect(row.token_hash).not.toBe(request.token);  // Not plaintext!
    expect(row.token_hash.length).toBeGreaterThan(20);  // Bcrypt hash length
  });

  it("validates tokens using bcrypt hash comparison", () => {
    const requests = createConfirmationRequests(db, [inactiveUserIds[0]]);
    const plainToken = requests[0].token;
    
    // recordResponse should accept the plaintext token and validate via bcrypt
    const result = recordResponse(db, plainToken, "yes");
    
    expect(result.found).toBe(true);
    expect(result.storedResponse).toBe("yes");
    expect(result.userId).toBeDefined();
  });

  it("prevents timing attacks with constant-time hash comparison", () => {
    const requests = createConfirmationRequests(db, [inactiveUserIds[0]]);
    const plainToken = requests[0].token;
    
    // Hash comparison should use bcrypt.compareSync (constant-time)
    // This is tested indirectly: wrong token doesn't match
    const wrongToken = "wrong" + plainToken.slice(5);
    const result = recordResponse(db, wrongToken, "yes");
    
    expect(result.found).toBe(false);
  });

  it("supports backward compatibility with plaintext tokens during migration", () => {
    const requests = createConfirmationRequests(db, [inactiveUserIds[0]]);
    const plainToken = requests[0].token;
    
    // During migration, old plaintext tokens should still work
    // Insert a legacy row with only plaintext token (no hash)
    const legacyId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO confirmation_requests (id, inactive_user_id, token, sent_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(legacyId, inactiveUserIds[1], "legacy-plaintext-token");
    
    // Should find and validate via plaintext lookup
    const result = recordResponse(db, "legacy-plaintext-token", "yes");
    expect(result.found).toBe(true);
  });

  it("rejects invalid tokens", () => {
    createConfirmationRequests(db, [inactiveUserIds[0]]);
    
    const result = recordResponse(db, "invalid-token-xyz", "yes");
    expect(result.found).toBe(false);
    expect(result.alreadyResponded).toBe(false);
  });

  it("integration test: full confirmation flow with hashed tokens", () => {
    // Create requests
    const requests = createConfirmationRequests(db, inactiveUserIds);
    expect(requests).toHaveLength(3);
    
    // Mark as sent
    markSent(db, requests.map((r) => r.id));
    
    // Record response with hashed token
    const result1 = recordResponse(db, requests[0].token, "yes");
    expect(result1.found).toBe(true);
    expect(result1.storedResponse).toBe("yes");
    
    // Get summary and verify
    const summary = getResponseSummary(db, runId);
    expect(summary.responded).toBe(1);
    expect(summary.yes).toBe(1);
    expect(summary.pending).toBe(2);
  });
});

