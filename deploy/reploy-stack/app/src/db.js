const Database = require("better-sqlite3");
const path = require("path");
const { resolveDbPath } = require("./runtimePaths");

const DEFAULT_DB_PATH = resolveDbPath();

/**
 * Open (or create) the SQLite database and ensure all required tables exist.
 *
 * @param {string} [dbPath] – path to the .db file; defaults to `data/leo.db`
 * @returns {import("better-sqlite3").Database}
 */
function openDb(dbPath = DEFAULT_DB_PATH) {
  const dir = path.dirname(dbPath);
  const fs = require("fs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  console.log(`[DB] Opening database at ${dbPath}`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  console.log("[DB] WAL mode enabled, foreign keys ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      trial_ends_at TEXT,
      disabled    INTEGER NOT NULL DEFAULT 0,
      monthly_rate_cents INTEGER DEFAULT NULL,
      annual_rate_cents INTEGER DEFAULT NULL,
      billing_enabled INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name    TEXT,
      last_name     TEXT,
      title         TEXT,
      company_id    TEXT NOT NULL REFERENCES companies(id),
      role          TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin', 'superadmin')),
      disabled      INTEGER NOT NULL DEFAULT 0,
      reset_token   TEXT,
      reset_token_expires TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      product_name  TEXT,
      email_template TEXT,
      send_date     TEXT,
      cost_per_user_cents INTEGER NOT NULL DEFAULT 0,
      currency      TEXT NOT NULL DEFAULT 'USD',
      status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
      company_id    TEXT NOT NULL REFERENCES companies(id),
      user_id       TEXT NOT NULL REFERENCES users(id),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id       TEXT PRIMARY KEY REFERENCES users(id),
      theme         TEXT NOT NULL DEFAULT 'light' CHECK(theme IN ('light','dark')),
      language      TEXT NOT NULL DEFAULT 'en',
      timezone      TEXT NOT NULL DEFAULT 'UTC',
      date_format   TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid       TEXT PRIMARY KEY,
      sess      TEXT NOT NULL,
      expired   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comparison_runs (
      id            TEXT PRIMARY KEY,
      project_id    TEXT REFERENCES projects(id),
      company_id    TEXT REFERENCES companies(id),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      key_column    TEXT NOT NULL,
      total_file_a  INTEGER NOT NULL,
      total_file_b  INTEGER NOT NULL,
      matched       INTEGER NOT NULL,
      only_in_a     INTEGER NOT NULL,
      only_in_b     INTEGER NOT NULL,
      field_diffs   INTEGER NOT NULL,
      report_json   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inactive_users (
      id              TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL REFERENCES comparison_runs(id),
      user_key        TEXT NOT NULL,
      source          TEXT NOT NULL CHECK(source IN ('onlyInFileA','onlyInFileB')),
      email           TEXT,
      user_data       TEXT NOT NULL,
      audit_status    TEXT NOT NULL DEFAULT 'pending' CHECK(audit_status IN ('pending','confirmed','revoked')),
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS confirmation_requests (
      id              TEXT PRIMARY KEY,
      inactive_user_id TEXT NOT NULL REFERENCES inactive_users(id),
      token           TEXT NOT NULL UNIQUE,
      token_hash      TEXT,
      sent_at         TEXT,
      responded_at    TEXT,
      response        TEXT CHECK(response IN ('yes','no', NULL)),
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id              TEXT PRIMARY KEY,
      run_id          TEXT NOT NULL REFERENCES comparison_runs(id),
      inactive_user_id TEXT NOT NULL REFERENCES inactive_users(id),
      user_key        TEXT NOT NULL,
      email           TEXT,
      action          TEXT NOT NULL CHECK(action IN ('verification_sent','confirmed','revoked')),
      ip_address      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stripe_customers (
      id TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id),
      stripe_customer_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id),
      stripe_invoice_id TEXT NOT NULL UNIQUE,
      amount_paid_cents INTEGER,
      currency TEXT,
      status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS billing_profiles (
      id            TEXT PRIMARY KEY,
      company_id    TEXT NOT NULL UNIQUE REFERENCES companies(id),
      plan          TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','starter','pro','enterprise')),
      plan_status   TEXT NOT NULL DEFAULT 'active' CHECK(plan_status IN ('active','past_due','canceled','trialing')),
      billing_address_line1 TEXT,
      billing_address_line2 TEXT,
      billing_city  TEXT,
      billing_state TEXT,
      billing_zip   TEXT,
      billing_country TEXT DEFAULT 'US',
      card_brand    TEXT,
      card_last4    TEXT,
      card_exp_month INTEGER,
      card_exp_year INTEGER,
      billing_email TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS platform_owners (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_log (
      id            TEXT PRIMARY KEY,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
      category      TEXT NOT NULL CHECK(category IN ('auth','project','comparison','verification','user_mgmt','billing','admin','owner','system')),
      action        TEXT NOT NULL,
      severity      TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','error','critical')),
      actor_id      TEXT,
      actor_email   TEXT,
      actor_type    TEXT DEFAULT 'user' CHECK(actor_type IN ('user','owner','system')),
      company_id    TEXT,
      company_name  TEXT,
      resource_type TEXT,
      resource_id   TEXT,
      ip_address    TEXT,
      user_agent    TEXT,
      details       TEXT,
      meta_json     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_system_log_timestamp ON system_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_system_log_category ON system_log(category);
    CREATE INDEX IF NOT EXISTS idx_system_log_actor ON system_log(actor_id);
    CREATE INDEX IF NOT EXISTS idx_system_log_company ON system_log(company_id);
    CREATE INDEX IF NOT EXISTS idx_system_log_severity ON system_log(severity);

    -- ── Core performance indexes (tenant-scoped lookups) ───────────────
    CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);

    CREATE INDEX IF NOT EXISTS idx_projects_company_created ON projects(company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_projects_company_status ON projects(company_id, status);

    CREATE INDEX IF NOT EXISTS idx_runs_company_created ON comparison_runs(company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_project_created ON comparison_runs(project_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_inactive_users_run_id ON inactive_users(run_id);
    CREATE INDEX IF NOT EXISTS idx_inactive_users_status ON inactive_users(audit_status);

    CREATE INDEX IF NOT EXISTS idx_confirmation_requests_token ON confirmation_requests(token);
    CREATE INDEX IF NOT EXISTS idx_confirmation_requests_token_hash ON confirmation_requests(token_hash);
    CREATE INDEX IF NOT EXISTS idx_confirmation_requests_inactive_user_id ON confirmation_requests(inactive_user_id);

    CREATE INDEX IF NOT EXISTS idx_audit_log_run_created ON audit_log(run_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_invoices_company_created ON invoices(company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_billing_profiles_company_id ON billing_profiles(company_id);
  `);

  // ── Migrations for existing databases ─────────────────────────────────
  const companyCols = db.prepare("PRAGMA table_info(companies)").all().map(c => c.name);
  if (!companyCols.includes("trial_ends_at")) {
    db.exec("ALTER TABLE companies ADD COLUMN trial_ends_at TEXT");
    console.log("[DB] Migration: added companies.trial_ends_at");
  }
  if (!companyCols.includes("disabled")) {
    db.exec("ALTER TABLE companies ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
    console.log("[DB] Migration: added companies.disabled");
  }

  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes("first_name")) {
    db.exec("ALTER TABLE users ADD COLUMN first_name TEXT");
    console.log("[DB] Migration: added users.first_name");
  }
  if (!userCols.includes("last_name")) {
    db.exec("ALTER TABLE users ADD COLUMN last_name TEXT");
    console.log("[DB] Migration: added users.last_name");
  }
  if (!userCols.includes("title")) {
    db.exec("ALTER TABLE users ADD COLUMN title TEXT");
    console.log("[DB] Migration: added users.title");
  }

  const confirmationRequestCols = db.prepare("PRAGMA table_info(confirmation_requests)").all().map(c => c.name);
  if (!confirmationRequestCols.includes("token_hash")) {
    db.exec("ALTER TABLE confirmation_requests ADD COLUMN token_hash TEXT");
    console.log("[DB] Migration: added confirmation_requests.token_hash");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_confirmation_requests_token_hash ON confirmation_requests(token_hash)");

  console.log("[DB] Schema ready");
  return db;
}

module.exports = { openDb, DEFAULT_DB_PATH };
