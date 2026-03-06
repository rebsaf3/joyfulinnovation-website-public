const fs = require('fs');
const path = require('path');
const LOG_FILE = path.resolve(__dirname, '../server/logs/agent_activity.log');
const PROJECT_FILES = [
  path.resolve(__dirname, '../server/logs/projects.json'),
  path.resolve(__dirname, '../logs/projects.json'),
];
const AGENT_ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const TASK_PROGRESS_STALE_MS = 60 * 60 * 1000;
function hasTimestamp(ts, keys) {
  for (const k of keys) if (Number.isFinite(ts[k])) return true;
  return false;
}
function normalizeWorkflowStatus(rawStatus, owner, timestamps) {
  const s = String(rawStatus || '').trim().toLowerCase();
  if (s === 'in-progress' || s === 'in_progress' || s === 'working') return 'in-progress';
  if (s === 'complete' || s === 'completed' || s === 'done') return 'completed';
  if (s === 'blocked' || s === 'failed' || s === 'error') return 'blocked';
  if (hasTimestamp(timestamps, ['complete', 'completed', 'work_completed', 'done'])) return 'completed';
  if (hasTimestamp(timestamps, ['failed', 'error', 'blocked'])) return 'blocked';
  if (hasTimestamp(timestamps, ['work_started', 'in-progress', 'in_progress', 'start'])) return 'in-progress';
  if (s === 'pending' || s === 'queued' || s === 'todo' || s === 'assigned' || s === '') return 'assigned';
  return owner ? 'assigned' : 'assigned';
}
function eventTsMs(log) {
  if (typeof log.ts !== 'string') return undefined;
  const ms = Date.parse(log.ts);
  return Number.isFinite(ms) ? ms : undefined;
}
function includesError(log) {
  return (
    log.level === 'ERROR' ||
    log.event === 'task_failed' ||
    log.event === 'task_parse_error' ||
    log.event === 'agent_spawn_failed'
  );
}

let logs = [];
if (fs.existsSync(LOG_FILE)) {
  logs = fs
    .readFileSync(LOG_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const runtimeByAgent = {};
const now = Date.now();
for (const log of logs) {
  const agent = log.agent || log.agentName;
  if (!agent) continue;
  if (!runtimeByAgent[agent]) {
    runtimeByAgent[agent] = {
      online: false,
      openWorkCount: 0,
      lastActivityMs: null,
      lastExecutionMs: null,
      recentExecutionCount: 0,
      lastErrorMs: null,
      lastSuccessMs: null,
    };
  }
  const state = runtimeByAgent[agent];
  const ts = eventTsMs(log);
  const event = log.event;
  if (Number.isFinite(ts) && event && ['task_received','work_started','task_dispatched','work_completed','task_complete','task_failed','task_parse_error'].includes(event)) {
    state.lastActivityMs = ts;
  }
  if (Number.isFinite(ts) && event && ['work_started','work_completed','task_complete','task_failed','task_parse_error'].includes(event)) {
    state.lastExecutionMs = ts;
    if (now - ts <= AGENT_ACTIVE_WINDOW_MS) state.recentExecutionCount += 1;
  }
  if (Number.isFinite(ts) && includesError(log)) state.lastErrorMs = ts;
  if (Number.isFinite(ts) && ['agent_ready','work_completed','task_complete'].includes(event)) state.lastSuccessMs = ts;
  if (event === 'agent_starting' || event === 'agent_ready') state.online = true;
  if (event === 'agent_shutdown' || event === 'agent_exited') {
    state.online = false;
    state.openWorkCount = 0;
  }
  if (event === 'work_started') state.openWorkCount += 1;
  if (['work_completed','task_complete','task_failed','task_parse_error'].includes(event)) state.openWorkCount = Math.max(0, state.openWorkCount - 1);
}

function isErrored(state) {
  if (!state.online) return false;
  if (!Number.isFinite(state.lastErrorMs)) return false;
  if (now - state.lastErrorMs > AGENT_ACTIVE_WINDOW_MS) return false;
  if (Number.isFinite(state.lastSuccessMs) && state.lastSuccessMs >= state.lastErrorMs) return false;
  return true;
}
function isExecuting(state) {
  return (
    state.openWorkCount > 0 ||
    state.recentExecutionCount > 0 ||
    (Number.isFinite(state.lastExecutionMs) && now - state.lastExecutionMs <= AGENT_ACTIVE_WINDOW_MS)
  );
}

let merged = {};
for (const file of PROJECT_FILES) {
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) {
      raw.forEach((p) => (merged[p.name] = p));
    } else {
      Object.assign(merged, raw);
    }
  }
}

let counts = { assigned: 0, inprogress: 0, completed: 0, blocked: 0 };
let reclass = 0;
for (const proj of Object.values(merged)) {
  for (const t of proj.tasks) {
    const owner = t.assignedAgent || 'Unassigned';
    const status = normalizeWorkflowStatus(t.status, owner, t.timestamps || {});
    let final = status;
    if (status === 'in-progress') {
      const ownerState = runtimeByAgent[owner];
      const ownerErrored = ownerState ? isErrored(ownerState) : false;
      const ownerActive = ownerState
        ? (ownerState.online && isExecuting(ownerState) && now - (ownerState.lastActivityMs || 0) <= AGENT_ACTIVE_WINDOW_MS && !ownerErrored)
        : false;
      const updatedMs = t.timestamps
        ? Math.max(...Object.values(t.timestamps).filter((v) => Number.isFinite(v)))
        : NaN;
      const stale = !Number.isFinite(updatedMs) || now - updatedMs > TASK_PROGRESS_STALE_MS;
      if ((ownerErrored || !ownerActive) && stale) {
        final = 'blocked';
        reclass++;
      }
    }
    counts[final.replace('-', '')]++;
  }
}
console.log('counts', counts, 'reclassified', reclass);
