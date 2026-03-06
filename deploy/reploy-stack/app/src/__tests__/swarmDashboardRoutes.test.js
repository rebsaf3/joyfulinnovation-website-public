const express = require("express");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const request = require("supertest");

function createTempSwarmDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-dashboard-routes-"));
  const logsDir = path.join(root, "logs");
  const serverLogsDir = path.join(root, "server-logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(serverLogsDir, { recursive: true });
  return { root, logsDir, serverLogsDir };
}

function buildTestApp(options = {}) {
  const {
    dashboardAuth = false,
    controlToken,
    meshPort,
    logsDir,
    serverLogsDir,
    sessionUserId = null,
  } = options;

  jest.resetModules();
  process.env.SWARM_DASHBOARD_AUTH = dashboardAuth ? "true" : "false";
  process.env.MESH_PORT = String(meshPort ?? 65535);
  process.env.SWARM_LOGS_DIR = logsDir;
  process.env.SWARM_SERVER_LOGS_DIR = serverLogsDir;
  if (controlToken) {
    process.env.SWARM_CONTROL_TOKEN = controlToken;
  } else {
    delete process.env.SWARM_CONTROL_TOKEN;
  }

  const { swarmDashboardRouter } = require("../swarmDashboardRoutes");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use((req, _res, next) => {
    if (sessionUserId) req.session = { userId: sessionUserId };
    next();
  });
  app.use("/api", swarmDashboardRouter);
  return app;
}

describe("swarmDashboardRoutes control access", () => {
  const originalEnv = { ...process.env };
  let tempDirs;

  beforeEach(() => {
    tempDirs = createTempSwarmDirs();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (tempDirs?.root) {
      fs.rmSync(tempDirs.root, { recursive: true, force: true });
    }
  });

  it("blocks remote control requests when dashboard auth is disabled and control token is missing", async () => {
    const app = buildTestApp({
      dashboardAuth: false,
      controlToken: null,
      logsDir: tempDirs.logsDir,
      serverLogsDir: tempDirs.serverLogsDir,
    });

    const res = await request(app)
      .post("/api/swarm-control/shutdown")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ reason: "test" });

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.error || "")).toContain("SWARM_CONTROL_TOKEN");
  });

  it("requires SWARM_CONTROL_TOKEN for control endpoints when token is configured", async () => {
    const app = buildTestApp({
      dashboardAuth: false,
      controlToken: "control-secret",
      logsDir: tempDirs.logsDir,
      serverLogsDir: tempDirs.serverLogsDir,
    });

    const res = await request(app)
      .post("/api/swarm-control/shutdown")
      .set("X-Forwarded-For", "127.0.0.1")
      .send({ reason: "test" });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("allows token-authorized control request to pass middleware", async () => {
    const app = buildTestApp({
      dashboardAuth: false,
      controlToken: "control-secret",
      logsDir: tempDirs.logsDir,
      serverLogsDir: tempDirs.serverLogsDir,
      meshPort: 65535, // no mesh listener; route should pass auth and fail upstream
    });

    const res = await request(app)
      .post("/api/swarm-control/shutdown")
      .set("x-swarm-control-token", "control-secret")
      .send({ reason: "test" });

    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.error || "")).toContain("failed");
  });
});

describe("swarmDashboardRoutes /swarm-stats", () => {
  const originalEnv = { ...process.env };
  let tempDirs;
  let meshServer;
  let meshPort;

  beforeEach(() => {
    tempDirs = createTempSwarmDirs();
  });

  afterEach(async () => {
    if (meshServer) {
      await new Promise((resolve) => meshServer.close(resolve));
      meshServer = null;
    }
    process.env = { ...originalEnv };
    if (tempDirs?.root) {
      fs.rmSync(tempDirs.root, { recursive: true, force: true });
    }
  });

  it("falls back to live /health payload when mesh_health_check log event is missing", async () => {
    meshServer = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            agents: {
              AgentA: "alive",
              AgentB: "alive",
              AgentC: "exited(1)",
            },
          })
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise((resolve) => meshServer.listen(0, "127.0.0.1", resolve));
    meshPort = meshServer.address().port;

    const app = buildTestApp({
      dashboardAuth: false,
      controlToken: null,
      meshPort,
      logsDir: tempDirs.logsDir,
      serverLogsDir: tempDirs.serverLogsDir,
    });

    const res = await request(app).get("/api/swarm-stats");

    expect(res.status).toBe(200);
    expect(res.body.totalAgents).toBe(3);
    expect(res.body.onlineAgents).toBe(2);
    expect(res.body.uptimeMap.AgentA).toBe("alive");
  });
});
