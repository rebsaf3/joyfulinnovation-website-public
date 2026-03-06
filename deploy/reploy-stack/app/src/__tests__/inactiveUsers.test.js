const path = require("path");
const fs = require("fs");
const os = require("os");
const { openDb } = require("../db");
const { saveComparisonRun } = require("../store");
const {
  extractAndSaveInactiveUsers,
  getInactiveUsers,
  generateEmailList,
} = require("../inactiveUsers");

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

function sampleReport() {
  return {
    summary: {
      totalFileA: 3,
      totalFileB: 2,
      matchedUsers: 1,
      onlyInFileA: 2,
      onlyInFileB: 1,
      usersWithFieldDifferences: 0,
    },
    keyColumn: "email",
    matches: ["shared@example.com"],
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

describe("extractAndSaveInactiveUsers", () => {
  it("saves all inactive users (from both files) to the database", () => {
    const report = sampleReport();
    const runId = saveComparisonRun(db, report);
    const result = extractAndSaveInactiveUsers(db, runId, report);

    expect(result.saved).toBe(3);
    expect(result.users).toHaveLength(3);

    const fromA = result.users.filter((u) => u.source === "onlyInFileA");
    const fromB = result.users.filter((u) => u.source === "onlyInFileB");
    expect(fromA).toHaveLength(2);
    expect(fromB).toHaveLength(1);
  });

  it("stores the correct email for each user", () => {
    const report = sampleReport();
    const runId = saveComparisonRun(db, report);
    const result = extractAndSaveInactiveUsers(db, runId, report);

    const emails = result.users.map((u) => u.email).sort();
    expect(emails).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
  });
});

describe("getInactiveUsers", () => {
  it("retrieves persisted inactive users with parsed user_data", () => {
    const report = sampleReport();
    const runId = saveComparisonRun(db, report);
    extractAndSaveInactiveUsers(db, runId, report);

    const users = getInactiveUsers(db, runId);
    expect(users).toHaveLength(3);
    expect(users[0].user_data).toHaveProperty("name");
  });

  it("returns empty array for unknown run", () => {
    expect(getInactiveUsers(db, "nonexistent")).toEqual([]);
  });
});

describe("generateEmailList", () => {
  it("returns a newline-separated list of unique emails", () => {
    const report = sampleReport();
    const runId = saveComparisonRun(db, report);
    extractAndSaveInactiveUsers(db, runId, report);

    const list = generateEmailList(db, runId);
    const emails = list.split("\n").sort();
    expect(emails).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
  });

  it("returns empty string when no inactive users exist", () => {
    const report = {
      ...sampleReport(),
      onlyInFileA: [],
      onlyInFileB: [],
    };
    const runId = saveComparisonRun(db, report);
    extractAndSaveInactiveUsers(db, runId, report);

    expect(generateEmailList(db, runId)).toBe("");
  });
});
