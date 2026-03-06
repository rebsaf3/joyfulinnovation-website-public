#!/usr/bin/env node
/**
 * Create or reset the platform owner account.
 *
 * Usage:
 *   node src/createOwner.js <email> <password> [name]
 *
 * Example:
 *   node src/createOwner.js owner@nyliassets.io MySecurePass123 "Platform Owner"
 */
const { openDb } = require("./db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const [,, email, password, name] = process.argv;

if (!email || !password) {
  console.error("Usage: node src/createOwner.js <email> <password> [name]");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

(async () => {
  const db = openDb();

  const hash = await bcrypt.hash(password, 12);
  const existing = db.prepare("SELECT id FROM platform_owners WHERE email = ?").get(email);

  if (existing) {
    db.prepare("UPDATE platform_owners SET password_hash = ?, name = ? WHERE email = ?")
      .run(hash, name || null, email);
    console.log(`Owner account updated: ${email}`);
  } else {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO platform_owners (id, email, password_hash, name) VALUES (?, ?, ?, ?)")
      .run(id, email, hash, name || null);
    console.log(`Owner account created: ${email} (id: ${id})`);
  }

  db.close();
})();
