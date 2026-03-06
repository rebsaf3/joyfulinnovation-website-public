#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { APP_ROOT, ROOT, buildRuntimeEnv } = require("./runtime-env");

const APP_ENTRY = path.join(APP_ROOT, "src", "server.js");
const MESH_ENTRY = path.join(
  APP_ROOT,
  "nyli-agent-swarm",
  "nyli-agent-swarm",
  "server",
  "src",
  "agent",
  "start_mesh.js"
);
const SWARM_STATUS_FILE = path.join(ROOT, "runtime-status.json");
const MAX_MESH_RESTARTS = Number(process.env.MESH_MAX_RESTARTS) || 3;

const { env, resolved } = buildRuntimeEnv(process.env);
let shuttingDown = false;
let meshProcess = null;
let appProcess = null;
let meshRestartCount = 0;

function writeStatus(data) {
  fs.writeFileSync(
    SWARM_STATUS_FILE,
    JSON.stringify({ ts: new Date().toISOString(), ...data }, null, 2)
  );
}

function log(message, details = {}) {
  // concise, machine-friendly startup logs
  console.log(`[stack] ${message}`, details);
}

function stopProcess(proc, signal = "SIGTERM") {
  if (!proc || proc.exitCode !== null) return;
  try {
    proc.kill(signal);
  } catch {
    // no-op
  }
}

function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutdown_requested", { reason, code });
  writeStatus({ status: "shutting_down", reason, code });
  stopProcess(meshProcess, "SIGTERM");
  stopProcess(appProcess, "SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}

function spawnMesh() {
  if (!resolved.meshShouldStart) {
    writeStatus({
      status: "degraded",
      reason: "mesh_skipped_missing_provider_keys",
      runtimeMode: resolved.runtimeMode,
      meshStarted: false,
    });
    log("mesh_skipped", { runtimeMode: resolved.runtimeMode });
    return null;
  }

  log("mesh_starting", {
    meshEntry: MESH_ENTRY,
    meshPort: env.MESH_PORT,
    runtimeMode: resolved.runtimeMode,
  });
  const proc = spawn("node", [MESH_ENTRY], {
    cwd: APP_ROOT,
    stdio: "inherit",
    env,
  });

  proc.on("exit", (exitCode) => {
    if (shuttingDown) return;
    log("mesh_exited", { exitCode });
    if (exitCode === 0) {
      writeStatus({
        status: "degraded",
        reason: "mesh_stopped",
        runtimeMode: resolved.runtimeMode,
        meshStarted: true,
      });
      return;
    }
    if (meshRestartCount >= MAX_MESH_RESTARTS) {
      writeStatus({
        status: "degraded",
        reason: "mesh_crash_loop",
        restartAttempts: meshRestartCount,
        runtimeMode: resolved.runtimeMode,
        meshStarted: false,
      });
      return;
    }
    meshRestartCount += 1;
    setTimeout(() => {
      if (!shuttingDown) meshProcess = spawnMesh();
    }, 2000).unref();
  });

  return proc;
}

function spawnApp() {
  log("app_starting", {
    appEntry: APP_ENTRY,
    databasePath: env.DATABASE_PATH,
  });
  const proc = spawn("node", [APP_ENTRY], {
    cwd: APP_ROOT,
    stdio: "inherit",
    env,
  });

  proc.on("exit", (exitCode) => {
    if (shuttingDown) return;
    log("app_exited", { exitCode });
    shutdown("app_exited", exitCode || 1);
  });
  return proc;
}

function main() {
  if (!fs.existsSync(APP_ENTRY)) {
    console.error(`[stack] app entry missing: ${APP_ENTRY}`);
    process.exit(1);
  }
  if (resolved.meshShouldStart && !fs.existsSync(MESH_ENTRY)) {
    console.error(`[stack] mesh entry missing: ${MESH_ENTRY}`);
    process.exit(1);
  }

  writeStatus({
    status: resolved.meshShouldStart ? "starting" : "degraded",
    runtimeMode: resolved.runtimeMode,
    meshShouldStart: resolved.meshShouldStart,
    paths: {
      stateRoot: resolved.stateRoot,
      db: resolved.databasePath,
      swarmLogs: resolved.swarmLogsDir,
      swarmServerLogs: resolved.swarmServerLogsDir,
      dashboardDist: resolved.swarmDashboardDist,
    },
  });

  meshProcess = spawnMesh();
  appProcess = spawnApp();

  process.on("SIGINT", () => shutdown("sigint", 0));
  process.on("SIGTERM", () => shutdown("sigterm", 0));
}

main();
