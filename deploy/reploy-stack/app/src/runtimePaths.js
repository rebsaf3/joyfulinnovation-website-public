const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SWARM_ROOT = path.join(APP_ROOT, "nyli-agent-swarm", "nyli-agent-swarm");

function resolveAbsolute(candidate, fallback) {
  if (!candidate || !String(candidate).trim()) return path.resolve(fallback);
  return path.isAbsolute(candidate) ? candidate : path.resolve(APP_ROOT, candidate);
}

function resolveStateRoot() {
  return resolveAbsolute(
    process.env.STATE_ROOT ||
      process.env.PERSIST_ROOT ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH ||
      "data",
    path.join(APP_ROOT, "data")
  );
}

function resolveDbPath() {
  const explicit = process.env.DATABASE_PATH;
  if (explicit && String(explicit).trim()) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(APP_ROOT, explicit);
  }
  return path.join(resolveStateRoot(), "leo.db");
}

function resolveSwarmRoot() {
  return resolveAbsolute(process.env.SWARM_ROOT, DEFAULT_SWARM_ROOT);
}

function resolveSwarmLogsDir() {
  return resolveAbsolute(process.env.SWARM_LOGS_DIR, path.join(resolveSwarmRoot(), "logs"));
}

function resolveSwarmServerLogsDir() {
  return resolveAbsolute(
    process.env.SWARM_SERVER_LOGS_DIR || process.env.SWARM_PROJECTS_DIR,
    path.join(resolveSwarmRoot(), "server", "logs")
  );
}

function resolveSwarmActivityLogCandidates() {
  if (process.env.SWARM_ACTIVITY_LOG) {
    const single = path.isAbsolute(process.env.SWARM_ACTIVITY_LOG)
      ? process.env.SWARM_ACTIVITY_LOG
      : path.resolve(APP_ROOT, process.env.SWARM_ACTIVITY_LOG);
    return [single];
  }
  return [
    path.join(resolveSwarmLogsDir(), "agent_activity.log"),
    path.join(resolveSwarmServerLogsDir(), "agent_activity.log"),
  ];
}

function resolveSwarmProjectsFileCandidates() {
  if (process.env.SWARM_PROJECTS_FILE) {
    const single = path.isAbsolute(process.env.SWARM_PROJECTS_FILE)
      ? process.env.SWARM_PROJECTS_FILE
      : path.resolve(APP_ROOT, process.env.SWARM_PROJECTS_FILE);
    return [single];
  }
  return [
    path.join(resolveSwarmLogsDir(), "projects.json"),
    path.join(resolveSwarmServerLogsDir(), "projects.json"),
  ];
}

function resolveSwarmDashboardDist() {
  return resolveAbsolute(process.env.SWARM_DASHBOARD_DIST, path.join(resolveSwarmRoot(), "client", "dist"));
}

function resolveMeshPort() {
  return Number(process.env.MESH_PORT) || 3099;
}

function resolveSwarmRuntimeMode() {
  return String(process.env.SWARM_RUNTIME_MODE || "auto").toLowerCase();
}

module.exports = {
  APP_ROOT,
  resolveStateRoot,
  resolveDbPath,
  resolveSwarmRoot,
  resolveSwarmLogsDir,
  resolveSwarmServerLogsDir,
  resolveSwarmActivityLogCandidates,
  resolveSwarmProjectsFileCandidates,
  resolveSwarmDashboardDist,
  resolveMeshPort,
  resolveSwarmRuntimeMode,
};
