// Load local environment variables from `.env` (no-op if missing).
// Avoids adding a runtime dependency (keeps deploy/install simpler).
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

function loadEnvFileIfPresent(envFilePath) {
  try {
    if (!fs.existsSync(envFilePath)) return;
    const raw = fs.readFileSync(envFilePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      process.env[key] = value;
    }
  } catch (err) {
    console.warn(`[BOOT] Failed to load .env (${envFilePath}): ${err.message}`);
  }
}

loadEnvFileIfPresent(path.join(__dirname, "..", ".env"));

const { createApp } = require("./app");
const { openDb } = require("./db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

// ── Migration runner ────────────────────────────────────────────────────
// Discover and execute pending database migrations
function initializeMigrations(db) {
  try {
    // Ensure migrations_applied table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations_applied (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Discover migration files from src/migrations/
    const migrationsDir = path.join(__dirname, "migrations");
    if (!fs.existsSync(migrationsDir)) {
      console.log("[MIGRATIONS] No migrations directory found, skipping");
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith(".js"))
      .sort();

    if (migrationFiles.length === 0) {
      console.log("[MIGRATIONS] No migration files found");
      return;
    }

    // Execute pending migrations
    let executedCount = 0;
    for (const file of migrationFiles) {
      const migration = require(path.join(migrationsDir, file));
      const migrationId = migration.id || file.replace(/\.js$/, "");

      // Check if already applied
      const existing = db.prepare(
        "SELECT id FROM migrations_applied WHERE id = ?"
      ).get(migrationId);

      if (existing) {
        console.log(`[MIGRATIONS] Skipping ${migrationId} (already applied)`);
        continue;
      }

      // Execute migration
      try {
        console.log(`[MIGRATIONS] Running ${migrationId}...`);
        migration.up(db);
        db.prepare("INSERT INTO migrations_applied (id) VALUES (?)").run(migrationId);
        console.log(`[MIGRATIONS] ✅ ${migrationId} applied successfully`);
        executedCount++;
      } catch (err) {
        console.error(`[MIGRATIONS] ❌ ${migrationId} failed: ${err.message}`);
        throw err;
      }
    }

    if (executedCount > 0) {
      console.log(`[MIGRATIONS] Applied ${executedCount} migration(s)`);
    } else {
      console.log("[MIGRATIONS] All migrations already applied");
    }
  } catch (err) {
    console.error("[FATAL] Migration initialization failed:", err.message);
    process.exit(1);
  }
}

// ── Process-level error handlers ────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
});

const PORT = process.env.PORT || 3000;
console.log(`[BOOT] Starting NyLi Assets – PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV}, RAILWAY_ENVIRONMENT=${process.env.RAILWAY_ENVIRONMENT}`);

const isProdLike = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;
if (isProdLike && !process.env.SESSION_SECRET) {
  console.error("[FATAL] SESSION_SECRET is required in production. Set it as an environment variable.");
  process.exit(1);
}

let app;
try {
  app = createApp();
  console.log("[BOOT] createApp() succeeded");
} catch (err) {
  console.error("[FATAL] createApp() threw:", err);
  process.exit(1);
}

// Auto-create owner account on first run if none exists
(async () => {
  try {
    const db = openDb();
    
    // Run pending database migrations
    initializeMigrations(db);
    
    // Ensure columns exist
    try { db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0"); } catch (_) {}

    const admin = db.prepare("SELECT id, email, password_hash FROM users WHERE is_admin = 1").get();
    if (!admin) {
      if (isProdLike && (!process.env.OWNER_EMAIL || !process.env.OWNER_PASSWORD)) {
        console.error("[FATAL] First-run bootstrap needs OWNER_EMAIL and OWNER_PASSWORD in production.");
        process.exit(1);
      }

      const email = process.env.OWNER_EMAIL || "owner@nyliassets.io";
      const pass  = process.env.OWNER_PASSWORD || "Owner12345";
      const org   = process.env.OWNER_ORG || "NyLi Assets";

      let company = db.prepare("SELECT * FROM companies WHERE name = ?").get(org);
      if (!company) {
        const cid = crypto.randomUUID();
        db.prepare("INSERT INTO companies (id, name) VALUES (?, ?)").run(cid, org);
        company = { id: cid };
      }
      const uid = crypto.randomUUID();
      const hash = await bcrypt.hash(pass, 12);
      db.prepare("INSERT INTO users (id, email, password_hash, company_id, is_admin, role) VALUES (?, ?, ?, ?, 1, 'superadmin')")
        .run(uid, email, hash, company.id);
      console.log(`[BOOT] Owner account created: ${email}`);
    } else if (process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
      // Sync owner credentials from env vars on every boot so that
      // changes in Railway variables take effect without wiping the DB.
      const envEmail = process.env.OWNER_EMAIL;
      const envPass  = process.env.OWNER_PASSWORD;
      // Only re-hash and write if the email changed or the password doesn't match
      // the stored hash (avoids a bcrypt work-factor hit on every restart).
      const emailChanged = admin.email !== envEmail;
      const passwordChanged = !(await bcrypt.compare(envPass, admin.password_hash || "").catch(() => false));
      if (emailChanged || passwordChanged) {
        const hash = await bcrypt.hash(envPass, 12);
        db.prepare("UPDATE users SET email = ?, password_hash = ? WHERE id = ?")
          .run(envEmail, hash, admin.id);
        if (emailChanged) {
          console.log(`[BOOT] Owner email updated: ${admin.email} → ${envEmail}`);
        } else {
          console.log(`[BOOT] Owner password re-synced for ${envEmail}`);
        }
      } else {
        console.log(`[BOOT] Owner credentials unchanged for ${envEmail} — skipping re-hash`);
      }
    }
  } catch (err) {
    console.error("Owner auto-create failed:", err.message);
  }
})();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NyLi Assets server listening on 0.0.0.0:${PORT}`);
  autoStartSwarm();
});

// ── Agent mesh auto-start ────────────────────────────────────────────────────
// Spawns the NyLi agent mesh (start_mesh.js) automatically when the Express
// server comes up, unless disabled via AUTO_START_SWARM=false.
// If the mesh is already running (health check passes) it is left alone.
function autoStartSwarm() {
  if (String(process.env.AUTO_START_SWARM || "true").toLowerCase() === "false") {
    console.log("[SWARM] AUTO_START_SWARM=false — skipping mesh launch");
    return;
  }

  const MESH_PORT = Number(process.env.MESH_PORT) || 3099;
  const SWARM_ROOT = process.env.SWARM_ROOT
    ? path.resolve(process.env.SWARM_ROOT)
    : path.join(__dirname, "..", "nyli-agent-swarm", "nyli-agent-swarm");
  const meshEntry = path.join(SWARM_ROOT, "server", "src", "agent", "start_mesh.js");

  if (!fs.existsSync(meshEntry)) {
    console.warn(`[SWARM] Mesh entry not found at ${meshEntry} — skipping auto-start`);
    return;
  }

  // Check if mesh is already up before spawning
  const healthReq = http.request(
    { hostname: "127.0.0.1", port: MESH_PORT, path: "/health", method: "GET" },
    (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`[SWARM] Mesh already running on port ${MESH_PORT} — skipping spawn`);
        res.resume();
        return;
      }
      res.resume();
      spawnMesh(meshEntry, SWARM_ROOT);
    }
  );
  healthReq.setTimeout(1500, () => {
    healthReq.destroy();
    spawnMesh(meshEntry, SWARM_ROOT);
  });
  healthReq.on("error", () => spawnMesh(meshEntry, SWARM_ROOT));
  healthReq.end();
}

function spawnMesh(meshEntry, swarmRoot) {
  console.log("[SWARM] Spawning agent mesh…");
  const proc = spawn("node", [meshEntry], {
    cwd: path.join(swarmRoot, "server"),
    stdio: "ignore",
    detached: false,
    env: { ...process.env },
  });
  proc.on("spawn", () => console.log(`[SWARM] Mesh started (pid ${proc.pid})`));
  proc.on("error", (err) => console.error(`[SWARM] Mesh spawn error: ${err.message}`));
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) console.warn(`[SWARM] Mesh exited with code ${code}`);
  });
}
