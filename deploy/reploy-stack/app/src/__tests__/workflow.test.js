const path = require("path");
const fs = require("fs");
const os = require("os");
const { openDb } = require("../db");
const { compareUsers } = require("../compareUsers");
const { saveComparisonRun, getComparisonRun } = require("../store");
const { extractAndSaveInactiveUsers, generateEmailList } = require("../inactiveUsers");
const { buildBulkConfirmationEmails } = require("../emailTemplates");
const { createConfirmationRequests, markSent, recordResponse, getResponseSummary, getAuditLog, getAuditResults } = require("../responseTracker");

let db;
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-test-"));
  db = openDb(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

describe("end-to-end workflow", () => {
  it("compares CSVs → stores results → generates emails → tracks responses", () => {
    // ----- 1. Compare two CSV files -----
    const csvA = toCsv(
      ["email", "name", "role"],
      [
        ["alice@co.com", "Alice", "admin"],
        ["bob@co.com", "Bob", "editor"],
        ["carol@co.com", "Carol", "viewer"],
      ]
    );
    const csvB = toCsv(
      ["email", "name", "role"],
      [
        ["alice@co.com", "Alice", "admin"],
        ["dave@co.com", "Dave", "viewer"],
      ]
    );

    const report = compareUsers(csvA, csvB);
    expect(report.summary.matchedUsers).toBe(1);
    expect(report.summary.onlyInFileA).toBe(2);
    expect(report.summary.onlyInFileB).toBe(1);

    // ----- 2. Store comparison results in DB -----
    const runId = saveComparisonRun(db, report);
    const saved = getComparisonRun(db, runId);
    expect(saved.report_json.summary.matchedUsers).toBe(1);

    // ----- 3. Extract inactive users & generate email list -----
    const { users: inactive } = extractAndSaveInactiveUsers(db, runId, report);
    expect(inactive).toHaveLength(3); // 2 only-A + 1 only-B

    const emailList = generateEmailList(db, runId);
    expect(emailList.split("\n").sort()).toEqual([
      "bob@co.com",
      "carol@co.com",
      "dave@co.com",
    ]);

    // ----- 4. Create confirmation requests & build email templates -----
    const confirmations = createConfirmationRequests(
      db,
      inactive.map((u) => u.id)
    );
    expect(confirmations).toHaveLength(3);

    const usersWithTokens = inactive.map((u) => ({
      ...u,
      token: confirmations.find((c) => c.inactiveUserId === u.id).token,
    }));

    const emails = buildBulkConfirmationEmails(
      usersWithTokens,
      "https://app.example.com"
    );
    expect(emails).toHaveLength(3);
    expect(emails[0].subject).toContain("access");
    expect(emails[0].htmlBody).toContain("Yes");
    expect(emails[0].htmlBody).toContain("No");

    // ----- 5. Mark as sent -----
    markSent(db, confirmations.map((c) => c.id));

    // ----- 6. Record responses -----
    const yesResult = recordResponse(db, confirmations[0].token, "yes");
    const noResult = recordResponse(db, confirmations[1].token, "no");
    // Third user does not respond

    expect(yesResult.auditStatus).toBe("confirmed");
    expect(noResult.auditStatus).toBe("revoked");

    // ----- 7. Check summary -----
    const summary = getResponseSummary(db, runId);
    expect(summary.total).toBe(3);
    expect(summary.sent).toBe(3);
    expect(summary.responded).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.yes).toBe(1);
    expect(summary.no).toBe(1);

    // ----- 8. Check audit log -----
    const auditLog = getAuditLog(db, runId);
    expect(auditLog).toHaveLength(2);
    expect(auditLog[0].action).toBe("confirmed");
    expect(auditLog[1].action).toBe("revoked");

    // ----- 9. Check audit results (per-user status) -----
    const auditResults = getAuditResults(db, runId);
    expect(auditResults).toHaveLength(3);
    const statuses = auditResults.map((r) => r.audit_status).sort();
    expect(statuses).toEqual(["confirmed", "pending", "revoked"]);
  });
});
