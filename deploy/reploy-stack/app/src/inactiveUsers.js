const crypto = require("crypto");

/**
 * Extract inactive users from a comparison report and persist them.
 *
 * "Inactive" users are those who appear in only one of the two files —
 * they are missing from the other system and may no longer need access.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} runId – the comparison_runs.id this belongs to
 * @param {object} report – the object returned by compareUsers()
 * @param {object} [options]
 * @param {string} [options.emailField] – column name that holds the email
 *   address.  Defaults to the report's keyColumn (which is often "email").
 * @returns {{ saved: number, users: object[] }}
 */
function extractAndSaveInactiveUsers(db, runId, report, options = {}) {
  const emailField = options.emailField ?? report.keyColumn ?? "email";

  const stmt = db.prepare(`
    INSERT INTO inactive_users (id, run_id, user_key, source, email, user_data)
    VALUES (@id, @runId, @userKey, @source, @email, @userData)
  `);

  const insert = db.transaction((entries) => {
    const saved = [];
    for (const entry of entries) {
      const id = crypto.randomUUID();
      const email =
        entry.data[emailField] ??
        entry.data.email ??
        entry.data.Email ??
        entry.key;
      stmt.run({
        id,
        runId,
        userKey: entry.key,
        source: entry.source,
        email: email.toString().trim(),
        userData: JSON.stringify(entry.data),
      });
      saved.push({ id, key: entry.key, email, source: entry.source });
    }
    return saved;
  });

  const entries = [
    ...report.onlyInFileA.map((u) => ({ ...u, source: "onlyInFileA" })),
    ...report.onlyInFileB.map((u) => ({ ...u, source: "onlyInFileB" })),
  ];

  const users = insert(entries);
  return { saved: users.length, users };
}

/**
 * Retrieve all inactive users for a given comparison run.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} runId
 * @returns {object[]}
 */
function getInactiveUsers(db, runId) {
  return db
    .prepare("SELECT * FROM inactive_users WHERE run_id = ? ORDER BY created_at")
    .all(runId)
    .map((row) => ({ ...row, user_data: JSON.parse(row.user_data) }));
}

/**
 * Build a plain email list (one address per line) for a comparison run.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} runId
 * @returns {string}
 */
function generateEmailList(db, runId) {
  const rows = db
    .prepare("SELECT DISTINCT email FROM inactive_users WHERE run_id = ? ORDER BY email")
    .all(runId);
  return rows.map((r) => r.email).join("\n");
}

module.exports = {
  extractAndSaveInactiveUsers,
  getInactiveUsers,
  generateEmailList,
};
