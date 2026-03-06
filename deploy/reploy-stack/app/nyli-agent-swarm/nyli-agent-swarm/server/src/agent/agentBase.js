// Shared base for all swarm agents — handles Anthropic/OpenAI API calls + logging
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import SDK from '@anthropic-ai/sdk';
import { OpenAI } from 'openai';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const Anthropic = SDK.default || SDK;

const LOG_DIR = process.env.SWARM_LOG_DIR
  ? path.resolve(process.env.SWARM_LOG_DIR)
  : path.resolve(__dirname, '../../../logs');
const LOG_FILE = path.join(LOG_DIR, 'agent_activity.log');
const TEMP_LOG_FILE = path.join(LOG_DIR, 'agent_activity_temp.log');
const FULL_RESPONSE_LOG_FILE = path.join(LOG_DIR, 'agent_full_responses.log');
// projects.json lives in server/logs (one level up from root logs), matching supervisor.js
const PROJECTS_DIR = process.env.SWARM_SERVER_LOGS_DIR
  ? path.resolve(process.env.SWARM_SERVER_LOGS_DIR)
  : path.resolve(__dirname, '../../logs');

// Use AGENT_NAME from environment, fallback to CodexAgent
const AGENT_NAME = process.env.AGENT_NAME || 'CodexAgent';
const TASK_QUEUE_MAX = Number(process.env.AGENT_TASK_QUEUE_MAX) || 100;
const ROUTE_FANOUT_LIMIT = Number(process.env.ROUTE_FANOUT_LIMIT) || 5;
const ROUTE_DEDUPE_WINDOW_MS = Number(process.env.ROUTE_DEDUPE_WINDOW_MS) || 2 * 60_000;
const ERROR_ESCALATION_WINDOW_MS = Number(process.env.ERROR_ESCALATION_WINDOW_MS) || 60_000;
const MESH_DISPATCH_TIMEOUT_MS = Number(process.env.MESH_DISPATCH_TIMEOUT_MS) || 5_000;
const FULL_RESPONSE_LOG_ENABLED = String(process.env.FULL_RESPONSE_LOG_ENABLED || '1') !== '0';
const FULL_RESPONSE_LOG_MAX_CHARS = Number(process.env.FULL_RESPONSE_LOG_MAX_CHARS) || 0;
const recentRouteDispatches = new Map();
const recentEscalations = new Map();
const recentProjectNotifications = new Map();
const PROJECT_NOTIFY_DEDUPE_MS = Number(process.env.PROJECT_NOTIFY_DEDUPE_MS) || 60_000;

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) { fs.mkdirSync(LOG_DIR, { recursive: true }); }

// Startup diagnostics without leaking secrets
fs.appendFileSync(LOG_FILE, JSON.stringify({
  ts: new Date().toISOString(),
  level: 'DEBUG',
  event: 'agent_startup',
  agent: AGENT_NAME,
  argv: process.argv,
  cwd: process.cwd(),
  pid: process.pid,
  keyPresence: {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY && !/placeholder/i.test(process.env.ANTHROPIC_API_KEY)),
    openai: Boolean(process.env.OPENAI_API_KEY && !/placeholder/i.test(process.env.OPENAI_API_KEY)),
  }
}) + '\n');

function safeLog(level, event, agentName = AGENT_NAME, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, agent: agentName, ...data }) + '\n';
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    fs.appendFileSync(TEMP_LOG_FILE, line);
    console.error(`[${agentName}] log fallback to temp file:`, err.message);
  }
  console.log(`[${agentName}] ${event}`, data);
}

function log(level, event, agentName = AGENT_NAME, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, agent: agentName, ...data }) + '\n';
  fs.appendFileSync(LOG_FILE, line);
  console.log(`[${agentName}] ${event}`, data);
}

function logFullResponse(agentName, task, result, meta = {}) {
  if (!FULL_RESPONSE_LOG_ENABLED) return;
  const output = String(result ?? '');
  const cappedOutput = FULL_RESPONSE_LOG_MAX_CHARS > 0 && output.length > FULL_RESPONSE_LOG_MAX_CHARS
    ? output.slice(0, FULL_RESPONSE_LOG_MAX_CHARS)
    : output;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event: 'agent_full_response',
    agent: agentName,
    taskPreview: String(task).slice(0, 200),
    outputChars: output.length,
    truncated: cappedOutput.length !== output.length,
    response: cappedOutput,
    ...meta,
  }) + '\n';
  try {
    fs.appendFileSync(FULL_RESPONSE_LOG_FILE, line);
  } catch (err) {
    safeLog('WARN', 'full_response_log_failed', agentName, { error: err.message });
  }
}

function parseIncomingTask(raw, agentName, meta = {}) {
  let task;
  let projectName = null, taskId = null;
  let parseError = false;
  try {
    const parsed = JSON.parse(String(raw).trim());
    ({ task } = parsed);
    projectName = parsed.projectName ?? null;
    taskId = parsed.taskId != null ? String(parsed.taskId) : null;

    // When OrchestratorAgent dispatches project-managed tasks it serialises the
    // payload as JSON.stringify({ task, projectName, taskId }).  The mesh then
    // wraps that string in another { task } envelope, so the outer `task` field
    // here is itself a JSON string.  Unwrap it so the agent receives a clean
    // description and the project context fields are populated correctly.
    //
    // Guard: do NOT unwrap error-escalation payloads ({ failedAgent, error, task })
    // because ErrorBoundaryAgent needs to receive the full JSON structure.
    if (typeof task === 'string' && task.trimStart().startsWith('{')) {
      try {
        const inner = JSON.parse(task);
        if (typeof inner.task === 'string' && !inner.failedAgent && !inner.error) {
          task = inner.task;
          if (projectName === null) projectName = inner.projectName ?? null;
          if (taskId === null) taskId = inner.taskId != null ? String(inner.taskId) : null;
        }
      } catch { /* inner string is not JSON — use as-is */ }
    }
  } catch (err) {
    parseError = true;
    safeLog('WARN', 'task_parse_error', agentName, {
      raw: String(raw).slice(0, 120),
      error: err?.message,
      recovered: false,
      ...meta,
    });
    if (typeof raw === 'string' && raw.trim().length > 0) {
      task = raw.trim();
      safeLog('INFO', 'task_recovered', agentName, {
        task: String(task).slice(0, 120),
        ...meta,
      });
    } else {
      safeLog('ERROR', 'task_handler_no_task', agentName, { raw: String(raw).slice(0, 120), ...meta });
      return null;
    }
  }

  if (task === undefined || task === null || String(task).trim().length === 0) {
    safeLog('ERROR', 'task_handler_no_task', agentName, { raw: String(raw).slice(0, 120), ...meta });
    return null;
  }

  return { task: String(task), parseError, projectName, taskId };
}

function attachStdinTaskQueue(agentName, handleTask) {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  const queue = [];
  let draining = false;

  const drainQueue = async () => {
    if (draining) return;
    draining = true;
    while (queue.length > 0) {
      const raw = queue.shift();
      try {
        await handleTask(raw);
      } catch (err) {
        safeLog('ERROR', 'task_handler_crashed', agentName, { error: err?.message });
      }
    }
    draining = false;
  };

  process.stdin.on('data', chunk => {
    buffer += String(chunk);
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      if (queue.length >= TASK_QUEUE_MAX) {
        safeLog('WARN', 'task_queue_overflow', agentName, { maxQueue: TASK_QUEUE_MAX });
        continue;
      }
      queue.push(line);
    }
    void drainQueue();
  });

  process.stdin.on('end', () => {
    if (buffer.trim().length > 0) queue.push(buffer.trim());
    buffer = '';
    void drainQueue();
  });
}

function shouldDispatchEscalation(agentName, task, error) {
  const now = Date.now();
  const errorMessage = String(error?.message || error || '').slice(0, 200);
  const key = `${agentName}|${String(task).slice(0, 200)}|${errorMessage}`;
  const last = recentEscalations.get(key);
  if (last && now - last < ERROR_ESCALATION_WINDOW_MS) return false;
  recentEscalations.set(key, now);
  for (const [k, ts] of recentEscalations) {
    if (now - ts > ERROR_ESCALATION_WINDOW_MS) recentEscalations.delete(k);
  }
  return true;
}

function shouldDispatchRoute(fromAgent, toAgent, task) {
  const now = Date.now();
  const key = `${fromAgent}->${toAgent}|${String(task).slice(0, 240)}`;
  const last = recentRouteDispatches.get(key);
  if (last && now - last < ROUTE_DEDUPE_WINDOW_MS) return false;
  recentRouteDispatches.set(key, now);
  for (const [k, ts] of recentRouteDispatches) {
    if (now - ts > ROUTE_DEDUPE_WINDOW_MS) recentRouteDispatches.delete(k);
  }
  return true;
}

function getTaskContext() {
  const projectName = process.env.PROJECT_NAME || null;
  const rawTaskId = process.env.TASK_ID;
  const taskId = rawTaskId === undefined || rawTaskId === null || rawTaskId === '' ? null : rawTaskId;
  return { projectName, taskId };
}

function normalizeErrorMessage(err) {
  if (!err) return '';
  return String(err?.message || err);
}

function createOptionalOpenAIClient(agentName, details = {}) {
  const rawKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!rawKey || /placeholder/i.test(rawKey)) {
    return { client: null, disabledReason: 'missing OPENAI_API_KEY' };
  }

  try {
    return {
      client: new OpenAI({ apiKey: rawKey }),
      disabledReason: null,
    };
  } catch (err) {
    const disabledReason = normalizeErrorMessage(err).slice(0, 300) || 'OpenAI client initialization failed';
    safeLog('WARN', 'openai_init_failed', agentName, {
      reason: disabledReason,
      ...details,
    });
    return { client: null, disabledReason };
  }
}

function isAnthropicProviderFatal(err) {
  const msg = normalizeErrorMessage(err).toLowerCase();
  return (
    msg.includes('authentication_error') ||
    msg.includes('invalid x-api-key') ||
    msg.includes('api key') && (msg.includes('invalid') || msg.includes('missing')) ||
    msg.includes('credit balance is too low') ||
    msg.includes('insufficient_quota') ||
    msg.includes('permission_error') ||
    msg.includes('forbidden')
  );
}

/**
 * Run an agent process with a given system prompt.
 * Handles: ready log, heartbeat, stdin task processing via Anthropic, SIGTERM.
 */
function runAgent(agentName = AGENT_NAME, systemPrompt) {
  // determine whether a *valid-looking* Anthropic key is present. the
  // placeholder strings we inject for docs/tests should not count, and if the
  // key turns out to be invalid at runtime we will catch that in the init
  // block below and mark the provider disabled so the process doesn't crash.
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY && !/placeholder/i.test(process.env.ANTHROPIC_API_KEY));
  let anthropicClient = null;
  let anthropicDisabledReason = null;
  let anthropicDisabledAt = 0;

  if (hasAnthropicKey) {
    try {
      anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      // some versions of the SDK may return `null` or an unexpected value if
      // the key is bogus; guard against that by verifying the shape.
      if (!anthropicClient || typeof anthropicClient.messages !== 'object') {
        throw new Error('invalid Anthropic client (was null or missing .messages)');
      }
    } catch (err) {
      anthropicDisabledReason = normalizeErrorMessage(err).slice(0, 300);
      anthropicDisabledAt = Date.now();
      safeLog('WARN', 'anthropic_init_failed', agentName, {
        reason: anthropicDisabledReason,
        disabledAt: new Date(anthropicDisabledAt).toISOString(),
      });
      // leave anthropicClient null so handler will switch to fallback
    }
  }

  const anthropicModel  = process.env.AGENT_MODEL || 'claude-haiku-4-5-20251001';
  const openAIKeyPresent = Boolean(process.env.OPENAI_API_KEY && !/placeholder/i.test(process.env.OPENAI_API_KEY));
  const allowOpenAIFallback =
    openAIKeyPresent &&
    String(process.env.ALLOW_OPENAI_FALLBACK_FOR_ANTHROPIC ?? 'true').toLowerCase() !== 'false';
  const openAIClient = allowOpenAIFallback ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  const fallbackModel = process.env.ANTHROPIC_FALLBACK_MODEL || process.env.CODEX_MODEL || 'gpt-4o-mini';

  safeLog('INFO', 'agent_ready', agentName, {
    model: anthropicModel,
    provider: 'anthropic',
    openAIFallbackEnabled: allowOpenAIFallback,
    anthropicDisabled: Boolean(anthropicDisabledReason) || !anthropicClient,
    fallbackModel: allowOpenAIFallback ? fallbackModel : null,
  });

  // Heartbeat
  // Set heartbeat interval to 30 minutes (1800000 ms) for CodexAgent
  const HEARTBEAT_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 1_800_000;
  setInterval(() => {
    safeLog('INFO', 'agent_heartbeat', agentName, {
      uptimeMs: Math.round(process.uptime() * 1000),
      anthropicDisabled: Boolean(anthropicDisabledReason),
    });
  }, HEARTBEAT_MS).unref();

  async function executeOpenAIFallback(task) {
    if (!openAIClient) {
      throw new Error('OpenAI fallback unavailable (missing OPENAI_API_KEY or fallback disabled)');
    }
    const response = await openAIClient.chat.completions.create({
      model: fallbackModel,
      max_tokens: 512,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ],
    });
    return {
      result: response.choices[0]?.message?.content ?? '',
      usage: response.usage ?? {},
      provider: 'openai-fallback',
      model: fallbackModel,
      endpoint: 'chat.completions',
    };
  }

  async function handleTask(raw) {
    const parsed = parseIncomingTask(raw, agentName, {
      model: anthropicModel,
      provider: anthropicDisabledReason || !anthropicClient ? 'openai-fallback' : 'anthropic',
    });
    if (!parsed) return;
    const { task, parseError, projectName: inlineProject, taskId: inlineTaskId } = parsed;
    const { projectName: envProject, taskId: envTaskId } = getTaskContext();
    const projectName = inlineProject || envProject;
    const taskId = inlineTaskId || envTaskId;

    // Always log task_received for every agent
    safeLog('INFO', 'task_received', agentName, {
      task: task.slice(0, 120),
      model: anthropicDisabledReason ? fallbackModel : anthropicModel,
      provider: anthropicDisabledReason ? 'openai-fallback' : 'anthropic',
      parseError,
      project: projectName,
      taskId,
    });
    // Log work_started for every agent
    safeLog('INFO', 'work_started', agentName, {
      project: projectName,
      taskId,
      taskDescription: task.slice(0, 120)
    });
    const start = Date.now();
    try {
      let runResult;
      if (anthropicDisabledReason || !anthropicClient) {
        runResult = await executeOpenAIFallback(task);
      } else {
        try {
          const response = await anthropicClient.messages.create({
            model: anthropicModel,
            max_tokens: 512,
            system: systemPrompt,
            messages: [{ role: 'user', content: task }],
          });
          runResult = {
            result: response.content[0]?.type === 'text' ? response.content[0].text : '',
            usage: response.usage ?? {},
            provider: 'anthropic',
            model: anthropicModel,
            endpoint: 'messages',
          };
        } catch (anthropicErr) {
          if (allowOpenAIFallback && isAnthropicProviderFatal(anthropicErr)) {
            anthropicDisabledReason = normalizeErrorMessage(anthropicErr).slice(0, 300);
            anthropicDisabledAt = Date.now();
            safeLog('WARN', 'anthropic_provider_disabled', agentName, {
              reason: anthropicDisabledReason,
              disabledAt: new Date(anthropicDisabledAt).toISOString(),
              fallbackProvider: 'openai',
              fallbackModel,
            });
            runResult = await executeOpenAIFallback(task);
          } else {
            throw anthropicErr;
          }
        }
      }

      const result = String(runResult?.result ?? '');
      const tokens = runResult?.usage ?? {};
      const inputTokens = tokens.input_tokens ?? tokens.prompt_tokens ?? null;
      const outputTokens = tokens.output_tokens ?? tokens.completion_tokens ?? null;
      const provider = runResult?.provider ?? 'unknown';
      safeLog('INFO', 'task_complete', agentName, {
        project: projectName,
        taskId,
        taskDescription: task.slice(0, 120),
        resultPreview: result.slice(0, 200),
        durationMs: Date.now() - start,
        inputTokens,
        outputTokens,
        provider,
      });
      safeLog('INFO', 'work_completed', agentName, {
        project: projectName,
        taskId,
        taskDescription: task.slice(0, 120),
        resultPreview: result.slice(0, 200),
        durationMs: Date.now() - start,
        inputTokens,
        outputTokens,
        provider,
      });
      parseAndDispatchRoutes(result, agentName, projectName);
      updateProjectTaskFile(projectName, taskId, 'complete', result);
      notifyProjectCompletion(projectName, agentName)
        .catch(err => safeLog('WARN', 'project_notify_error', agentName, { error: err.message }));
    } catch (err) {
      const errorMessage = normalizeErrorMessage(err);
      const providerFailure = isAnthropicProviderFatal(err);
      safeLog('ERROR', 'task_failed', agentName, {
        project: projectName,
        taskId,
        task:      task.slice(0, 120),
        error:     errorMessage,
        durationMs: Date.now() - start,
        provider: anthropicDisabledReason ? 'openai-fallback' : 'anthropic',
      });
      updateProjectTaskFile(projectName, taskId, 'failed', errorMessage);
      if (providerFailure) {
        safeLog('WARN', 'provider_failure_not_escalated', agentName, {
          provider: 'anthropic',
          reason: errorMessage.slice(0, 220),
          fallbackEnabled: allowOpenAIFallback,
        });
        return;
      }
      // Auto-escalate failures to ErrorBoundaryAgent for internal recovery (skip if we ARE ErrorBoundaryAgent)
      if (agentName !== 'ErrorBoundaryAgent') {
        if (shouldDispatchEscalation(agentName, task, err)) {
          const escalation = JSON.stringify({
            failedAgent:  agentName,
            task:         task.slice(0, 500),
            error:        errorMessage,
            // projectName for routing context; intentionally NO taskId so the
            // original task stays 'failed' in projects.json for the supervisor
            // to pick up and re-assign on the next tick.
            ...(projectName ? { projectName } : {}),
          });
          dispatchToMesh('ErrorBoundaryAgent', escalation)
            .catch(meshErr => safeLog('WARN', 'error_escalation_failed', agentName, { error: meshErr.message }));
        } else {
          safeLog('WARN', 'error_escalation_suppressed', agentName, { task: task.slice(0, 120) });
        }
      }
    }
  }

  // Task handler
  attachStdinTaskQueue(agentName, handleTask);

  // Fallback: allow one-shot execution when task is injected through env.
  if (process.env.AGENT_TASK) {
    handleTask(process.env.AGENT_TASK)
      .catch(err => safeLog('ERROR', 'task_handler_crashed', agentName, { error: err?.message }));
  }

  process.on('SIGTERM', () => {
    safeLog('INFO', 'agent_shutdown', agentName, {});
    process.exit(0);
  });
}

// ── Codex (OpenAI) variant ──────────────────────────────────────────────────
// Uses OpenAI API instead of Anthropic. All Codex* agents call this.
function runCodexAgent(agentName = AGENT_NAME, systemPrompt) {
  const { client, disabledReason } = createOptionalOpenAIClient(agentName, { role: 'codex' });
  const model  = process.env.CODEX_MODEL || 'gpt-4o-mini';

  safeLog('INFO', 'agent_ready', agentName, {
    model,
    provider: 'openai',
    disabled: !client,
    disabledReason: client ? null : disabledReason,
  });

  const HEARTBEAT_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 1_800_000;
  setInterval(() => {
    log('INFO', 'agent_heartbeat', agentName, { uptimeMs: Math.round(process.uptime() * 1000) });
  }, HEARTBEAT_MS).unref();

  async function handleTask(raw) {
    const parsed = parseIncomingTask(raw, agentName, { model, provider: 'openai' });
    if (!parsed) return;
    const { task, parseError, projectName: inlineProject, taskId: inlineTaskId } = parsed;
    const { projectName: envProject, taskId: envTaskId } = getTaskContext();
    const projectName = inlineProject || envProject;
    const taskId = inlineTaskId || envTaskId;
    const start = Date.now();

    safeLog('INFO', 'task_received', agentName, {
      task: task.slice(0, 120),
      model,
      provider: 'openai',
      parseError,
      project: projectName,
      taskId,
    });
    safeLog('INFO', 'work_started', agentName, {
      project: projectName,
      taskId,
      taskDescription: task.slice(0, 120),
      provider: 'openai',
    });

    if (!client) {
      const errorMessage = `OpenAI unavailable (${disabledReason || 'missing OPENAI_API_KEY'})`;
      safeLog('WARN', 'provider_unavailable', agentName, {
        provider: 'openai',
        reason: disabledReason || 'missing OPENAI_API_KEY',
        project: projectName,
        taskId,
      });
      safeLog('ERROR', 'task_failed', agentName, {
        project: projectName,
        taskId,
        task: task.slice(0, 120),
        error: errorMessage,
        durationMs: Date.now() - start,
        provider: 'openai',
      });
      updateProjectTaskFile(projectName, taskId, 'failed', errorMessage);
      return;
    }

    const isCodexModel = model.includes('codex');
    try {
      let result, usage;
      if (isCodexModel) {
        const prompt = `${systemPrompt}\n\n${task}`;
        const response = await client.completions.create({ model, max_tokens: 512, prompt });
        result = response.choices[0]?.text ?? '';
        usage  = response.usage ?? {};
      } else {
        const response = await client.chat.completions.create({
          model,
          max_tokens: 512,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: task },
          ],
        });
        result = response.choices[0]?.message?.content ?? '';
        usage  = response.usage ?? {};
      }
      safeLog('INFO', 'task_complete', agentName, {
        project:       projectName,
        taskId,
        task:          task.slice(0, 120),
        resultPreview: result.slice(0, 200),
        durationMs:    Date.now() - start,
        inputTokens:   usage.prompt_tokens,
        outputTokens:  usage.completion_tokens,
        provider:      'openai',
        endpoint:      isCodexModel ? 'completions' : 'chat.completions',
      });
      logFullResponse(agentName, task, result, {
        provider: 'openai',
        endpoint: isCodexModel ? 'completions' : 'chat.completions',
      });
      parseAndDispatchRoutes(result, agentName, projectName);
      updateProjectTaskFile(projectName, taskId, 'complete', result);
      notifyProjectCompletion(projectName, agentName)
        .catch(err => safeLog('WARN', 'project_notify_error', agentName, { error: err.message }));
    } catch (err) {
      safeLog('ERROR', 'task_failed', agentName, {
        project:    projectName,
        taskId,
        task:      task.slice(0, 120),
        error:     err.message,
        durationMs: Date.now() - start,
        provider:  'openai',
      });
      updateProjectTaskFile(projectName, taskId, 'failed', err.message);
      // Auto-escalate failures to ErrorBoundaryAgent for internal recovery (skip if we ARE ErrorBoundaryAgent)
      if (agentName !== 'ErrorBoundaryAgent') {
        if (shouldDispatchEscalation(agentName, task, err)) {
          const escalation = JSON.stringify({
            failedAgent:  agentName,
            task:         task.slice(0, 500),
            error:        err.message,
            // projectName for routing context; intentionally NO taskId so the
            // original task stays 'failed' in projects.json for the supervisor
            // to pick up and re-assign on the next tick.
            ...(projectName ? { projectName } : {}),
          });
          dispatchToMesh('ErrorBoundaryAgent', escalation)
            .catch(meshErr => safeLog('WARN', 'error_escalation_failed', agentName, { error: meshErr.message }));
        } else {
          safeLog('WARN', 'error_escalation_suppressed', agentName, { task: task.slice(0, 120) });
        }
      }
    }
  }

  attachStdinTaskQueue(agentName, handleTask);

  // Fallback: check for AGENT_TASK env var and process if present
  if (process.env.AGENT_TASK) {
    handleTask(process.env.AGENT_TASK);
  }

  process.on('SIGTERM', () => {
    safeLog('INFO', 'agent_shutdown', agentName, {});
    process.exit(0);
  });
}



// ── projects.json helpers ────────────────────────────────────────────────────
// All direct reads/writes in this file must go through these helpers so the
// canonical { projects: [...], metadata: {...} } dashboard format is preserved.
function parseProjectsFile(raw) {
  if (Array.isArray(raw)) return { map: Object.fromEntries(raw.map(p => [p.name, p])), meta: {} };
  if (raw && typeof raw === 'object' && Array.isArray(raw.projects))
    return { map: Object.fromEntries(raw.projects.map(p => [p.name, p])), meta: raw.metadata || {} };
  return { map: raw || {}, meta: {} };
}
function serializeProjectsFile(projectMap, meta) {
  const arr = Object.values(projectMap);
  return {
    projects: arr,
    metadata: {
      ...meta,
      totalProjects: arr.length,
      completedCount: arr.filter(p => p.status === 'complete' || p.status === 'completed').length,
      activeCount:    arr.filter(p => p.status === 'active').length,
      blockedCount:   arr.filter(p => p.status === 'blocked').length,
      lastUpdated:    new Date().toISOString(),
    },
  };
}
function findTask(tasks, taskId) {
  // Match both numeric (1) and string ("sec001-t1") task IDs
  return (tasks || []).find(t => t.id === taskId || String(t.id) === String(taskId));
}

// Write task result back to projects.json when a project context is present.
// projectName and taskId may come from inline task JSON or env vars.
function updateProjectTaskFile(projectName, taskId, status, result) {
  if (!projectName || !taskId) return;
  const PROJECTS_FILE = path.join(PROJECTS_DIR, 'projects.json');
  if (!fs.existsSync(PROJECTS_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    const { map: projects, meta } = parseProjectsFile(raw);
    const project = projects[projectName];
    if (!project) return;
    const task = findTask(project.tasks, taskId);
    if (!task) return;
    task.status = status;
    if (result) task.result = String(result).slice(0, 1000);
    if (!task.timestamps) task.timestamps = {};
    task.timestamps[status] = Date.now();
    // 'assigned' timestamp is used by supervisor for stall detection
    if (status === 'in-progress') task.timestamps.assigned = Date.now();
    (project.history = project.history || []).push({ event: 'task_status_update', taskId, status, ts: Date.now() });
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(serializeProjectsFile(projects, meta), null, 2));
  } catch (err) {
    safeLog('WARN', 'project_task_update_failed', AGENT_NAME, { projectName, taskId, error: err.message });
  }
}

// When a specialist agent completes a project task, immediately trigger an
// OrchestratorAgent supervisor_check so the next pending batch is dispatched
// without waiting for the 5-minute supervisor interval.  A per-project dedup
// window (default 60 s) prevents flooding when several tasks finish at once.
async function notifyProjectCompletion(projectName, fromAgent) {
  if (!projectName) return;
  const now = Date.now();
  const last = recentProjectNotifications.get(projectName);
  if (last && now - last < PROJECT_NOTIFY_DEDUPE_MS) return;
  recentProjectNotifications.set(projectName, now);
  for (const [k, ts] of recentProjectNotifications) {
    if (now - ts > PROJECT_NOTIFY_DEDUPE_MS * 2) recentProjectNotifications.delete(k);
  }

  const PROJECTS_FILE = path.join(PROJECTS_DIR, 'projects.json');
  if (!fs.existsSync(PROJECTS_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    const { map: projects } = parseProjectsFile(raw);
    const project = projects[projectName];
    if (!project || project.status !== 'active') return;

    const tasks = project.tasks || [];
    const pending    = tasks.filter(t => t.status === 'pending');
    const inProgress = tasks.filter(t => t.status === 'in-progress');
    const completed  = tasks.filter(t => t.status === 'complete' || t.status === 'completed');
    const failed     = tasks.filter(t => t.status === 'failed');

    if (pending.length === 0) return; // nothing left to dispatch

    const BATCH_SIZE = Number(process.env.SUPERVISOR_BATCH_SIZE) || 3;
    const notification = JSON.stringify({
      type:        'supervisor_check',
      project:     projectName,
      description: project.description || '',
      trigger:     'task_completed',
      stats: {
        total:      tasks.length,
        pending:    pending.length,
        inProgress: inProgress.length,
        completed:  completed.length,
        failed:     failed.length,
        stalled:    0,
      },
      pendingTasks: pending.slice(0, BATCH_SIZE).map(t => ({ id: t.id, description: t.description })),
      stalledTasks: [],
      recentFailures: failed.slice(-3).map(t => ({
        id: t.id, description: t.description, result: String(t.result || '').slice(0, 200),
      })),
      recentResults: completed.filter(t => t.result).slice(-5).map(t => ({
        id:          t.id,
        description: String(t.description).slice(0, 200),
        result:      String(t.result).slice(0, 400),
      })),
    });

    await dispatchToMesh('OrchestratorAgent', notification);
    safeLog('INFO', 'project_notify_dispatched', fromAgent, { project: projectName, pending: pending.length });
  } catch (err) {
    safeLog('WARN', 'project_notify_failed', fromAgent, { project: projectName, error: err.message });
  }
}

const SPECIALIST_AGENTS = [
  'ClaudeAgent', 'CodexAgent',
  'ClaudeAgent1', 'ClaudeAgent2', 'ClaudeAgent3', 'ClaudeAgent4', 'ClaudeAgent5',
  'CodexAgent1', 'CodexAgent2', 'CodexAgent3', 'CodexAgent4', 'CodexAgent5',
  'UIDesignerAgent', 'LLMMLAgent', 'IntegrationsAgent', 'LoggingAgent',
  'AuditDocumentationAgent', 'SecurityAgent', 'TestAgent', 'DocumentationAgent',
  'ErrorBoundaryAgent', 'BridgeAgent', 'OrchestratorAgent',
  'RegistryAgent', 'TaskManagerAgent', 'ConfigAgent', 'PackagingAgent',
  'InsightsAgent', 'MigrationAgent', 'DependencyAgent', 'CIAgent', 'ReleaseAgent',
];

// Scan an agent's result text for routing directives and dispatch them to the mesh.
// Agents signal collaboration needs by including lines like:
//   {"route":"AgentName","task":"description"}
function parseAndDispatchRoutes(result, fromAgent, projectName = null) {
  const lines = String(result).split('\n');
  let dispatched = 0;
  for (const line of lines) {
    if (dispatched >= ROUTE_FANOUT_LIMIT) break; // cap fan-out per result to prevent flooding
    const trimmed = line.trim();
    const candidate = trimmed
      .replace(/^[-*]\s*/, '')
      .replace(/`/g, '')
      .replace(/,\s*$/, '');
    if (!candidate.includes('"route"') || !candidate.includes('"task"')) continue;
    try {
      const directive = JSON.parse(candidate);
      if (!directive.route || !directive.task || !SPECIALIST_AGENTS.includes(directive.route)) continue;
      if (directive.route === fromAgent) {
        safeLog('WARN', 'agent_self_route_blocked', fromAgent, { task: String(directive.task).slice(0, 120) });
        continue;
      }
      const routeTask = String(directive.task).trim();
      if (!routeTask) continue;
      if (!shouldDispatchRoute(fromAgent, directive.route, routeTask)) {
        safeLog('WARN', 'agent_route_suppressed', fromAgent, { to: directive.route, task: routeTask.slice(0, 120) });
        continue;
      }
      // Propagate project context so the receiving agent can log project
      // association.  No taskId — routed subtasks are new work, not tracked
      // as individual project tasks.
      const payload = projectName
        ? JSON.stringify({ task: routeTask, projectName })
        : routeTask;
      dispatchToMesh(directive.route, payload)
        .then(() => safeLog('INFO', 'agent_routed_subtask', fromAgent, { to: directive.route, task: routeTask.slice(0, 120), project: projectName }))
        .catch(err => safeLog('ERROR', 'agent_route_failed', fromAgent, { to: directive.route, error: err.message }));
      dispatched++;
    } catch { /* not valid JSON, skip */ }
  }
}

function dispatchToMesh(agent, task) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ agent, task });
    const port = Number(process.env.MESH_PORT) || 3099;
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/dispatch', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Mesh dispatch HTTP ${res.statusCode} for agent ${agent}: ${data.slice(0, 120)}`));
          } else {
            resolve({ statusCode: res.statusCode, body: data });
          }
        });
      }
    );
    req.setTimeout(MESH_DISPATCH_TIMEOUT_MS, () => {
      req.destroy(new Error(`Mesh dispatch timeout after ${MESH_DISPATCH_TIMEOUT_MS}ms for agent ${agent}`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// Codex agents are OpenAI-backed and work without Anthropic credits
const CODEX_AGENTS = [
  'CodexAgent', 'CodexAgent1', 'CodexAgent2', 'CodexAgent3', 'CodexAgent4', 'CodexAgent5',
];

function runOrchestratorAgent(agentName) {
  const { client, disabledReason } = createOptionalOpenAIClient(agentName, { role: 'orchestrator' });
  const model  = process.env.CODEX_MODEL || 'gpt-4o-mini';

  log('INFO', 'agent_ready', agentName, {
    model,
    provider: 'openai',
    role: 'orchestrator',
    disabled: !client,
    disabledReason: client ? null : disabledReason,
  });

  const HEARTBEAT_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 1_800_000;
  setInterval(() => {
    log('INFO', 'agent_heartbeat', agentName, { uptimeMs: Math.round(process.uptime() * 1000) });
  }, HEARTBEAT_MS).unref();

  const PROJECTS_FILE_PATH = path.join(PROJECTS_DIR, 'projects.json');

  const PLAN_PROJECT_SYSTEM = `You are the project planner for a multi-agent AI swarm. Given a project name, description, and goals, decompose the work into 5-15 ordered, actionable tasks.

Return ONLY a JSON object, no prose:
{
  "tasks": [
    { "id": 1, "description": "Specific task with relevant file paths and acceptance criteria", "agent": "BestAgentName" },
    ...
  ]
}

Agent roster:
- CodexAgent1: React/TypeScript frontend (client/src/)
- CodexAgent2: Node.js/Express backend + SQLite (server/src/)
- CodexAgent3: DevOps, Railway deployment, GitHub Actions
- CodexAgent4: SQLite schema, migrations, query optimization
- CodexAgent5: refactoring, type safety improvements
- ClaudeAgent1: research, root cause analysis, tradeoff comparison
- ClaudeAgent2: solution planning, step-by-step architecture
- ClaudeAgent3: code review, quality assurance
- ClaudeAgent4: summarization, writing documentation
- ClaudeAgent5: writing test cases and validation criteria
- SecurityAgent: vulnerability review, JWT/SQL injection, auth flows
- TestAgent: test suites, integration tests
- DocumentationAgent: API docs, README, developer guides
- UIDesignerAgent: React UI implementation — pages, components, user flows
- IntegrationsAgent: Stripe billing, SendGrid/SMTP email, webhooks
- LoggingAgent: logging strategy, usage metrics, observability

Rules:
- Order tasks by dependency (earlier tasks should unblock later ones)
- Each description must be specific enough for an agent to execute without asking questions
- Include relevant file paths and context in each description
- Aim for tasks that can be completed in a single focused AI call`;

  const SUPERVISOR_CHECK_SYSTEM = `You are the project supervisor for a multi-agent AI swarm. You have been given the current state of an active project including pending tasks, stalled tasks, recent failures, and the results of recently completed tasks.

Your job:
1. Select up to 3 pending tasks to dispatch now (prefer foundational/unblocking tasks first)
2. For each task you dispatch, embed any relevant completed-task results directly into the task description so the receiving agent has full context — agents have NO shared memory
3. For stalled tasks: re-assign to a different agent or skip if clearly blocked
4. For failed tasks: the supervisor will automatically re-try on the next tick — only skip if the failure is permanent

Return ONLY a JSON array, no prose:
[
  { "agent": "AgentName", "taskId": 4, "task": "Full task description. Context from prior tasks: [paste relevant results inline here]", "action": "dispatch" },
  { "agent": "ClaudeAgent1", "taskId": 2, "task": "Original task — previous attempt stalled after 45 min, try a different approach", "action": "reassign" },
  { "agent": "CodexAgent2", "taskId": 7, "task": "Skip — blocked on external dependency", "action": "skip" }
]

Rules:
- Never dispatch more than 3 tasks per check
- If a task depends on a pending or in-progress task, do NOT dispatch it — wait for the next tick
- Include full context in each task description string — paste relevant prior results inline
- For stalled/reassigned tasks, note the original agent name and stall duration in the description`;

  const SYSTEM = `You are the swarm orchestrator for the NyLi Agent platform. Decompose the given task into 2-4 focused subtasks and assign each to the best specialist:

- CodexAgent: general code generation
- CodexAgent1: React/TypeScript frontend (client/src/)
- CodexAgent2: Node.js/Express backend + SQLite (server/src/)
- CodexAgent3: DevOps, Railway deployment, GitHub Actions
- CodexAgent4: SQLite schema, migrations, query optimization
- CodexAgent5: refactoring, type safety improvements
- ClaudeAgent: general reasoning or tasks without a clear specialist
- ClaudeAgent1: research, root cause analysis, tradeoff comparison
- ClaudeAgent2: solution planning, step-by-step architecture
- ClaudeAgent3: code review, quality assurance
- ClaudeAgent4: summarization, writing documentation
- ClaudeAgent5: writing test cases and validation criteria
- SecurityAgent: vulnerability review, JWT/SQL injection, auth flows, role enforcement
- TestAgent: test suites, integration tests, agent mesh test harness
- DocumentationAgent: API docs, README, developer guides, SOP writing
- ErrorBoundaryAgent: error handling patterns, policy fallback, output validation
- LoggingAgent: logging strategy, usage metrics, observability
- UIDesignerAgent: React UI implementation — pages, components, user flows
- LLMMLAgent: prompt engineering, model selection, AI pipeline design
- IntegrationsAgent: Stripe billing, SendGrid/SMTP email, webhook integrations
- AuditDocumentationAgent: knowledge edit history, compliance audit trails
- BridgeAgent: widget.js unification, multi-agent coordination, context handoffs

Respond ONLY with a JSON array, no prose. Example:
[
  { "agent": "SecurityAgent", "task": "Review JWT verification in server/src/lib/jwt.ts for vulnerabilities." },
  { "agent": "CodexAgent2",   "task": "Add a prepared statement for the new users query in server/src/db.ts." }
]

If a subtask depends on output from a prior subtask, include the relevant context directly in the dependent task's description string — agents do not share memory, so pass all needed information inline.
If you are uncertain which specialist to use, default to ClaudeAgent2 for a planning step first.
If a subtask fails, it will be automatically routed to ErrorBoundaryAgent for recovery — do not re-assign the same failed task to the same agent.`;

  // ── Project planning handler ─────────────────────────────────────────────
  // Called when task JSON contains { type: "plan_project", name, description, goals }
  async function handleProjectPlanning(structured) {
    const { name, description, goals } = structured;
    log('INFO', 'orchestrator_project_planning', agentName, { project: name });
    const start = Date.now();
    const userMsg = `Project name: ${name}\nDescription: ${description}\nGoals: ${goals || description}`;
    if (!client) {
      log('WARN', 'orchestrator_provider_unavailable', agentName, {
        project: name,
        reason: disabledReason || 'missing OPENAI_API_KEY',
      });
      return;
    }
    try {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: PLAN_PROJECT_SYSTEM },
          { role: 'user',   content: userMsg },
        ],
      });
      const text = response.choices[0]?.message?.content ?? '{}';
      logFullResponse(agentName, userMsg, text, { provider: 'openai', role: 'orchestrator', subtype: 'plan_project' });

      let plan;
      try { plan = JSON.parse(text); } catch {
        log('WARN', 'orchestrator_plan_parse_failed', agentName, { preview: text.slice(0, 200) });
        return;
      }

      const tasks = (plan.tasks || []).map((t, i) => ({
        id: Number(t.id) || i + 1,
        description: String(t.description),
        assignedAgent: t.agent || null,
        status: 'pending',
        timestamps: {},
        result: null,
      }));

      // Write plan into projects.json
      try {
        const raw = fs.existsSync(PROJECTS_FILE_PATH)
          ? JSON.parse(fs.readFileSync(PROJECTS_FILE_PATH, 'utf-8'))
          : {};
        const { map: projects, meta } = parseProjectsFile(raw);
        projects[name] = { ...projects[name], name, description, tasks, status: 'active', history: projects[name]?.history || [] };
        fs.writeFileSync(PROJECTS_FILE_PATH, JSON.stringify(serializeProjectsFile(projects, meta), null, 2));
      } catch (err) {
        log('ERROR', 'orchestrator_plan_write_failed', agentName, { project: name, error: err.message });
      }

      log('INFO', 'orchestrator_project_planned', agentName, {
        project: name, taskCount: tasks.length, durationMs: Date.now() - start,
        inputTokens: response.usage?.prompt_tokens, outputTokens: response.usage?.completion_tokens,
      });

      // Dispatch first batch (up to SUPERVISOR_BATCH_SIZE tasks)
      const batchSize = Number(process.env.SUPERVISOR_BATCH_SIZE) || 3;
      const initialBatch = tasks.slice(0, batchSize);
      for (const t of initialBatch) {
        const targetAgent = SPECIALIST_AGENTS.includes(t.assignedAgent) ? t.assignedAgent : 'ClaudeAgent2';
        try {
          await dispatchToMesh(targetAgent, JSON.stringify({ task: t.description, projectName: name, taskId: t.id }));
          updateProjectTaskFile(name, t.id, 'in-progress', null);
          log('INFO', 'orchestrator_dispatched', agentName, { agent: targetAgent, taskId: t.id, project: name });
        } catch (err) {
          log('ERROR', 'orchestrator_dispatch_failed', agentName, { agent: targetAgent, error: err.message });
        }
      }
    } catch (err) {
      log('ERROR', 'orchestrator_planning_failed', agentName, { project: name, error: err.message, durationMs: Date.now() - start });
    }
  }

  // ── Supervisor check handler ─────────────────────────────────────────────
  // Called when task JSON contains { type: "supervisor_check", project, pendingTasks, stalledTasks, ... }
  async function handleSupervisorCheck(structured) {
    const { project: projectName } = structured;
    log('INFO', 'orchestrator_supervisor_check', agentName, { project: projectName });
    const start = Date.now();
    const userMsg = JSON.stringify(structured);
    if (!client) {
      log('WARN', 'orchestrator_provider_unavailable', agentName, {
        project: projectName,
        reason: disabledReason || 'missing OPENAI_API_KEY',
      });
      return;
    }
    try {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SUPERVISOR_CHECK_SYSTEM },
          { role: 'user',   content: userMsg },
        ],
      });
      const text = response.choices[0]?.message?.content ?? '[]';
      logFullResponse(agentName, userMsg, text, { provider: 'openai', role: 'orchestrator', subtype: 'supervisor_check' });

      let decisions;
      try { decisions = JSON.parse(text); } catch {
        log('WARN', 'orchestrator_supervisor_parse_failed', agentName, { preview: text.slice(0, 200) });
        return;
      }

      log('INFO', 'orchestrator_supervisor_decisions', agentName, {
        project: projectName, count: decisions.length, durationMs: Date.now() - start,
      });

      for (const { agent, taskId, task: taskDesc, action } of decisions) {
        // ignore the agent suggested by the LLM; always use the assignment stored
        // in the project file so tasks are routed predictably.  Read the file
        // directly rather than relying on projectManager (which isn't defined here).
        let chosenAgent = 'CodexAgent';
        try {
          const PROJECTS_FILE = path.join(PROJECTS_DIR, 'projects.json');
          if (fs.existsSync(PROJECTS_FILE)) {
            const rawProj = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
            const { map: projects } = parseProjectsFile(rawProj);
            const project = projects[projectName];
            const taskObj = findTask(project?.tasks, taskId);
            if (taskObj && taskObj.assignedAgent) {
              chosenAgent = taskObj.assignedAgent;
            }
          }
        } catch (e) {
          log('WARN', 'orchestrator_project_read_failed', agentName, { error: e.message });
        }
        if (!SPECIALIST_AGENTS.includes(chosenAgent)) {
          log('WARN', 'orchestrator_assigned_agent_not_specialist', agentName, { chosenAgent, taskId });
          chosenAgent = 'CodexAgent';
        }
        log('INFO', 'orchestrator_chosen_agent_from_project', agentName, {
          originalSuggestion: agent,
          chosen: chosenAgent,
          taskId,
        });

        if (action === 'skip') {
          updateProjectTaskFile(projectName, taskId, 'skipped', 'Skipped by supervisor');
          log('INFO', 'orchestrator_task_skipped', agentName, { project: projectName, taskId });
          continue;
        }
        try {
          await dispatchToMesh(chosenAgent, JSON.stringify({ task: taskDesc, projectName, taskId }));
          updateProjectTaskFile(projectName, taskId, 'in-progress', null);
          log('INFO', 'orchestrator_dispatched', agentName, { agent: chosenAgent, taskId, project: projectName, action });
        } catch (err) {
          log('ERROR', 'orchestrator_dispatch_failed', agentName, { agent: chosenAgent, taskId, error: err.message });
        }
      }
    } catch (err) {
      log('ERROR', 'orchestrator_supervisor_failed', agentName, { project: projectName, error: err.message, durationMs: Date.now() - start });
    }
  }

  async function handleOrchestratorTask(raw) {
    const parsed = parseIncomingTask(raw, agentName, { model, provider: 'openai', role: 'orchestrator' });
    if (!parsed) return;
    const { task, projectName, taskId } = parsed;

    log('INFO', 'task_received', agentName, { task: task.slice(0, 120), model, provider: 'openai', project: projectName, taskId });

    if (!client) {
      const errorMessage = `OpenAI unavailable (${disabledReason || 'missing OPENAI_API_KEY'})`;
      log('WARN', 'orchestrator_provider_unavailable', agentName, {
        project: projectName,
        taskId,
        reason: disabledReason || 'missing OPENAI_API_KEY',
      });
      if (projectName && taskId) {
        updateProjectTaskFile(projectName, taskId, 'failed', errorMessage);
      }
      return;
    }

    // Route to specialised handlers based on task type
    let structured = null;
    try { structured = JSON.parse(task); } catch { /* plain string task — fall through */ }
    if (structured?.type === 'plan_project')    return handleProjectPlanning(structured);
    if (structured?.type === 'supervisor_check') return handleSupervisorCheck(structured);

    const start = Date.now();
    try {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 512,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user',   content: task },
        ],
      });

      const text = response.choices[0]?.message?.content ?? '[]';
      logFullResponse(agentName, task, text, { provider: 'openai', role: 'orchestrator' });

      let subtasks;
      try {
        subtasks = JSON.parse(text);
      } catch {
        log('WARN', 'orchestrator_parse_failed', agentName, { responsePreview: text.slice(0, 200) });
        return;
      }

      // If Anthropic credits are absent, re-route Claude-targeted subtasks to Codex agents
      const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY && !/placeholder/i.test(process.env.ANTHROPIC_API_KEY));
      if (!hasAnthropicKey) {
        subtasks = subtasks.map((s, i) => {
          if (!CODEX_AGENTS.includes(s.agent)) {
            const fallback = CODEX_AGENTS[i % CODEX_AGENTS.length];
            log('INFO', 'orchestrator_rerouted', agentName, { from: s.agent, to: fallback });
            return { ...s, agent: fallback };
          }
          return s;
        });
      }

      log('INFO', 'orchestrator_plan', agentName, {
        task:         task.slice(0, 120),
        subtaskCount: subtasks.length,
        durationMs:   Date.now() - start,
        inputTokens:  response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        provider:     'openai',
      });

      // Dispatch each subtask to the mesh.
      // If the original task carried project context, propagate it so the
      // specialist can write results back to projects.json.  When no project
      // context is present, dispatch the plain string so the mesh wraps it
      // in the standard { task } envelope.
      for (const { agent, task: subtask } of subtasks) {
        if (!SPECIALIST_AGENTS.includes(agent)) {
          log('WARN', 'orchestrator_unknown_agent', agentName, { agent, subtask: String(subtask).slice(0, 80) });
          continue;
        }
        const payload = projectName
          ? JSON.stringify({ task: String(subtask), projectName, ...(taskId ? { taskId } : {}) })
          : String(subtask);
        try {
          await dispatchToMesh(agent, payload);
          log('INFO', 'orchestrator_dispatched', agentName, { agent, subtask: String(subtask).slice(0, 120), project: projectName });
        } catch (err) {
          log('ERROR', 'orchestrator_dispatch_failed', agentName, { agent, error: err.message });
        }
      }
    } catch (err) {
      log('ERROR', 'task_failed', agentName, {
        task:      task.slice(0, 120),
        error:     err.message,
        durationMs: Date.now() - start,
      });
    }
  }

  attachStdinTaskQueue(agentName, handleOrchestratorTask);

  // ── Self-tick: proactively drive active projects even without an external push ──
  // Reads projects.json on a regular interval and synthesises a supervisor_check
  // for any active project that has pending tasks.  This ensures work continues
  // if the external supervisor missed a window or a task completed without
  // triggering the notifyProjectCompletion hook.
  const SELF_TICK_MS = Number(process.env.ORCHESTRATOR_SELF_TICK_MS) || 2 * 60_000; // 2 min
  const selfTickLastDispatched = {}; // { projectName: timestamp }

  async function orchestratorSelfTick() {
    if (!client) return; // no provider — nothing to do
    if (!fs.existsSync(PROJECTS_FILE_PATH)) return;

    let raw;
    try { raw = JSON.parse(fs.readFileSync(PROJECTS_FILE_PATH, 'utf-8')); } catch { return; }

    const { map: projects } = parseProjectsFile(raw);
    const now = Date.now();

    for (const project of Object.values(projects)) {
      if (project.status !== 'active') continue;
      const tasks = project.tasks || [];
      const pending    = tasks.filter(t => t.status === 'pending');
      const inProgress = tasks.filter(t => t.status === 'in-progress');
      const completed  = tasks.filter(t => t.status === 'complete' || t.status === 'completed');
      const failed     = tasks.filter(t => t.status === 'failed');

      if (pending.length === 0) continue;

      // Skip if we dispatched this project very recently (dedupe window = self-tick interval)
      const last = selfTickLastDispatched[project.name] || 0;
      if (now - last < SELF_TICK_MS) continue;

      selfTickLastDispatched[project.name] = now;

      log('INFO', 'orchestrator_self_tick_check', agentName, {
        project: project.name, pending: pending.length, inProgress: inProgress.length,
      });

      const supervisorContext = {
        type:        'supervisor_check',
        project:     project.name,
        description: project.description || '',
        trigger:     'orchestrator_self_tick',
        stats: {
          total: tasks.length, pending: pending.length,
          inProgress: inProgress.length, completed: completed.length,
          failed: failed.length, stalled: 0,
        },
        pendingTasks: pending.slice(0, Number(process.env.SUPERVISOR_BATCH_SIZE) || 3).map(t => ({
          id: t.id, description: t.description,
        })),
        stalledTasks:   [],
        recentFailures: failed.slice(-3).map(t => ({
          id: t.id, description: t.description, result: String(t.result || '').slice(0, 200),
        })),
        recentResults: completed.filter(t => t.result).slice(-5).map(t => ({
          id: t.id, description: String(t.description).slice(0, 200), result: String(t.result).slice(0, 400),
        })),
      };

      try {
        await handleSupervisorCheck(supervisorContext);
      } catch (err) {
        log('ERROR', 'orchestrator_self_tick_failed', agentName, { project: project.name, error: err.message });
      }
    }
  }

  setInterval(() => {
    orchestratorSelfTick().catch(err =>
      log('ERROR', 'orchestrator_self_tick_error', agentName, { error: err.message })
    );
  }, SELF_TICK_MS).unref();

  process.on('SIGTERM', () => {
    log('INFO', 'agent_shutdown', agentName, {});
    process.exit(0);
  });
}

export { runAgent, runCodexAgent, runOrchestratorAgent };
