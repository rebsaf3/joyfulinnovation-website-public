const crypto = require("crypto");

/**
 * Persist a comparison report to the database.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {object} report – the object returned by compareUsers()
 * @returns {string} the generated run ID
 */
function saveComparisonRun(db, report, { companyId, projectId } = {}) {
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO comparison_runs
      (id, company_id, project_id, key_column, total_file_a, total_file_b, matched, only_in_a, only_in_b, field_diffs, report_json)
    VALUES
      (@id, @companyId, @projectId, @keyColumn, @totalFileA, @totalFileB, @matched, @onlyInA, @onlyInB, @fieldDiffs, @reportJson)
  `);

  stmt.run({
    id,
    companyId: companyId || null,
    projectId: projectId || null,
    keyColumn: report.keyColumn || "",
    totalFileA: report.summary.totalFileA,
    totalFileB: report.summary.totalFileB,
    matched: report.summary.matchedUsers,
    onlyInA: report.summary.onlyInFileA,
    onlyInB: report.summary.onlyInFileB,
    fieldDiffs: report.summary.usersWithFieldDifferences || 0,
    reportJson: JSON.stringify(report),
  });

  return id;
}

/**
 * Retrieve a comparison run by ID.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} runId
 * @returns {object|undefined}
 */
function getComparisonRun(db, runId) {
  const row = db.prepare("SELECT * FROM comparison_runs WHERE id = ?").get(runId);
  if (row) row.report_json = JSON.parse(row.report_json);
  return row;
}

/**
 * Retrieve a comparison run by ID, but only if it belongs to the given company.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} runId
 * @param {string} companyId
 * @returns {object|undefined}
 */
function getComparisonRunForCompany(db, runId, companyId) {
  const row = db
    .prepare("SELECT * FROM comparison_runs WHERE id = ? AND company_id = ?")
    .get(runId, companyId);
  if (row) row.report_json = JSON.parse(row.report_json);
  return row;
}

/**
 * List all comparison runs, most recent first.
 * If companyId is provided, only return runs belonging to that company.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ companyId?: string }} [options]
 * @returns {object[]}
 */
function listComparisonRuns(db, { companyId, projectId } = {}) {
  let sql = "SELECT id, project_id, created_at, key_column, total_file_a, total_file_b, matched, only_in_a, only_in_b, field_diffs FROM comparison_runs";
  const params = [];
  const conditions = [];

  if (companyId) {
    conditions.push("company_id = ?");
    params.push(companyId);
  }
  if (projectId) {
    conditions.push("project_id = ?");
    params.push(projectId);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY created_at DESC";

  return db.prepare(sql).all(...params);
}

module.exports = { saveComparisonRun, getComparisonRun, getComparisonRunForCompany, listComparisonRuns };