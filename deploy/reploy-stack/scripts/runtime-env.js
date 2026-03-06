const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const APP_ROOT = path.join(ROOT, "app");

function sanitizePath(value) {
  if (!value || !String(value).trim()) return "";
  return String(value).trim();
}

function resolveMaybeRelative(value, baseDir) {
  const cleaned = sanitizePath(value);
  if (!cleaned) return "";
  return path.isAbsolute(cleaned) ? cleaned : path.resolve(baseDir, cleaned);
}

function keyConfigured(value) {
  return Boolean(value && !/placeholder|your_|changeme|<|>/i.test(String(value)));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function pickStateRoot(rawEnv) {
  const preferred =
    resolveMaybeRelative(rawEnv.STATE_ROOT, ROOT) ||
    resolveMaybeRelative(rawEnv.RAILWAY_VOLUME_MOUNT_PATH, ROOT) ||
    "/data";
  try {
    ensureDir(preferred);
    return preferred;
  } catch {
    const fallback = path.join(ROOT, ".state");
    ensureDir(fallback);
    return fallback;
  }
}

function buildRuntimeEnv(rawEnv = process.env) {
  const env = { ...rawEnv };
  const stateRoot = pickStateRoot(rawEnv);
  const swarmRoot =
    resolveMaybeRelative(rawEnv.SWARM_ROOT, APP_ROOT) ||
    path.join(APP_ROOT, "nyli-agent-swarm", "nyli-agent-swarm");
  const swarmLogsDir =
    resolveMaybeRelative(rawEnv.SWARM_LOGS_DIR, APP_ROOT) ||
    path.join(stateRoot, "swarm", "logs");
  const swarmServerLogsDir =
    resolveMaybeRelative(rawEnv.SWARM_SERVER_LOGS_DIR || rawEnv.SWARM_PROJECTS_DIR, APP_ROOT) ||
    path.join(stateRoot, "swarm", "server-logs");
  const databasePath =
    resolveMaybeRelative(rawEnv.DATABASE_PATH, APP_ROOT) ||
    path.join(stateRoot, "leo.db");
  const swarmDashboardDist =
    resolveMaybeRelative(rawEnv.SWARM_DASHBOARD_DIST, APP_ROOT) ||
    path.join(swarmRoot, "client", "dist");

  ensureDir(stateRoot);
  ensureDir(path.dirname(databasePath));
  ensureDir(swarmLogsDir);
  ensureDir(swarmServerLogsDir);

  const hasAnthropic = keyConfigured(rawEnv.ANTHROPIC_API_KEY);
  const hasOpenAI = keyConfigured(rawEnv.OPENAI_API_KEY);
  const hasAnyKey = hasAnthropic || hasOpenAI;

  const meshShouldStart = hasAnyKey || String(rawEnv.FORCE_SWARM_START || "").toLowerCase() === "true";
  const runtimeMode =
    rawEnv.SWARM_RUNTIME_MODE ||
    (!hasAnyKey ? "minimal" : hasAnthropic && hasOpenAI ? "normal" : "degraded");

  env.STATE_ROOT = stateRoot;
  env.DATABASE_PATH = databasePath;
  env.SWARM_ROOT = swarmRoot;
  env.SWARM_LOGS_DIR = swarmLogsDir;
  env.SWARM_LOG_DIR = swarmLogsDir;
  env.SWARM_SERVER_LOGS_DIR = swarmServerLogsDir;
  env.SWARM_SERVER_LOG_DIR = swarmServerLogsDir;
  env.SWARM_PROJECTS_FILE = path.join(swarmServerLogsDir, "projects.json");
  env.SWARM_DASHBOARD_DIST = swarmDashboardDist;
  env.SWARM_RUNTIME_MODE = runtimeMode;
  env.SWARM_DASHBOARD_AUTH = rawEnv.SWARM_DASHBOARD_AUTH || "false";
  env.SKIP_SWARM_MESH = meshShouldStart ? "false" : "true";
  env.MESH_PORT = rawEnv.MESH_PORT || "3099";

  return {
    env,
    resolved: {
      stateRoot,
      databasePath,
      swarmRoot,
      swarmLogsDir,
      swarmServerLogsDir,
      swarmDashboardDist,
      runtimeMode,
      meshShouldStart,
      hasAnthropic,
      hasOpenAI,
    },
  };
}

module.exports = {
  ROOT,
  APP_ROOT,
  buildRuntimeEnv,
  keyConfigured,
};
