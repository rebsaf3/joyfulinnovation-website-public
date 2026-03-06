/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const targets = [
  path.resolve(repoRoot, "logs/projects.json"),
  path.resolve(repoRoot, "server/logs/projects.json"),
];

const DOC_OWNER_HINTS = ["documentationagent", "auditdocumentationagent"];
const TEST_OWNER_HINTS = ["testagent", "ciagent"];
const ANALYTICS_OWNER_HINTS = ["loggingagent", "insightsagent"];
const DASHBOARD_OWNER_HINTS = ["uidesigneragent"];
const ORCHESTRATION_OWNER_HINTS = [
  "codexagent",
  "claudeagent",
  "orchestratoragent",
  "bridgeagent",
  "registryagent",
  "taskmanageragent",
  "configagent",
  "packagingagent",
  "migrationagent",
  "dependencyagent",
  "integrationsagent",
  "securityagent",
  "errorboundaryagent",
  "llmmlagent",
];

const DOC_KEYWORDS = ["doc", "documentation", "article", "readme", "guide", "knowledge base", "faq", "support article", "sop"];
const TEST_KEYWORDS = ["test", "qa", "verification", "validate", "assert", "regression", "harness", "smoke test", "integration test"];
const ANALYTICS_KEYWORDS = ["metric", "analytic", "kpi", "telemetry", "observability", "report", "logging", "audit log", "activity feed"];
const DASHBOARD_KEYWORDS = [
  "dashboard",
  "ui",
  "frontend",
  "owner portal",
  "portal",
  "layout",
  "component",
  "page",
  "visual",
  "onboarding",
  "registration",
  "login flow",
];
const ORCHESTRATION_KEYWORDS = [
  "orchestr",
  "swarm",
  "agent",
  "bridge",
  "dispatch",
  "routing",
  "queue",
  "task manager",
  "config",
  "policy",
  "auth",
  "jwt",
  "tenant",
  "permission",
  "billing",
  "stripe",
  "webhook",
  "api",
  "backend",
  "migration",
  "deployment",
  "auto-created",
];

function hasAnyHint(input, hints) {
  return hints.some((hint) => input.includes(hint));
}

function normalizeMilestoneLabel(rawMilestone) {
  const value = typeof rawMilestone === "string" ? rawMilestone.trim().toLowerCase() : "";
  if (!value) return null;
  if (value === "documentation" || value === "docs") return "Documentation";
  if (value === "testing" || value === "test" || value === "qa") return "Testing";
  if (value === "analytics" || value === "metrics" || value === "observability") return "Analytics";
  if (value === "dashboard" || value === "ui" || value === "owner portal") return "Dashboard";
  if (value === "orchestration" || value === "backend" || value === "mesh" || value === "integration") return "Orchestration";
  return null;
}

function extractMilestoneHint(text) {
  const value = typeof text === "string" ? text.trim().toLowerCase() : "";
  if (!value) return null;
  if (
    value.includes("documentation milestone") ||
    value.includes("doc milestone") ||
    value.includes("-documentation")
  ) {
    return "Documentation";
  }
  if (value.includes("testing milestone") || value.includes("test milestone") || value.includes("qa milestone") || value.includes("-testing")) {
    return "Testing";
  }
  if (value.includes("analytics milestone") || value.includes("metrics milestone") || value.includes("-analytics")) {
    return "Analytics";
  }
  if (
    value.includes("dashboard milestone") ||
    value.includes("owner portal milestone") ||
    value.includes("ui milestone") ||
    value.includes("-dashboard")
  ) {
    return "Dashboard";
  }
  if (
    value.includes("orchestration milestone") ||
    value.includes("mesh milestone") ||
    value.includes("integration milestone") ||
    value.includes("backend milestone") ||
    value.includes("-mesh")
  ) {
    return "Orchestration";
  }
  return null;
}

function inferMilestone(description, owner, explicitMilestone) {
  const hintedByDescription = extractMilestoneHint(description);
  if (hintedByDescription) return hintedByDescription;
  const explicit = normalizeMilestoneLabel(explicitMilestone);
  if (explicit) return explicit;
  const hintedByOwner = extractMilestoneHint(owner);
  if (hintedByOwner) return hintedByOwner;

  const d = String(description || "").toLowerCase();
  const o = String(owner || "").toLowerCase();

  if (hasAnyHint(o, DOC_OWNER_HINTS) || hasAnyHint(d, DOC_KEYWORDS)) return "Documentation";
  if (hasAnyHint(o, TEST_OWNER_HINTS) || hasAnyHint(d, TEST_KEYWORDS)) return "Testing";
  if (hasAnyHint(o, ANALYTICS_OWNER_HINTS) || hasAnyHint(d, ANALYTICS_KEYWORDS)) return "Analytics";
  if (hasAnyHint(o, DASHBOARD_OWNER_HINTS) || hasAnyHint(d, DASHBOARD_KEYWORDS)) return "Dashboard";
  if (hasAnyHint(o, ORCHESTRATION_OWNER_HINTS) || hasAnyHint(d, ORCHESTRATION_KEYWORDS)) return "Orchestration";
  return "Orchestration";
}

function parseProjects(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function alignFile(file) {
  if (!fs.existsSync(file)) {
    return { file, skipped: true, reason: "missing" };
  }

  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const projectsObj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  const projects = parseProjects(raw);

  let total = 0;
  let updatedMilestone = 0;
  let updatedDescription = 0;
  const milestoneCounts = {};

  for (const project of projects) {
    const tasks = Array.isArray(project.tasks) ? project.tasks : [];
    for (const task of tasks) {
      total += 1;
      const owner = task.assignedAgent || "";
      const inferred = inferMilestone(task.description, owner, task.milestone);
      if (task.milestone !== inferred) {
        task.milestone = inferred;
        updatedMilestone += 1;
      }
      if (typeof task.description === "string" && task.description.trim().toLowerCase() === "auto-created") {
        task.description = "Auto-created orchestration task";
        updatedDescription += 1;
      }
      milestoneCounts[inferred] = (milestoneCounts[inferred] || 0) + 1;
    }
  }

  const backup = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  return {
    file,
    backup,
    totalTasks: total,
    updatedMilestone,
    updatedDescription,
    milestoneCounts,
    objectLayout: Boolean(projectsObj),
  };
}

function main() {
  const results = targets.map(alignFile);
  console.log(JSON.stringify({ results }, null, 2));
}

main();
