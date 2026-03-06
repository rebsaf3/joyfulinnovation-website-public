const crypto = require("crypto");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 12;

const TRIAL_DAYS = 7;

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  // Lightweight validation to block obvious bad input.
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Create a new company with a 7-day trial period.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} name
 * @returns {{ id: string, name: string }}
 */
function createCompany(db, name) {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO companies (id, name, trial_ends_at) VALUES (?, ?, datetime('now', '+' || ? || ' days'))"
  ).run(id, name, TRIAL_DAYS);
  console.log(`[AUTH] Company created: "${name}" (id=${id}, trial=${TRIAL_DAYS}d)`);
  return { id, name };
}

/**
 * Find a company by name.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} name
 * @returns {object|undefined}
 */
function getCompanyByName(db, name) {
  return db.prepare("SELECT * FROM companies WHERE name = ?").get(name);
}

/**
 * Register a new user with email, password, and company.
 * Creates the company if it doesn't exist yet.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ email: string, password: string, companyName: string }} params
 * @returns {{ id: string, email: string, companyId: string }}
 */
async function registerUser(db, { email, password, companyName }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCompanyName = (companyName || "").trim();

  if (!normalizedEmail || !password || !normalizedCompanyName) {
    throw new Error("Email, password, and company name are required.");
  }
  if (!isValidEmail(normalizedEmail)) {
    throw new Error("Please provide a valid email address.");
  }

  // Check if email is already taken
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    throw new Error("A user with this email already exists.");
  }

  // IMPORTANT (multi-tenancy): do NOT allow arbitrary users to join an existing
  // tenant just by guessing the company name.
  const existingCompany = getCompanyByName(db, normalizedCompanyName);
  if (existingCompany) {
    throw new Error("That company already exists. Ask your administrator to invite you.");
  }

  const company = createCompany(db, normalizedCompanyName);

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  db.prepare(
    "INSERT INTO users (id, email, password_hash, company_id) VALUES (?, ?, ?, ?)"
  ).run(id, normalizedEmail, passwordHash, company.id);

  console.log(`[AUTH] User registered: ${normalizedEmail} (company=${company.id})`);
  return { id, email: normalizedEmail, companyId: company.id };
}

/**
 * Authenticate a user by email and password.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ email: string, password: string }} params
 * @returns {Promise<{ id: string, email: string, companyId: string } | null>}
 */
async function loginUser(db, { email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }
  if (!isValidEmail(normalizedEmail)) {
    return null;
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  if (!user) return null;

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    console.log(`[AUTH] Login failed (bad password): ${normalizedEmail}`);
    return null;
  }

  console.log(`[AUTH] Login success: ${normalizedEmail}`);
  return { id: user.id, email: user.email, companyId: user.company_id, disabled: !!user.disabled, role: user.role };
}

/**
 * Get user by ID.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} userId
 * @returns {object|undefined}
 */
function getUserById(db, userId) {
  const user = db
    .prepare("SELECT id, email, company_id, created_at FROM users WHERE id = ?")
    .get(userId);
  return user;
}

module.exports = {
  createCompany,
  getCompanyByName,
  registerUser,
  loginUser,
  getUserById,
  normalizeEmail,
};
