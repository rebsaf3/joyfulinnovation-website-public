/**
 * Express middleware that requires the request to be authenticated.
 * Browser requests (Accept: text/html) are redirected to /login.
 * API requests receive a 401 JSON response.
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    // Browser navigation → redirect to login page
    const acceptsHtml =
      req.headers.accept && req.headers.accept.includes("text/html");
    if (acceptsHtml && !req.xhr) {
      return res.redirect("/login");
    }
    // API / fetch / XHR → JSON error
    return res.status(401).json({ error: "Authentication required." });
  }
  next();
}

/**
 * Express middleware that loads the user's company_id from the session
 * onto req. Assumes requireAuth has already run.
 */
function loadCompany(req, _res, next) {
  req.companyId = req.session.companyId || null;
  next();
}

/**
 * Factory that returns middleware requiring an active trial (or paid plan).
 * Must be used AFTER requireAuth so that req.session.companyId exists.
 *
 * @param {import("better-sqlite3").Database} db
 * @returns {Function} Express middleware
 */
function requireActiveTrial(db) {
  return (req, res, next) => {
    const companyId = req.session.companyId;
    if (!companyId) return next(); // let requireAuth handle missing session

    const company = db.prepare(
      "SELECT trial_ends_at FROM companies WHERE id = ?"
    ).get(companyId);

    // No company found — should not happen, but don't block
    if (!company) return next();

    // No trial_ends_at set — legacy company, allow access (owner can set later)
    if (!company.trial_ends_at) return next();

    const now = new Date();
    // Stored by SQLite as "YYYY-MM-DD HH:MM:SS" (UTC). Convert to ISO for JS.
    const trialEnd = new Date(String(company.trial_ends_at).replace(" ", "T") + "Z");

    if (now > trialEnd) {
      // Trial expired — check if company has an active paid subscription
      const billing = db.prepare(
        "SELECT plan_status FROM billing_profiles WHERE company_id = ?"
      ).get(companyId);

      if (billing && billing.plan_status === "active") {
        return next(); // paid plan — allow access
      }

      // Trial expired, no active plan
      const acceptsHtml =
        req.headers.accept && req.headers.accept.includes("text/html");
      if (acceptsHtml && !req.xhr) {
        return res.redirect("/trial-expired");
      }
      return res.status(403).json({
        error: "Trial expired",
        trialExpired: true,
        trialEndsAt: company.trial_ends_at,
      });
    }

    next();
  };
}

module.exports = { requireAuth, loadCompany, requireActiveTrial };
