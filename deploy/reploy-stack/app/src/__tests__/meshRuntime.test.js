const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const MESH_ENTRY = path.resolve(
  __dirname,
  "../../nyli-agent-swarm/nyli-agent-swarm/server/src/agent/start_mesh.js"
);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(port, pathname, method = "GET", payload = null) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : "";
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({
              statusCode: res.statusCode || 0,
              body: raw ? JSON.parse(raw) : {},
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error(`timeout requesting ${pathname}`)));
    if (body) req.write(body);
    req.end();
  });
}

async function waitForHealth(port, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await requestJson(port, "/health");
      if (res.statusCode === 200) return res.body;
    } catch {
      // mesh not ready yet
    }
    await wait(200);
  }
  throw new Error(`mesh did not become healthy on port ${port}`);
}

function stopProcessTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"]);
  } catch {
    // best-effort cleanup
  }
}

describe("mesh runtime graceful degradation", () => {
  let tempDir;
  let meshProc;
  let meshPort;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-runtime-"));
    meshPort = 32000 + Math.floor(Math.random() * 1000);
  });

  afterEach(async () => {
    if (meshProc) {
      try {
        await requestJson(meshPort, "/control/swarm/shutdown", "POST", {
          reason: "jest-cleanup",
        });
        await wait(1000);
      } catch {
        // fall through to hard stop
      }
      stopProcessTree(meshProc);
      meshProc = null;
    }

    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("keeps OpenAI-backed agents alive when OPENAI_API_KEY is missing", async () => {
    const logsDir = path.join(tempDir, "logs");
    const serverLogsDir = path.join(tempDir, "server-logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(serverLogsDir, { recursive: true });

    let stderr = "";
    meshProc = spawn(process.execPath, [MESH_ENTRY], {
      cwd: path.dirname(MESH_ENTRY),
      env: {
        ...process.env,
        AGENT_LIST: "CodexAgent,OrchestratorAgent",
        AUTO_START_SUPERVISOR: "false",
        MESH_PORT: String(meshPort),
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        SWARM_LOG_DIR: logsDir,
        SWARM_LOGS_DIR: logsDir,
        SWARM_SERVER_LOG_DIR: serverLogsDir,
        SWARM_SERVER_LOGS_DIR: serverLogsDir,
        SUPPRESS_HEALTH_LOGS: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    meshProc.stdout.on("data", () => {});
    meshProc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const health = await waitForHealth(meshPort);

    expect(health.keyPresence.openai).toBe(false);
    expect(health.agentCount).toBe(2);
    expect(health.activeAgents).toBe(2);
    expect(health.agents.CodexAgent).toBe("alive");
    expect(health.agents.OrchestratorAgent).toBe("alive");
    expect(stderr).not.toContain("Missing credentials");
  });
});
