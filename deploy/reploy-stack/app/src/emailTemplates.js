/**
 * Generate a plain-text confirmation email asking a user whether they
 * still need access.
 *
 * @param {object} params
 * @param {string} params.userName – display name or identifier for the user
 * @param {string} params.email    – the user's email address
 * @param {string} params.token    – unique confirmation token
 * @param {string} params.baseUrl  – base URL for the confirmation endpoint
 * @returns {{ subject: string, textBody: string, htmlBody: string }}
 */
function buildConfirmationEmail({ userName, email, token, baseUrl }) {
  // Use URL fragments so the token/response never hit server logs/proxies as a querystring.
  const base = String(baseUrl || "").replace(/\/$/, "");
  const encodedToken = encodeURIComponent(token);
  const yesUrl = `${base}/confirm#token=${encodedToken}&response=yes`;
  const noUrl = `${base}/confirm#token=${encodedToken}&response=no`;

  const subject = "Action Required: Do you still need access?";

  const textBody = [
    `Hello ${userName},`,
    "",
    "We are reviewing user access and noticed your account may no longer be active.",
    "Please let us know whether you still need access by clicking one of the links below:",
    "",
    `  YES, I still need access: ${yesUrl}`,
    "",
    `  NO, please remove my access: ${noUrl}`,
    "",
    "If we do not hear from you within 14 days your access may be revoked.",
    "",
    "Thank you,",
    "The Access Review Team",
  ].join("\n");

  const htmlBody = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head><meta charset=\"UTF-8\"></head>",
    "<body style=\"font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;\">",
    `  <p>Hello ${escapeHtml(userName)},</p>`,
    "  <p>We are reviewing user access and noticed your account may no longer be active.",
    "     Please let us know whether you still need access:</p>",
    '  <table cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">',
    "    <tr>",
    `      <td style="padding-right: 12px;"><a href="${escapeHtml(yesUrl)}" style="background: #16a34a; color: #fff; padding: 10px 24px; border-radius: 4px; text-decoration: none; display: inline-block;">Yes, I still need access</a></td>`,
    `      <td><a href="${escapeHtml(noUrl)}" style="background: #dc2626; color: #fff; padding: 10px 24px; border-radius: 4px; text-decoration: none; display: inline-block;">No, remove my access</a></td>`,
    "    </tr>",
    "  </table>",
    "  <p>If we do not hear from you within 14 days your access may be revoked.</p>",
    "  <p>Thank you,<br>The Access Review Team</p>",
    "</body>",
    "</html>",
  ].join("\n");

  return { to: email, subject, textBody, htmlBody };
}

/**
 * Generate confirmation emails for a list of inactive users.
 *
 * @param {object[]} users – rows from inactive_users joined with their tokens
 * @param {string}   baseUrl
 * @returns {object[]} array of email objects
 */
function buildBulkConfirmationEmails(users, baseUrl) {
  return users.map((user) =>
    buildConfirmationEmail({
      userName: user.userName || user.user_key || user.key || "User",
      email: user.email,
      token: user.token,
      baseUrl,
    })
  );
}

/**
 * Generate a password reset email with a fragment-based reset link.
 */
function buildPasswordResetEmail({ email, token, baseUrl }) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const url = `${base}/reset#token=${encodeURIComponent(token)}`;

  const subject = "Reset your password";
  const textBody = [
    "We received a request to reset your NyLi Assets password.",
    "",
    `Reset your password: ${url}`,
    "",
    "If you did not request a reset, you can ignore this email.",
  ].join("\n");

  const htmlBody = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head><meta charset=\"UTF-8\"></head>",
    "<body style=\"font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;\">",
    "  <h2>Password reset</h2>",
    "  <p>We received a request to reset your NyLi Assets password.</p>",
    `  <p><a href="${escapeHtml(url)}" style="background:#0d9488;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;">Reset password</a></p>`,
    `  <p style="font-size:0.9rem;color:#666;">Or copy this link: ${escapeHtml(url)}</p>`,
    "  <p style=\"font-size:0.9rem;color:#666;\">If you did not request a reset, you can ignore this email.</p>",
    "</body>",
    "</html>",
  ].join("\n");

  return { to: email, subject, textBody, htmlBody };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { buildConfirmationEmail, buildBulkConfirmationEmails, buildPasswordResetEmail, escapeHtml };
