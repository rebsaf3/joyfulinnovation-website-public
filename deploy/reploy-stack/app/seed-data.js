/**
 * Seed Script — Populate all data tables with realistic sample data
 * for verifying analytics across Dashboard, Projects, Communications, Home, etc.
 *
 * Run:  node seed-data.js
 *
 * Creates:
 *   - 4 additional projects (various statuses, with email templates)
 *   - 8 comparison runs spread across months (Oct 2025 – Feb 2026)
 *   - ~200 inactive users with mixed statuses (confirmed/revoked/pending)
 *   - confirmation_requests with varied response states
 *   - audit_log entries for each status change
 *
 * Also updates some of the existing 7956 users to confirmed/revoked
 * so the existing "Testing 1" project also shows analytics.
 */

const { openDb } = require("./src/db");
const crypto = require("crypto");

const db = openDb();

// ─── Existing IDs ────────────────────────────────────────────────────────────
const COMPANY_ID = "c28afb4b-7dc3-4628-9e5b-bfccd12cdc39";
const USER_ID    = "2d561612-1eca-4abd-b1c2-6786c0879923";
const EXISTING_PROJECT_ID = "5de6dee4-68c1-4f36-9c23-ef3727e0c059";
const EXISTING_RUN_ID     = "c87447b2-fe9a-4832-a9fd-b1c369924012";

function uuid() { return crypto.randomUUID(); }

// ─── Helper: past date string ────────────────────────────────────────────────
function dateAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().replace("T", " ").substring(0, 19);
}

// ─── Create sample people names/emails ───────────────────────────────────────
const PEOPLE = [
  { name: "Alice Johnson",    email: "alice.johnson@acme.com" },
  { name: "Bob Smith",        email: "bob.smith@acme.com" },
  { name: "Carol Williams",   email: "carol.williams@acme.com" },
  { name: "David Brown",      email: "david.brown@acme.com" },
  { name: "Eva Martinez",     email: "eva.martinez@acme.com" },
  { name: "Frank Davis",      email: "frank.davis@acme.com" },
  { name: "Grace Wilson",     email: "grace.wilson@acme.com" },
  { name: "Henry Taylor",     email: "henry.taylor@acme.com" },
  { name: "Iris Anderson",    email: "iris.anderson@acme.com" },
  { name: "Jack Thomas",      email: "jack.thomas@acme.com" },
  { name: "Karen White",      email: "karen.white@acme.com" },
  { name: "Leo Harris",       email: "leo.harris@acme.com" },
  { name: "Monica Clark",     email: "monica.clark@acme.com" },
  { name: "Nathan Lewis",     email: "nathan.lewis@acme.com" },
  { name: "Olivia Robinson",  email: "olivia.robinson@acme.com" },
  { name: "Peter Walker",     email: "peter.walker@acme.com" },
  { name: "Quinn Hall",       email: "quinn.hall@acme.com" },
  { name: "Rachel Allen",     email: "rachel.allen@acme.com" },
  { name: "Steven King",      email: "steven.king@acme.com" },
  { name: "Tina Wright",      email: "tina.wright@acme.com" },
  { name: "Uma Lopez",        email: "uma.lopez@acme.com" },
  { name: "Victor Hill",      email: "victor.hill@acme.com" },
  { name: "Wendy Scott",      email: "wendy.scott@acme.com" },
  { name: "Xavier Green",     email: "xavier.green@acme.com" },
  { name: "Yolanda Adams",    email: "yolanda.adams@acme.com" },
  { name: "Zach Baker",       email: "zach.baker@acme.com" },
  { name: "Amy Nelson",       email: "amy.nelson@acme.com" },
  { name: "Brian Carter",     email: "brian.carter@acme.com" },
  { name: "Cindy Mitchell",   email: "cindy.mitchell@acme.com" },
  { name: "Derek Perez",      email: "derek.perez@acme.com" },
  { name: "Elena Roberts",    email: "elena.roberts@acme.com" },
  { name: "Fred Turner",      email: "fred.turner@acme.com" },
  { name: "Gina Phillips",    email: "gina.phillips@acme.com" },
  { name: "Howard Campbell",  email: "howard.campbell@acme.com" },
  { name: "Irene Parker",     email: "irene.parker@acme.com" },
  { name: "Jeff Evans",       email: "jeff.evans@acme.com" },
  { name: "Kim Edwards",      email: "kim.edwards@acme.com" },
  { name: "Larry Collins",    email: "larry.collins@acme.com" },
  { name: "Maria Stewart",    email: "maria.stewart@acme.com" },
  { name: "Nick Sanchez",     email: "nick.sanchez@acme.com" },
];

// ─── 1. Create additional Projects ──────────────────────────────────────────
console.log("Creating projects...");

const projects = [
  {
    id: uuid(),
    name: "Q4 2025 Microsoft 365 Audit",
    description: "Quarterly audit of Microsoft 365 license assignments vs Active Directory.",
    product_name: "Microsoft 365",
    email_template: "Dear {name},\n\nWe are conducting a software license audit for {product}. Our records show that you have an assigned license.\n\nPlease confirm your usage by clicking the link below:\n{link}\n\nIf you no longer need this software, please select 'No' when prompted.\n\nThank you,\nIT Compliance Team",
    status: "completed",
    created_at: dateAgo(120),
  },
  {
    id: uuid(),
    name: "Adobe Creative Cloud Review",
    description: "Annual review of Adobe CC seat usage across design and marketing teams.",
    product_name: "Adobe Creative Cloud",
    email_template: "Hi {name},\n\nAs part of our annual software review, we need to verify your Adobe Creative Cloud license.\n\nEmail on file: {email}\nProduct: {product}\n\nPlease click below to confirm you still need this license:\n{link}\n\nBest regards,\nSoftware Asset Management",
    status: "completed",
    created_at: dateAgo(90),
  },
  {
    id: uuid(),
    name: "Salesforce License Optimization",
    description: "Identify unused Salesforce seats for potential cost savings.",
    product_name: "Salesforce",
    email_template: "Hello {name},\n\nWe're optimizing our Salesforce licenses. Please confirm whether you actively use your {product} account.\n\nVerification link: {link}\n\nIf we don't hear from you within 14 days, the license may be reassigned.\n\nRegards,\nIT Department",
    status: "active",
    created_at: dateAgo(45),
  },
  {
    id: uuid(),
    name: "Slack Enterprise Audit",
    description: "Verify active Slack Enterprise Grid users against HR records.",
    product_name: "Slack Enterprise Grid",
    email_template: "Dear {name},\n\nPlease verify your Slack Enterprise account at {email}.\n\nClick here to confirm: {link}\n\nThank you,\nIT Operations",
    status: "active",
    created_at: dateAgo(15),
  },
];

const insertProject = db.prepare(`
  INSERT OR IGNORE INTO projects (id, name, description, product_name, email_template, status, company_id, user_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const p of projects) {
  insertProject.run(p.id, p.name, p.description, p.product_name, p.email_template, p.status, COMPANY_ID, USER_ID, p.created_at);
}
console.log(`  Created ${projects.length} projects`);

// Also add an email template to the existing "Testing 1" project
db.prepare("UPDATE projects SET email_template = ?, product_name = ? WHERE id = ?").run(
  "Dear {name},\n\nPlease verify your license usage for {product}.\n\nClick here: {link}\n\nThank you.",
  "Internal Software",
  EXISTING_PROJECT_ID
);
console.log("  Updated existing project with email template & product name");

// ─── 2. Create Comparison Runs ──────────────────────────────────────────────
console.log("\nCreating comparison runs...");

function makeReport(totalA, totalB, matched, onlyA, onlyB, diffs) {
  return JSON.stringify({
    keyColumn: "email",
    summary: {
      totalFileA: totalA,
      totalFileB: totalB,
      matchedUsers: matched,
      onlyInFileA: onlyA,
      onlyInFileB: onlyB,
      usersWithFieldDifferences: diffs
    },
    onlyInFileA: [],
    onlyInFileB: [],
    fieldDifferences: []
  });
}

const runs = [
  // Project 1: Q4 M365 — 2 runs
  { id: uuid(), project_id: projects[0].id, created_at: dateAgo(115), totalA: 450, totalB: 500, matched: 420, onlyA: 30, onlyB: 80, diffs: 15 },
  { id: uuid(), project_id: projects[0].id, created_at: dateAgo(100), totalA: 460, totalB: 510, matched: 430, onlyA: 30, onlyB: 80, diffs: 12 },
  // Project 2: Adobe CC — 2 runs
  { id: uuid(), project_id: projects[1].id, created_at: dateAgo(85),  totalA: 120, totalB: 150, matched: 100, onlyA: 20, onlyB: 50, diffs: 8 },
  { id: uuid(), project_id: projects[1].id, created_at: dateAgo(60),  totalA: 125, totalB: 155, matched: 105, onlyA: 20, onlyB: 50, diffs: 5 },
  // Project 3: Salesforce — 2 runs
  { id: uuid(), project_id: projects[2].id, created_at: dateAgo(40),  totalA: 300, totalB: 280, matched: 250, onlyA: 50, onlyB: 30, diffs: 20 },
  { id: uuid(), project_id: projects[2].id, created_at: dateAgo(20),  totalA: 310, totalB: 290, matched: 260, onlyA: 50, onlyB: 30, diffs: 18 },
  // Project 4: Slack — 1 run
  { id: uuid(), project_id: projects[3].id, created_at: dateAgo(10),  totalA: 200, totalB: 180, matched: 160, onlyA: 40, onlyB: 20, diffs: 10 },
];

const insertRun = db.prepare(`
  INSERT OR IGNORE INTO comparison_runs (id, project_id, company_id, created_at, key_column, total_file_a, total_file_b, matched, only_in_a, only_in_b, field_diffs, report_json)
  VALUES (?, ?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?)
`);

for (const r of runs) {
  insertRun.run(r.id, r.project_id, COMPANY_ID, r.created_at, r.totalA, r.totalB, r.matched, r.onlyA, r.onlyB, r.diffs,
    makeReport(r.totalA, r.totalB, r.matched, r.onlyA, r.onlyB, r.diffs));
}
console.log(`  Created ${runs.length} comparison runs`);

// ─── 3. Create Inactive Users for each run ──────────────────────────────────
console.log("\nCreating inactive users for new runs...");

const insertInactiveUser = db.prepare(`
  INSERT OR IGNORE INTO inactive_users (id, run_id, user_key, source, email, user_data, audit_status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertConfirmation = db.prepare(`
  INSERT OR IGNORE INTO confirmation_requests (id, inactive_user_id, token, sent_at, responded_at, response, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertAuditLog = db.prepare(`
  INSERT OR IGNORE INTO audit_log (id, run_id, inactive_user_id, user_key, email, action, ip_address, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let totalCreatedUsers = 0;
let totalConfirmations = 0;
let totalAuditLogs = 0;

const statusDistributions = {
  // completed projects: high response rate
  0: { confirmed: 0.55, revoked: 0.25, pending: 0.20 },  // M365 run 1
  1: { confirmed: 0.60, revoked: 0.20, pending: 0.20 },  // M365 run 2
  2: { confirmed: 0.50, revoked: 0.30, pending: 0.20 },  // Adobe run 1
  3: { confirmed: 0.55, revoked: 0.25, pending: 0.20 },  // Adobe run 2
  // active projects: lower response rates
  4: { confirmed: 0.35, revoked: 0.15, pending: 0.50 },  // Salesforce run 1
  5: { confirmed: 0.40, revoked: 0.20, pending: 0.40 },  // Salesforce run 2
  6: { confirmed: 0.20, revoked: 0.10, pending: 0.70 },  // Slack run 1
};

const seedInsert = db.transaction(() => {
  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri];
    const dist = statusDistributions[ri];
    const userCount = run.onlyA + run.onlyB; // flagged users = only in A + only in B
    const sources = [];

    // Split into onlyInFileA and onlyInFileB
    for (let i = 0; i < run.onlyA; i++) sources.push("onlyInFileA");
    for (let i = 0; i < run.onlyB; i++) sources.push("onlyInFileB");

    for (let i = 0; i < userCount; i++) {
      const person = PEOPLE[i % PEOPLE.length];
      const suffix = ri * 100 + i;
      const email = person.email.replace("@", `${suffix}@`);
      const userKey = email.toLowerCase();
      const source = sources[i] || "onlyInFileA";

      // Determine status based on distribution
      const rand = Math.random();
      let status;
      if (rand < dist.confirmed) status = "confirmed";
      else if (rand < dist.confirmed + dist.revoked) status = "revoked";
      else status = "pending";

      const iuId = uuid();
      const createdAt = run.created_at;

      insertInactiveUser.run(iuId, run.id, userKey, source, email, JSON.stringify({ name: person.name, email }), status, createdAt);
      totalCreatedUsers++;

      // Create confirmation request for non-pending users
      if (status !== "pending") {
        const token = crypto.randomBytes(16).toString("hex");
        const sentAt = createdAt;
        // responded 1-7 days after sent
        const respondedDate = new Date(new Date(createdAt).getTime() + (1 + Math.random() * 6) * 86400000);
        const respondedAt = respondedDate.toISOString().replace("T", " ").substring(0, 19);
        const response = status === "confirmed" ? "yes" : "no";

        insertConfirmation.run(uuid(), iuId, token, sentAt, respondedAt, response, createdAt);
        totalConfirmations++;

        // Audit log: verification_sent
        insertAuditLog.run(uuid(), run.id, iuId, userKey, email, "verification_sent", null, sentAt);
        totalAuditLogs++;

        // Audit log: confirmed or revoked
        const action = status === "confirmed" ? "confirmed" : "revoked";
        const ip = `192.168.1.${10 + (i % 240)}`;
        insertAuditLog.run(uuid(), run.id, iuId, userKey, email, action, ip, respondedAt);
        totalAuditLogs++;
      } else {
        // For some pending users, create a sent confirmation (no response yet)
        if (Math.random() < 0.6) {
          const token = crypto.randomBytes(16).toString("hex");
          const sentAt = createdAt;
          insertConfirmation.run(uuid(), iuId, token, sentAt, null, null, createdAt);
          totalConfirmations++;

          insertAuditLog.run(uuid(), run.id, iuId, userKey, email, "verification_sent", null, sentAt);
          totalAuditLogs++;
        }
      }
    }
  }
});

seedInsert();
console.log(`  Created ${totalCreatedUsers} inactive users`);
console.log(`  Created ${totalConfirmations} confirmation requests`);
console.log(`  Created ${totalAuditLogs} audit log entries`);

// ─── 4. Update some existing "Testing 1" users to confirmed/revoked ─────────
console.log("\nUpdating existing 'Testing 1' project users...");

const existingUsers = db.prepare(
  "SELECT id, user_key, email FROM inactive_users WHERE run_id = ? LIMIT 500"
).all(EXISTING_RUN_ID);

let updatedConfirmed = 0, updatedRevoked = 0, existingConfirmations = 0, existingLogs = 0;

const updateExisting = db.transaction(() => {
  for (let i = 0; i < existingUsers.length; i++) {
    const u = existingUsers[i];
    let newStatus;
    if (i < 150) {
      newStatus = "confirmed";
      updatedConfirmed++;
    } else if (i < 250) {
      newStatus = "revoked";
      updatedRevoked++;
    } else {
      continue; // leave as pending
    }

    db.prepare("UPDATE inactive_users SET audit_status = ? WHERE id = ?").run(newStatus, u.id);

    // Add confirmation request
    const token = crypto.randomBytes(16).toString("hex");
    const sentAt = dateAgo(130);
    const respondedAt = dateAgo(128 - Math.floor(Math.random() * 5));
    const response = newStatus === "confirmed" ? "yes" : "no";
    insertConfirmation.run(uuid(), u.id, token, sentAt, respondedAt, response, sentAt);
    existingConfirmations++;

    // Audit log entries
    insertAuditLog.run(uuid(), EXISTING_RUN_ID, u.id, u.user_key, u.email, "verification_sent", null, sentAt);
    existingLogs++;

    const action = newStatus === "confirmed" ? "confirmed" : "revoked";
    insertAuditLog.run(uuid(), EXISTING_RUN_ID, u.id, u.user_key, u.email, action, `10.0.0.${i % 255}`, respondedAt);
    existingLogs++;
  }
});

updateExisting();
console.log(`  Updated ${updatedConfirmed} to confirmed, ${updatedRevoked} to revoked`);
console.log(`  Created ${existingConfirmations} confirmation requests for existing users`);
console.log(`  Created ${existingLogs} audit log entries for existing users`);

// ─── 5. Summary ──────────────────────────────────────────────────────────────
console.log("\n═══ FINAL DATA SUMMARY ═══");
const pCount = db.prepare("SELECT COUNT(*) as n FROM projects WHERE company_id = ?").get(COMPANY_ID);
const rCount = db.prepare("SELECT COUNT(*) as n FROM comparison_runs WHERE company_id = ?").get(COMPANY_ID);
const iuCount = db.prepare("SELECT COUNT(*) as n FROM inactive_users").get();
const iuStatus = db.prepare("SELECT audit_status, COUNT(*) as cnt FROM inactive_users GROUP BY audit_status").all();
const crCount = db.prepare("SELECT COUNT(*) as n FROM confirmation_requests").get();
const alCount = db.prepare("SELECT COUNT(*) as n FROM audit_log").get();

console.log(`  Projects:              ${pCount.n}`);
console.log(`  Comparison Runs:       ${rCount.n}`);
console.log(`  Inactive Users:        ${iuCount.n}`);
for (const s of iuStatus) {
  console.log(`    - ${s.audit_status}: ${s.cnt}`);
}
console.log(`  Confirmation Requests: ${crCount.n}`);
console.log(`  Audit Log Entries:     ${alCount.n}`);

db.close();
console.log("\n✓ Seed data complete! Restart the server and check your analytics.");
