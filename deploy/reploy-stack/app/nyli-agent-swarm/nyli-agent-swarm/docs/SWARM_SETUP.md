# NyLi Agent Swarm — Setup Guide for a New Repository

You are an AI agent tasked with setting up the NyLi multi-agent orchestration
swarm in a Node.js repository. This file tells you exactly what to do, in
order. Follow every step. Do not skip steps or make assumptions.

If the swarm files do not yet exist in the target repo, read
`docs/swarm-packaging-prompt.md` first — it tells you how to build them from
scratch. This guide assumes the files are already in place and you need to
configure and run them.

---

## What You Are Setting Up

A multi-agent AI mesh where:
- Each agent is a Node.js child process receiving tasks over stdin
- A central HTTP server on `127.0.0.1:3099` routes tasks to agents
- Agents collaborate by emitting JSON routing directives in LLM output
- Project state is tracked in `server/logs/projects.json`
- A supervisor loop polls every 5 minutes and drives `OrchestratorAgent`

---

## Required Files

Confirm these exist in the target repo before proceeding:

```
server/src/agent/agentBase.js          — shared agent runtime
server/src/agent/start_mesh.js         — mesh launcher + HTTP dispatch server
server/src/agent/supervisor.js         — project supervisor loop
server/src/agent/agents/               — individual agent .js files (at least 1)
server/src/agent/agents/OrchestratorAgent.js
server/src/agent/agents/ClaudeAgent.js
server/src/agent/agents/CodexAgent.js
server/src/agent/agents/ErrorBoundaryAgent.js
scripts/setup-swarm.js                 — interactive setup wizard
```

If any are missing, read `docs/swarm-packaging-prompt.md` to build them.

---

## Step 1 — Prerequisites

Check Node version:
```bash
node --version
# Must be >= 20. If not, install Node 20+ before continuing.
```

Confirm `server/package.json` has `"type": "module"` (ESM). If it doesn't,
add it — all agent files use ESM imports.

---

## Step 2 — API Keys

You need:
- **ANTHROPIC_API_KEY** — from https://console.anthropic.com — used by Claude agents
- **OPENAI_API_KEY** — from https://platform.openai.com/api-keys — used by Codex agents and OrchestratorAgent

If the target repo has a `.env` file, add the keys there. If not, create `.env`
in the repo root:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
JWT_SECRET=any-long-random-string-at-least-32-chars
```

---

## Step 3 — Run the Setup Wizard

The wizard validates keys, lets you choose which agents to run, sets the mesh
port, and writes everything to `.env`:

```bash
node scripts/setup-swarm.js
```

Walk through the prompts:
1. It checks Node version and key files automatically
2. Enter API keys if prompted (or press Enter to skip if already set)
3. Choose model defaults — press Enter to accept `claude-haiku-4-5-20251001` and `gpt-4o-mini`
4. Choose agent preset: enter `2` for **standard** (all agents) or `1` for **minimal**
5. Choose mesh port — press Enter to accept `3099`
6. Choose advanced timing — press Enter to skip (defaults are fine)
7. It installs missing packages if needed

After the wizard completes, verify `.env` has `AGENT_LIST` set.

---

## Step 4 — Install Dependencies

From the repo root:

```bash
npm install
cd server && npm install && cd ..
```

Required packages in `server/node_modules`: `@anthropic-ai/sdk`, `openai`, `dotenv`.

---

## Step 5 — Start the Swarm

```bash
node server/src/agent/start_mesh.js
```

You should see output like:
```
[mesh] mesh_starting { agents: ['ClaudeAgent', 'CodexAgent', 'OrchestratorAgent', ...] }
[mesh] agent_starting { agentName: 'ClaudeAgent' }
[mesh] agent_starting { agentName: 'CodexAgent' }
...
[mesh] dispatch_server_listening { port: 3099 }
```

The supervisor starts automatically. Keep this process running.

---

## Step 6 — Verify Health

In a second terminal:

```bash
curl http://127.0.0.1:3099/health
```

Expected: `{"status":"ok","agents":["ClaudeAgent","CodexAgent",...]}`

If you get connection refused, the mesh hasn't started. Check the terminal
where you ran `start_mesh.js` for `agent_spawn_failed` errors.

---

## Step 7 — Send a Test Task

```bash
curl -X POST http://127.0.0.1:3099/dispatch \
  -H 'Content-Type: application/json' \
  -d '{"agent":"ClaudeAgent","task":"Say hello and confirm you are running."}'
```

Watch the terminal where `start_mesh.js` is running — you should see
`task_received` and `task_complete` log lines within a few seconds.

---

## Step 8 — Create a Project

A project gives `OrchestratorAgent` a goal. It plans tasks and dispatches them
to specialist agents. The supervisor advances it automatically every 5 minutes.

```bash
curl -X POST http://127.0.0.1:3099/dispatch \
  -H 'Content-Type: application/json' \
  -d '{
    "agent": "OrchestratorAgent",
    "task": "{\"type\":\"plan_project\",\"name\":\"test-project\",\"description\":\"Add a hello world endpoint\",\"goals\":\"Create GET /hello that returns {message:hello}\"}"
  }'
```

Check the result:
```bash
node scripts/check_projects.js
```

---

## Step 9 — Monitor Logs

Tail live activity:
```bash
node scripts/tail_log.js
```

Search for specific events:
```bash
node scripts/search_log.js task_complete
node scripts/search_log.js OrchestratorAgent
```

Manually trigger a supervisor tick (useful for testing):
```bash
node scripts/force_tick.js
```

---

## Environment Variables Reference

Set these in `.env` to tune behaviour. Defaults are shown.

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Anthropic key. |
| `OPENAI_API_KEY` | — | **Required.** OpenAI key. |
| `MESH_PORT` | `3099` | Dispatch server port. |
| `AGENT_MODEL` | `claude-haiku-4-5-20251001` | Model for Claude agents. |
| `CODEX_MODEL` | `gpt-4o-mini` | Model for Codex agents. |
| `AGENT_LIST` | all agents | Comma-separated list of agents to start. |
| `AUTO_START_SUPERVISOR` | `true` | Start supervisor with mesh. |
| `SUPERVISOR_INTERVAL_MS` | `300000` | Supervisor poll interval (5 min). |
| `SUPERVISOR_BATCH_SIZE` | `3` | Max tasks per supervisor tick. |
| `SUPERVISOR_STALL_MS` | `1800000` | Time before task considered stalled (30 min). |
| `HEARTBEAT_INTERVAL_MS` | `1800000` | Agent heartbeat log interval. |
| `AUTO_START_MESH` | `true` | Auto-start mesh when Express boots. |

---

## Adding New Agents

To add a specialist agent:

1. Create `server/src/agent/agents/MyAgent.js`:

```js
import { runAgent } from '../agentBase.js';
const agentName = process.env.AGENT_NAME || 'MyAgent';
const systemPrompt = `You are a specialist agent responsible for ...

COLLABORATION:
When you need help from another agent, include a JSON routing directive in your response:
{"route":"AgentName","task":"Specific task description"}
`;
runAgent(agentName, systemPrompt);
```

2. Restart `start_mesh.js` — it discovers new agents automatically.

No registration, no config changes needed.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `agent_spawn_failed` in log | Check the agent .js file exists and has no syntax errors |
| OrchestratorAgent exits immediately | Check `OPENAI_API_KEY` is set — it is required |
| Tasks received but no response | Check API keys are valid; look for `provider_error` in log |
| Supervisor not advancing tasks | Run `node scripts/force_tick.js`; check `supervisor_tick` in log |
| ESM `require is not defined` error | The agent file is using CommonJS in an ESM module — change `require()` to `import` |
| `cannot find module agentBase.js` | Check `server/package.json` has `"type": "module"` |

---

## Validation Checklist

Before declaring the swarm operational:

```
[ ] node --version → v20 or higher
[ ] server/package.json has "type": "module"
[ ] .env has ANTHROPIC_API_KEY (not a placeholder)
[ ] .env has OPENAI_API_KEY (not a placeholder)
[ ] npm install completed in server/ without errors
[ ] node server/src/agent/start_mesh.js → all agents listed in output
[ ] curl http://127.0.0.1:3099/health → {"status":"ok",...}
[ ] POST /dispatch to ClaudeAgent → task_received in log
[ ] POST /dispatch to OrchestratorAgent with plan_project → project created in projects.json
[ ] node scripts/check_projects.js → project listed with pending tasks
[ ] node scripts/force_tick.js → tasks move to in-progress
```

All boxes checked = swarm is operational.
