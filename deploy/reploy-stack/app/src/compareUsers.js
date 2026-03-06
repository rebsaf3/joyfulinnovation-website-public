const { parse } = require("csv-parse/sync");

/**
 * Parse a CSV buffer/string into an array of row objects.
 * The first row is treated as column headers.
 */
function parseCsv(input) {
  return parse(input, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

/**
 * Validate CSV headers to ensure required columns are present.
 * BKD-004: Prevent corrupt data insertion from malformed CSVs.
 * 
 * @param {string[]} headers - Column names from CSV
 * @param {string} fileType - "licenses" or "adUsers" for context
 * @throws {Error} if validation fails
 */
function validateCsvHeaders(headers, fileType = "csv") {
  if (!headers || headers.length === 0) {
    throw new Error(`${fileType}: CSV file is empty or has no headers.`);
  }

  // At minimum, we need some identifier column
  const keyColumns = ["email", "id", "user_id", "userid", "username", "name"];
  const headerLower = headers.map((h) => h.toLowerCase());
  const hasKeyColumn = keyColumns.some((col) => headerLower.includes(col));

  if (!hasKeyColumn) {
    throw new Error(
      `${fileType}: CSV must contain at least one of these columns: ${keyColumns.join(", ")}. ` +
        `Found: ${headers.join(", ")}`
    );
  }
}

/**
 * Detect which column holds the user identifier.
 * Looks for common header names (case-insensitive); falls back to the first column.
 */
function detectKeyColumn(headers) {
  const candidates = ["email", "id", "user_id", "userid", "username"];
  const lower = headers.map((h) => h.toLowerCase());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  return headers[0];
}

/**
 * Build a lookup map keyed by the normalized value of `keyColumn`.
 * Returns { map: Map<string, object>, keyColumn: string }.
 */
function buildUserMap(rows, keyColumn) {
  const map = new Map();
  for (const row of rows) {
    const key = (row[keyColumn] ?? "").toString().trim().toLowerCase();
    if (key) map.set(key, row);
  }
  return map;
}

/**
 * Compare two parsed CSV datasets and return a JSON-serialisable report.
 *
 * @param {Buffer|string} csvA – contents of the first CSV file
 * @param {Buffer|string} csvB – contents of the second CSV file
 * @param {object}  [options]
 * @param {string}  [options.keyColumn] – column name to use as the user
 *   identifier.  When omitted the function auto-detects it from the headers.
 * @returns {object} comparison report
 */
function compareUsers(csvA, csvB, options = {}) {
  const rowsA = parseCsv(csvA);
  const rowsB = parseCsv(csvB);

  if (rowsA.length === 0 && rowsB.length === 0) {
    return {
      summary: {
        totalFileA: 0,
        totalFileB: 0,
        matchedUsers: 0,
        onlyInFileA: 0,
        onlyInFileB: 0,
      },
      matches: [],
      onlyInFileA: [],
      onlyInFileB: [],
      fieldDifferences: [],
    };
  }

  const headersA = rowsA.length > 0 ? Object.keys(rowsA[0]) : [];
  const headersB = rowsB.length > 0 ? Object.keys(rowsB[0]) : [];

  // BKD-004: Validate CSV headers before comparison
  if (rowsA.length > 0) validateCsvHeaders(headersA, "licenses file");
  if (rowsB.length > 0) validateCsvHeaders(headersB, "Active Directory users file");

  const keyColumn =
    options.keyColumn ??
    detectKeyColumn(headersA.length > 0 ? headersA : headersB);

  const mapA = buildUserMap(rowsA, keyColumn);
  const mapB = buildUserMap(rowsB, keyColumn);

  const matches = [];
  const fieldDifferences = [];
  const onlyInA = [];
  const onlyInB = [];

  // Walk through file A and compare against file B
  for (const [key, rowA] of mapA) {
    if (mapB.has(key)) {
      matches.push({ key, fileA: rowA, fileB: mapB.get(key) });

      // Detect field-level differences for matched users
      const rowB = mapB.get(key);
      const allFields = new Set([...Object.keys(rowA), ...Object.keys(rowB)]);
      const diffs = {};
      for (const field of allFields) {
        const valA = (rowA[field] ?? "").toString();
        const valB = (rowB[field] ?? "").toString();
        if (valA !== valB) {
          diffs[field] = { fileA: valA, fileB: valB };
        }
      }
      if (Object.keys(diffs).length > 0) {
        fieldDifferences.push({ key, differences: diffs });
      }
    } else {
      onlyInA.push({ key, data: rowA });
    }
  }

  // Users present only in file B
  for (const [key, rowB] of mapB) {
    if (!mapA.has(key)) {
      onlyInB.push({ key, data: rowB });
    }
  }

  return {
    summary: {
      totalFileA: mapA.size,
      totalFileB: mapB.size,
      matchedUsers: matches.length,
      onlyInFileA: onlyInA.length,
      onlyInFileB: onlyInB.length,
      usersWithFieldDifferences: fieldDifferences.length,
    },
    keyColumn,
    matches: matches.map((m) => m.key),
    onlyInFileA: onlyInA,
    onlyInFileB: onlyInB,
    fieldDifferences,
  };
}

module.exports = { compareUsers, parseCsv, detectKeyColumn, validateCsvHeaders };
