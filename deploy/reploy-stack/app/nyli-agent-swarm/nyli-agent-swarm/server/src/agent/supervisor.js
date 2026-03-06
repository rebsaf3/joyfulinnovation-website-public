// Project Supervisor — periodic loop that monitors projects.json and triggers OrchestratorAgent
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// original LOG_DIR pointed at repository root; projectManager writes to server/logs
const LOG_DIR = process.env.SWARM_SERVER_LOGS_DIR
  ? path.resolve(process.env.SWARM_SERVER_LOGS_DIR)
  : path.resolve(__dirname, '../../logs');
const LOG_FILE     = path.join(LOG_DIR, 'agent_activity.log');
const PROJECTS_FILE = path.join(LOG_DIR, 'projects.json');

const MESH_PORT              = Number(process.env.MESH_PORT)                  || 3099;
const SUPERVISOR_INTERVAL_MS = Number(process.env.SUPERVISOR_INTERVAL_MS)     || 60_000;       // 1 min (was 5 min)
const STALL_THRESHOLD_MS     = Number(process.env.SUPERVISOR_STALL_MS)        || 30 * 60_000; // 30 min
const BATCH_SIZE             = Number(process.env.SUPERVISOR_BATCH_SIZE)       || 3;
// How long a project may stay in 'planning' before supervisor re-triggers planning
const PLAN_TIMEOUT_MS        = Number(process.env.SUPERVISOR_PLAN_TIMEOUT_MS)  || 15 * 60_000; // 15 min

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function log(level, event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, agent: 'supervisor', ...data }) + '\n';
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  console.log(`[supervisor] ${event}`, data);
}

function dispatchToMesh(agent, task) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ agent, task });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: MESH_PORT,
        path: '/dispatch',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      }
    );
    req.setTimeout(8_000, () => req.destroy(new Error('dispatch timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

function readProjects() {
  if (!fs.existsSync(PROJECTS_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    // Handle canonical {projects: [...], metadata: {...}} format used by the dashboard
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.projects)) {
      return Object.fromEntries(raw.projects.map(p => [p.name, p]));
    }
    // Handle bare array format
    if (Array.isArray(raw)) {
      return Object.fromEntries(raw.map(p => [p.name, p]));
    }
    // Legacy object-map format
    return raw;
  } catch (err) {
    log('ERROR', 'supervisor_read_failed', { error: err.message });
    return {};
  }
}

function readProjectsRaw() {
  if (!fs.existsSync(PROJECTS_FILE)) return { projects: [], metadata: {} };
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
  } catch {
    return { projects: [], metadata: {} };
  }
}

function writeProjects(projects) {
  try {
    // Preserve the canonical {projects: [...], metadata: {...}} format so the dashboard can read it
    const existingRaw = readProjectsRaw();
    const projectsArray = Object.values(projects);
    const completedCount = projectsArray.filter(p => p.status === 'complete' || p.status === 'completed').length;
    const activeCount = projectsArray.filter(p => p.status === 'active').length;
    const blockedCount = projectsArray.filter(p => p.status === 'blocked').length;
    const output = {
      projects: projectsArray,
      metadata: {
        ...(existingRaw.metadata || {}),
        totalProjects: projectsArray.length,
        completedCount,
        activeCount,
        blockedCount,
        lastUpdated: new Date().toISOString(),
      },
    };
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(output, null, 2));
  } catch (err) {
    log('ERROR', 'supervisor_write_failed', { error: err.message });
  }
}

async function supervisorTick() {
  log('INFO', 'supervisor_tick_start');
  const projects = readProjects();
  const allProjects = Object.values(projects);
  const now = Date.now();
  let dispatched = 0;

  // ── Re-trigger planning for projects stuck in 'planning' state ──────────────
  // If OrchestratorAgent's plan_project call failed or returned bad JSON the
  // project stays in 'planning' forever.  After PLAN_TIMEOUT_MS we re-send the
  // plan_project task so it gets another attempt.
  const stuckPlanning = allProjects.filter(p =>
    p.status === 'planning' && p.createdAt && now - p.createdAt > PLAN_TIMEOUT_MS
  );
  for (const project of stuckPlanning) {
    log('WARN', 'supervisor_planning_timeout', {
      project:       project.name,
      minutesStuck:  Math.round((now - project.createdAt) / 60_000),
    });
    const planTask = JSON.stringify({
      type:        'plan_project',
      name:        project.name,
      description: project.description || '',
      goals:       project.goals || project.description || '',
    });
    try {
      const result = await dispatchToMesh('OrchestratorAgent', planTask);
      log('INFO', 'supervisor_plan_retriggered', { project: project.name, meshStatus: result.statusCode });
      dispatched++;
    } catch (err) {
      log('ERROR', 'supervisor_plan_retrigger_failed', { project: project.name, error: err.message });
    }
  }

  // ── Proactive: trigger planning for projects in 'pending' status ────────────
  // A project reaches 'pending' when it has been created but planning hasn't
  // started yet (e.g. manually inserted into projects.json).  Kick them off.
  const pendingProjects = allProjects.filter(p => p.status === 'pending');
  for (const project of pendingProjects) {
    log('INFO', 'supervisor_triggering_pending_project', { project: project.name });
    const planTask = JSON.stringify({
      type:        'plan_project',
      name:        project.name,
      description: project.description || '',
      goals:       project.goals || project.description || '',
    });
    try {
      const result = await dispatchToMesh('OrchestratorAgent', planTask);
      log('INFO', 'supervisor_pending_project_triggered', { project: project.name, meshStatus: result.statusCode });
      dispatched++;
    } catch (err) {
      log('ERROR', 'supervisor_pending_project_trigger_failed', { project: project.name, error: err.message });
    }
  }

  const activeProjects = allProjects.filter(p => p.status === 'active');

  if (activeProjects.length === 0) {
    if (stuckPlanning.length === 0 && pendingProjects.length === 0) log('DEBUG', 'supervisor_no_active_projects');
    log('INFO', 'supervisor_tick_end', { activeProjects: 0, pendingProjects: pendingProjects.length, dispatched });
    return;
  }

  for (const project of activeProjects) {
    const tasks = project.tasks || [];
    let pending   = tasks.filter(t => t.status === 'pending');
    const inProgress = tasks.filter(t => t.status === 'in-progress');
    const stalled   = inProgress.filter(t =>
      t.timestamps?.assigned && now - t.timestamps.assigned > STALL_THRESHOLD_MS
    );
    const completed = tasks.filter(t => t.status === 'complete' || t.status === 'completed');
    let failed    = tasks.filter(t => t.status === 'failed');

    // Automatically requeue failed tasks if there are no pending ones.  This
    // helps recover from transient errors such as an invalid API key – once the
    // environment is corrected the tasks will go back to pending and be
    // dispatched again.  We cap retries to avoid infinite loops.
    if (pending.length === 0 && failed.length > 0) {
      const retryable = failed.filter(t => !t.retryCount || t.retryCount < 2);
      if (retryable.length > 0) {
        log('INFO', 'supervisor_retrying_failed', { project: project.name, count: retryable.length });
        retryable.forEach(t => {
          t.retryCount = (t.retryCount || 0) + 1;
          t.status = 'pending';
          t.timestamps = t.timestamps || {};
          t.timestamps.retried = now;
        });
        // refresh arrays so subsequent logic uses new pending list
        pending = tasks.filter(t => t.status === 'pending');
        failed = tasks.filter(t => t.status === 'failed');
        projects[project.name] = project;
        writeProjects(projects);
      }
    }

    // All tasks done — mark project complete
    if (pending.length === 0 && inProgress.length === 0 && tasks.length > 0 && completed.length === tasks.length) {
      project.status = 'complete';
      project.completedAt = now;
      projects[project.name] = project;
      writeProjects(projects);
      log('INFO', 'supervisor_project_complete', { project: project.name, taskCount: tasks.length });
      continue;
    }

    if (pending.length === 0 && stalled.length === 0) continue;

    log('INFO', 'supervisor_project_check', {
      project:   project.name,
      pending:   pending.length,
      stalled:   stalled.length,
      inProgress: inProgress.length,
      completed: completed.length,
      failed:    failed.length,
    });

    const supervisorContext = JSON.stringify({
      type:        'supervisor_check',
      project:     project.name,
      description: project.description || '',
      stats: {
        total:      tasks.length,
        pending:    pending.length,
        inProgress: inProgress.length,
        completed:  completed.length,
        failed:     failed.length,
        stalled:    stalled.length,
      },
      pendingTasks: pending.slice(0, BATCH_SIZE).map(t => ({
        id: t.id, description: t.description
      })),
      stalledTasks: stalled.map(t => ({
        id:              t.id,
        description:     t.description,
        assignedAgent:   t.assignedAgent,
        stalledForMinutes: Math.round((now - t.timestamps.assigned) / 60_000),
      })),
      recentFailures: failed.slice(-3).map(t => ({
        id: t.id, description: t.description, result: String(t.result || '').slice(0, 200)
      })),
      // Results from completed tasks — lets OrchestratorAgent pass outputs as
      // context when dispatching dependent tasks.  Limited to last 5 to stay
      // within token budget.
      recentResults: completed.filter(t => t.result).slice(-5).map(t => ({
        id:          t.id,
        description: String(t.description).slice(0, 200),
        result:      String(t.result).slice(0, 400),
      })),
    });

    try {
      const result = await dispatchToMesh('OrchestratorAgent', supervisorContext);
      log('INFO', 'supervisor_dispatched', {
        project:   project.name,
        pending:   pending.length,
        stalled:   stalled.length,
        meshStatus: result.statusCode,
      });
      dispatched++;
    } catch (err) {
      log('ERROR', 'supervisor_dispatch_failed', { project: project.name, error: err.message });
    }
  }

  log('INFO', 'supervisor_tick_end', { activeProjects: activeProjects.length, pendingProjects: pendingProjects.length, stuckPlanning: stuckPlanning.length, dispatched });
}

// Run immediately, then on interval
supervisorTick().catch(err => log('ERROR', 'supervisor_tick_error', { error: err.message }));
setInterval(() => {
  supervisorTick().catch(err => log('ERROR', 'supervisor_tick_error', { error: err.message }));
}, SUPERVISOR_INTERVAL_MS);

log('INFO', 'supervisor_started', { intervalMs: SUPERVISOR_INTERVAL_MS, meshPort: MESH_PORT });

process.on('SIGTERM', () => {
  log('INFO', 'supervisor_shutdown', {});
  process.exit(0);
});
