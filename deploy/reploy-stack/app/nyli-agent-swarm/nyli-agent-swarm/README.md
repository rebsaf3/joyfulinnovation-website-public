# NyLi Agent Swarm

**If you are an AI agent:** Read `docs/SWARM_SETUP.md` — it tells you exactly
what to do to deploy this swarm step by step.

**If you are a human:** Same — read `docs/SWARM_SETUP.md`.

## Quick orientation

```
server/src/agent/agentBase.js        shared agent runtime (LLM calls, routing, project writes)
server/src/agent/start_mesh.js       spawns all agents + HTTP dispatch server on port 3099
server/src/agent/supervisor.js       polls projects.json every 5 min, drives OrchestratorAgent
server/src/agent/agents/             32 specialist agent files — each is a standalone process
server/src/agent/bridge/             in-process IPC + project management utilities
scripts/setup-swarm.js               interactive setup wizard — run this first
scripts/                             monitoring + project management utilities
docs/SWARM_SETUP.md                  full step-by-step setup and operations guide
.env.example                         environment variable reference
```

## 30-second start

```bash
cp .env.example .env          # add your API keys
node scripts/setup-swarm.js   # interactive configuration wizard
cd server && npm install       # install @anthropic-ai/sdk, openai, dotenv
node server/src/agent/start_mesh.js
curl http://127.0.0.1:3099/health
```
