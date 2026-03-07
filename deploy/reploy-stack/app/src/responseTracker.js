const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { maskToken } = require("./sanitizeLogging");

/** Compute a SHA-256 hex digest – used for fast indexed token lookup. */
function sha256hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Create confirmation request rows for a set of inactive users and return
 * the generated tokens.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string[]} inactiveUserIds – inactive_users.id values
 * @returns {object[]} created confirmation requests with tokens
 */
function createConfirmationRequests(db, inactiveUserIds) {
  const stmt = db.prepare(`
    INSERT INTO confirmation_requests (id, inactive_user_id, token, token_hash)
    VALUES (@id, @inactiveUserId, @token, @tokenHash)
  `);

  const insert = db.transaction((ids) => {
    const results = [];
    for (const inactiveUserId of ids) {
      const id = crypto.randomUUID();
      const token = crypto.randomBytes(32).toString("hex");
      // Store SHA-256 digest in token_hash for O(1) indexed lookup.
      // SHA-256 is appropriate for random confirmation tokens (not passwords).
      const tokenHash = sha256hex(token);
      stmt.run({ id, inactiveUserId, token, tokenHash });
      results.push({ id, inactiveUserId, token }); // Return plaintext token for email
    }
    return results;
  });

  return insert(inactiveUserIds);
}

/**
 * Mark a set of confirmation requests as sent (records the timestamp).
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string[]} requestIds – confirmation_requests.id values
 */
function markSent(db, requestIds) {
  const stmt = db.prepare(
    "UPDATE confirmation_requests SET sent_at = datetime('now') WHERE id = ?"
  );
  const run = db.transaction((ids) => ids.forEach((id) => stmt.run(id)));
  run(requestIds);
}

/**
 * Record a user's yes/no response by their unique token.
 *
 * This function performs three operations in a single transaction:
 *   1. Updates confirmation_requests with the response and timestamp
 *   2. Updates inactive_users.audit_status to 'confirmed' or 'revoked'
 *   3. Inserts an audit_log entry with user ID, action, and timestamp
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} token
 * @param {'yes'|'no'} response
 * @param {object} [meta]
 * @param {string} [meta.ipAddress] – optional IP address of the respondent
 * @returns {{ found: boolean, alreadyResponded: boolean, userId?: string, userKey?: string, email?: string, auditStatus?: string }}
 */
function recordResponse(db, token, response, meta = {}) {
  if (response !== "yes" && response !== "no") {
    throw new Error(`Invalid response: expected "yes" or "no", got "${response}"`);
  }

  // ── O(1) indexed token lookup ────────────────────────────────────────────
  // 1. Try SHA-256 lookup (new tokens): token_hash column is indexed.
  const tokenSha256 = sha256hex(token);
  let matchedRow = db
    .prepare(
      `SELECT cr.id AS cr_id, cr.response, cr.token_hash, cr.token,
              cr.created_at AS cr_created_at,
              iu.id AS user_id, iu.user_key, iu.email, iu.run_id, iu.audit_status
       FROM confirmation_requests cr
       JOIN inactive_users iu ON iu.id = cr.inactive_user_id
       WHERE cr.token_hash = ?`
    )
    .get(tokenSha256);

  if (!matchedRow) {
    // 2. Fallback: plaintext token lookup for legacy records (token column is indexed).
    const candidate = db
      .prepare(
        `SELECT cr.id AS cr_id, cr.response, cr.token_hash, cr.token,
                cr.created_at AS cr_created_at,
                iu.id AS user_id, iu.user_key, iu.email, iu.run_id, iu.audit_status
         FROM confirmation_requests cr
         JOIN inactive_users iu ON iu.id = cr.inactive_user_id
         WHERE cr.token = ?`
      )
      .get(token);

    if (candidate) {
      // If the legacy record has a bcrypt hash, verify it (single compare, not a loop).
      if (candidate.token_hash && candidate.token_hash.startsWith("$2")) {
        const valid = bcrypt.compareSync(token, candidate.token_hash);
        if (!valid) return { found: false, alreadyResponded: false };
      }
      matchedRow = candidate;
    }
  }

  if (!matchedRow) {
    return { found: false, alreadyResponded: false };
  }

  if (matchedRow.response !== null) {
    return {
      found: true,
      alreadyResponded: true,
      userId: matchedRow.user_id,
      userKey: matchedRow.user_key,
      email: matchedRow.email,
      auditStatus: matchedRow.audit_status || null,
      storedResponse: matchedRow.response,
    };
  }

  // Expire stale confirmation tokens (matches email copy: 14 days).
  try {
    const createdAt = new Date(String(matchedRow.cr_created_at).replace(" ", "T") + "Z");
    const ttlMs = 14 * 24 * 60 * 60 * 1000;
    if (createdAt.getTime() && Date.now() - createdAt.getTime() > ttlMs) {
      return {
        found: true,
        alreadyResponded: false,
        expired: true,
        userId: matchedRow.user_id,
        userKey: matchedRow.user_key,
        email: matchedRow.email,
      };
    }
  } catch (_) {
    // If parsing fails, do not block the response (treat as non-expiring).
  }

  const auditStatus = response === "yes" ? "confirmed" : "revoked";
  const action = response === "yes" ? "confirmed" : "revoked";

  const commit = db.transaction(() => {
    // 1. Record the response on confirmation_requests (idempotent)
    const upd = db.prepare(
      "UPDATE confirmation_requests SET response = ?, responded_at = datetime('now') WHERE id = ? AND response IS NULL"
    ).run(response, matchedRow.cr_id);

    if (upd.changes === 0) {
      const latest = db.prepare(
        `SELECT cr.response, iu.audit_status
         FROM confirmation_requests cr
         JOIN inactive_users iu ON iu.id = cr.inactive_user_id
         WHERE cr.id = ?`
      ).get(matchedRow.cr_id);
      return { alreadyResponded: true, storedResponse: latest?.response || null, auditStatus: latest?.audit_status || null };
    }

    // 2. Update the user's audit status
    db.prepare(
      "UPDATE inactive_users SET audit_status = ? WHERE id = ?"
    ).run(auditStatus, matchedRow.user_id);

    // 3. Insert audit log entry
    db.prepare(
      `INSERT INTO audit_log (id, run_id, inactive_user_id, user_key, email, action, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      matchedRow.run_id,
      matchedRow.user_id,
      matchedRow.user_key,
      matchedRow.email,
      action,
      meta.ipAddress || null
    );

    return { alreadyResponded: false, storedResponse: response, auditStatus };
  });

  const out = commit();

  return {
    found: true,
    alreadyResponded: !!out.alreadyResponded,
    userId: matchedRow.user_id,
    userKey: matchedRow.user_key,
    email: matchedRow.email,
    auditStatus: out.auditStatus,
    storedResponse: out.storedResponse,
  };
}

/**
 * Get a summary of response statuses for a comparison run.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} runId
 * @returns {{ total: number, sent: number, responded: number, pending: number, yes: number, no: number, details: object[] }}
 */
function getResponseSummary(db, runId) {
  const rows = db
    .prepare(
      `SELECT cr.id, cr.token, cr.sent_at, cr.responded_at, cr.response,
              iu.user_key, iu.email, iu.source, iu.audit_status
       FROM confirmation_requests cr
       JOIN inactive_users iu ON iu.id = cr.inactive_user_id
       WHERE iu.run_id = ?
       ORDER BY iu.user_key`
    )
    .all(runId);

  const total = rows.length;
  const sent = rows.filter((r) => r.sent_at !== null).length;
  const responded = rows.filter((r) => r.response !== null).length;
  const yes = rows.filter((r) => r.response === "yes").length;
  const no = rows.filter((r) => r.response === "no").length;

  return {
    total,
    sent,
    responded,
    pending: total - responded,
    yes,
    no,
    details: rows,
  };
}

/**
 * Retrieve the full audit log for a comparison run.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} runId
 * @returns {object[]}
 */
function getAuditLog(db, runId) {
  return db
    .prepare(
      `SELECT al.id, al.inactive_user_id, al.user_key, al.email,
              al.action, al.ip_address, al.created_at
       FROM audit_log al
       WHERE al.run_id = ?
       ORDER BY al.created_at ASC`
    )
    .all(runId);
}

/**
 * Retrieve a per-user audit status view for a comparison run, combining the
 * user's current status with their most recent audit log entries.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} runId
 * @returns {object[]}
 */
function getAuditResults(db, runId) {
  return db
    .prepare(
      `SELECT iu.id, iu.user_key, iu.email, iu.source, iu.audit_status,
              cr.response, cr.responded_at, cr.sent_at
       FROM inactive_users iu
       LEFT JOIN confirmation_requests cr ON cr.inactive_user_id = iu.id
       WHERE iu.run_id = ?
       ORDER BY iu.user_key`
    )
    .all(runId);
}

module.exports = {
  createConfirmationRequests,
  markSent,
  recordResponse,
  getResponseSummary,
  getAuditLog,
  getAuditResults,
};
