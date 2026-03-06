// Script to create an initial admin user for NyLi Assets
const { openDb } = require('./db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = openDb();

const email = process.argv[2] || 'admin@example.com';
const password = process.argv[3] || 'AdminPassword123';
const companyName = process.argv[4] || 'OwnerOrg';

async function main() {
  // Add admin and disabled columns if missing (safe to run multiple times)
  try {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;");
  } catch (e) {
    // ignore if column exists
  }
  try {
    db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER DEFAULT 0;");
  } catch (e) {
    // ignore if column exists
  }
  try {
    db.exec("ALTER TABLE companies ADD COLUMN monthly_rate_cents INTEGER DEFAULT NULL;");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE companies ADD COLUMN annual_rate_cents INTEGER DEFAULT NULL;");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE companies ADD COLUMN billing_enabled INTEGER DEFAULT 0;");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE companies ADD COLUMN currency TEXT DEFAULT 'USD';");
  } catch (e) {}

  // Check if admin already exists
  const existing = db.prepare("SELECT id FROM users WHERE email = ? AND role IN ('admin','superadmin')").get(email);
  if (existing) {
    console.log('Admin user already exists:', email);
    return;
  }

  // Find or create company
  let company = db.prepare('SELECT * FROM companies WHERE name = ?').get(companyName);
  if (!company) {
    const companyId = crypto.randomUUID();
    db.prepare('INSERT INTO companies (id, name) VALUES (?, ?)').run(companyId, companyName);
    company = { id: companyId, name: companyName };
  }

  const userId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);

  db.prepare(
    "INSERT INTO users (id, email, password_hash, company_id, is_admin, role) VALUES (?, ?, ?, ?, 1, 'superadmin')"
  ).run(userId, email, passwordHash, company.id);

  console.log('Admin user created:');
  console.log('  Email:', email);
  console.log('  Password:', password);
  console.log('  Company:', companyName);
}

main().catch(err => {
  console.error('Failed to create admin user:', err);
  process.exit(1);
});
