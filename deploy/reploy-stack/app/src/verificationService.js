const crypto = require("crypto");
const { getInactiveUsers } = require("./inactiveUsers");
const { createConfirmationRequests, markSent } = require("./responseTracker");
const { buildConfirmationEmail } = require("./emailTemplates");

/**
 * Orchestrate the full email-verification flow for a comparison run:
 *
 *   1. Load inactive users for the run
 *   2. Create a confirmation_request (with unique token) for each user
 *   3. Build a templated email per user
 *   4. Send every email via the provided sender
 *   5. Mark the confirmation_requests as sent in the DB
 *
 * @param {object} params
 * @param {import("better-sqlite3").Database} params.db
 * @param {string} params.runId       – comparison_runs.id
 * @param {string} params.baseUrl     – base URL for confirmation links
 * @param {{ sendMail: Function }} params.emailSender
 * @param {string} [params.fromAddress] – "From" header, defaults to noreply
 * @returns {Promise<{ sent: number, failed: number, details: object[] }>}
 */
async function sendVerificationEmails({
  db,
  runId,
  baseUrl,
  emailSender,
  fromAddress = "NyLi Assets Access Review <noreply@nyliassets.io>",
}) {
  // 1. Load inactive users
  const users = getInactiveUsers(db, runId);
  if (users.length === 0) {
    return { sent: 0, failed: 0, details: [] };
  }

  // 2. Create confirmation requests (tokens)
  const userIds = users.map((u) => u.id);
  const requests = createConfirmationRequests(db, userIds);

  // Build a lookup: inactive_user_id → token + request id
  const tokenMap = new Map(
    requests.map((r) => [r.inactiveUserId, { token: r.token, requestId: r.id }])
  );

  // 3 & 4. Build and send emails
  const details = [];
  const sentRequestIds = [];

  for (const user of users) {
    const entry = tokenMap.get(user.id);
    if (!entry) continue;

    const userName =
      user.user_data?.name || user.user_data?.Name || user.user_key || "User";

    const emailContent = buildConfirmationEmail({
      userName,
      email: user.email,
      token: entry.token,
      baseUrl,
    });

    try {
      const result = await emailSender.sendMail({
        from: fromAddress,
        to: emailContent.to,
        subject: emailContent.subject,
        text: emailContent.textBody,
        html: emailContent.htmlBody,
      });

      sentRequestIds.push(entry.requestId);
      details.push({
        email: user.email,
        userKey: user.user_key,
        status: "sent",
        messageId: result.messageId || null,
      });
    } catch (err) {
      details.push({
        email: user.email,
        userKey: user.user_key,
        status: "failed",
        error: err.message,
      });
    }
  }

  // 5. Mark successfully sent requests in DB and write audit log entries
  if (sentRequestIds.length > 0) {
    markSent(db, sentRequestIds);

    // Log "verification_sent" for each successfully sent user
    const logStmt = db.prepare(
      `INSERT INTO audit_log (id, run_id, inactive_user_id, user_key, email, action)
       VALUES (?, ?, ?, ?, ?, 'verification_sent')`
    );
    const sentUsers = details.filter((d) => d.status === "sent");
    const logInsert = db.transaction((entries) => {
      for (const entry of entries) {
        const user = users.find((u) => u.user_key === entry.userKey);
        if (user) {
          logStmt.run(crypto.randomUUID(), runId, user.id, user.user_key, user.email);
        }
      }
    });
    logInsert(sentUsers);
  }

  return {
    sent: details.filter((d) => d.status === "sent").length,
    failed: details.filter((d) => d.status === "failed").length,
    details,
  };
}

module.exports = { sendVerificationEmails };
