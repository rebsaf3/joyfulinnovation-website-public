# NyLi Reploy Stack (Drop-In Deploy Folder)

This folder is a self-contained deploy package for:
- Full NyLi app
- Swarm mesh runtime
- Swarm dashboard API + UI

If you are an automated agent, follow this README exactly.

## One-Command Start

1. Provide environment variables from `.env.example` (at minimum: `SESSION_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`).
2. Run:

```bash
npm run deploy:start
```

This command performs a non-interactive flow:
- install app/server/client dependencies
- build swarm dashboard frontend
- start app + mesh supervisor stack

## Health Checks

After startup:

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/api/swarm-status
curl http://127.0.0.1:3000/api/swarm-stats
curl http://127.0.0.1:3000/api/project-dashboard
curl http://127.0.0.1:3000/api/token-usage
curl http://127.0.0.1:3000/swarm-dashboard
```

Expected:
- `healthz` returns `OK`
- `/api/swarm-status` returns `healthy`, `degraded`, or `offline`
- dashboard routes respond without 5xx

## Runtime Modes

- **normal**: both `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` configured
- **degraded**: one provider key configured
- **minimal**: both keys missing; app stays up, mesh is skipped/degraded by default

## Swarm Control Security

- Control routes (`/api/swarm-control/*`) are always protected.
- If `SWARM_DASHBOARD_AUTH=true`, an authenticated app session is required.
- If `SWARM_DASHBOARD_AUTH=false`:
  - Set `SWARM_CONTROL_TOKEN` for token-based protection from any source.
  - If no token is set, control actions are limited to localhost requests only.

## Persistent Storage

Set `STATE_ROOT` to a mounted persistent volume path (recommended: `/data`).

Default derived paths:
- DB: `${STATE_ROOT}/leo.db`
- Swarm logs: `${STATE_ROOT}/swarm/logs`
- Swarm projects/server logs: `${STATE_ROOT}/swarm/server-logs`

## Reploy Deployment

1. Deploy this folder as the build context.
2. Use Docker build (Dockerfile included).
3. Set env vars from `.env.example`.
4. Mount persistent volume to `STATE_ROOT` (default `/data`).

## Railway Compatibility

This package remains Railway-compatible:
- `railway.json` included
- Dockerfile-based deployment supported

## Deterministic Troubleshooting

1. `SESSION_SECRET` missing:
   - Symptom: app fails at startup.
   - Fix: set `SESSION_SECRET` to a long random string.

2. Mesh offline:
   - Symptom: `/api/swarm-status` shows `offline`.
   - Fix: check mesh process logs and `MESH_PORT`.

3. Minimal mode active:
   - Symptom: `/api/swarm-status` shows `degraded` + missing keys.
   - Fix: add `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`.

4. Dashboard UI 404:
   - Symptom: `/swarm-dashboard` not found.
   - Fix: rerun `npm run deploy:start` to rebuild client dist.

5. State not persisting:
   - Symptom: DB/projects reset on restart.
   - Fix: ensure `STATE_ROOT` points to a persistent mounted volume.

## CI/Validation Commands

```bash
npm run integrity:check
npm run bootstrap
npm run smoke
```
