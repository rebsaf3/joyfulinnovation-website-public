#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const APP_ROOT = path.join(ROOT, "app");

const requiredFiles = [
  "README.md",
  "ARCHITECTURE.md",
  "Dockerfile",
  "package.json",
  "scripts/bootstrap-and-run.js",
  "scripts/stack-supervisor.js",
  "scripts/runtime-env.js",
  "app/package.json",
  "app/src/server.js",
  "app/src/swarmDashboardRoutes.js",
  "app/nyli-agent-swarm/nyli-agent-swarm/server/src/agent/start_mesh.js",
  "app/nyli-agent-swarm/nyli-agent-swarm/client/src/pages/SwarmDashboard.tsx",
];

const forbiddenPaths = [
  "app/node_modules",
  "app/nyli-agent-swarm/nyli-agent-swarm/client/node_modules",
  "app/nyli-agent-swarm/nyli-agent-swarm/server/node_modules",
  "app/nyli-agent-swarm/nyli-agent-swarm/client/dist",
];

function fail(msg) {
  console.error(`[integrity] ${msg}`);
  process.exit(1);
}

function canUseGit() {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  return result.status === 0;
}

function hasTrackedFiles(pathspec) {
  const result = spawnSync("git", ["ls-files", "--", pathspec], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  });
  if (result.status !== 0) return false;
  return Boolean(String(result.stdout || "").trim());
}

function assertRequiredFiles() {
  for (const rel of requiredFiles) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) fail(`missing required file: ${rel}`);
  }
}

function assertForbiddenPaths(useGit) {
  for (const rel of forbiddenPaths) {
    if (useGit) {
      if (hasTrackedFiles(rel)) fail(`forbidden tracked path present in deploy package: ${rel}`);
      continue;
    }
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) {
      fail(`forbidden path present in deploy package (no git context): ${rel}`);
    }
  }
}

function assertNoRuntimeLogs(useGit) {
  const logsRoot = path.join(APP_ROOT, "nyli-agent-swarm", "nyli-agent-swarm");
  const checks = [
    path.join(logsRoot, "logs", "agent_activity.log"),
    path.join(logsRoot, "logs", "agent_full_responses.log"),
    path.join(logsRoot, "server", "logs", "agent_activity.log"),
  ];
  for (const filePath of checks) {
    const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
    if (useGit) {
      if (hasTrackedFiles(rel)) fail(`runtime log file tracked in deploy package: ${rel}`);
      continue;
    }
    if (fs.existsSync(filePath)) fail(`runtime log file present in deploy package: ${rel}`);
  }
}

const useGit = canUseGit();
assertRequiredFiles();
assertForbiddenPaths(useGit);
assertNoRuntimeLogs(useGit);
console.log("[integrity] deploy package integrity OK");
