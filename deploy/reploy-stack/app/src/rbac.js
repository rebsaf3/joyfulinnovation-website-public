const ROLE_ORDER = ["member", "admin", "superadmin"];

function roleAtLeast(userRole, requiredRole) {
  const requiredIndex = ROLE_ORDER.indexOf(requiredRole);
  const userIndex = ROLE_ORDER.indexOf(userRole);
  if (requiredIndex === -1) throw new Error(`Unknown required role: ${requiredRole}`);
  return userIndex >= requiredIndex;
}

function createRequireRole(db) {
  return function requireRole(requiredRole) {
    return (req, res, next) => {
      if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: "Authentication required." });
      }
      const user = db.prepare("SELECT role FROM users WHERE id = ?").get(req.session.userId);
      const userRole = user ? user.role : null;
      if (!userRole || !roleAtLeast(userRole, requiredRole)) {
        return res.status(403).json({ error: "Insufficient privileges." });
      }
      next();
    };
  };
}

function createRequireOwner(db) {
  return function requireOwner(req, res, next) {
    if (!req.session || !req.session.ownerId) {
      // API routes always get JSON; page routes get a redirect
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "Owner authentication required." });
      }
      return res.redirect("/owner/login");
    }
    const owner = db.prepare("SELECT id FROM platform_owners WHERE id = ?").get(req.session.ownerId);
    if (!owner) {
      req.session.destroy(() => {});
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "Owner account not found." });
      }
      return res.redirect("/owner/login");
    }
    next();
  };
}

module.exports = {
  ROLE_ORDER,
  roleAtLeast,
  createRequireRole,
  createRequireOwner,
};

