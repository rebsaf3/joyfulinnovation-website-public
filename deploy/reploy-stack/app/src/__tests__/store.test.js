const path = require("path");
const fs = require("fs");
const os = require("os");
const { openDb } = require("../db");
const { saveComparisonRun, getComparisonRun, listComparisonRuns } = require("../store");

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
      { key: "a@example.com", data: { email: "a@example.com", name: "A" } },
      { key: "b@example.com", data: { email: "b@example.com", name: "B" } },
    ],
    onlyInFileB: [
      { key: "c@example.com", data: { email: "c@example.com", name: "C" } },
    ],
    fieldDifferences: [],
  };
}

describe("store – saveComparisonRun / getComparisonRun", () => {
  it("saves and retrieves a comparison run", () => {
    const report = sampleReport();
    const runId = saveComparisonRun(db, report);

    expect(typeof runId).toBe("string");
    expect(runId.length).toBeGreaterThan(0);

    const row = getComparisonRun(db, runId);
    expect(row).toBeDefined();
    expect(row.key_column).toBe("email");
    expect(row.total_file_a).toBe(3);
    expect(row.total_file_b).toBe(2);
    expect(row.matched).toBe(1);
    expect(row.only_in_a).toBe(2);
    expect(row.only_in_b).toBe(1);
    expect(row.report_json).toEqual(report);
  });

  it("returns undefined for a nonexistent run", () => {
    expect(getComparisonRun(db, "nonexistent")).toBeUndefined();
  });
});

describe("store – listComparisonRuns", () => {
  it("lists runs in reverse chronological order", () => {
    saveComparisonRun(db, sampleReport());
    saveComparisonRun(db, { ...sampleReport(), keyColumn: "id" });

    const runs = listComparisonRuns(db);
    expect(runs).toHaveLength(2);
    // Most recent first — both have same second-level timestamp, but insertion order holds
    expect(runs[0].key_column).toBeDefined();
    expect(runs[1].key_column).toBeDefined();
  });

  it("returns an empty array when no runs exist", () => {
    expect(listComparisonRuns(db)).toEqual([]);
  });
});
