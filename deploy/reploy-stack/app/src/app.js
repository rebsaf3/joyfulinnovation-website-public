const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { openDb } = require("./db");
const { compareUsers } = require("./compareUsers");
const { saveComparisonRun, getComparisonRun, getComparisonRunForCompany, listComparisonRuns } = require("./store");
const { extractAndSaveInactiveUsers } = require("./inactiveUsers");
const { recordResponse, getResponseSummary, getAuditLog, getAuditResults } = require("./responseTracker");
const { sendVerificationEmails } = require("./verificationService");
const { createEmailSender } = require("./emailSender");
const { buildPasswordResetEmail } = require("./emailTemplates");
const { registerUser, loginUser, getUserById } = require("./authService");
const { requireAuth, loadCompany, requireActiveTrial } = require("./authMiddleware");
const { SqliteSessionStore } = require("./sessionStore");
const { createClaudeAnalyzer } = require("./claudeAnalysis");
const { createRateLimiter } = require("./rateLimiter");
const { createSystemLogger } = require("./systemLogger");
const { createRequireRole, createRequireOwner } = require("./rbac");
const { swarmDashboardRouter } = require("./swarmDashboardRoutes");
const { resolveSwarmDashboardDist, resolveMeshPort, resolveSwarmRuntimeMode } = require("./runtimePaths");

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/csv",
  "text/plain",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function createApp(db, options = {}) {
  if (!db) db = openDb();
  const emailSender = options.emailSender || createEmailSender(undefined, db);
  const claudeAnalyzer = options.claudeAnalyzer || createClaudeAnalyzer(db);

  const app = express();
  const syslog = createSystemLogger(db);

  // Concise error-logging helper used in catch blocks
  const logErr = (route, err) => console.error(`[ERR] ${route}:`, err.message || err);

  function sanitizeUrlForLog(url) {
    try {
      const u = new URL(url, "http://local");
      // Mask common sensitive params if they ever appear in URLs.
      for (const key of ["token", "reset_token", "code", "key", "secret"]) {
        if (u.searchParams.has(key)) u.searchParams.set(key, "[REDACTED]");
      }
      // Mask tokenized reset routes (/reset/:token).
      u.pathname = u.pathname.replace(/^\/reset\/[^/]+$/, "/reset/[REDACTED]");
      return u.pathname + (u.search || "");
    } catch {
      return url;
    }
  }

  function parseSqliteUtc(ts) {
    if (!ts) return null;
    const s = String(ts);
    // Accept either ISO or SQLite "YYYY-MM-DD HH:MM:SS" (UTC).
    if (s.includes("T")) return new Date(s);
    return new Date(s.replace(" ", "T") + "Z");
  }

  function probeMeshHealth(timeoutMs = 1200) {
    const meshPort = resolveMeshPort();
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: meshPort,
          path: "/health",
          method: "GET",
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => {
            raw += chunk;
          });
          res.on("end", () => {
            let body = null;
            try {
              body = raw ? JSON.parse(raw) : null;
            } catch {
              body = { raw: raw.slice(0, 200) };
            }
            resolve({
              reachable: res.statusCode >= 200 && res.statusCode < 300,
              statusCode: res.statusCode || 0,
              body,
              meshPort,
            });
          });
        }
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error("mesh health timeout")));
      req.on("error", (err) => {
        resolve({
          reachable: false,
          statusCode: 0,
          body: { error: err.message },
          meshPort,
        });
      });
      req.end();
    });
  }

  // ── Health check (before ALL middleware, so it always responds) ────────
  app.get("/healthz", (_req, res) => {
    res.status(200).send("OK");
  });

  app.get("/api/swarm-status", async (_req, res) => {
    const keyPattern = /placeholder|your_|changeme|<|>/i;
    const keyPresence = {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY && !keyPattern.test(process.env.ANTHROPIC_API_KEY)),
      openai: Boolean(process.env.OPENAI_API_KEY && !keyPattern.test(process.env.OPENAI_API_KEY)),
    };
    const runtimeMode = resolveSwarmRuntimeMode();
    const mesh = await probeMeshHealth();
    const hasAnyKey = keyPresence.anthropic || keyPresence.openai;

    let status = "offline";
    if (mesh.reachable) status = hasAnyKey ? "healthy" : "degraded";
    else if (!hasAnyKey || runtimeMode === "minimal") status = "degraded";

    return res.json({
      status,
      runtimeMode,
      mesh,
      keyPresence,
      checkedAt: new Date().toISOString(),
    });
  });

  // ── Request / Response logger ──────────────────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    const ip = req.ip || req.socket?.remoteAddress;
    const safeUrl = sanitizeUrlForLog(req.originalUrl || req.url);
    console.log(`[REQ] ${req.method} ${safeUrl} from ${ip}`);

    const origEnd = res.end.bind(res);
    res.end = function (...args) {
      const ms = Date.now() - start;
      const tag = res.statusCode >= 500 ? "ERR" : res.statusCode >= 400 ? "WARN" : "RES";
      console.log(`[${tag}] ${req.method} ${safeUrl} → ${res.statusCode} (${ms}ms) from ${ip}`);
      return origEnd(...args);
    };
    next();
  });

  // Trust reverse proxy (Railway, Render, etc.) so req.protocol / req.ip work
  if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  // ── Baseline security headers (CSP intentionally omitted due to inline scripts) ──
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    next();
  });

  // ── Request timeout middleware (BKD-006) ───────────────────────────────
  // Prevent hanging requests from exhausting server resources
  // Timeout: 30 seconds for normal requests, 5 min for uploads
  const REQUEST_TIMEOUT_MS = 30_000;
  const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
  app.use((req, res, next) => {
    const timeoutMs = req.path.includes("/upload") || req.path.includes("/import") ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    req.setTimeout(timeoutMs, () => {
      const ip = req.ip || req.socket?.remoteAddress;
      console.error(`[TIMEOUT] ${req.method} ${req.path} exceeded ${timeoutMs}ms from ${ip}`);
      if (!res.headersSent) {
        res.status(503).json({ error: "Request timeout. Please try again.", code: "REQUEST_TIMEOUT" });
      }
      req.socket.destroy();
    });
    next();
  });

  const requireRole = createRequireRole(db);
  const requireOwner = createRequireOwner(db);

  // ── Rate limiters for different endpoint sensitivities ─────────────────
  // Auth endpoints: stricter limits (brute force protection)
  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5, // 5 attempts per IP
  });

  // Public confirmation endpoint: moderate limits (DOS protection)
  const confirmLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 20, // 20 confirmations per IP (allow for legitimate retries)
  });

  // Comparison endpoint: moderate limits (resource protection)
  const compareLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 50, // 50 comparisons per hour per IP
  });

  // ── JSON body parser ────────────────────────────────────────────────────
  // Skip JSON parsing for the Stripe webhook (needs raw body for HMAC verification)
  app.use((req, res, next) => {
    if (req.originalUrl === '/webhooks/stripe') return next();
    express.json()(req, res, next);
  });

  // ── Session management ────────────────────────────────────────────────
  const sessionSecret =
    options.sessionSecret ||
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === "test" ? "test-session-secret-not-for-production" : null);
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET environment variable is required. Set it before starting the app.");
  }
  app.use(
    session({
      store: new SqliteSessionStore(db),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production"),
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      },
    })
  );

  function requestComesFromLocalhost(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || "").trim().toLowerCase();
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost";
  }

  function isStateChangingRequest(req) {
    return ["POST", "PUT", "PATCH", "DELETE"].includes(String(req.method || "").toUpperCase());
  }

  function isSameOriginMutation(req) {
    const host = String(req.get("x-forwarded-host") || req.get("host") || "").toLowerCase();
    if (!host) return requestComesFromLocalhost(req);

    const candidates = [req.get("origin"), req.get("referer")].filter(Boolean);
    if (candidates.length === 0) {
      return process.env.NODE_ENV === "test" || requestComesFromLocalhost(req);
    }

    return candidates.some((candidate) => {
      try {
        return new URL(candidate).host.toLowerCase() === host;
      } catch {
        return false;
      }
    });
  }

  // ── Mutation guard (SEC-003) ───────────────────────────────────────────
  // The app ships static HTML without CSRF token wiring, so enforce a
  // same-origin policy for state-changing requests instead of rejecting all
  // browser mutations that lack a token. Webhooks and local swarm controls are
  // excluded from this guard because they have their own trust model.
  app.use((req, res, next) => {
    req.csrfToken = () => null;

    if (!isStateChangingRequest(req)) return next();
    if (req.path.startsWith("/api/swarm-control/")) return next();
    if (req.path === "/webhooks/stripe") return next();
    if (isSameOriginMutation(req)) return next();

    return res.status(403).json({
      error: "Cross-site request blocked.",
      code: "CSRF_ORIGIN_MISMATCH",
    });
  });

  // Middleware to provide a stable template hook to all responses
  app.use((req, res, next) => {
    res.locals.csrfToken = null;
    next();
  });

  // ── Swarm dashboard API routes ───────────────────────────────────────────
  // Auth behavior is controlled inside swarmDashboardRouter via
  // SWARM_DASHBOARD_AUTH (default: open access).
  app.use("/api", swarmDashboardRouter);

  // ── Guard: prevent bypassing auth by hitting protected *.html directly ──
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!req.path || !req.path.endsWith(".html")) return next();

    const publicHtml = new Set([
      "/index.html",
      "/landing.html",
      "/login.html",
      "/register.html",
      "/confirm.html",
      "/reset-password.html",
      "/owner-login.html",
    ]);

    if (publicHtml.has(req.path)) return next();

    if (req.path.startsWith("/owner-")) return requireOwner(req, res, next);
    if (req.path === "/admin.html") return requireRole("admin")(req, res, next);

    return requireAuth(req, res, next);
  });

  // ── Swarm Dashboard SPA (scoped routes only) ────────────────────────────
  const swarmClientDist = resolveSwarmDashboardDist();
  const swarmClientIndex = path.join(swarmClientDist, "index.html");
  const swarmDashboardAuthRequired = String(process.env.SWARM_DASHBOARD_AUTH || "").toLowerCase() === "true";
  const maybeRequireSwarmAuth = (req, res, next) => {
    if (!swarmDashboardAuthRequired) return next();
    return requireAuth(req, res, next);
  };
  if (fs.existsSync(swarmClientIndex)) {
    // Serve built bundle assets without exposing a global catch-all route.
    app.use("/assets", express.static(path.join(swarmClientDist, "assets")));

    // Keep SPA route list scoped to swarm pages.
    app.get(
      ["/swarm-dashboard", "/agent-monitor", "/agent-activity", "/agent-verification"],
      maybeRequireSwarmAuth,
      (req, res, next) =>
        res.sendFile(swarmClientIndex, (err) => {
          if (err) return next(err);
        })
    );
  }

  // ── Static files ──────────────────────────────────────────────────────
  app.use(express.static(path.join(__dirname, "public")));

  // ── Global trial check ────────────────────────────────────────────────
  // Runs after session is established. Skips public/auth/owner routes and
  // checks whether the company's 7-day trial (or paid plan) is still active.
  const checkTrial = requireActiveTrial(db);
  const TRIAL_SKIP = new Set([
    "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/me",
    "/api/auth/forgot-password", "/api/auth/reset-password",
    "/api/confirm", "/api/trial/status", "/healthz",
  ]);
  const TRIAL_SKIP_PREFIXES = [
    "/api/swarm-",
    "/api/agent-activity",
    "/api/agent-verification",
    "/api/project-dashboard",
    "/api/project-tasks",
    "/api/token-usage",
  ];
  app.use((req, res, next) => {
    // Skip public pages, auth endpoints, owner routes, webhooks, static files
    if (
      TRIAL_SKIP.has(req.path) ||
      TRIAL_SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix)) ||
      req.path.startsWith("/api/owner/") ||
      req.path.startsWith("/webhooks/") ||
      req.path === "/trial-expired" ||
      !req.session?.userId // not logged in — let requireAuth handle it
    ) {
      return next();
    }
    checkTrial(req, res, next);
  });

  // ── Multer setup (memory storage – files stay in buffers) ─────────────
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter(_req, file, cb) {
      // Accept .csv by extension OR known CSV mime types
      if (
        ALLOWED_MIME_TYPES.has(file.mimetype) ||
        file.originalname.toLowerCase().endsWith(".csv")
      ) {
        return cb(null, true);
      }
      cb(new Error("Only CSV files are allowed."));
    },
  });

  // ── Helper: look up run scoped to user's company ──────────────────────
  function getRunForUser(req) {
    const companyId = req.session.companyId;
    if (!companyId) return null;
    return getComparisonRunForCompany(db, req.params.id, companyId);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  AUTH ROUTES (public)
  // ══════════════════════════════════════════════════════════════════════

  // ── POST /api/auth/register ──────────────────────────────────────────
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    const { email, password, companyName } = req.body || {};

    if (!email || !password || !companyName) {
      return res.status(400).json({
        error: "Fields 'email', 'password', and 'companyName' are required.",
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    try {
      const user = await registerUser(db, { email, password, companyName });

      // Auto-login after registration (regenerate session to prevent fixation)
      req.session.regenerate((err) => {
        if (err) {
          logErr("session.regenerate (register)", err);
          return res.status(500).json({ error: "Registration succeeded, but login failed." });
        }
        req.session.userId = user.id;
        req.session.companyId = user.companyId;

        syslog.authRegister(req, user);

        return res.status(201).json({
          id: user.id,
          email: user.email,
          companyId: user.companyId,
        });
      });
    } catch (err) {
      logErr("POST /api/auth/register", err);
      if (err.message.includes("already exists")) {
        return res.status(409).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }
  });

  // ── POST /api/auth/login ─────────────────────────────────────────────
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Fields 'email' and 'password' are required." });
    }

    try {
      const user = await loginUser(db, { email, password });
      if (!user) {
        syslog.authLoginFailed(req, email, "invalid credentials");
        return res.status(401).json({ error: "Invalid email or password." });
      }

      if (user.disabled) {
        syslog.authLoginFailed(req, email, "account disabled");
        return res.status(403).json({ error: "Account disabled. Contact support." });
      }

      // Check if company is disabled
      const company = db.prepare("SELECT disabled FROM companies WHERE id = ?").get(user.companyId);
      if (company && company.disabled) {
        syslog.authLoginFailed(req, email, "company disabled");
        return res.status(403).json({ error: "Your organization's account has been suspended. Contact support." });
      }

      // Regenerate session to prevent session fixation
      const oldSession = req.session;
      req.session.regenerate((err) => {
        if (err) {
          logErr("session.regenerate", err);
          return res.status(500).json({ error: "Login failed." });
        }
        req.session.userId = user.id;
        req.session.companyId = user.companyId;

        syslog.authLogin(req, user);

        return res.json({
          id: user.id,
          email: user.email,
          companyId: user.companyId,
          disabled: !!user.disabled,
        });
      });
    } catch (err) {
      logErr("POST /api/auth/login", err);
      return res.status(400).json({ error: err.message });
    }
  });

  // ── POST /api/auth/logout ────────────────────────────────────────────
  app.post("/api/auth/logout", (req, res) => {
    const uid = req.session?.userId;
    const uemail = uid ? (db.prepare("SELECT email FROM users WHERE id = ?").get(uid)?.email || null) : null;
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Failed to log out." });
      }
      if (uid) syslog.authLogout(req, uid, uemail);
      res.clearCookie("connect.sid");
      return res.json({ success: true });
    });
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────
  app.get("/api/auth/me", requireAuth, (req, res) => {
    const row = db.prepare("SELECT id, email, company_id, role, disabled, created_at FROM users WHERE id = ?").get(req.session.userId);
    if (!row) return res.status(401).json({ error: "User not found." });

    // Trial info
    const company = db.prepare("SELECT trial_ends_at FROM companies WHERE id = ?").get(row.company_id);
    let trial = null;
    if (company?.trial_ends_at) {
      const now = new Date();
      const trialEnd = parseSqliteUtc(company.trial_ends_at);
      const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
      const billing = db.prepare("SELECT plan_status FROM billing_profiles WHERE company_id = ?").get(row.company_id);
      const hasPaidPlan = billing && billing.plan_status === "active";
      trial = {
        endsAt: company.trial_ends_at,
        daysRemaining,
        expired: now > trialEnd,
        active: now <= trialEnd || hasPaidPlan,
        hasPaidPlan,
      };
    }

    return res.json({
      id: row.id,
      email: row.email,
      companyId: row.company_id,
      role: row.role,
      disabled: !!row.disabled,
      memberSince: row.created_at,
      trial,
    });
  });

  // ── GET /api/trial/status ────────────────────────────────────────────
  app.get("/api/trial/status", requireAuth, (req, res) => {
    const companyId = req.session.companyId;
    const company = db.prepare("SELECT trial_ends_at FROM companies WHERE id = ?").get(companyId);
    if (!company?.trial_ends_at) {
      return res.json({ trial: null });
    }
    const now = new Date();
    const trialEnd = parseSqliteUtc(company.trial_ends_at);
    const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
    const billing = db.prepare("SELECT plan_status FROM billing_profiles WHERE company_id = ?").get(companyId);
    const hasPaidPlan = billing && billing.plan_status === "active";
    return res.json({
      trial: {
        endsAt: company.trial_ends_at,
        daysRemaining,
        expired: now > trialEnd,
        active: now <= trialEnd || hasPaidPlan,
        hasPaidPlan,
      },
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  //  OWNER PORTAL ROUTES
  // ══════════════════════════════════════════════════════════════════════

  // ── POST /api/owner/login ──────────────────────────────────────────
  app.post("/api/owner/login", authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    try {
      const bcrypt = require("bcrypt");
      const owner = db.prepare("SELECT * FROM platform_owners WHERE email = ?").get(email);
      if (!owner) return res.status(401).json({ error: "Invalid credentials." });

      const valid = await bcrypt.compare(password, owner.password_hash);
      if (!valid) {
        syslog.ownerLoginFailed(req, email);
        return res.status(401).json({ error: "Invalid credentials." });
      }

      // Regenerate session to prevent fixation
      req.session.regenerate((err) => {
        if (err) {
          logErr("session.regenerate (owner login)", err);
          return res.status(500).json({ error: "Login failed." });
        }
        req.session.ownerId = owner.id;
        req.session.ownerEmail = owner.email;
        syslog.ownerLogin(req, owner);
        return res.json({ id: owner.id, email: owner.email, name: owner.name });
      });
    } catch (err) {
      logErr("POST /api/owner/login", err);
      return res.status(500).json({ error: "Login failed." });
    }
  });

  // ── POST /api/owner/logout ─────────────────────────────────────────
  app.post("/api/owner/logout", (req, res) => {
    const oid = req.session?.ownerId;
    const oemail = oid ? (db.prepare("SELECT email FROM platform_owners WHERE id = ?").get(oid)?.email || null) : null;
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Logout failed." });
      if (oid) syslog.ownerLogout(req, oid, oemail);
      res.clearCookie("connect.sid");
      return res.json({ success: true });
    });
  });

  // ── GET /api/owner/me ──────────────────────────────────────────────
  app.get("/api/owner/me", requireOwner, (req, res) => {
    const owner = db.prepare("SELECT id, email, name, created_at FROM platform_owners WHERE id = ?").get(req.session.ownerId);
    if (!owner) return res.status(401).json({ error: "Owner not found." });
    return res.json(owner);
  });

  // ── GET /api/owner/dashboard ───────────────────────────────────────
  app.get("/api/owner/dashboard", requireOwner, (_req, res) => {
    try {
      const totalClients = db.prepare("SELECT COUNT(*) AS c FROM companies").get().c;
      const totalUsers = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
      const activeUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE disabled = 0").get().c;
      const totalProjects = db.prepare("SELECT COUNT(*) AS c FROM projects").get().c;
      const activeProjects = db.prepare("SELECT COUNT(*) AS c FROM projects WHERE status = 'active'").get().c;
      const totalRuns = db.prepare("SELECT COUNT(*) AS c FROM comparison_runs").get().c;

      // New clients this month
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const newClientsThisMonth = db.prepare(
        "SELECT COUNT(*) AS c FROM companies WHERE created_at >= ?"
      ).get(monthStart.toISOString()).c;

      // Runs this month
      const runsThisMonth = db.prepare(
        "SELECT COUNT(*) AS c FROM comparison_runs WHERE created_at >= ?"
      ).get(monthStart.toISOString()).c;

      // Revenue from billing_profiles + companies
      const revRow = db.prepare(`
        SELECT COALESCE(SUM(c.monthly_rate_cents), 0) AS total
        FROM companies c
        JOIN billing_profiles bp ON bp.company_id = c.id
        WHERE bp.plan != 'free' AND bp.plan_status = 'active' AND c.billing_enabled = 1
      `).get();
      const monthlyRevenueCents = revRow ? revRow.total : 0;

      const paidClients = db.prepare(`
        SELECT COUNT(*) AS c FROM billing_profiles WHERE plan != 'free' AND plan_status = 'active'
      `).get().c;

      // Client growth last 12 months
      const clientGrowth = db.prepare(`
        SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
        FROM companies
        WHERE created_at >= date('now', '-12 months')
        GROUP BY month ORDER BY month
      `).all();

      // Plan distribution
      const planDistribution = db.prepare(`
        SELECT COALESCE(bp.plan, 'free') AS plan, COUNT(*) AS count
        FROM companies c
        LEFT JOIN billing_profiles bp ON bp.company_id = c.id
        GROUP BY plan ORDER BY count DESC
      `).all();

      // Recent clients (top 10)
      const recentClients = db.prepare(`
        SELECT c.id, c.name, c.created_at,
          COALESCE(bp.plan, 'free') AS plan,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS userCount,
          (SELECT COUNT(*) FROM projects p WHERE p.company_id = c.id) AS projectCount,
          (SELECT COUNT(*) FROM comparison_runs cr WHERE cr.company_id = c.id) AS runCount
        FROM companies c
        LEFT JOIN billing_profiles bp ON bp.company_id = c.id
        ORDER BY c.created_at DESC LIMIT 10
      `).all();

      return res.json({
        totalClients, totalUsers, activeUsers, totalProjects, activeProjects,
        totalRuns, newClientsThisMonth, runsThisMonth, monthlyRevenueCents,
        paidClients, clientGrowth, planDistribution, recentClients,
      });
    } catch (err) {
      logErr("GET /api/owner/dashboard", err);
      return res.status(500).json({ error: "Failed to load dashboard data." });
    }
  });

  // ── GET /api/owner/clients ─────────────────────────────────────────
  app.get("/api/owner/clients", requireOwner, (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      const plan = (req.query.plan || "").trim();
      const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
      const offset = parseInt(req.query.offset, 10) || 0;

      let where = "1=1";
      const params = [];
      if (q) { where += " AND c.name LIKE ?"; params.push(`%${q}%`); }
      if (plan) { where += " AND COALESCE(bp.plan, 'free') = ?"; params.push(plan); }

      const totalRow = db.prepare(`
        SELECT COUNT(*) AS c FROM companies c
        LEFT JOIN billing_profiles bp ON bp.company_id = c.id
        WHERE ${where}
      `).get(...params);

      const clients = db.prepare(`
        SELECT c.*, COALESCE(bp.plan, 'free') AS plan, bp.plan_status,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS userCount,
          (SELECT COUNT(*) FROM projects p WHERE p.company_id = c.id) AS projectCount,
          (SELECT COUNT(*) FROM comparison_runs cr WHERE cr.company_id = c.id) AS runCount
        FROM companies c
        LEFT JOIN billing_profiles bp ON bp.company_id = c.id
        WHERE ${where}
        ORDER BY c.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      return res.json({ total: totalRow.c, clients });
    } catch (err) {
      logErr("GET /api/owner/clients", err);
      return res.status(500).json({ error: "Failed to load clients." });
    }
  });

  // ── GET /api/owner/clients/:id ─────────────────────────────────────
  app.get("/api/owner/clients/:id", requireOwner, (req, res) => {
    try {
      const cid = req.params.id;
      const company = db.prepare(`
        SELECT c.*, COALESCE(bp.plan, 'free') AS plan, bp.plan_status,
          bp.billing_email, bp.card_brand, bp.card_last4,
          bp.current_period_start, bp.current_period_end,
          bp.billing_address_line1, bp.billing_address_line2,
          bp.billing_city, bp.billing_state, bp.billing_zip, bp.billing_country,
          bp.card_exp_month, bp.card_exp_year
        FROM companies c
        LEFT JOIN billing_profiles bp ON bp.company_id = c.id
        WHERE c.id = ?
      `).get(cid);
      if (!company) return res.status(404).json({ error: "Client not found." });

      const users = db.prepare(
        "SELECT id, email, first_name, last_name, role, disabled, created_at FROM users WHERE company_id = ? ORDER BY created_at"
      ).all(cid);

      const projects = db.prepare(`
        SELECT p.id, p.name, p.product_name, p.status, p.created_at,
          (SELECT COUNT(*) FROM comparison_runs cr WHERE cr.project_id = p.id) AS runCount
        FROM projects p WHERE p.company_id = ? ORDER BY p.created_at DESC LIMIT 50
      `).all(cid);

      const recentRuns = db.prepare(`
        SELECT cr.id, cr.created_at, cr.total_file_a, cr.total_file_b,
          cr.matched, cr.only_in_a, cr.only_in_b, cr.field_diffs,
          p.name AS project_name
        FROM comparison_runs cr
        LEFT JOIN projects p ON p.id = cr.project_id
        WHERE cr.company_id = ? ORDER BY cr.created_at DESC LIMIT 20
      `).all(cid);

      const invoices = db.prepare(`
        SELECT id, stripe_invoice_id, amount_paid_cents, currency, status, created_at
        FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(cid);

      let activity = [];
      try {
        activity = db.prepare(`
          SELECT id, action, details, severity, timestamp, actor_email
          FROM system_log WHERE company_id = ? ORDER BY timestamp DESC LIMIT 30
        `).all(cid);
      } catch (_e) { /* system_log may not exist yet */ }

      const userCount = users.length;
      const projectCount = projects.length;
      const runCount = db.prepare("SELECT COUNT(*) AS c FROM comparison_runs WHERE company_id = ?").get(cid).c;

      return res.json({ ...company, users, projects, recentRuns, invoices, activity, userCount, projectCount, runCount });
    } catch (err) {
      logErr("GET /api/owner/clients/:id", err);
      return res.status(500).json({ error: "Failed to load client details." });
    }
  });

  // ── GET /api/owner/users ───────────────────────────────────────────
  app.get("/api/owner/users", requireOwner, (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      const role = (req.query.role || "").trim();
      const status = (req.query.status || "").trim();
      const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
      const offset = parseInt(req.query.offset, 10) || 0;

      let where = "1=1";
      const params = [];
      if (q) {
        where += " AND (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR c.name LIKE ?)";
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }
      if (role) { where += " AND u.role = ?"; params.push(role); }
      if (status === "active") { where += " AND u.disabled = 0"; }
      if (status === "disabled") { where += " AND u.disabled = 1"; }

      const totalRow = db.prepare(`
        SELECT COUNT(*) AS c FROM users u
        LEFT JOIN companies c ON c.id = u.company_id
        WHERE ${where}
      `).get(...params);

      const users = db.prepare(`
        SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.disabled, u.created_at,
          c.name AS company_name
        FROM users u
        LEFT JOIN companies c ON c.id = u.company_id
        WHERE ${where}
        ORDER BY u.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      return res.json({ total: totalRow.c, users });
    } catch (err) {
      logErr("GET /api/owner/users", err);
      return res.status(500).json({ error: "Failed to load users." });
    }
  });

  // ── PUT /api/owner/users/:id ───────────────────────────────────────
  app.put("/api/owner/users/:id", requireOwner, (req, res) => {
    try {
      const { disabled, role } = req.body || {};
      const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found." });

      const targetUser = db.prepare("SELECT email, role, disabled FROM users WHERE id = ?").get(req.params.id);
      const changes = {};
      if (disabled !== undefined) {
        db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, req.params.id);
        changes.disabled = !!disabled;
      }
      if (role && ['member', 'admin', 'superadmin'].includes(role)) {
        db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, req.params.id);
        changes.role = role;
      }

      syslog.ownerUserUpdated(req, req.params.id, targetUser?.email, changes, req.session.ownerId);
      return res.json({ success: true });
    } catch (err) {
      logErr("PUT /api/owner/users/:id", err);
      return res.status(500).json({ error: "Failed to update user." });
    }
  });

  // ── POST /api/owner/users ─────────────────────────────────────────
  // Owner creates a user in any company
  app.post("/api/owner/users", requireOwner, async (req, res) => {
    try {
      const { email, password, companyId, role, firstName, lastName } = req.body || {};
      if (!email || !password || !companyId) {
        return res.status(400).json({ error: "email, password, and companyId are required." });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
      }
      const validRoles = ["member", "admin", "superadmin"];
      const userRole = validRoles.includes(role) ? role : "member";

      // Check company exists
      const company = db.prepare("SELECT id, name FROM companies WHERE id = ?").get(companyId);
      if (!company) return res.status(404).json({ error: "Company not found." });

      // Check email uniqueness
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
      if (existing) return res.status(409).json({ error: "A user with that email already exists." });

      const bcrypt = require("bcrypt");
      const crypto = require("crypto");
      const id = crypto.randomUUID();
      const hash = await bcrypt.hash(password, 12);

      db.prepare(
        `INSERT INTO users (id, email, password_hash, company_id, role, first_name, last_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, email.toLowerCase().trim(), hash, companyId, userRole, firstName || null, lastName || null);

      syslog.raw({
        category: "owner", action: "owner.user_created", severity: "info",
        actorId: req.session.ownerId, actorType: "owner",
        details: `Owner created user ${email} in company ${company.name} with role ${userRole}`,
        companyId, companyName: company.name,
        ...require("./systemLogger").reqMeta(req),
      });

      return res.status(201).json({ id, email: email.toLowerCase().trim(), companyId, role: userRole });
    } catch (err) {
      console.error("[ERR] POST /api/owner/users:", err.message);
      return res.status(500).json({ error: err.message || "Failed to create user." });
    }
  });

  // ── POST /api/owner/users/:id/reset-password ──────────────────────
  // Owner resets a user's password
  app.post("/api/owner/users/:id/reset-password", requireOwner, async (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
      }

      const user = db.prepare("SELECT id, email FROM users WHERE id = ?").get(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found." });

      const bcrypt = require("bcrypt");
      const hash = await bcrypt.hash(password, 12);
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.params.id);

      syslog.raw({
        category: "owner", action: "owner.password_reset", severity: "warn",
        actorId: req.session.ownerId, actorType: "owner",
        details: `Owner reset password for user ${user.email}`,
        ...require("./systemLogger").reqMeta(req),
      });

      return res.json({ success: true });
    } catch (err) {
      logErr("POST /api/owner/users/:id/reset-password", err);
      return res.status(500).json({ error: "Failed to reset password." });
    }
  });

  // ── GET /api/owner/activity ────────────────────────────────────────
  app.get("/api/owner/activity", requireOwner, (req, res) => {
    try {
      const category = (req.query.category || "").trim();
      const severity = (req.query.severity || "").trim();
      const action = (req.query.action || "").trim();
      const q = (req.query.q || "").trim();
      const companyId = (req.query.companyId || "").trim();
      const actorType = (req.query.actorType || "").trim();
      const dateFrom = (req.query.dateFrom || "").trim();
      const dateTo = (req.query.dateTo || "").trim();
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
      const offset = parseInt(req.query.offset, 10) || 0;

      let where = "1=1";
      const params = [];

      if (category) { where += " AND sl.category = ?"; params.push(category); }
      if (severity) { where += " AND sl.severity = ?"; params.push(severity); }
      if (action) { where += " AND sl.action LIKE ?"; params.push(`%${action}%`); }
      if (q) {
        where += " AND (sl.details LIKE ? OR sl.actor_email LIKE ? OR sl.company_name LIKE ? OR sl.action LIKE ?)";
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }
      if (companyId) { where += " AND sl.company_id = ?"; params.push(companyId); }
      if (actorType) { where += " AND sl.actor_type = ?"; params.push(actorType); }
      if (dateFrom) { where += " AND DATE(sl.timestamp) >= ?"; params.push(dateFrom); }
      if (dateTo) { where += " AND DATE(sl.timestamp) <= ?"; params.push(dateTo); }

      const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM system_log sl WHERE ${where}`).get(...params);

      const rows = db.prepare(`
        SELECT sl.* FROM system_log sl
        WHERE ${where}
        ORDER BY sl.timestamp DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      // Parse meta_json for each row
      const entries = rows.map(r => ({
        ...r,
        meta: r.meta_json ? JSON.parse(r.meta_json) : null,
        meta_json: undefined,
      }));

      // Get available filter options
      const categories = db.prepare("SELECT DISTINCT category FROM system_log ORDER BY category").all().map(r => r.category);
      const severities = db.prepare("SELECT DISTINCT severity FROM system_log ORDER BY severity").all().map(r => r.severity);
      const actions = db.prepare("SELECT DISTINCT action FROM system_log ORDER BY action").all().map(r => r.action);

      return res.json({
        total: totalRow.c,
        limit,
        offset,
        entries,
        filters: { categories, severities, actions },
      });
    } catch (err) {
      logErr("GET /api/owner/activity", err);
      return res.status(500).json({ error: "Failed to load activity." });
    }
  });

  // ── GET /api/owner/activity/stats ──────────────────────────────────
  app.get("/api/owner/activity/stats", requireOwner, (_req, res) => {
    try {
      const total = db.prepare("SELECT COUNT(*) AS c FROM system_log").get().c;
      const today = db.prepare("SELECT COUNT(*) AS c FROM system_log WHERE DATE(timestamp) = DATE('now')").get().c;
      const thisWeek = db.prepare("SELECT COUNT(*) AS c FROM system_log WHERE timestamp >= datetime('now', '-7 days')").get().c;
      const warnings = db.prepare("SELECT COUNT(*) AS c FROM system_log WHERE severity IN ('warning','error','critical')").get().c;
      const byCategory = db.prepare("SELECT category, COUNT(*) AS count FROM system_log GROUP BY category ORDER BY count DESC").all();
      const bySeverity = db.prepare("SELECT severity, COUNT(*) AS count FROM system_log GROUP BY severity ORDER BY count DESC").all();
      const recentByHour = db.prepare(`
        SELECT strftime('%Y-%m-%dT%H:00', timestamp) AS hour, COUNT(*) AS count
        FROM system_log WHERE timestamp >= datetime('now', '-24 hours')
        GROUP BY hour ORDER BY hour
      `).all();

      return res.json({ total, today, thisWeek, warnings, byCategory, bySeverity, recentByHour });
    } catch (err) {
      logErr("GET /api/owner/activity/stats", err);
      return res.status(500).json({ error: "Failed to load activity stats." });
    }
  });

  // ── GET /api/owner/activity/export ─────────────────────────────────
  app.get("/api/owner/activity/export", requireOwner, (req, res) => {
    try {
      const dateFrom = (req.query.dateFrom || "").trim();
      const dateTo = (req.query.dateTo || "").trim();
      const category = (req.query.category || "").trim();
      const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 10000);

      let where = "1=1";
      const params = [];
      if (dateFrom) { where += " AND DATE(timestamp) >= ?"; params.push(dateFrom); }
      if (dateTo) { where += " AND DATE(timestamp) <= ?"; params.push(dateTo); }
      if (category) { where += " AND category = ?"; params.push(category); }

      const rows = db.prepare(`SELECT * FROM system_log WHERE ${where} ORDER BY timestamp DESC LIMIT ?`).all(...params, limit);

      const headers = ["timestamp", "category", "action", "severity", "actor_email", "actor_type", "company_name", "resource_type", "resource_id", "ip_address", "details"];
      const csvRows = [headers.join(",")];
      for (const r of rows) {
        const vals = headers.map(h => {
          const v = r[h] == null ? "" : String(r[h]);
          return '"' + v.replace(/"/g, '""') + '"';
        });
        csvRows.push(vals.join(","));
      }

      const csv = csvRows.join("\n");
      const filename = `system-log-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (err) {
      logErr("GET /api/owner/activity/export", err);
      return res.status(500).json({ error: "Failed to export activity." });
    }
  });

  // ── GET /api/owner/integrations ────────────────────────────────────
  app.get("/api/owner/integrations", requireOwner, (_req, res) => {
    const keys = [
      "sendgrid_api_key", "sendgrid_from_email", "sendgrid_from_name",
      "sendgrid_reply_to", "sendgrid_rate_limit",
      "llm_provider", "llm_api_key", "llm_model", "llm_max_tokens",
      "llm_temperature", "llm_enabled",
    ];
    const result = {};
    for (const k of keys) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(k);
      result[k] = row ? row.value : "";
    }
    // Mask API keys for security — only show last 6 characters
    if (result.sendgrid_api_key) {
      result.sendgrid_api_key = "••••••••" + result.sendgrid_api_key.slice(-6);
    }
    if (result.llm_api_key) {
      result.llm_api_key = "••••••••" + result.llm_api_key.slice(-6);
    }
    return res.json(result);
  });

  // ── PUT /api/owner/integrations ────────────────────────────────────
  app.put("/api/owner/integrations", requireOwner, (req, res) => {
    const allowed = [
      "sendgrid_api_key", "sendgrid_from_email", "sendgrid_from_name",
      "sendgrid_reply_to", "sendgrid_rate_limit",
      "llm_provider", "llm_api_key", "llm_model", "llm_max_tokens",
      "llm_temperature", "llm_enabled",
    ];
    const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    const del = db.prepare("DELETE FROM settings WHERE key = ?");

    const updates = {};
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      const val = String(req.body[k]).trim();
      // If value starts with masked prefix, skip (user didn't change it)
      if ((k === "sendgrid_api_key" || k === "llm_api_key") && val.startsWith("••••••••")) continue;
      if (val === "") {
        del.run(k);
      } else {
        upsert.run(k, val);
      }
      updates[k] = k.includes("api_key") ? "(updated)" : val;
    }

    syslog.raw({
      category: "owner", action: "owner.integrations_updated", actorId: req.session.ownerId,
      actorEmail: req.session.ownerEmail, actorType: "owner",
      details: `Integration settings updated: ${Object.keys(updates).join(", ")}`,
      meta: updates,
      ...require("./systemLogger").reqMeta(req),
    });

    return res.json({ success: true, updated: Object.keys(updates) });
  });

  // ── POST /api/owner/integrations/test-sendgrid ─────────────────────
  app.post("/api/owner/integrations/test-sendgrid", requireOwner, async (_req, res) => {
    try {
      const apiKey = (db.prepare("SELECT value FROM settings WHERE key = ?").get("sendgrid_api_key") || {}).value;
      const fromEmail = (db.prepare("SELECT value FROM settings WHERE key = ?").get("sendgrid_from_email") || {}).value;
      if (!apiKey || !fromEmail) {
        return res.json({ success: false, message: "API key and From email are required." });
      }
      // Simple validation: call SendGrid API to verify key
      const resp = await fetch("https://api.sendgrid.com/v3/scopes", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const hasMail = data.scopes && data.scopes.includes("mail.send");
        return res.json({
          success: true,
          message: hasMail
            ? `Connected! API key is valid with mail.send permission. (${data.scopes.length} scopes)`
            : `API key is valid but may lack mail.send permission. Scopes: ${(data.scopes || []).slice(0, 5).join(", ")}`,
        });
      } else {
        return res.json({ success: false, message: `SendGrid returned ${resp.status}: Invalid API key.` });
      }
    } catch (err) {
      logErr("POST /api/owner/integrations/test-sendgrid", err);
      return res.json({ success: false, message: `Connection failed: ${err.message}` });
    }
  });

  // ── POST /api/owner/integrations/test-llm ──────────────────────────
  app.post("/api/owner/integrations/test-llm", requireOwner, async (_req, res) => {
    try {
      const get = (k) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) || {}).value || null;
      const provider = get("llm_provider") || "anthropic";
      const apiKey = get("llm_api_key");
      if (!apiKey) {
        return res.json({ success: false, message: `${provider === "openai" ? "OpenAI" : "Anthropic"} API key is required.` });
      }
      const defaultModel = provider === "openai" ? "gpt-4o-mini" : "claude-3-haiku-20240307";
      const model = get("llm_model") || defaultModel;

      if (provider === "openai") {
        // ── OpenAI test ────────────────────────
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            max_tokens: 16,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const text = data.choices?.[0]?.message?.content || "";
          return res.json({ success: true, message: `Connected! Model: ${data.model}. Response: "${text.substring(0, 50)}"` });
        } else {
          const err = await resp.json().catch(() => ({}));
          return res.json({ success: false, message: `OpenAI returned ${resp.status}: ${err.error?.message || "Invalid API key."}` });
        }
      } else {
        // ── Anthropic test ─────────────────────
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 16,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const text = (data.content && data.content[0] && data.content[0].text) || "";
          return res.json({ success: true, message: `Connected! Model: ${data.model}. Response: "${text.substring(0, 50)}"` });
        } else {
          const err = await resp.json().catch(() => ({}));
          return res.json({ success: false, message: `Anthropic returned ${resp.status}: ${err.error?.message || "Invalid API key."}` });
        }
      }
    } catch (err) {
      logErr("POST /api/owner/integrations/test-llm", err);
      return res.json({ success: false, message: `Connection failed: ${err.message}` });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  OWNER BILLING ROUTES
  // ══════════════════════════════════════════════════════════════════════

  // ── GET /api/owner/billing/config ──────────────────────────────────
  // Returns Stripe configuration (keys masked)
  app.get("/api/owner/billing/config", requireOwner, (_req, res) => {
    try {
      const get = (k) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) || {}).value || "";
      const apiKey = get("stripe_api_key");
      const webhookSecret = get("stripe_webhook_secret");
      return res.json({
        stripe_api_key: apiKey ? "••••••••" + apiKey.slice(-8) : "",
        stripe_webhook_secret: webhookSecret ? "••••••••" + webhookSecret.slice(-6) : "",
        configured: !!(apiKey),
      });
    } catch (err) {
      logErr("GET /api/owner/billing/config", err);
      return res.status(500).json({ error: "Failed to load billing config." });
    }
  });

  // ── PUT /api/owner/billing/config ──────────────────────────────────
  // Save Stripe API key and webhook secret
  app.put("/api/owner/billing/config", requireOwner, (req, res) => {
    try {
      const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      const del = db.prepare("DELETE FROM settings WHERE key = ?");
      const updated = [];

      for (const k of ["stripe_api_key", "stripe_webhook_secret"]) {
        if (req.body[k] === undefined) continue;
        const val = String(req.body[k]).trim();
        if (val.startsWith("••••••••")) continue; // masked = unchanged
        if (val === "") { del.run(k); } else { upsert.run(k, val); }
        updated.push(k);
      }

      syslog.raw({
        category: "owner", action: "owner.billing_config_updated", actorId: req.session.ownerId,
        actorType: "owner", details: `Stripe config updated: ${updated.join(", ") || "none"}`,
        ...require("./systemLogger").reqMeta(req),
      });

      return res.json({ success: true, updated });
    } catch (err) {
      logErr("PUT /api/owner/billing/config", err);
      return res.status(500).json({ error: "Failed to save billing config." });
    }
  });

  // ── POST /api/owner/billing/test-stripe ────────────────────────────
  // Verify the Stripe API key by fetching account info
  app.post("/api/owner/billing/test-stripe", requireOwner, async (_req, res) => {
    try {
      const apiKey = (db.prepare("SELECT value FROM settings WHERE key = ?").get("stripe_api_key") || {}).value;
      if (!apiKey) return res.json({ success: false, message: "Stripe API key not configured." });

      const resp = await fetch("https://api.stripe.com/v1/account", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (resp.ok) {
        const acct = await resp.json();
        return res.json({
          success: true,
          message: `Connected! Account: ${acct.settings?.dashboard?.display_name || acct.id} (${acct.country || "?"})`,
        });
      } else {
        const err = await resp.json().catch(() => ({}));
        return res.json({ success: false, message: `Stripe returned ${resp.status}: ${err.error?.message || "Invalid API key."}` });
      }
    } catch (err) {
      logErr("POST /api/owner/billing/test-stripe", err);
      return res.json({ success: false, message: `Connection failed: ${err.message}` });
    }
  });

  // ── GET /api/owner/billing/defaults ────────────────────────────────
  // Default pricing config for new clients
  app.get("/api/owner/billing/defaults", requireOwner, (_req, res) => {
    try {
      const get = (k) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) || {}).value || "";
      return res.json({
        default_monthly_rate_cents: parseInt(get("default_monthly_rate_cents"), 10) || 0,
        default_annual_rate_cents: parseInt(get("default_annual_rate_cents"), 10) || 0,
        default_currency: get("default_currency") || "usd",
        default_trial_days: parseInt(get("default_trial_days"), 10) || 0,
      });
    } catch (err) {
      logErr("GET /api/owner/billing/defaults", err);
      return res.status(500).json({ error: "Failed to load billing defaults." });
    }
  });

  // ── PUT /api/owner/billing/defaults ────────────────────────────────
  app.put("/api/owner/billing/defaults", requireOwner, (req, res) => {
    try {
      const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      const fields = ["default_monthly_rate_cents", "default_annual_rate_cents", "default_currency", "default_trial_days"];
      for (const k of fields) {
        if (req.body[k] !== undefined) upsert.run(k, String(req.body[k]));
      }

      syslog.raw({
        category: "owner", action: "owner.billing_defaults_updated", actorId: req.session.ownerId,
        actorType: "owner", details: "Default billing configuration updated",
        ...require("./systemLogger").reqMeta(req),
      });

      return res.json({ success: true });
    } catch (err) {
      logErr("PUT /api/owner/billing/defaults", err);
      return res.status(500).json({ error: "Failed to save billing defaults." });
    }
  });

  // ── PUT /api/owner/clients/:id/billing ─────────────────────────────
  // Update a client's plan, rates, and billing status
  app.put("/api/owner/clients/:id/billing", requireOwner, (req, res) => {
    try {
      const companyId = req.params.id;
      const company = db.prepare("SELECT id FROM companies WHERE id = ?").get(companyId);
      if (!company) return res.status(404).json({ error: "Client not found." });

      const { plan, planStatus, monthlyRateCents, annualRateCents, billingEnabled, currency } = req.body || {};

      // Upsert billing profile
      let bp = db.prepare("SELECT id FROM billing_profiles WHERE company_id = ?").get(companyId);
      if (!bp) {
        const id = require("crypto").randomUUID();
        db.prepare("INSERT INTO billing_profiles (id, company_id) VALUES (?, ?)").run(id, companyId);
      }

      if (plan) db.prepare("UPDATE billing_profiles SET plan = ? WHERE company_id = ?").run(plan, companyId);
      if (planStatus) db.prepare("UPDATE billing_profiles SET plan_status = ? WHERE company_id = ?").run(planStatus, companyId);

      // Update company-level billing fields
      const updates = [];
      if (monthlyRateCents !== undefined) updates.push({ sql: "monthly_rate_cents = ?", val: monthlyRateCents });
      if (annualRateCents !== undefined) updates.push({ sql: "annual_rate_cents = ?", val: annualRateCents });
      if (billingEnabled !== undefined) updates.push({ sql: "billing_enabled = ?", val: billingEnabled ? 1 : 0 });
      if (currency) updates.push({ sql: "currency = ?", val: currency });
      if (updates.length > 0) {
        const sql = `UPDATE companies SET ${updates.map(u => u.sql).join(", ")} WHERE id = ?`;
        db.prepare(sql).run(...updates.map(u => u.val), companyId);
      }

      const companyName = (db.prepare("SELECT name FROM companies WHERE id = ?").get(companyId) || {}).name;
      syslog.raw({
        category: "owner", action: "owner.client_billing_updated", actorId: req.session.ownerId,
        actorType: "owner", companyId, companyName,
        details: `Billing updated: plan=${plan || "-"}, status=${planStatus || "-"}, rate=${monthlyRateCents || "-"}¢/mo`,
        ...require("./systemLogger").reqMeta(req),
      });

      return res.json({ success: true });
    } catch (err) {
      logErr("PUT /api/owner/clients/:id/billing", err);
      return res.status(500).json({ error: "Failed to update client billing." });
    }
  });

  // ── PUT /api/owner/clients/:id/trial ──────────────────────────────
  // Extend, reset, or remove a client's trial period
  app.put("/api/owner/clients/:id/trial", requireOwner, (req, res) => {
    try {
      const companyId = req.params.id;
      const company = db.prepare("SELECT id, name FROM companies WHERE id = ?").get(companyId);
      if (!company) return res.status(404).json({ error: "Client not found." });

      const { action, days } = req.body || {};

      if (action === "extend") {
        // Extend trial by N days from now (default 7)
        const d = Math.max(1, Math.min(parseInt(days, 10) || 7, 90));
        db.prepare(
          "UPDATE companies SET trial_ends_at = datetime('now', '+' || ? || ' days') WHERE id = ?"
        ).run(d, companyId);
        syslog.raw({
          category: "owner", action: "owner.trial_extended", actorId: req.session.ownerId,
          actorType: "owner", companyId, companyName: company.name,
          details: `Trial extended by ${d} days`,
          ...require("./systemLogger").reqMeta(req),
        });
        return res.json({ success: true, message: `Trial extended by ${d} days.` });
      }

      if (action === "remove") {
        // Remove trial restriction (unlimited access)
        db.prepare("UPDATE companies SET trial_ends_at = NULL WHERE id = ?").run(companyId);
        syslog.raw({
          category: "owner", action: "owner.trial_removed", actorId: req.session.ownerId,
          actorType: "owner", companyId, companyName: company.name,
          details: "Trial restriction removed",
          ...require("./systemLogger").reqMeta(req),
        });
        return res.json({ success: true, message: "Trial restriction removed." });
      }

      return res.status(400).json({ error: "Invalid action. Use 'extend' or 'remove'." });
    } catch (err) {
      logErr("PUT /api/owner/clients/:id/trial", err);
      return res.status(500).json({ error: "Failed to update trial." });
    }
  });

  // ── PUT /api/owner/clients/:id/status ─────────────────────────────
  // Enable or disable a company (account)
  app.put("/api/owner/clients/:id/status", requireOwner, (req, res) => {
    try {
      const companyId = req.params.id;
      const company = db.prepare("SELECT id, name FROM companies WHERE id = ?").get(companyId);
      if (!company) return res.status(404).json({ error: "Client not found." });

      const { disabled } = req.body || {};
      if (disabled === undefined) return res.status(400).json({ error: "'disabled' field is required." });

      db.prepare("UPDATE companies SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, companyId);

      // If disabling, also destroy all active sessions for users in this company
      if (disabled) {
        const users = db.prepare("SELECT id FROM users WHERE company_id = ?").all(companyId);
        for (const u of users) {
          db.prepare("DELETE FROM sessions WHERE sess LIKE ?").run(`%"userId":"${u.id}"%`);
        }
      }

      syslog.raw({
        category: "owner", action: disabled ? "owner.client_disabled" : "owner.client_enabled",
        actorId: req.session.ownerId, actorType: "owner",
        companyId, companyName: company.name,
        details: disabled ? `Company "${company.name}" disabled` : `Company "${company.name}" enabled`,
        ...require("./systemLogger").reqMeta(req),
      });

      return res.json({ success: true, disabled: !!disabled });
    } catch (err) {
      logErr("PUT /api/owner/clients/:id/status", err);
      return res.status(500).json({ error: "Failed to update company status." });
    }
  });

  // ── GET /api/owner/billing/invoices ────────────────────────────────
  // List all invoices across clients
  app.get("/api/owner/billing/invoices", requireOwner, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const companyId = (req.query.companyId || "").trim();

      let where = "1=1";
      const params = [];
      if (companyId) { where += " AND i.company_id = ?"; params.push(companyId); }

      const total = db.prepare(`SELECT COUNT(*) AS c FROM invoices i WHERE ${where}`).get(...params).c;
      const invoices = db.prepare(`
        SELECT i.*, c.name AS company_name
        FROM invoices i
        LEFT JOIN companies c ON c.id = i.company_id
        WHERE ${where}
        ORDER BY i.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      return res.json({ total, invoices });
    } catch (err) {
      logErr("GET /api/owner/billing/invoices", err);
      return res.status(500).json({ error: "Failed to load invoices." });
    }
  });

  // ── GET /api/owner/billing/summary ─────────────────────────────────
  // Revenue and subscription summary KPIs
  app.get("/api/owner/billing/summary", requireOwner, (_req, res) => {
    try {
      const totalClients = db.prepare("SELECT COUNT(*) AS c FROM companies").get().c;

      const paidClients = db.prepare(`
        SELECT COUNT(*) AS c FROM billing_profiles WHERE plan != 'free' AND plan_status = 'active'
      `).get().c;

      const freeClients = totalClients - paidClients;

      const revRow = db.prepare(`
        SELECT COALESCE(SUM(c.monthly_rate_cents), 0) AS total
        FROM companies c
        JOIN billing_profiles bp ON bp.company_id = c.id
        WHERE bp.plan != 'free' AND bp.plan_status = 'active' AND c.billing_enabled = 1
      `).get();
      const mrr = revRow ? revRow.total : 0;

      const arr = mrr * 12;

      const pastDue = db.prepare(`
        SELECT COUNT(*) AS c FROM billing_profiles WHERE plan_status = 'past_due'
      `).get().c;

      const canceled = db.prepare(`
        SELECT COUNT(*) AS c FROM billing_profiles WHERE plan_status = 'canceled'
      `).get().c;

      const planBreakdown = db.prepare(`
        SELECT COALESCE(bp.plan, 'free') AS plan, COUNT(*) AS count
        FROM companies c
        LEFT JOIN billing_profiles bp ON bp.company_id = c.id
        GROUP BY plan ORDER BY count DESC
      `).all();

      // Recent invoices (last 10)
      const recentInvoices = db.prepare(`
        SELECT i.*, c.name AS company_name
        FROM invoices i
        LEFT JOIN companies c ON c.id = i.company_id
        ORDER BY i.created_at DESC LIMIT 10
      `).all();

      // Monthly revenue trend (last 12 months)
      const revenueTrend = db.prepare(`
        SELECT strftime('%Y-%m', i.created_at) AS month, 
          SUM(i.amount_paid_cents) AS revenue_cents,
          COUNT(*) AS invoice_count
        FROM invoices i
        WHERE i.created_at >= date('now', '-12 months')
        GROUP BY month ORDER BY month
      `).all();

      return res.json({
        totalClients, paidClients, freeClients, mrr, arr,
        pastDue, canceled, planBreakdown, recentInvoices, revenueTrend,
      });
    } catch (err) {
      logErr("GET /api/owner/billing/summary", err);
      return res.status(500).json({ error: "Failed to load billing summary." });
    }
  });

  // ── GET /api/owner/health ───────────────────────────────────────────
  // Lightweight platform health snapshot for the Owner Portal.
  app.get("/api/owner/health", requireOwner, (_req, res) => {
    try {
      const get = (k) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) || {}).value || "";

      let dbOk = true;
      try { db.prepare("SELECT 1 AS ok").get(); } catch { dbOk = false; }

      const sendgridConfigured = !!(get("sendgrid_api_key") && get("sendgrid_from_email"));
      const llmConfigured = !!(get("llm_api_key") && get("llm_enabled") !== "false");
      const stripeConfigured = !!get("stripe_api_key");
      const stripeWebhookConfigured = !!get("stripe_webhook_secret");

      return res.json({
        db: { ok: dbOk },
        integrations: {
          sendgrid: { configured: sendgridConfigured },
          llm: { configured: llmConfigured, provider: get("llm_provider") || "anthropic" },
          stripe: { configured: stripeConfigured, webhookConfigured: stripeWebhookConfigured },
        },
      });
    } catch (err) {
      logErr("GET /api/owner/health", err);
      return res.status(500).json({ error: "Failed to load health." });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  PROTECTED ROUTES (require authentication + company scoping)
  // ══════════════════════════════════════════════════════════════════════

  // ── POST /api/compare ─────────────────────────────────────────────────
  // Expects two files: field names "licenses" and "adUsers"
  app.post(
    "/api/compare",
    requireAuth,
    loadCompany,
    compareLimiter,
    async (req, res, next) => {
      const handler = upload.fields([
        { name: "licenses", maxCount: 1 },
        { name: "adUsers", maxCount: 1 },
      ]);
      try {
        await new Promise((resolve, reject) => {
          handler(req, res, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        next();
      } catch (err) {
        logErr("POST /api/compare (upload)", err);
        return res.status(400).json({ error: err.message || "File upload error." });
      }
    },
    (req, res) => {
      const licensesFile = req.files?.licenses?.[0];
      const adUsersFile = req.files?.adUsers?.[0];
      const projectId = req.body?.projectId; // Extract projectId

      if (!licensesFile || !adUsersFile) {
        return res.status(400).json({
          error: "Both files are required: 'licenses' (software licenses CSV) and 'adUsers' (Active Directory users CSV).",
        });
      }

      try {
        // Block uploads to completed/archived projects
        let verifiedProjectId = null;
        if (projectId) {
          const proj = db.prepare("SELECT id, status FROM projects WHERE id = ? AND company_id = ?").get(projectId, req.companyId);
          if (!proj) {
            return res.status(404).json({ error: "Project not found." });
          }
          verifiedProjectId = proj.id;
          if (proj.status !== 'active') {
            return res.status(403).json({ error: `Cannot upload to a ${proj.status} project.` });
          }
        }

        const csvA = licensesFile.buffer.toString("utf-8");
        const csvB = adUsersFile.buffer.toString("utf-8");

        // Run comparison
        const report = compareUsers(csvA, csvB);

        // Persist to DB, scoped to the user's company
        const runId = saveComparisonRun(db, report, { 
          companyId: req.companyId,
          projectId: verifiedProjectId, // verified ownership + status
        });
        extractAndSaveInactiveUsers(db, runId, report);

        // Auto-mark project as completed after a successful run
        if (verifiedProjectId) {
          db.prepare("UPDATE projects SET status = 'completed' WHERE id = ? AND company_id = ? AND status = 'active'").run(verifiedProjectId, req.companyId);
        }

        const actor = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
        syslog.comparisonRun(req, runId, projectId, report, { id: req.session.userId, email: actor?.email });

        return res.json({ runId, report });
      } catch (err) {
        logErr("POST /api/compare", err);
        return res.status(422).json({ error: `Failed to process CSV files: ${err.message}` });
      }
    }
  );

  // ── GET /api/runs/:id ────────────────────────────────────────────────
  app.get("/api/runs/:id", requireAuth, loadCompany, (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });
    return res.json(run);
  });

  // ── POST /api/runs/:id/verify ──────────────────────────────────────
  // Sends verification emails to all inactive users for a comparison run.
  app.post("/api/runs/:id/verify", requireAuth, loadCompany, async (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });

    // Never trust a client-provided base URL for email links.
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    try {
      const result = await sendVerificationEmails({
        db,
        runId: req.params.id,
        baseUrl,
        emailSender,
      });
      const actor = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
      syslog.verificationSent(req, req.params.id, result.sent, result.failed, { id: req.session.userId, email: actor?.email });
      return res.json(result);
    } catch (err) {
      logErr("POST /api/runs/:id/verify", err);
      return res.status(500).json({ error: `Failed to send verification emails: ${err.message}` });
    }
  });

  // ── POST /api/confirm ──────────────────────────────────────────────
  // Records a yes/no response from a user's confirmation link.
  // This route is PUBLIC – accessed by email recipients via unique tokens.
  app.post("/api/confirm", confirmLimiter, (req, res) => {
    const { token, response } = req.body || {};

    if (!token || !response) {
      return res.status(400).json({ error: "Both 'token' and 'response' are required." });
    }
    if (response !== "yes" && response !== "no") {
      return res.status(400).json({ error: "Response must be 'yes' or 'no'." });
    }

    const result = recordResponse(db, token, response, {
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });

    if (!result.found) {
      return res.status(404).json({ error: "Confirmation token not found." });
    }
    if (result.expired) {
      return res.status(400).json({ error: "Confirmation token expired. Please request a new verification email." });
    }

    if (!result.alreadyResponded) {
      syslog.verificationResponse(req, token, response, result.userKey, result.email);
    }

    return res.json({
      recorded: !result.alreadyResponded,
      alreadyResponded: result.alreadyResponded,
      response,
      userId: result.userId,
      userKey: result.userKey,
      email: result.email,
      auditStatus: result.auditStatus,
    });
  });

  // ── GET /api/runs/:id/responses ────────────────────────────────────
  // Returns a summary of all verification responses for a run.
  app.get("/api/runs/:id/responses", requireAuth, loadCompany, (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });

    const summary = getResponseSummary(db, req.params.id);
    return res.json(summary);
  });

  // ── GET /api/runs/:id/audit ──────────────────────────────────────
  // Returns the chronological audit log for a run.
  app.get("/api/runs/:id/audit", requireAuth, loadCompany, (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });

    const log = getAuditLog(db, req.params.id);
    return res.json({ runId: req.params.id, entries: log });
  });

  // ── GET /api/runs/:id/audit/results ────────────────────────────────
  // Returns the per-user audit status view for a run.
  app.get("/api/runs/:id/audit/results", requireAuth, loadCompany, (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });

    const results = getAuditResults(db, req.params.id);
    const confirmed = results.filter((r) => r.audit_status === "confirmed").length;
    const revoked = results.filter((r) => r.audit_status === "revoked").length;
    const pending = results.filter((r) => r.audit_status === "pending").length;

    return res.json({
      runId: req.params.id,
      total: results.length,
      confirmed,
      revoked,
      pending,
      users: results,
    });
  });

  // ── GET /api/dashboard/overview ──────────────────────────────────────
  // Aggregated dashboard KPIs across all runs/projects
  // Supports query params: projectId, status (confirmed|revoked|pending), dateFrom, dateTo
  app.get("/api/dashboard/overview", requireAuth, loadCompany, (req, res) => {
    try {
      const filterProjectId = req.query.projectId || null;
      const filterStatus = req.query.status || null; // confirmed, revoked, pending
      const filterDateFrom = req.query.dateFrom || null;
      const filterDateTo = req.query.dateTo || null;

      let runs = filterProjectId
        ? listComparisonRuns(db, { companyId: req.companyId, projectId: filterProjectId })
        : listComparisonRuns(db, { companyId: req.companyId });

      // Date filtering on runs
      if (filterDateFrom) {
        runs = runs.filter(r => r.created_at >= filterDateFrom);
      }
      if (filterDateTo) {
        runs = runs.filter(r => r.created_at <= filterDateTo + 'T23:59:59');
      }

      // Load project list for filter dropdown
      const projectsList = db.prepare(
        `SELECT id, name, status FROM projects WHERE company_id = ? ORDER BY name`
      ).all(req.companyId);

      const projectCount = db.prepare(
        `SELECT COUNT(*) AS cnt FROM projects WHERE company_id = ?`
      ).get(req.companyId)?.cnt || 0;

      let totalFlagged = 0, totalConfirmed = 0, totalRevoked = 0, totalPending = 0;
      const monthlyData = {};
      const recentRuns = [];

      for (const run of runs) {
        const results = getAuditResults(db, run.id);
        const confirmed = results.filter(r => r.audit_status === "confirmed").length;
        const revoked = results.filter(r => r.audit_status === "revoked").length;
        const pending = results.filter(r => r.audit_status === "pending").length;
        totalFlagged += results.length;
        totalConfirmed += confirmed;
        totalRevoked += revoked;
        totalPending += pending;

        // Aggregate by month for trend chart
        const month = (run.created_at || "").substring(0, 7); // YYYY-MM
        if (month) {
          if (!monthlyData[month]) monthlyData[month] = { runs: 0, flagged: 0, confirmed: 0, revoked: 0 };
          monthlyData[month].runs += 1;
          monthlyData[month].flagged += results.length;
          monthlyData[month].confirmed += confirmed;
          monthlyData[month].revoked += revoked;
        }

        if (recentRuns.length < 10) {
          // Resolve project name for display
          const proj = run.project_id ? projectsList.find(p => p.id === run.project_id) : null;
          recentRuns.push({
            id: run.id,
            created_at: run.created_at,
            project_id: run.project_id,
            project_name: proj ? proj.name : null,
            totalFlagged: results.length,
            confirmed,
            revoked,
            pending,
          });
        }
      }

      // Apply status filter to KPI totals display
      let displayFlagged = totalFlagged, displayConfirmed = totalConfirmed, displayRevoked = totalRevoked, displayPending = totalPending;
      if (filterStatus === 'confirmed') {
        displayRevoked = 0; displayPending = 0;
      } else if (filterStatus === 'revoked') {
        displayConfirmed = 0; displayPending = 0;
      } else if (filterStatus === 'pending') {
        displayConfirmed = 0; displayRevoked = 0;
      }

      const responseRate = totalFlagged > 0
        ? (((totalConfirmed + totalRevoked) / totalFlagged) * 100).toFixed(1)
        : "0.0";

      // Build sorted monthly trend array (last 12 months)
      const sortedMonths = Object.keys(monthlyData).sort().slice(-12);
      const trends = sortedMonths.map(m => ({ month: m, ...monthlyData[m] }));

      return res.json({
        kpis: {
          totalProjects: projectCount,
          totalRuns: runs.length,
          totalFlagged: displayFlagged,
          totalConfirmed: displayConfirmed,
          totalRevoked: displayRevoked,
          totalPending: displayPending,
          responseRate,
        },
        trends,
        recentRuns,
        projects: projectsList,
      });
    } catch (err) {
      console.error("Dashboard overview error:", err);
      return res.status(500).json({ error: "Failed to load dashboard overview." });
    }
  });

  // ── GET /api/runs ─────────────────────────────────────────────────────
  // List comparison runs with pagination
  app.get("/api/runs", requireAuth, loadCompany, (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    const runs = listComparisonRuns(db, { companyId: req.companyId });
    const paginated = runs.slice(offset, offset + limit);
    return res.json({
      data: paginated,
      limit,
      offset,
      total: runs.length,
    });
  });

  // ── GET /api/runs/:id/dashboard ────────────────────────────────────────
  // KPI summary for dashboard
  app.get("/api/runs/:id/dashboard", requireAuth, loadCompany, (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });
    const results = getAuditResults(db, req.params.id);
    const confirmed = results.filter(r => r.audit_status === "confirmed").length;
    const revoked = results.filter(r => r.audit_status === "revoked").length;
    const pending = results.filter(r => r.audit_status === "pending").length;
    return res.json({
      summary: {
        totalInactiveUsers: results.length,
        confirmed,
        revoked,
        pending,
        confirmationRate: results.length > 0 ? ((confirmed + revoked) / results.length * 100).toFixed(1) : 0,
      },
    });
  });

  // ── GET /api/runs/:id/snapshot ─────────────────────────────────────────
  // Full comparison snapshot
  app.get("/api/runs/:id/snapshot", requireAuth, loadCompany, (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });
    return res.json((run.report_json || {}));
  });

  // ── GET /api/runs/:id/export ───────────────────────────────────────────
  // Export results as CSV
  app.get("/api/runs/:id/export", requireAuth, loadCompany, (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });
    const results = getAuditResults(db, req.params.id);

    // CSV-safe quoting: escape double quotes and wrap in quotes
    function csvSafe(val) {
      const s = val == null ? '' : String(val);
      return '"' + s.replace(/"/g, '""') + '"';
    }

    const rows = [["user_key", "email", "source", "status", "response_date"].map(csvSafe).join(",")];
    for (const r of results) {
      rows.push([r.user_key, r.email, r.source, r.audit_status, r.responded_at || ""].map(csvSafe).join(","));
    }
    const csv = rows.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-results-${req.params.id}.csv"`);
    return res.send(csv);
  });

  // ── GET /api/trends ────────────────────────────────────────────────────
  app.get("/api/trends", requireAuth, loadCompany, (req, res) => {
    const runs = listComparisonRuns(db, { companyId: req.companyId });
    const trends = runs.map(run => {
      const results = getAuditResults(db, run.id);
      return {
        runId: run.id,
        date: run.created_at,
        totalInactive: results.length,
        confirmed: results.filter(r => r.audit_status === "confirmed").length,
        revoked: results.filter(r => r.audit_status === "revoked").length,
      };
    });
    return res.json({ companyId: req.companyId, totalRuns: runs.length, trends });
  });

  // ======================================================================
  //  COMMUNICATIONS ENDPOINTS
  // ======================================================================

  // ── GET /api/communications/stats?q=&projectId=&dateFrom=&dateTo= ────
  // Aggregated KPI stats for the communications page, respecting same filters
  app.get("/api/communications/stats", requireAuth, loadCompany, (req, res) => {
    const q = (req.query.q || "").trim();
    const projectId = req.query.projectId || "";
    const dateFrom = req.query.dateFrom || "";
    const dateTo = req.query.dateTo || "";

    let where = "cr.company_id = ?";
    const params = [req.companyId];

    if (q) {
      where += " AND (iu.email LIKE ? OR iu.user_key LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }
    if (projectId) {
      where += " AND cr.project_id = ?";
      params.push(projectId);
    }
    if (dateFrom) {
      where += " AND DATE(cr.created_at) >= ?";
      params.push(dateFrom);
    }
    if (dateTo) {
      where += " AND DATE(cr.created_at) <= ?";
      params.push(dateTo);
    }

    const row = db.prepare(`
      SELECT
        COUNT(DISTINCT LOWER(COALESCE(iu.email, iu.user_key))) AS totalUsers,
        SUM(CASE WHEN iu.audit_status = 'confirmed' THEN 1 ELSE 0 END) AS totalConfirmed,
        SUM(CASE WHEN iu.audit_status = 'revoked' THEN 1 ELSE 0 END) AS totalRevoked,
        SUM(CASE WHEN iu.audit_status = 'pending' THEN 1 ELSE 0 END) AS totalPending,
        COUNT(DISTINCT cr.project_id) AS totalProjects,
        COUNT(*) AS totalRecords
      FROM inactive_users iu
      JOIN comparison_runs cr ON iu.run_id = cr.id
      WHERE ${where}
    `).get(...params);

    const totalUsers = row.totalUsers || 0;
    const totalConfirmed = row.totalConfirmed || 0;
    const totalRevoked = row.totalRevoked || 0;
    const totalPending = row.totalPending || 0;
    const totalProjects = row.totalProjects || 0;
    const responded = totalConfirmed + totalRevoked;
    const totalRecords = row.totalRecords || 0;
    const responseRate = totalRecords > 0 ? ((responded / totalRecords) * 100).toFixed(1) : "0.0";

    return res.json({
      totalUsers,
      totalConfirmed,
      totalRevoked,
      totalPending,
      totalProjects,
      responseRate,
    });
  });

  // ── GET /api/communications/users?q=search&projectId=&dateFrom=&dateTo= ──
  app.get("/api/communications/users", requireAuth, loadCompany, (req, res) => {
    const q = (req.query.q || "").trim();
    const projectId = req.query.projectId || "";
    const dateFrom = req.query.dateFrom || "";
    const dateTo = req.query.dateTo || "";

    // Need at least a search term or a filter
    if (!q && !projectId && !dateFrom && !dateTo) return res.json({ users: [] });

    let sql = `SELECT iu.id, iu.user_key, iu.email, iu.source, iu.audit_status,
              cr.id AS run_id, cr.project_id, cr.created_at AS run_date,
              p.name AS project_name, p.product_name, p.status AS project_status
       FROM inactive_users iu
       JOIN comparison_runs cr ON iu.run_id = cr.id
       LEFT JOIN projects p ON cr.project_id = p.id
       WHERE cr.company_id = ?`;
    const params = [req.companyId];

    if (q) {
      sql += ` AND (iu.email LIKE ? OR iu.user_key LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    if (projectId) {
      sql += ` AND cr.project_id = ?`;
      params.push(projectId);
    }
    if (dateFrom) {
      sql += ` AND DATE(cr.created_at) >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ` AND DATE(cr.created_at) <= ?`;
      params.push(dateTo);
    }

    sql += ` ORDER BY iu.email, cr.created_at DESC`;
    const rows = db.prepare(sql).all(...params);

    // Group by user (email or user_key)
    const userMap = new Map();
    for (const row of rows) {
      const key = (row.email || row.user_key || "").toLowerCase();
      if (!userMap.has(key)) {
        userMap.set(key, {
          email: row.email,
          user_key: row.user_key,
          projects: [],
        });
      }
      userMap.get(key).projects.push({
        project_id: row.project_id,
        project_name: row.project_name,
        product_name: row.product_name,
        project_status: row.project_status,
        audit_status: row.audit_status,
        source: row.source,
        run_id: row.run_id,
        run_date: row.run_date,
      });
    }

    res.json({ users: Array.from(userMap.values()) });
  });

  // ══════════════════════════════════════════════════════════════════════
  //  PROJECTS ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════

  // ── GET /api/projects ──────────────────────────────────────────────────
  app.get("/api/projects", requireAuth, loadCompany, (req, res) => {
    const rows = db.prepare(
      `SELECT p.*, u.email AS created_by_email
       FROM projects p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.company_id = ?
       ORDER BY p.created_at DESC`
    ).all(req.companyId);

    // Attach run count to each project
    const projects = rows.map(p => {
      const runCount = db.prepare(
        "SELECT COUNT(*) AS cnt FROM comparison_runs WHERE project_id = ?"
      ).get(p.id);
      return { ...p, run_count: runCount.cnt };
    });

    return res.json(projects);
  });

  // ── PUT /api/projects/:id/status ───────────────────────────────────────
  app.put("/api/projects/:id/status", requireAuth, loadCompany, (req, res) => {
    const project = db.prepare(
      "SELECT * FROM projects WHERE id = ? AND company_id = ?"
    ).get(req.params.id, req.companyId);
    if (!project) return res.status(404).json({ error: "Project not found." });

    const { status } = req.body;
    const valid = ['active', 'completed', 'archived'];
    if (!status || !valid.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });
    }
    db.prepare("UPDATE projects SET status = ? WHERE id = ? AND company_id = ?").run(status, req.params.id, req.companyId);
    const actor = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
    syslog.projectStatusChanged(req, req.params.id, project.name, project.status, status, { id: req.session.userId, email: actor?.email });
    return res.json({ id: req.params.id, status });
  });

  // ── POST /api/projects ─────────────────────────────────────────────────
  app.post("/api/projects", requireAuth, loadCompany, (req, res) => {
    const { name, description, product_name, email_template, send_date, cost_per_user, currency } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Project name is required." });
    }
    if (cost_per_user === undefined || cost_per_user === null || cost_per_user === '') {
      return res.status(400).json({ error: "Cost per user is required." });
    }
    const costCents = Math.round(parseFloat(cost_per_user) * 100);
    if (isNaN(costCents) || costCents < 0) {
      return res.status(400).json({ error: "Cost per user must be a valid non-negative number." });
    }
    const validCurrencies = ['USD','EUR','GBP','CAD','AUD','JPY','CHF','INR','BRL','MXN'];
    const curr = (currency || 'USD').toUpperCase();
    if (!validCurrencies.includes(curr)) {
      return res.status(400).json({ error: `Currency must be one of: ${validCurrencies.join(', ')}` });
    }

    const id = require("crypto").randomUUID();
    db.prepare(
      `INSERT INTO projects (id, name, description, product_name, email_template, send_date, cost_per_user_cents, currency, status, company_id, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(id, name.trim(), description || null, product_name || null, email_template || null, send_date || null, costCents, curr, req.companyId, req.session.userId);

    const actor = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
    syslog.projectCreated(req, { id, name: name.trim(), cost_per_user: costCents / 100 }, { id: req.session.userId, email: actor?.email });

    return res.status(201).json({ id, name: name.trim(), description: description || null, product_name: product_name || null, email_template: email_template || null, send_date: send_date || null, cost_per_user: costCents / 100, currency: curr, status: 'active' });
  });

  // ── GET /api/projects/:id ──────────────────────────────────────────────
  app.get("/api/projects/:id", requireAuth, loadCompany, (req, res) => {
    const project = db.prepare(
      `SELECT p.*, u.email AS created_by_email
       FROM projects p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = ? AND p.company_id = ?`
    ).get(req.params.id, req.companyId);

    if (!project) return res.status(404).json({ error: "Project not found." });

    // Include comparison runs for this project
    const runs = listComparisonRuns(db, { companyId: req.companyId, projectId: project.id });

    // Compute per-project analytics from all runs
    let totalFlagged = 0, totalConfirmed = 0, totalRevoked = 0, totalPending = 0;
    const enrichedRuns = runs.map(run => {
      const results = getAuditResults(db, run.id);
      const confirmed = results.filter(r => r.audit_status === "confirmed").length;
      const revoked = results.filter(r => r.audit_status === "revoked").length;
      const pending = results.filter(r => r.audit_status === "pending").length;
      totalFlagged += results.length;
      totalConfirmed += confirmed;
      totalRevoked += revoked;
      totalPending += pending;
      return {
        ...run,
        totalFlagged: results.length,
        confirmed,
        revoked,
        pending,
      };
    });

    const responseRate = totalFlagged > 0
      ? (((totalConfirmed + totalRevoked) / totalFlagged) * 100).toFixed(1)
      : "0.0";

    // Fetch all users (inactive_users) across all runs for this project
    const projectUsers = db.prepare(
      `SELECT iu.id, iu.user_key, iu.email, iu.source, iu.audit_status,
              iu.created_at, iu.run_id
       FROM inactive_users iu
       JOIN comparison_runs cr ON iu.run_id = cr.id
       WHERE cr.project_id = ? AND cr.company_id = ?
       ORDER BY iu.email, iu.user_key, iu.created_at DESC`
    ).all(project.id, req.companyId);

    // Financial insights
    const costPerUserCents = project.cost_per_user_cents || 0;
    const costPerUser = costPerUserCents / 100;
    const curr = project.currency || 'USD';
    const revokedSavings = totalRevoked * costPerUser;
    const pendingSavings = totalPending * costPerUser;
    const potentialSavings = (totalRevoked + totalPending) * costPerUser;
    const totalLicenseCost = totalFlagged * costPerUser;
    const confirmedCost = totalConfirmed * costPerUser;
    const savingsPercent = totalLicenseCost > 0 ? ((revokedSavings / totalLicenseCost) * 100).toFixed(1) : '0.0';

    return res.json({
      ...project,
      cost_per_user: costPerUser,
      currency: curr,
      runs: enrichedRuns,
      users: projectUsers,
      analytics: {
        totalFlagged,
        totalConfirmed,
        totalRevoked,
        totalPending,
        responseRate,
        totalRuns: runs.length,
      },
      financialInsights: {
        costPerUser,
        currency: curr,
        totalLicenseCost,
        confirmedCost,
        revokedSavings,
        pendingSavings,
        potentialSavings,
        savingsPercent,
      },
    });
  });

  // ── PUT /api/projects/:id ──────────────────────────────────────────────
  app.put("/api/projects/:id", requireAuth, loadCompany, (req, res) => {
    const project = db.prepare(
      "SELECT * FROM projects WHERE id = ? AND company_id = ?"
    ).get(req.params.id, req.companyId);

    if (!project) return res.status(404).json({ error: "Project not found." });

    const { name, description, product_name, email_template, send_date, cost_per_user, currency } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Project name is required." });
    }

    let costCents = project.cost_per_user_cents;
    let curr = project.currency || 'USD';
    if (cost_per_user !== undefined && cost_per_user !== null && cost_per_user !== '') {
      costCents = Math.round(parseFloat(cost_per_user) * 100);
      if (isNaN(costCents) || costCents < 0) {
        return res.status(400).json({ error: "Cost per user must be a valid non-negative number." });
      }
    }
    if (currency) {
      const validCurrencies = ['USD','EUR','GBP','CAD','AUD','JPY','CHF','INR','BRL','MXN'];
      curr = currency.toUpperCase();
      if (!validCurrencies.includes(curr)) {
        return res.status(400).json({ error: `Currency must be one of: ${validCurrencies.join(', ')}` });
      }
    }

    db.prepare(
      "UPDATE projects SET name = ?, description = ?, product_name = ?, email_template = ?, send_date = ?, cost_per_user_cents = ?, currency = ? WHERE id = ? AND company_id = ?"
    ).run(name.trim(), description || null, product_name || null, email_template || null, send_date || null, costCents, curr, req.params.id, req.companyId);

    const actor = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
    syslog.projectUpdated(req, req.params.id, name.trim(), { id: req.session.userId, email: actor?.email }, { name: name.trim(), costPerUser: costCents / 100 });

    return res.json({ id: req.params.id, name: name.trim(), description: description || null, product_name: product_name || null, email_template: email_template || null, send_date: send_date || null, cost_per_user: costCents / 100, currency: curr, status: project.status });
  });

  // ── DELETE /api/projects/:id ───────────────────────────────────────────
  app.delete("/api/projects/:id", requireAuth, loadCompany, (req, res) => {
    const project = db.prepare(
      "SELECT * FROM projects WHERE id = ? AND company_id = ?"
    ).get(req.params.id, req.companyId);

    if (!project) return res.status(404).json({ error: "Project not found." });

    // Unlink runs from this project (don't delete them)
    db.prepare("UPDATE comparison_runs SET project_id = NULL WHERE project_id = ?").run(req.params.id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);

    const actor = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
    syslog.projectDeleted(req, req.params.id, project.name, { id: req.session.userId, email: actor?.email });

    return res.json({ success: true });
  });

    // ══════════════════════════════════════════════════════════════════════
    //  ADMIN PANEL ENDPOINTS (require 'admin' or 'superadmin' role)
    // ══════════════════════════════════════════════════════════════════════

    // Middleware to check for at least 'admin' role for all /api/admin routes
    app.use("/api/admin", requireRole('admin'));

    // ── GET /api/admin/users ─────────────────────────────────────────────
    // List users (superadmin sees all; regular admin scoped to own company)
    app.get("/api/admin/users", (req, res) => {
      const q = (req.query.q || "").trim();
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const actor = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(req.session.userId);
      const isSuperadmin = actor && actor.role === 'superadmin';

      let rows, total;
      if (isSuperadmin) {
        // Superadmin: cross-company visibility
        if (q) {
          const like = `%${q.replace(/%/g, '')}%`;
          rows = db.prepare("SELECT id, email, company_id, role, disabled, created_at FROM users WHERE email LIKE ? OR company_id LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(like, like, limit, offset);
          total = db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE ? OR company_id LIKE ?").get(like, like).n;
        } else {
          rows = db.prepare("SELECT id, email, company_id, role, disabled, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
          total = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
        }
      } else {
        // Regular admin: own company only
        const companyId = actor.company_id;
        if (q) {
          const like = `%${q.replace(/%/g, '')}%`;
          rows = db.prepare("SELECT id, email, company_id, role, disabled, created_at FROM users WHERE company_id = ? AND (email LIKE ? OR company_id LIKE ?) ORDER BY created_at DESC LIMIT ? OFFSET ?").all(companyId, like, like, limit, offset);
          total = db.prepare("SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND (email LIKE ? OR company_id LIKE ?)").get(companyId, like, like).n;
        } else {
          rows = db.prepare("SELECT id, email, company_id, role, disabled, created_at FROM users WHERE company_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(companyId, limit, offset);
          total = db.prepare("SELECT COUNT(*) AS n FROM users WHERE company_id = ?").get(companyId).n;
        }
      }

      return res.json({ data: rows, total, limit, offset });
    });

    // ── POST /api/admin/users ────────────────────────────────────────────
    // Add a new user
    app.post("/api/admin/users", requireRole('admin'), async (req, res) => {
        const { email, password, role } = req.body;
        const companyId = req.session.companyId; // Admin can only add users to their own company

        if (!email || !password || !role) {
            return res.status(400).json({ error: "Email, password, and role are required." });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters." });
        }
        if (!['member', 'admin'].includes(role)) {
            return res.status(400).json({ error: "Invalid role. Can only be 'member' or 'admin'." });
        }

        try {
            // Ensure user doesn't already exist
            const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
            if (existingUser) {
                return res.status(409).json({ error: "User with this email already exists." });
            }

            const bcrypt = require("bcrypt");
            const password_hash = await bcrypt.hash(password, 12);
            const id = require("crypto").randomUUID();

            db.prepare(
                "INSERT INTO users (id, email, password_hash, company_id, role) VALUES (?, ?, ?, ?, ?)"
            ).run(id, email, password_hash, companyId, role);

            const newUser = db.prepare("SELECT id, email, role, created_at FROM users WHERE id = ?").get(id);
            return res.status(201).json(newUser);
        } catch (err) {
          logErr("POST /api/admin/users", err);
            return res.status(500).json({ error: `Failed to create user: ${err.message}` });
        }
    });

    // ── PUT /api/admin/users/:id ─────────────────────────────────────────
    // Edit a user's role or disabled status
    app.put("/api/admin/users/:id", requireRole('admin'), (req, res) => {
        const { role, disabled } = req.body;
        const targetUserId = req.params.id;
        const actor = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(req.session.userId);

        if (role && !['member', 'admin', 'superadmin'].includes(role)) {
            return res.status(400).json({ error: "Invalid role specified." });
        }

        // Superadmin can do anything
        if (actor.role === 'superadmin') {
            // but cannot remove the last superadmin
            if (role && role !== 'superadmin') {
                const superadminCount = db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'superadmin'").get().n;
                const targetUser = db.prepare("SELECT role FROM users WHERE id = ?").get(targetUserId);
                if (targetUser.role === 'superadmin' && superadminCount <= 1) {
                    return res.status(403).json({ error: "Cannot remove the last superadmin." });
                }
            }
        } else { // Regular admin
            if (role === 'superadmin') {
                return res.status(403).json({ error: "Only a superadmin can assign the superadmin role." });
            }
            const targetUser = db.prepare("SELECT company_id, role FROM users WHERE id = ?").get(targetUserId);
            if (!targetUser || targetUser.company_id !== actor.company_id) {
                return res.status(403).json({ error: "Admins can only manage users in their own company." });
            }
            if (targetUser.role === 'superadmin') {
                return res.status(403).json({ error: "Admins cannot modify a superadmin." });
            }
        }

        try {
            if (role != null) {
                db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, targetUserId);
            }
            if (disabled != null) {
                db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, targetUserId);
            }
            return res.json({ success: true });
        } catch (err) {
          logErr("PUT /api/admin/users/:id", err);
            return res.status(500).json({ error: `Failed to update user: ${err.message}` });
        }
    });

    // ── POST /api/admin/users/bulk ───────────────────────────────────────
    // Perform bulk actions on users
    app.post("/api/admin/users/bulk", requireRole('admin'), (req, res) => {
        const { userIds, action, value } = req.body;
        if (!Array.isArray(userIds) || userIds.length === 0 || !action) {
            return res.status(400).json({ error: "User IDs and action are required." });
        }

        const actor = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(req.session.userId);
        
        // Filter out users the actor cannot modify
        const allowedUserIds = db.transaction((ids) => {
            const stmt = db.prepare("SELECT id, role, company_id FROM users WHERE id = ?");
            return ids.filter(id => {
                const target = stmt.get(id);
                if (!target) return false;
                if (actor.role === 'superadmin') return true;
                // Admin can only modify members/admins in their own company
                return target.company_id === actor.company_id && target.role !== 'superadmin';
            });
        })(userIds);

        if (allowedUserIds.length === 0) {
            return res.status(403).json({ error: "No users you are permitted to modify were found." });
        }

        const placeholders = allowedUserIds.map(() => '?').join(',');
        let stmt;

        try {
            switch (action) {
                case 'disable':
                    stmt = db.prepare(`UPDATE users SET disabled = 1 WHERE id IN (${placeholders})`);
                    stmt.run(...allowedUserIds);
                    break;
                case 'enable':
                    stmt = db.prepare(`UPDATE users SET disabled = 0 WHERE id IN (${placeholders})`);
                    stmt.run(...allowedUserIds);
                    break;
                case 'setRole':
                    if (!['member', 'admin'].includes(value) && actor.role !== 'superadmin') {
                         return res.status(403).json({ error: "Invalid role for bulk assignment." });
                    }
                     if (!['member', 'admin', 'superadmin'].includes(value)) {
                         return res.status(400).json({ error: "Invalid role value." });
                    }
                    stmt = db.prepare(`UPDATE users SET role = ? WHERE id IN (${placeholders})`);
                    stmt.run(value, ...allowedUserIds);
                    break;
                default:
                    return res.status(400).json({ error: "Invalid bulk action." });
            }
            return res.json({ success: true, affected: allowedUserIds.length });
        } catch (err) {
          logErr("POST /api/admin/users/bulk", err);
            return res.status(500).json({ error: `Bulk action failed: ${err.message}` });
        }
    });

    // ── POST /api/admin/users/:id/enable ─────────────────────────────────
    // Enable user account (tenant-scoped)
    app.post("/api/admin/users/:id/enable", requireRole('admin'), (req, res) => {
      const actor = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(req.session.userId);
      if (actor.role !== 'superadmin') {
        const target = db.prepare("SELECT company_id FROM users WHERE id = ?").get(req.params.id);
        if (!target || target.company_id !== actor.company_id) {
          return res.status(403).json({ error: "Cannot modify users outside your company." });
        }
      }
      db.prepare("UPDATE users SET disabled = 0 WHERE id = ?").run(req.params.id);
      return res.json({ success: true });
    });

    // ── POST /api/admin/users/:id/disable ────────────────────────────────
    // Disable user account (tenant-scoped)
    app.post("/api/admin/users/:id/disable", requireRole('admin'), (req, res) => {
      const actor = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(req.session.userId);
      if (actor.role !== 'superadmin') {
        const target = db.prepare("SELECT company_id, role FROM users WHERE id = ?").get(req.params.id);
        if (!target || target.company_id !== actor.company_id) {
          return res.status(403).json({ error: "Cannot modify users outside your company." });
        }
        if (target.role === 'superadmin') {
          return res.status(403).json({ error: "Cannot disable a superadmin." });
        }
      }
      db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(req.params.id);
      return res.json({ success: true });
    });

    // ── GET /api/admin/logs ──────────────────────────────────────────────
    // Review system activity logs (tenant-scoped unless superadmin)
    app.get("/api/admin/logs", requireRole('admin'), (req, res) => {
      const actor = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(req.session.userId);
      const isSuperadmin = actor && actor.role === 'superadmin';

      if (isSuperadmin) {
        const logs = db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100").all();
        return res.json(logs);
      }

      const logs = db.prepare(`
        SELECT al.*
        FROM audit_log al
        JOIN comparison_runs cr ON cr.id = al.run_id
        WHERE cr.company_id = ?
        ORDER BY al.created_at DESC
        LIMIT 100
      `).all(actor.company_id);

      return res.json(logs);
    });

    // ── GET /api/admin/logs/export ───────────────────────────────────────
    // Export audit logs as CSV
    app.get("/api/admin/logs/export", requireRole('admin'), (req, res) => {
      const limit = Math.min(parseInt(req.query.limit || "1000", 10), 10000);
      const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
      const actor = db.prepare("SELECT role, company_id FROM users WHERE id = ?").get(req.session.userId);
      const isSuperadmin = actor && actor.role === 'superadmin';

      const rows = isSuperadmin
        ? db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset)
        : db.prepare(`
            SELECT al.*
            FROM audit_log al
            JOIN comparison_runs cr ON cr.id = al.run_id
            WHERE cr.company_id = ?
            ORDER BY al.created_at DESC
            LIMIT ? OFFSET ?
          `).all(actor.company_id, limit, offset);

      // CSV header
      const headers = ["id", "run_id", "inactive_user_id", "user_key", "email", "action", "ip_address", "created_at"];
      const csvRows = [headers.join(",")];

      for (const r of rows) {
        const vals = headers.map(h => {
          const v = r[h] == null ? "" : String(r[h]);
          // escape double quotes
          return '"' + v.replace(/"/g, '""') + '"';
        });
        csvRows.push(vals.join(","));
      }

      const csv = csvRows.join("\n");
      const filename = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    });

    // ── GET /api/admin/billing ─────────────────────────────────────────--
    // Review billing info (stub)
    app.get("/api/admin/billing", requireRole('superadmin'), (req, res) => {
      // Placeholder: return dummy billing info
      return res.json({
        totalClients: db.prepare("SELECT COUNT(DISTINCT company_id) AS n FROM users").get().n,
        totalUsers: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
        monthlyRevenue: 0,
        invoices: [],
      });
    });

    // ── GET /api/admin/billing/defaults ─────────────────────────────────
    app.get('/api/admin/billing/defaults', requireRole('superadmin'), (req, res) => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get('default_monthly_cents') || {};
      const monthly = row.value ? parseInt(row.value, 10) : null;
      const row2 = db.prepare("SELECT value FROM settings WHERE key = ?").get('default_annual_cents') || {};
      const annual = row2.value ? parseInt(row2.value, 10) : null;
      return res.json({ defaultMonthlyCents: monthly, defaultAnnualCents: annual, currency: 'USD' });
    });

    // ── PUT /api/admin/billing/defaults ─────────────────────────────────
    app.put('/api/admin/billing/defaults', requireRole('superadmin'), express.json(), (req, res) => {
      const { defaultMonthlyCents, defaultAnnualCents } = req.body || {};
      if (defaultMonthlyCents != null) db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run('default_monthly_cents', String(defaultMonthlyCents));
      if (defaultAnnualCents != null) db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run('default_annual_cents', String(defaultAnnualCents));
      return res.json({ success: true });
    });

    // ── PUT /api/admin/companies/:companyId/billing ─────────────────────
    app.put('/api/admin/companies/:companyId/billing', requireRole('superadmin'), express.json(), (req, res) => {
      const { monthlyRateCents, annualRateCents, billingEnabled, currency } = req.body || {};
      const updates = [];
      if (monthlyRateCents != null) updates.push({ sql: 'monthly_rate_cents = ?', val: monthlyRateCents });
      if (annualRateCents != null) updates.push({ sql: 'annual_rate_cents = ?', val: annualRateCents });
      if (billingEnabled != null) updates.push({ sql: 'billing_enabled = ?', val: billingEnabled ? 1 : 0 });
      if (currency != null) updates.push({ sql: 'currency = ?', val: currency });

      if (updates.length === 0) return res.status(400).json({ error: 'No billing fields provided.' });

      const setClause = updates.map(u => u.sql).join(', ');
      const vals = updates.map(u => u.val);
      vals.push(req.params.companyId);

      const stmt = db.prepare(`UPDATE companies SET ${setClause} WHERE id = ?`);
      stmt.run(...vals);
      return res.json({ success: true });
    });

  // ── POST /api/runs/:id/analyze ─────────────────────────────────────────
  app.post("/api/runs/:id/analyze", requireAuth, loadCompany, async (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });
    if (!claudeAnalyzer.isConfigured) {
      return res.status(503).json({ error: "Claude API not configured." });
    }
    try {
      const report = (run.report_json || {});
      const analysis = await claudeAnalyzer.analyze(report);
      return res.json(analysis);
    } catch (err) {
      logErr("POST /api/runs/:id/analyze", err);
      return res.status(500).json({ error: "Analysis failed." });
    }
  });

  // ── POST /api/billing/checkout ──────────────────────────────────────
  // Create a Stripe Checkout session for a company. Accessible to admins or company users.
  app.post('/api/billing/checkout', requireAuth, async (req, res) => {
    const { companyId, interval, successUrl, cancelUrl } = req.body || {};
    if (!companyId || !interval) return res.status(400).json({ error: 'companyId and interval required' });

    if (!['month', 'year'].includes(interval)) return res.status(400).json({ error: 'interval must be month or year' });

    // Allow checkout for your own tenant; only superadmin can target other tenants.
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId) || {};
    const isSuperadmin = row.role === 'superadmin';
    if (!isSuperadmin && req.session.companyId !== companyId) return res.status(403).json({ error: 'Forbidden' });

    const origin = `${req.protocol}://${req.get('host')}`;
    const toSameOriginUrl = (candidate, fallbackPath) => {
      try {
        if (!candidate) return origin + fallbackPath;
        const u = new URL(String(candidate), origin);
        if (u.origin !== origin) return origin + fallbackPath;
        return u.toString();
      } catch {
        return origin + fallbackPath;
      }
    };

    try {
      const { createCheckoutSession } = require('./billing');
      const session = await createCheckoutSession({
        db,
        companyId,
        interval,
        successUrl: toSameOriginUrl(successUrl, '/settings'),
        cancelUrl: toSameOriginUrl(cancelUrl, '/settings'),
      });
      return res.json({ url: session.url });
    } catch (err) {
      logErr("POST /api/billing/checkout", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /webhooks/stripe ───────────────────────────────────────────
  // Stripe webhook endpoint (public)
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

    const getSetting = (k) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) || {}).value || null;
    const secret = getSetting("stripe_webhook_secret") || process.env.STRIPE_WEBHOOK_SECRET;
    const Stripe = require('stripe');
    const apiKey = getSetting("stripe_api_key") || process.env.STRIPE_API_KEY;
    const stripe = apiKey ? new Stripe(apiKey) : null;

    if (!secret || !stripe) {
      console.warn('[STRIPE] Webhook ignored: STRIPE_WEBHOOK_SECRET or STRIPE_API_KEY not configured');
      return res.status(400).json({ error: 'Stripe not configured' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle relevant events
    try {
      const type = event.type;
      if (type === 'invoice.paid' || type === 'invoice.payment_succeeded') {
        const invoice = event.data.object;
        const companyId = invoice.metadata?.companyId || null;
        const id = require('crypto').randomUUID();
        db.prepare('INSERT OR REPLACE INTO invoices (id, company_id, stripe_invoice_id, amount_paid_cents, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))')
          .run(id, companyId, invoice.id, Math.round((invoice.total || 0)), invoice.currency || 'usd', invoice.status || 'paid');
      }
    } catch (e) {
      console.error('Webhook handling error:', e);
    }
    res.json({ received: true });
  });

  // ── GET /api/runs/:id/anomalies ────────────────────────────────────────
  app.get("/api/runs/:id/anomalies", requireAuth, loadCompany, async (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });
    if (!claudeAnalyzer.isConfigured) {
      return res.status(503).json({ error: "Claude API not configured." });
    }
    try {
      const report = (run.report_json || {});
      const anomalies = await claudeAnalyzer.detectAnomalies(report);
      return res.json(anomalies);
    } catch (err) {
      logErr("GET /api/runs/:id/anomalies", err);
      return res.status(500).json({ error: "Detection failed." });
    }
  });

  // ── GET /api/runs/:id/categorize ───────────────────────────────────────
  app.get("/api/runs/:id/categorize", requireAuth, loadCompany, async (req, res) => {
    const run = getRunForUser(req);
    if (!run) return res.status(404).json({ error: "Run not found." });
    if (!claudeAnalyzer.isConfigured) {
      return res.status(503).json({ error: "Claude API not configured." });
    }
    try {
      const inactiveUsers = db.prepare("SELECT * FROM inactive_users WHERE run_id = ?").all(req.params.id);
      const result = await claudeAnalyzer.categorizeUsers(inactiveUsers, `Run: ${run.id}`);
      return res.json(result);
    } catch (err) {
      logErr("GET /api/runs/:id/categorize", err);
      return res.status(500).json({ error: "Categorization failed." });
    }
  });

  // ── POST /api/auth/forgot-password ─────────────────────────────────────
  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required." });
    try {
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      if (user) {
        const token = require("crypto").randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 3600000).toISOString();
        db.prepare("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?").run(token, expiresAt, user.id);

        // Deliver reset email (fragment-based link to avoid token leakage in URLs/logs).
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const mail = buildPasswordResetEmail({ email, token, baseUrl });
        try {
          await emailSender.sendMail({
            from: "NyLi Assets <noreply@nyliassets.io>",
            to: mail.to,
            subject: mail.subject,
            text: mail.textBody,
            html: mail.htmlBody,
          });
        } catch (sendErr) {
          logErr("forgot-password sendMail", sendErr);
        }

        syslog.authPasswordReset(req, email);
      }
      return res.json({ success: true });
    } catch (err) {
      logErr("POST /api/auth/forgot-password", err);
      return res.status(500).json({ error: "Request failed." });
    }
  });

  // ── POST /api/auth/reset-password ──────────────────────────────────────
  app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: "Token and password required." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be ≥ 8 characters." });
    try {
      const user = db.prepare("SELECT * FROM users WHERE reset_token = ?").get(token);
      if (!user || new Date(user.reset_token_expires) < new Date()) {
        return res.status(400).json({ error: "Invalid or expired token." });
      }
      const bcrypt = require("bcrypt");
      const hashed = await bcrypt.hash(password, 12);
      db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?").run(hashed, user.id);
      return res.json({ success: true });
    } catch (err) {
      logErr("POST /api/auth/reset-password", err);
      return res.status(500).json({ error: "Reset failed." });
    }
  });

  // ── GET /api/users/profile ────────────────────────────────────────────
  app.get("/api/users/profile", requireAuth, (req, res) => {
    try {
      const user = db.prepare("SELECT id, email, first_name, last_name, title, company_id, role, disabled, created_at FROM users WHERE id = ?").get(req.session.userId);
      return res.json({
        id: user.id,
        email: user.email,
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        title: user.title || '',
        companyId: user.company_id,
        role: user.role,
        isAdmin: user.role === 'admin' || user.role === 'superadmin',
        disabled: !!user.disabled,
        memberSince: user.created_at,
      });
    } catch (err) {
      logErr("GET /api/users/profile", err);
      return res.status(500).json({ error: "Profile lookup failed." });
    }
  });

  // ── PUT /api/users/profile ────────────────────────────────────────────
  app.put("/api/users/profile", requireAuth, (req, res) => {
    try {
      const { firstName, lastName, title } = req.body;
      db.prepare("UPDATE users SET first_name = ?, last_name = ?, title = ? WHERE id = ?")
        .run(firstName || null, lastName || null, title || null, req.session.userId);
      return res.json({ success: true });
    } catch (err) {
      logErr("PUT /api/users/profile", err);
      return res.status(500).json({ error: "Profile update failed." });
    }
  });

  // ── PUT /api/users/password ────────────────────────────────────────────
  app.put("/api/users/password", requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both passwords required." });
    if (newPassword.length < 8) return res.status(400).json({ error: "New password must be ≥ 8 characters." });
    try {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
      const bcrypt = require("bcrypt");
      if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
        return res.status(401).json({ error: "Current password incorrect." });
      }
      const hashed = await bcrypt.hash(newPassword, 12);
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashed, req.session.userId);
      return res.json({ success: true });
    } catch (err) {
      logErr("PUT /api/users/password", err);
      return res.status(500).json({ error: "Password change failed." });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  ACCOUNT USER MANAGEMENT (admin / superadmin only, company-scoped)
  // ══════════════════════════════════════════════════════════════════════

  // ── GET /api/account/users ─────────────────────────────────────────────
  // List all users in the current admin's company
  app.get("/api/account/users", requireAuth, requireRole('admin'), (req, res) => {
    try {
      const companyId = req.session.companyId;
      const rows = db.prepare(
        "SELECT id, email, first_name, last_name, title, role, disabled, created_at FROM users WHERE company_id = ? ORDER BY created_at ASC"
      ).all(companyId);
      return res.json(rows.map(u => ({
        id: u.id,
        email: u.email,
        firstName: u.first_name || '',
        lastName: u.last_name || '',
        title: u.title || '',
        role: u.role,
        disabled: !!u.disabled,
        createdAt: u.created_at,
      })));
    } catch (err) {
      logErr("GET /api/account/users", err);
      return res.status(500).json({ error: "Failed to load users." });
    }
  });

  // ── POST /api/account/users ────────────────────────────────────────────
  // Add a new user to the admin's company
  app.post("/api/account/users", requireAuth, requireRole('admin'), async (req, res) => {
    const { email, password, role, firstName, lastName, title } = req.body;
    const companyId = req.session.companyId;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    const allowedRole = role || 'member';
    if (!['member', 'admin'].includes(allowedRole)) {
      return res.status(400).json({ error: "Role must be 'member' or 'admin'." });
    }

    try {
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) {
        return res.status(409).json({ error: "A user with this email already exists." });
      }

      const bcrypt = require("bcrypt");
      const password_hash = await bcrypt.hash(password, 12);
      const id = require("crypto").randomUUID();

      db.prepare(
        "INSERT INTO users (id, email, password_hash, first_name, last_name, title, company_id, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, email, password_hash, firstName || null, lastName || null, title || null, companyId, allowedRole);

      const newUser = db.prepare("SELECT id, email, first_name, last_name, title, role, created_at FROM users WHERE id = ?").get(id);
      return res.status(201).json({
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name || '',
        lastName: newUser.last_name || '',
        title: newUser.title || '',
        role: newUser.role,
        disabled: false,
        createdAt: newUser.created_at,
      });
    } catch (err) {
      logErr("POST /api/account/users", err);
      return res.status(500).json({ error: `Failed to create user: ${err.message}` });
    }
  });

  // ── DELETE /api/account/users/:id ──────────────────────────────────────
  // Remove a user from the company
  app.delete("/api/account/users/:id", requireAuth, requireRole('admin'), (req, res) => {
    const targetId = req.params.id;
    const actorId = req.session.userId;
    const companyId = req.session.companyId;

    if (targetId === actorId) {
      return res.status(400).json({ error: "You cannot remove yourself." });
    }

    try {
      const actor = db.prepare("SELECT role FROM users WHERE id = ?").get(actorId);
      const target = db.prepare("SELECT id, role, company_id FROM users WHERE id = ?").get(targetId);

      if (!target) {
        return res.status(404).json({ error: "User not found." });
      }
      if (target.company_id !== companyId) {
        return res.status(403).json({ error: "You can only remove users from your own company." });
      }
      if (target.role === 'superadmin' && actor.role !== 'superadmin') {
        return res.status(403).json({ error: "Only a superadmin can remove another superadmin." });
      }
      if (target.role === 'superadmin') {
        const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'").get().n;
        if (count <= 1) {
          return res.status(403).json({ error: "Cannot remove the last superadmin." });
        }
      }

      // Delete user preferences first (FK)
      db.prepare("DELETE FROM user_preferences WHERE user_id = ?").run(targetId);
      // Delete the user
      db.prepare("DELETE FROM users WHERE id = ?").run(targetId);

      return res.json({ success: true });
    } catch (err) {
      logErr("DELETE /api/account/users/:id", err);
      return res.status(500).json({ error: `Failed to remove user: ${err.message}` });
    }
  });

  // ── GET /api/users/preferences ─────────────────────────────────────────
  app.get("/api/users/preferences", requireAuth, (req, res) => {
    let prefs = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(req.session.userId);
    if (!prefs) {
      prefs = { user_id: req.session.userId, theme: 'light', language: 'en', timezone: 'UTC', date_format: 'MM/DD/YYYY', notifications_enabled: 1 };
    }
    return res.json(prefs);
  });

  // ── PUT /api/users/preferences ─────────────────────────────────────────
  app.put("/api/users/preferences", requireAuth, (req, res) => {
    const { theme, language, timezone, date_format, notifications_enabled } = req.body;
    const validThemes = ['light', 'dark'];
    const validLanguages = ['en', 'es', 'fr', 'de', 'pt', 'ja', 'zh'];
    const validFormats = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];

    if (theme && !validThemes.includes(theme)) return res.status(400).json({ error: 'Invalid theme.' });
    if (language && !validLanguages.includes(language)) return res.status(400).json({ error: 'Invalid language.' });
    if (date_format && !validFormats.includes(date_format)) return res.status(400).json({ error: 'Invalid date format.' });

    const existing = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(req.session.userId);
    if (existing) {
      db.prepare(
        `UPDATE user_preferences SET theme = ?, language = ?, timezone = ?, date_format = ?, notifications_enabled = ?, updated_at = datetime('now') WHERE user_id = ?`
      ).run(
        theme || existing.theme,
        language || existing.language,
        timezone || existing.timezone,
        date_format || existing.date_format,
        notifications_enabled !== undefined ? (notifications_enabled ? 1 : 0) : existing.notifications_enabled,
        req.session.userId
      );
    } else {
      db.prepare(
        `INSERT INTO user_preferences (user_id, theme, language, timezone, date_format, notifications_enabled) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        req.session.userId,
        theme || 'light',
        language || 'en',
        timezone || 'UTC',
        date_format || 'MM/DD/YYYY',
        notifications_enabled !== undefined ? (notifications_enabled ? 1 : 0) : 1
      );
    }
    const prefs = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(req.session.userId);
    return res.json(prefs);
  });

  // ── GET /api/calendar/events ───────────────────────────────────────────
  app.get("/api/calendar/events", requireAuth, loadCompany, (req, res) => {
    const { month, year } = req.query;
    let query = `SELECT p.id, p.name, p.send_date, p.status, p.product_name, u.email AS created_by_email
                 FROM projects p
                 LEFT JOIN users u ON p.user_id = u.id
                 WHERE p.company_id = ? AND p.send_date IS NOT NULL`;
    const params = [req.companyId];

    if (month && year) {
      const m = String(month).padStart(2, '0');
      query += ` AND p.send_date LIKE ?`;
      params.push(`${year}-${m}-%`);
    }

    query += ` ORDER BY p.send_date ASC`;
    const events = db.prepare(query).all(...params);
    return res.json(events);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  BILLING ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════

  // ── GET /api/billing ─────────────────────────────────────────────────
  app.get("/api/billing", requireAuth, loadCompany, (req, res) => {
    try {
      let bp = db.prepare("SELECT * FROM billing_profiles WHERE company_id = ?").get(req.companyId);
      if (!bp) {
        // Create default billing profile
        const id = require("crypto").randomUUID();
        db.prepare(`INSERT INTO billing_profiles (id, company_id) VALUES (?, ?)`).run(id, req.companyId);
        bp = db.prepare("SELECT * FROM billing_profiles WHERE company_id = ?").get(req.companyId);
      }
      const planPrices = { free: 0, starter: 2900, pro: 7900, enterprise: 19900 };
      return res.json({
        plan: bp.plan,
        planStatus: bp.plan_status,
        planPrice: planPrices[bp.plan] || 0,
        billingAddress: {
          line1: bp.billing_address_line1 || '',
          line2: bp.billing_address_line2 || '',
          city: bp.billing_city || '',
          state: bp.billing_state || '',
          zip: bp.billing_zip || '',
          country: bp.billing_country || 'US',
        },
        card: bp.card_last4 ? {
          brand: bp.card_brand,
          last4: bp.card_last4,
          expMonth: bp.card_exp_month,
          expYear: bp.card_exp_year,
        } : null,
        billingEmail: bp.billing_email || '',
        currentPeriodStart: bp.current_period_start,
        currentPeriodEnd: bp.current_period_end,
      });
    } catch (err) {
      logErr("GET /api/billing", err);
      return res.status(500).json({ error: "Failed to load billing info." });
    }
  });

  // ── PUT /api/billing/address ─────────────────────────────────────────
  app.put("/api/billing/address", requireAuth, loadCompany, (req, res) => {
    try {
      const { line1, line2, city, state, zip, country } = req.body;
      const bp = db.prepare("SELECT id FROM billing_profiles WHERE company_id = ?").get(req.companyId);
      if (!bp) return res.status(404).json({ error: "Billing profile not found." });
      db.prepare(`UPDATE billing_profiles SET billing_address_line1 = ?, billing_address_line2 = ?, billing_city = ?, billing_state = ?, billing_zip = ?, billing_country = ?, updated_at = datetime('now') WHERE company_id = ?`)
        .run(line1 || null, line2 || null, city || null, state || null, zip || null, country || 'US', req.companyId);
      return res.json({ success: true });
    } catch (err) {
      logErr("PUT /api/billing/address", err);
      return res.status(500).json({ error: "Failed to update billing address." });
    }
  });

  // ── PUT /api/billing/card ────────────────────────────────────────────
  app.put("/api/billing/card", requireAuth, loadCompany, (req, res) => {
    try {
      const { cardNumber, expMonth, expYear, cvc } = req.body;
      if (!cardNumber || !expMonth || !expYear || !cvc) {
        return res.status(400).json({ error: "All card fields are required." });
      }
      // Validate card number length
      const cleaned = cardNumber.replace(/\s/g, '');
      if (cleaned.length < 13 || cleaned.length > 19) {
        return res.status(400).json({ error: "Invalid card number." });
      }
      // Determine brand
      let brand = 'unknown';
      if (cleaned.startsWith('4')) brand = 'Visa';
      else if (/^5[1-5]/.test(cleaned) || /^2[2-7]/.test(cleaned)) brand = 'Mastercard';
      else if (/^3[47]/.test(cleaned)) brand = 'Amex';
      else if (/^6(?:011|5)/.test(cleaned)) brand = 'Discover';

      const last4 = cleaned.slice(-4);
      const bp = db.prepare("SELECT id FROM billing_profiles WHERE company_id = ?").get(req.companyId);
      if (!bp) return res.status(404).json({ error: "Billing profile not found." });

      db.prepare(`UPDATE billing_profiles SET card_brand = ?, card_last4 = ?, card_exp_month = ?, card_exp_year = ?, updated_at = datetime('now') WHERE company_id = ?`)
        .run(brand, last4, parseInt(expMonth), parseInt(expYear), req.companyId);
      return res.json({ success: true, card: { brand, last4, expMonth: parseInt(expMonth), expYear: parseInt(expYear) } });
    } catch (err) {
      logErr("PUT /api/billing/card", err);
      return res.status(500).json({ error: "Failed to update payment method." });
    }
  });

  // ── PUT /api/billing/plan ────────────────────────────────────────────
  app.put("/api/billing/plan", requireAuth, loadCompany, (req, res) => {
    try {
      const { plan } = req.body;
      const validPlans = ['free', 'starter', 'pro', 'enterprise'];
      if (!plan || !validPlans.includes(plan)) {
        return res.status(400).json({ error: "Invalid plan." });
      }
      const bp = db.prepare("SELECT * FROM billing_profiles WHERE company_id = ?").get(req.companyId);
      if (!bp) return res.status(404).json({ error: "Billing profile not found." });

      // If upgrading from free, require a card on file
      if (plan !== 'free' && !bp.card_last4) {
        return res.status(400).json({ error: "Please add a payment method before upgrading." });
      }

      const now = new Date().toISOString();
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`UPDATE billing_profiles SET plan = ?, plan_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = datetime('now') WHERE company_id = ?`)
        .run(plan, now, periodEnd, req.companyId);

      // Create an invoice record
      const invoiceId = require("crypto").randomUUID();
      const planPrices = { free: 0, starter: 2900, pro: 7900, enterprise: 19900 };
      if (planPrices[plan] > 0) {
        db.prepare(`INSERT INTO invoices (id, company_id, stripe_invoice_id, amount_paid_cents, currency, status, created_at) VALUES (?, ?, ?, ?, 'USD', 'paid', datetime('now'))`)
          .run(invoiceId, req.companyId, 'inv_' + invoiceId.slice(0, 8), planPrices[plan]);
      }

      return res.json({ success: true, plan, status: 'active' });
    } catch (err) {
      logErr("PUT /api/billing/plan", err);
      return res.status(500).json({ error: "Failed to update plan." });
    }
  });

  // ── POST /api/billing/cancel ─────────────────────────────────────────
  app.post("/api/billing/cancel", requireAuth, loadCompany, (req, res) => {
    try {
      const bp = db.prepare("SELECT * FROM billing_profiles WHERE company_id = ?").get(req.companyId);
      if (!bp) return res.status(404).json({ error: "Billing profile not found." });
      if (bp.plan === 'free') return res.status(400).json({ error: "You are already on the free plan." });

      db.prepare(`UPDATE billing_profiles SET plan = 'free', plan_status = 'canceled', updated_at = datetime('now') WHERE company_id = ?`)
        .run(req.companyId);
      return res.json({ success: true });
    } catch (err) {
      logErr("POST /api/billing/cancel", err);
      return res.status(500).json({ error: "Failed to cancel plan." });
    }
  });

  // ── GET /api/billing/invoices ────────────────────────────────────────
  app.get("/api/billing/invoices", requireAuth, loadCompany, (req, res) => {
    try {
      const invoices = db.prepare(
        `SELECT id, stripe_invoice_id, amount_paid_cents, currency, status, created_at FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 50`
      ).all(req.companyId);
      return res.json(invoices);
    } catch (err) {
      logErr("GET /api/billing/invoices", err);
      return res.status(500).json({ error: "Failed to load invoices." });
    }
  });

  // ── GET /home ──────────────────────────────────────────────────────────
  app.get("/home", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "home.html"));
  });

  // ── GET /upload ────────────────────────────────────────────────────────
  app.get("/upload", requireAuth, (_req, res) => {
    res.redirect("/projects.html");
  });

  // ── GET /dashboard ─────────────────────────────────────────────────────
  app.get("/dashboard", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
  });

  // ── GET /history ───────────────────────────────────────────────────────
  app.get("/history", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "history.html"));
  });

  // ── GET /settings ──────────────────────────────────────────────────────
  app.get("/settings", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "settings.html"));
  });

  // ── GET /help ──────────────────────────────────────────────────────────
  app.get("/help", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "help.html"));
  });

  // ── GET /calendar ──────────────────────────────────────────────────────
  app.get("/calendar", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "calendar.html"));
  });

  // ── GET /communications ───────────────────────────────────────────────
  app.get("/communications", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "communications.html"));
  });

  // ── GET /projects ──────────────────────────────────────────────────────
  app.get("/projects", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "projects.html"));
  });

  // ── GET /projects/:id ─────────────────────────────────────────────────
  app.get("/projects/:id", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "project-detail.html"));
  });

  // ── GET /analysis ──────────────────────────────────────────────────────
  app.get("/analysis", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "analysis.html"));
  });

  // ── GET /admin ───────────────────────────────────────────────────────
  // Owner/admin interface (protected)
  app.get("/admin", requireRole('admin'), (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
  });

  // ── GET / ──────────────────────────────────────────────────────────────
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "landing.html"));
  });

  // ── GET /login ─────────────────────────────────────────────────────────
  app.get("/login", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
  });

  // ── GET /trial-expired ──────────────────────────────────────────────
  app.get("/trial-expired", requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "trial-expired.html"));
  });

  // ── GET /register ──────────────────────────────────────────────────────
  app.get("/register", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "register.html"));
  });

  // ── GET /reset/:token ──────────────────────────────────────────────────
  app.get("/reset/:token", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "reset-password.html"));
  });
  app.get("/reset", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "reset-password.html"));
  });

  // ── GET /confirm ───────────────────────────────────────────────────
  // Serves the confirmation landing page (handles the link users click).
  app.get("/confirm", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "confirm.html"));
  });

  // ── Owner Portal pages ──────────────────────────────────────────────
  app.get("/owner/login", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "owner-login.html"));
  });
  app.get("/owner/dashboard", requireOwner, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "owner-dashboard.html"));
  });
  app.get("/owner/clients", requireOwner, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "owner-clients.html"));
  });
  app.get("/owner/users", requireOwner, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "owner-users.html"));
  });
  app.get("/owner/activity", requireOwner, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "owner-activity.html"));
  });
  app.get("/owner/integrations", requireOwner, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "owner-integrations.html"));
  });
  app.get("/owner/billing", requireOwner, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "owner-billing.html"));
  });
  app.get("/owner/health", requireOwner, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "owner-health.html"));
  });

  // ── 404 catch-all (ensures API callers always get JSON) ────────────────
  app.use((req, res) => {
    res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
  });

  // ── Global error handler (diagnostic) ─────────────────────────────────
  app.use((err, req, res, _next) => {
    const ip = req.ip || req.socket?.remoteAddress;
    console.error(`[ERR] Unhandled: ${req.method} ${req.url} from ${ip} –`, err.message || err);
    if (err.stack) console.error(err.stack.split("\n").slice(0, 4).join("\n"));
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}

module.exports = { createApp };
