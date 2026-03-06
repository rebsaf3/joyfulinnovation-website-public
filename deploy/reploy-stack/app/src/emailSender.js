const nodemailer = require("nodemailer");

/**
 * Create a nodemailer transporter from configuration.
 *
 * In production pass real SMTP settings.  For local development / testing,
 * pass nothing and the sender will operate in "log-only" mode — emails are
 * captured in a `sent` array on the returned object instead of being
 * dispatched over the network.
 *
 * If a `db` reference is provided, the sender will check the settings table
 * for SendGrid credentials on every send and route through SendGrid when
 * configured.  This lets the owner update credentials at runtime without
 * restarting the server.
 *
 * @param {object} [smtpConfig] – nodemailer transport options
 * @param {import("better-sqlite3").Database} [db] – optional DB for SendGrid
 * @returns {{ sendMail: Function, sent: object[]|null, transporter: object|null }}
 */
function createEmailSender(smtpConfig, db) {
  // ── Helper: send via SendGrid REST API ────────────────────────────
  async function sendViaSendGrid(apiKey, fromEmail, fromName, mailOptions) {
    const to = Array.isArray(mailOptions.to)
      ? mailOptions.to.map(e => ({ email: e }))
      : [{ email: mailOptions.to }];

    const from = {};
    // Extract name/email from "from" field if present
    if (mailOptions.from && typeof mailOptions.from === "string" && mailOptions.from.includes("<")) {
      const m = mailOptions.from.match(/^(.*?)\s*<(.+)>$/);
      if (m) { from.name = m[1].trim(); from.email = m[2].trim(); }
      else { from.email = mailOptions.from; }
    } else {
      from.email = fromEmail;
      if (fromName) from.name = fromName;
    }

    const payload = {
      personalizations: [{ to }],
      from,
      subject: mailOptions.subject || "(no subject)",
      content: [],
    };
    if (mailOptions.text) payload.content.push({ type: "text/plain", value: mailOptions.text });
    if (mailOptions.html) payload.content.push({ type: "text/html", value: mailOptions.html });
    if (payload.content.length === 0) payload.content.push({ type: "text/plain", value: "" });

    // Read optional reply-to from DB
    if (db) {
      const replyRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("sendgrid_reply_to");
      if (replyRow && replyRow.value) payload.reply_to = { email: replyRow.value };
    }

    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[EMAIL] SendGrid error ${resp.status}: ${body.substring(0, 200)}`);
      throw new Error(`SendGrid ${resp.status}: ${body}`);
    }
    const msgId = resp.headers.get("x-message-id") || `sg-${Date.now()}`;
    console.log(`[EMAIL] SendGrid sent to ${Array.isArray(mailOptions.to) ? mailOptions.to.join(", ") : mailOptions.to} – msgId=${msgId}`);
    return { messageId: msgId, sendgrid: true };
  }

  // ── Log-only / test mode ────────────────────────────────────────────
  if (!smtpConfig) {
    const sent = [];
    return {
      sent,
      transporter: null,
      async sendMail(mailOptions) {
        // Check DB for SendGrid credentials at send time
        if (db) {
          try {
            const keyRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("sendgrid_api_key");
            const fromRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("sendgrid_from_email");
            const nameRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("sendgrid_from_name");
            if (keyRow && keyRow.value && fromRow && fromRow.value) {
              return sendViaSendGrid(keyRow.value, fromRow.value, nameRow?.value || "", mailOptions);
            }
          } catch (err) {
            console.error(`[EMAIL] SendGrid send failed, falling back to log-only: ${err.message}`);
          }
        }
        // Fallback: log-only
        const entry = {
          to: mailOptions.to,
          subject: mailOptions.subject,
          text: mailOptions.text,
          html: mailOptions.html,
          sentAt: new Date().toISOString(),
        };
        sent.push(entry);
        console.log(`[EMAIL] Log-only mode: to=${mailOptions.to}, subject="${mailOptions.subject}"`);
        return { messageId: `log-${sent.length}@leo.local`, logged: true };
      },
    };
  }

  // ── Real SMTP mode ──────────────────────────────────────────────────
  const transporter = nodemailer.createTransport(smtpConfig);

  return {
    sent: null,
    transporter,
    async sendMail(mailOptions) {
      return transporter.sendMail(mailOptions);
    },
  };
}

module.exports = { createEmailSender };
