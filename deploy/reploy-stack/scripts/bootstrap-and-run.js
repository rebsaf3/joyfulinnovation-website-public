#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { APP_ROOT, ROOT, buildRuntimeEnv } = require("./runtime-env");

const CLIENT_ROOT = path.join(APP_ROOT, "nyli-agent-swarm", "nyli-agent-swarm", "client");
const SWARM_SERVER_ROOT = path.join(APP_ROOT, "nyli-agent-swarm", "nyli-agent-swarm", "server");

function runOrFail(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
  }
}

function ensureNode20() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`Node 20+ required, current: ${process.version}`);
  }
}

function ensureRequiredRuntimeSecrets(env) {
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).trim().length < 16) {
    throw new Error("SESSION_SECRET is required and must be at least 16 chars.");
  }
}

function existsOrFail(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required file: ${filePath}`);
}

function prepare(env) {
  existsOrFail(path.join(APP_ROOT, "package.json"));
  existsOrFail(path.join(CLIENT_ROOT, "package.json"));
  existsOrFail(path.join(SWARM_SERVER_ROOT, "package.json"));

  runOrFail("npm", ["ci"], APP_ROOT, env);
  runOrFail("npm", ["ci"], CLIENT_ROOT, env);
  runOrFail("npm", ["ci"], SWARM_SERVER_ROOT, env);
  runOrFail("npm", ["run", "build"], CLIENT_ROOT, env);
}

function main() {
  const prepareOnly = process.argv.includes("--prepare-only");
  ensureNode20();

  const { env, resolved } = buildRuntimeEnv(process.env);
  ensureRequiredRuntimeSecrets(env);

  console.log("[bootstrap] resolved runtime paths", {
    stateRoot: resolved.stateRoot,
    databasePath: resolved.databasePath,
    swarmLogsDir: resolved.swarmLogsDir,
    swarmServerLogsDir: resolved.swarmServerLogsDir,
    dashboardDist: resolved.swarmDashboardDist,
    runtimeMode: resolved.runtimeMode,
    meshShouldStart: resolved.meshShouldStart,
  });

  prepare(env);
  console.log("[bootstrap] dependencies installed and dashboard built");

  if (prepareOnly) return;
  runOrFail("node", ["scripts/stack-supervisor.js"], ROOT, env);
}

try {
  main();
} catch (err) {
  console.error("[bootstrap] fatal", err.message);
  process.exit(1);
}
