#!/usr/bin/env node
const http = require("http");

const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const paths = [
  "/healthz",
  "/api/swarm-status",
  "/api/swarm-stats",
  "/api/project-dashboard",
  "/api/token-usage",
  "/swarm-dashboard",
];

function fetchPath(pathname) {
  const url = new URL(pathname, BASE);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port || 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode || 0,
            body: raw.slice(0, 300),
          })
        );
      }
    );
    req.setTimeout(2500, () => req.destroy(new Error(`timeout: ${pathname}`)));
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  for (const pathname of paths) {
    const result = await fetchPath(pathname);
    if (result.statusCode < 200 || result.statusCode >= 500) {
      throw new Error(`${pathname} failed with HTTP ${result.statusCode}`);
    }
    console.log(`[smoke] ${pathname} -> ${result.statusCode}`);
  }
  console.log("[smoke] all checks passed");
}

main().catch((err) => {
  console.error("[smoke] failed:", err.message);
  process.exit(1);
});
