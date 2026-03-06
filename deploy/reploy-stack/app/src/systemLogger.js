const crypto = require("crypto");

/**
 * System-wide audit logger for tracking all platform activity.
 *
 * Categories: auth, project, comparison, verification, user_mgmt, billing, admin, owner, system
 * Severities: info, warning, error, critical
 */

/**
 * Log a system event.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {object} entry
 * @param {string} entry.category    – auth|project|comparison|verification|user_mgmt|billing|admin|owner|system
 * @param {string} entry.action      – e.g. "user.login", "project.created"
 * @param {string} [entry.severity]  – info|warning|error|critical (default: info)
 * @param {string} [entry.actorId]   – user or owner ID who performed the action
 * @param {string} [entry.actorEmail]
 * @param {string} [entry.actorType] – user|owner|system (default: user)
 * @param {string} [entry.companyId]
 * @param {string} [entry.companyName]
 * @param {string} [entry.resourceType] – e.g. "project", "user", "run"
 * @param {string} [entry.resourceId]
 * @param {string} [entry.ipAddress]
 * @param {string} [entry.userAgent]
 * @param {string} [entry.details]   – human-readable description
 * @param {object} [entry.meta]      – arbitrary JSON metadata
 */
function logEvent(db, entry) {
  try {
    // Echo to stdout so events are visible in Railway / container logs
    const sev = (entry.severity || "info").toUpperCase();
    const tag = sev === "ERROR" || sev === "CRITICAL" ? "ERR" : sev === "WARNING" ? "WARN" : "LOG";
    const actor = entry.actorEmail || entry.actorId || "system";
    const ip = entry.ipAddress ? ` ip=${entry.ipAddress}` : "";
    console.log(`[${tag}] [${entry.category}] ${entry.action} – ${entry.details || "(no details)"}  actor=${actor}${ip}`);

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO system_log (id, category, action, severity, actor_id, actor_email, actor_type,
        company_id, company_name, resource_type, resource_id, ip_address, user_agent, details, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.category,
      entry.action,
      entry.severity || "info",
      entry.actorId || null,
      entry.actorEmail || null,
      entry.actorType || "user",
      entry.companyId || null,
      entry.companyName || null,
      entry.resourceType || null,
      entry.resourceId || null,
      entry.ipAddress || null,
      entry.userAgent || null,
      entry.details || null,
      entry.meta ? JSON.stringify(entry.meta) : null
    );
    return id;
  } catch (err) {
    // Logging should never crash the app
    console.error("[ERR] System log write failed:", err.message);
    return null;
  }
}

/**
 * Helper to extract common request metadata for logging.
 */
function reqMeta(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: (req.headers["user-agent"] || "").substring(0, 500),
  };
}

/**
 * Build a logging helper scoped to the DB.
 * Returns a convenience object with category-specific methods.
 */
function createSystemLogger(db) {
  const log = (entry) => logEvent(db, entry);

  return {
    raw: log,

    // ── Auth events ──────────────────────────────────────────
    authLogin(req, user) {
      const m = reqMeta(req);
      log({ category: "auth", action: "user.login", actorId: user.id, actorEmail: user.email,
        companyId: user.companyId, details: `User logged in: ${user.email}`, ...m });
    },
    authLoginFailed(req, email, reason) {
      const m = reqMeta(req);
      log({ category: "auth", action: "user.login_failed", severity: "warning",
        actorEmail: email, details: `Login failed for ${email}: ${reason}`, ...m });
    },
    authRegister(req, user) {
      const m = reqMeta(req);
      log({ category: "auth", action: "user.register", actorId: user.id, actorEmail: user.email,
        companyId: user.companyId, details: `New user registered: ${user.email}`, ...m });
    },
    authLogout(req, userId, email) {
      const m = reqMeta(req);
      log({ category: "auth", action: "user.logout", actorId: userId, actorEmail: email, details: `User logged out: ${email}`, ...m });
    },
    authPasswordReset(req, email) {
      const m = reqMeta(req);
      log({ category: "auth", action: "user.password_reset_request", actorEmail: email,
        details: `Password reset requested for ${email}`, ...m });
    },
    authPasswordChanged(req, userId, email) {
      const m = reqMeta(req);
      log({ category: "auth", action: "user.password_changed", actorId: userId, actorEmail: email,
        details: `Password changed for ${email}`, ...m });
    },

    // ── Owner auth events ────────────────────────────────────
    ownerLogin(req, owner) {
      const m = reqMeta(req);
      log({ category: "owner", action: "owner.login", actorId: owner.id, actorEmail: owner.email,
        actorType: "owner", details: `Owner logged in: ${owner.email}`, ...m });
    },
    ownerLoginFailed(req, email) {
      const m = reqMeta(req);
      log({ category: "owner", action: "owner.login_failed", severity: "warning", actorType: "owner",
        actorEmail: email, details: `Owner login failed: ${email}`, ...m });
    },
    ownerLogout(req, ownerId, email) {
      const m = reqMeta(req);
      log({ category: "owner", action: "owner.logout", actorId: ownerId, actorEmail: email,
        actorType: "owner", details: `Owner logged out: ${email}`, ...m });
    },

    // ── Project events ───────────────────────────────────────
    projectCreated(req, project, actor) {
      const m = reqMeta(req);
      log({ category: "project", action: "project.created", actorId: actor.id, actorEmail: actor.email,
        companyId: req.companyId, resourceType: "project", resourceId: project.id,
        details: `Project created: "${project.name}"`, meta: { projectName: project.name, costPerUser: project.cost_per_user }, ...m });
    },
    projectUpdated(req, projectId, projectName, actor, changes) {
      const m = reqMeta(req);
      log({ category: "project", action: "project.updated", actorId: actor.id, actorEmail: actor.email,
        companyId: req.companyId, resourceType: "project", resourceId: projectId,
        details: `Project updated: "${projectName}"`, meta: changes, ...m });
    },
    projectStatusChanged(req, projectId, projectName, oldStatus, newStatus, actor) {
      const m = reqMeta(req);
      log({ category: "project", action: "project.status_changed", actorId: actor.id, actorEmail: actor.email,
        companyId: req.companyId, resourceType: "project", resourceId: projectId,
        details: `Project "${projectName}" status: ${oldStatus} → ${newStatus}`, meta: { oldStatus, newStatus }, ...m });
    },
    projectDeleted(req, projectId, projectName, actor) {
      const m = reqMeta(req);
      log({ category: "project", action: "project.deleted", severity: "warning", actorId: actor.id, actorEmail: actor.email,
        companyId: req.companyId, resourceType: "project", resourceId: projectId,
        details: `Project deleted: "${projectName}"`, ...m });
    },

    // ── Comparison events ────────────────────────────────────
    comparisonRun(req, runId, projectId, report, actor) {
      const m = reqMeta(req);
      const summary = report.summary || {};
      log({ category: "comparison", action: "comparison.run", actorId: actor.id, actorEmail: actor.email,
        companyId: req.companyId, resourceType: "run", resourceId: runId,
        details: `Comparison run completed: ${summary.totalFileA || 0} vs ${summary.totalFileB || 0} users, ${summary.onlyInFileA + summary.onlyInFileB} flagged`,
        meta: { projectId, ...summary }, ...m });
    },

    // ── Verification events ──────────────────────────────────
    verificationSent(req, runId, sentCount, failedCount, actor) {
      const m = reqMeta(req);
      log({ category: "verification", action: "verification.emails_sent", actorId: actor.id, actorEmail: actor.email,
        companyId: req.companyId, resourceType: "run", resourceId: runId,
        details: `Verification emails sent: ${sentCount} sent, ${failedCount} failed`,
        meta: { sentCount, failedCount }, ...m });
    },
    verificationResponse(req, token, response, userKey, email) {
      const m = reqMeta(req);
      const sev = response === "no" ? "warning" : "info";
      log({ category: "verification", action: `verification.response_${response}`, severity: sev,
        actorEmail: email, details: `User ${userKey} (${email}) responded "${response}"`,
        meta: { token: token.substring(0, 8) + "...", userKey }, ...m });
    },

    // ── User management events ───────────────────────────────
    userCreated(req, newUser, actor) {
      const m = reqMeta(req);
      log({ category: "user_mgmt", action: "user.created", actorId: actor.id, actorEmail: actor.email,
        companyId: req.session?.companyId, resourceType: "user", resourceId: newUser.id,
        details: `User created: ${newUser.email} (role: ${newUser.role})`, meta: { email: newUser.email, role: newUser.role }, ...m });
    },
    userRoleChanged(req, targetId, targetEmail, oldRole, newRole, actor) {
      const m = reqMeta(req);
      log({ category: "user_mgmt", action: "user.role_changed", actorId: actor.id, actorEmail: actor.email,
        companyId: req.session?.companyId, resourceType: "user", resourceId: targetId,
        details: `User ${targetEmail} role changed: ${oldRole} → ${newRole}`, meta: { oldRole, newRole }, ...m });
    },
    userDisabled(req, targetId, targetEmail, actor) {
      const m = reqMeta(req);
      log({ category: "user_mgmt", action: "user.disabled", severity: "warning", actorId: actor.id, actorEmail: actor.email,
        companyId: req.session?.companyId, resourceType: "user", resourceId: targetId,
        details: `User disabled: ${targetEmail}`, ...m });
    },
    userEnabled(req, targetId, targetEmail, actor) {
      const m = reqMeta(req);
      log({ category: "user_mgmt", action: "user.enabled", actorId: actor.id, actorEmail: actor.email,
        companyId: req.session?.companyId, resourceType: "user", resourceId: targetId,
        details: `User enabled: ${targetEmail}`, ...m });
    },
    userDeleted(req, targetId, targetEmail, actor) {
      const m = reqMeta(req);
      log({ category: "user_mgmt", action: "user.deleted", severity: "warning", actorId: actor.id, actorEmail: actor.email,
        companyId: req.session?.companyId, resourceType: "user", resourceId: targetId,
        details: `User deleted: ${targetEmail}`, ...m });
    },
    userProfileUpdated(req, userId, email) {
      const m = reqMeta(req);
      log({ category: "user_mgmt", action: "user.profile_updated", actorId: userId, actorEmail: email,
        details: `Profile updated: ${email}`, ...m });
    },
    userBulkAction(req, action, affectedCount, actor) {
      const m = reqMeta(req);
      log({ category: "user_mgmt", action: `user.bulk_${action}`, severity: "warning", actorId: actor.id, actorEmail: actor.email,
        companyId: req.session?.companyId, details: `Bulk ${action}: ${affectedCount} users affected`, meta: { affectedCount }, ...m });
    },

    // ── Billing events ───────────────────────────────────────
    billingPlanChanged(req, companyId, oldPlan, newPlan, actor) {
      const m = reqMeta(req);
      log({ category: "billing", action: "billing.plan_changed", actorId: actor.id, actorEmail: actor.email,
        companyId, resourceType: "billing", details: `Plan changed: ${oldPlan} → ${newPlan}`,
        meta: { oldPlan, newPlan }, ...m });
    },
    billingPlanCanceled(req, companyId, plan, actor) {
      const m = reqMeta(req);
      log({ category: "billing", action: "billing.plan_canceled", severity: "warning", actorId: actor.id, actorEmail: actor.email,
        companyId, resourceType: "billing", details: `Plan canceled (was: ${plan})`, ...m });
    },
    billingAddressUpdated(req, companyId, actor) {
      const m = reqMeta(req);
      log({ category: "billing", action: "billing.address_updated", actorId: actor.id, actorEmail: actor.email,
        companyId, resourceType: "billing", details: "Billing address updated", ...m });
    },
    billingCardUpdated(req, companyId, brand, last4, actor) {
      const m = reqMeta(req);
      log({ category: "billing", action: "billing.card_updated", actorId: actor.id, actorEmail: actor.email,
        companyId, resourceType: "billing", details: `Payment method updated: ${brand} ****${last4}`, meta: { brand, last4 }, ...m });
    },

    // ── Admin events ─────────────────────────────────────────
    adminBillingDefaultsChanged(req, actor) {
      const m = reqMeta(req);
      log({ category: "admin", action: "admin.billing_defaults_changed", actorId: actor.id, actorEmail: actor.email,
        details: "Billing defaults updated", ...m });
    },
    adminCompanyBillingChanged(req, companyId, actor) {
      const m = reqMeta(req);
      log({ category: "admin", action: "admin.company_billing_changed", actorId: actor.id, actorEmail: actor.email,
        companyId, details: `Company billing configuration updated`, ...m });
    },

    // ── Owner events (platform-level actions) ────────────────
    ownerUserUpdated(req, targetId, targetEmail, changes, ownerId) {
      const m = reqMeta(req);
      log({ category: "owner", action: "owner.user_updated", actorId: ownerId, actorType: "owner",
        resourceType: "user", resourceId: targetId,
        details: `Owner updated user ${targetEmail}: ${Object.keys(changes).join(", ")}`, meta: changes, ...m });
    },

    // ── System events ────────────────────────────────────────
    systemStartup() {
      log({ category: "system", action: "system.startup", actorType: "system", details: "Server started" });
    },
    systemError(context, error) {
      log({ category: "system", action: "system.error", severity: "error", actorType: "system",
        details: `Error in ${context}: ${error.message || error}`, meta: { stack: (error.stack || "").substring(0, 500) } });
    },
  };
}

module.exports = { logEvent, createSystemLogger, reqMeta };
