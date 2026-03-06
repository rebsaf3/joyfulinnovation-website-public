const { compareUsers, parseCsv, detectKeyColumn } = require("../compareUsers");

// ---------------------------------------------------------------------------
// Helper – builds a simple CSV string from an array of rows
// ---------------------------------------------------------------------------
function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------
describe("parseCsv", () => {
  it("parses a basic CSV string into row objects", () => {
    const csv = "name,email\nAlice,alice@example.com\nBob,bob@example.com";
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ]);
  });

  it("trims whitespace from values", () => {
    const csv = "name , email\n  Alice , alice@example.com ";
    const rows = parseCsv(csv);
    expect(rows).toEqual([{ name: "Alice", email: "alice@example.com" }]);
  });

  it("skips empty lines", () => {
    const csv = "name,email\n\nAlice,alice@example.com\n\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it("accepts a Buffer as input", () => {
    const csv = Buffer.from("id,name\n1,Alice");
    const rows = parseCsv(csv);
    expect(rows).toEqual([{ id: "1", name: "Alice" }]);
  });
});

// ---------------------------------------------------------------------------
// detectKeyColumn
// ---------------------------------------------------------------------------
describe("detectKeyColumn", () => {
  it("picks 'email' when present", () => {
    expect(detectKeyColumn(["name", "email", "role"])).toBe("email");
  });

  it("picks 'id' when present", () => {
    expect(detectKeyColumn(["id", "name"])).toBe("id");
  });

  it("is case-insensitive", () => {
    expect(detectKeyColumn(["Name", "EMAIL"])).toBe("EMAIL");
  });

  it("falls back to first column when no known key is found", () => {
    expect(detectKeyColumn(["full_name", "department"])).toBe("full_name");
  });
});

// ---------------------------------------------------------------------------
// compareUsers
// ---------------------------------------------------------------------------
describe("compareUsers", () => {
  it("detects matches, gaps, and field differences", () => {
    const csvA = toCsv(
      ["email", "name", "role"],
      [
        ["alice@example.com", "Alice", "admin"],
        ["bob@example.com", "Bob", "editor"],
        ["carol@example.com", "Carol", "viewer"],
      ]
    );
    const csvB = toCsv(
      ["email", "name", "role"],
      [
        ["alice@example.com", "Alice", "admin"],
        ["bob@example.com", "Robert", "admin"],
        ["dave@example.com", "Dave", "viewer"],
      ]
    );

    const report = compareUsers(csvA, csvB);

    expect(report.summary.totalFileA).toBe(3);
    expect(report.summary.totalFileB).toBe(3);
    expect(report.summary.matchedUsers).toBe(2);
    expect(report.summary.onlyInFileA).toBe(1);
    expect(report.summary.onlyInFileB).toBe(1);
    expect(report.summary.usersWithFieldDifferences).toBe(1);

    expect(report.keyColumn).toBe("email");

    // Matched keys
    expect(report.matches).toContain("alice@example.com");
    expect(report.matches).toContain("bob@example.com");

    // Only in file A
    expect(report.onlyInFileA.map((u) => u.key)).toEqual([
      "carol@example.com",
    ]);

    // Only in file B
    expect(report.onlyInFileB.map((u) => u.key)).toEqual([
      "dave@example.com",
    ]);

    // Field differences for bob
    const bobDiff = report.fieldDifferences.find(
      (d) => d.key === "bob@example.com"
    );
    expect(bobDiff).toBeDefined();
    expect(bobDiff.differences.name).toEqual({
      fileA: "Bob",
      fileB: "Robert",
    });
    expect(bobDiff.differences.role).toEqual({
      fileA: "editor",
      fileB: "admin",
    });
  });

  it("handles two empty CSVs", () => {
    const report = compareUsers("email\n", "email\n");
    expect(report.summary.matchedUsers).toBe(0);
    expect(report.summary.onlyInFileA).toBe(0);
    expect(report.summary.onlyInFileB).toBe(0);
  });

  it("handles one empty CSV", () => {
    const csvA = toCsv(["email", "name"], [["a@b.com", "A"]]);
    const csvB = "email,name\n";
    const report = compareUsers(csvA, csvB);

    expect(report.summary.totalFileA).toBe(1);
    expect(report.summary.totalFileB).toBe(0);
    expect(report.summary.onlyInFileA).toBe(1);
  });

  it("uses a custom keyColumn when provided", () => {
    const csvA = toCsv(
      ["username", "email"],
      [["alice", "alice@example.com"]]
    );
    const csvB = toCsv(
      ["username", "email"],
      [["alice", "alice-new@example.com"]]
    );

    const report = compareUsers(csvA, csvB, { keyColumn: "username" });

    expect(report.keyColumn).toBe("username");
    expect(report.summary.matchedUsers).toBe(1);
    expect(report.fieldDifferences).toHaveLength(1);
    expect(report.fieldDifferences[0].differences.email).toEqual({
      fileA: "alice@example.com",
      fileB: "alice-new@example.com",
    });
  });

  it("normalises key values (case-insensitive, trimmed)", () => {
    const csvA = toCsv(["email", "name"], [["Alice@Example.COM", "Alice"]]);
    const csvB = toCsv(["email", "name"], [["alice@example.com", "Alice"]]);

    const report = compareUsers(csvA, csvB);
    expect(report.summary.matchedUsers).toBe(1);
    expect(report.summary.onlyInFileA).toBe(0);
    expect(report.summary.onlyInFileB).toBe(0);
  });

  it("handles files with different columns", () => {
    const csvA = toCsv(
      ["email", "name"],
      [["a@b.com", "Alice"]]
    );
    const csvB = toCsv(
      ["email", "department"],
      [["a@b.com", "Engineering"]]
    );

    const report = compareUsers(csvA, csvB);
    expect(report.summary.matchedUsers).toBe(1);

    const diff = report.fieldDifferences[0];
    expect(diff.differences.name).toEqual({ fileA: "Alice", fileB: "" });
    expect(diff.differences.department).toEqual({
      fileA: "",
      fileB: "Engineering",
    });
  });
});
