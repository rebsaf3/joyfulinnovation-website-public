const path = require("path");
const fs = require("fs");
const os = require("os");
const { openDb } = require("../db");
const { compareUsers } = require("../compareUsers");
const { saveComparisonRun } = require("../store");
const { extractAndSaveInactiveUsers, getInactiveUsers } = require("../inactiveUsers");
const { sendVerificationEmails } = require("../verificationService");
const { createEmailSender } = require("../emailSender");
const { getResponseSummary } = require("../responseTracker");

let db;
let tmpDir;
let runId;
let sender;

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leo-test-"));
  db = openDb(path.join(tmpDir, "test.db"));
  sender = createEmailSender(); // log-only

  const csvA = toCsv(
    ["email", "name"],
    [
      ["alice@co.com", "Alice"],
      ["bob@co.com", "Bob"],
    ]
  );
  const csvB = toCsv(
    ["email", "name"],
    [["carol@co.com", "Carol"]]
  );
  const report = compareUsers(csvA, csvB);
  runId = saveComparisonRun(db, report);
  extractAndSaveInactiveUsers(db, runId, report);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sendVerificationEmails", () => {
  it("sends one email per inactive user", async () => {
    const result = await sendVerificationEmails({
      db,
      runId,
      baseUrl: "https://app.example.com",
      emailSender: sender,
    });

    expect(result.sent).toBe(3); // 2 only-in-A + 1 only-in-B
    expect(result.failed).toBe(0);
    expect(result.details).toHaveLength(3);
    expect(sender.sent).toHaveLength(3);
  });

  it("populates emails with correct content", async () => {
    await sendVerificationEmails({
      db,
      runId,
      baseUrl: "https://app.example.com",
      emailSender: sender,
    });

    const email = sender.sent[0];
    expect(email.subject).toContain("access");
    expect(email.text).toContain("response=yes");
    expect(email.text).toContain("response=no");
    expect(email.html).toContain("Yes");
    expect(email.html).toContain("No");
  });

  it("uses the user name from CSV data in the greeting", async () => {
    await sendVerificationEmails({
      db,
      runId,
      baseUrl: "https://app.example.com",
      emailSender: sender,
    });

    const names = sender.sent.map((e) => e.text.split("\n")[0]);
    expect(names).toContain("Hello Alice,");
    expect(names).toContain("Hello Bob,");
    expect(names).toContain("Hello Carol,");
  });

  it("marks confirmation requests as sent in the database", async () => {
    await sendVerificationEmails({
      db,
      runId,
      baseUrl: "https://app.example.com",
      emailSender: sender,
    });

    const summary = getResponseSummary(db, runId);
    expect(summary.total).toBe(3);
    expect(summary.sent).toBe(3);
    expect(summary.pending).toBe(3); // none responded yet
  });

  it("includes unique tokens in each email", async () => {
    await sendVerificationEmails({
      db,
      runId,
      baseUrl: "https://app.example.com",
      emailSender: sender,
    });

    // Extract tokens from the text bodies
    const tokens = sender.sent.map((e) => {
      const match = e.text.match(/token=([a-f0-9]+)/);
      return match ? match[1] : null;
    });

    expect(tokens.every((t) => t !== null)).toBe(true);
    expect(new Set(tokens).size).toBe(3); // all unique
  });

  it("returns 0 sent for a run with no inactive users", async () => {
    // Create a run where both files match perfectly
    const csv = toCsv(["email"], [["same@co.com"]]);
    const report = compareUsers(csv, csv);
    const emptyRunId = saveComparisonRun(db, report);
    extractAndSaveInactiveUsers(db, emptyRunId, report);

    const result = await sendVerificationEmails({
      db,
      runId: emptyRunId,
      baseUrl: "https://app.example.com",
      emailSender: sender,
    });

    expect(result.sent).toBe(0);
    expect(result.details).toHaveLength(0);
  });

  it("handles individual send failures gracefully", async () => {
    let callCount = 0;
    const faultySender = {
      async sendMail(opts) {
        callCount++;
        if (callCount === 2) throw new Error("SMTP timeout");
        return { messageId: `ok-${callCount}@test` };
      },
    };

    const result = await sendVerificationEmails({
      db,
      runId,
      baseUrl: "https://app.example.com",
      emailSender: faultySender,
    });

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    const failed = result.details.find((d) => d.status === "failed");
    expect(failed.error).toContain("SMTP timeout");
  });
});
