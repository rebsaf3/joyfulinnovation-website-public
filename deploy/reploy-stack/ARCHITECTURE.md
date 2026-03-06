# Canonical Runtime Architecture

This deploy package is the single canonical runtime for:
- Root NyLi Express application (`app/src/server.js`)
- Swarm mesh runtime (`app/nyli-agent-swarm/nyli-agent-swarm/server/src/agent/start_mesh.js`)
- Built swarm dashboard client (`app/nyli-agent-swarm/nyli-agent-swarm/client/dist`)

## Runtime Boundary

- **Runtime source of truth**
  - `app/src/*` for web app + dashboard APIs
  - `app/nyli-agent-swarm/nyli-agent-swarm/server/src/agent/*` for mesh/supervisor/agents
  - `app/nyli-agent-swarm/nyli-agent-swarm/client/src/*` for dashboard UI

- **Explicitly non-runtime in this package**
  - Nested TypeScript route layer under `.../server/src/routes/*` is intentionally excluded.
  - Planning/audit docs and local logs are intentionally excluded.

## Process Model

- `scripts/stack-supervisor.js` is the process orchestrator.
- It launches:
  - app process on `PORT` (default `3000`)
  - mesh process on `MESH_PORT` (default `3099`) when provider keys are available
- If both provider keys are missing, stack runs in **minimal mode** (app+dashboard up, mesh skipped/degraded).

## Persistence Model

- Unified state root: `STATE_ROOT` (default `/data` in container).
- App DB defaults to `${STATE_ROOT}/leo.db`.
- Swarm logs and project state default to:
  - `${STATE_ROOT}/swarm/logs`
  - `${STATE_ROOT}/swarm/server-logs`

These directories should be backed by persistent volume mounts in production.
