/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const projectsFile = path.resolve(repoRoot, "server/logs/projects.json");
const activityLogFile = path.resolve(repoRoot, "logs/agent_activity.log");

const SUCCESS_EVENTS = new Set(["task_complete", "work_completed"]);
const FAILURE_EVENTS = new Set(["task_failed"]);
const TERMINAL_EVENTS = new Set([...SUCCESS_EVENTS, ...FAILURE_EVENTS]);

function normalizeAgent(agent) {
  const name = String(agent || "").trim();
  if (!name) return "";
  if (/^CodexAgent\d+$/.test(name)) return "CodexAgent";
  if (/^ClaudeAgent\d+$/.test(name)) return "ClaudeAgent";
  return name;
}

function parseMsFromIso(iso) {
  if (!iso || typeof iso !== "string") return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

function toIso(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readTerminalEvents(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const byAgent = new Map();
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const event = String(row.event || "");
    if (!TERMINAL_EVENTS.has(event)) continue;
    const agentRaw = row.agent || row.agentName;
    const agent = normalizeAgent(agentRaw);
    if (!agent) continue;
    const tsMs = parseMsFromIso(row.ts);
    if (!Number.isFinite(tsMs)) continue;
    const entry = {
      agent: String(agentRaw || agent),
      ownerKey: agent,
      event,
      tsMs,
      tsIso: row.ts,
      error: row.error ? String(row.error) : "",
    };
    if (!byAgent.has(agent)) byAgent.set(agent, []);
    byAgent.get(agent).push(entry);
  }
  for (const arr of byAgent.values()) {
    arr.sort((a, b) => a.tsMs - b.tsMs);
  }
  return byAgent;
}

function normalizeTaskStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "complete" || s === "completed" || s === "done") return "complete";
  if (s === "failed" || s === "blocked" || s === "error") return "failed";
  if (s === "in-progress" || s === "in_progress" || s === "working") return "in-progress";
  return "pending";
}

function summarizeTasks(projectsObj) {
  const summary = {
    total: 0,
    pending: 0,
    inProgress: 0,
    complete: 0,
    failed: 0,
    withCompletionTimestamp: 0,
  };
  for (const project of Object.values(projectsObj)) {
    const tasks = Array.isArray(project.tasks) ? project.tasks : [];
    for (const task of tasks) {
      summary.total += 1;
      const normalized = normalizeTaskStatus(task.status);
      if (normalized === "pending") summary.pending += 1;
      else if (normalized === "in-progress") summary.inProgress += 1;
      else if (normalized === "complete") summary.complete += 1;
      else if (normalized === "failed") summary.failed += 1;
      const ts = task.timestamps || {};
      if (ts.complete || ts.completed || ts.done || ts.work_completed || ts.failed || ts.blocked || ts.error) {
        summary.withCompletionTimestamp += 1;
      }
    }
  }
  return summary;
}

function backfillProject(projectName, project, terminalByAgent) {
  const tasks = Array.isArray(project.tasks) ? project.tasks : [];
  if (!Array.isArray(project.history)) project.history = [];

  // Group candidate tasks by normalized owner key.
  const tasksByOwner = new Map();
  for (const task of tasks) {
    const normalizedStatus = normalizeTaskStatus(task.status);
    if (normalizedStatus !== "in-progress" && normalizedStatus !== "pending") continue;
    const owner = normalizeAgent(task.assignedAgent);
    if (!owner) continue;
    if (!tasksByOwner.has(owner)) tasksByOwner.set(owner, []);
    tasksByOwner.get(owner).push(task);
  }
  for (const ownerTasks of tasksByOwner.values()) {
    ownerTasks.sort((a, b) => {
      const aAssigned = Number((a.timestamps || {}).assigned || 0);
      const bAssigned = Number((b.timestamps || {}).assigned || 0);
      return aAssigned - bAssigned || Number(a.id || 0) - Number(b.id || 0);
    });
  }

  const counters = {
    completed: 0,
    failed: 0,
    untouched: 0,
  };

  for (const [owner, ownerTasks] of tasksByOwner.entries()) {
    const events = terminalByAgent.get(owner);
    if (!events || events.length === 0) {
      counters.untouched += ownerTasks.length;
      continue;
    }
    let cursor = 0;
    for (const task of ownerTasks) {
      const timestamps = task.timestamps && typeof task.timestamps === "object" ? task.timestamps : {};
      task.timestamps = timestamps;
      const assignedMs = Number(timestamps.assigned || 0);
      // Find earliest unused terminal event at/after assigned timestamp.
      let chosenIndex = -1;
      for (let idx = cursor; idx < events.length; idx++) {
        if (!Number.isFinite(assignedMs) || assignedMs <= 0 || events[idx].tsMs >= assignedMs) {
          chosenIndex = idx;
          break;
        }
      }
      if (chosenIndex === -1) {
        counters.untouched += 1;
        continue;
      }
      const event = events[chosenIndex];
      cursor = chosenIndex + 1;

      if (SUCCESS_EVENTS.has(event.event)) {
        task.status = "complete";
        if (!timestamps.complete && !timestamps.completed && !timestamps.done) {
          timestamps.complete = event.tsMs;
        }
        if (task.result == null || task.result === "") {
          task.result = `Backfilled from ${event.event} by ${event.agent} at ${event.tsIso}`;
        }
        project.history.push({
          event: "task_status_backfilled",
          taskId: task.id,
          status: "complete",
          sourceEvent: event.event,
          sourceAgent: event.agent,
          ts: Date.now(),
        });
        counters.completed += 1;
      } else if (FAILURE_EVENTS.has(event.event)) {
        task.status = "failed";
        if (!timestamps.failed && !timestamps.error && !timestamps.blocked) {
          timestamps.failed = event.tsMs;
        }
        if (task.result == null || task.result === "") {
          task.result = `Backfilled from ${event.event} by ${event.agent} at ${event.tsIso}${event.error ? `: ${event.error}` : ""}`;
        }
        project.history.push({
          event: "task_status_backfilled",
          taskId: task.id,
          status: "failed",
          sourceEvent: event.event,
          sourceAgent: event.agent,
          ts: Date.now(),
        });
        counters.failed += 1;
      }
    }
  }

  return counters;
}

function main() {
  if (!fs.existsSync(projectsFile)) {
    throw new Error(`Missing project file: ${projectsFile}`);
  }
  if (!fs.existsSync(activityLogFile)) {
    throw new Error(`Missing activity log file: ${activityLogFile}`);
  }

  const projects = readJson(projectsFile);
  const before = summarizeTasks(projects);
  const terminalByAgent = readTerminalEvents(activityLogFile);

  const totals = { completed: 0, failed: 0, untouched: 0 };
  for (const [projectName, project] of Object.entries(projects)) {
    const r = backfillProject(projectName, project, terminalByAgent);
    totals.completed += r.completed;
    totals.failed += r.failed;
    totals.untouched += r.untouched;
  }

  // Write backup then apply.
  const backupFile = `${projectsFile}.bak-${Date.now()}`;
  fs.copyFileSync(projectsFile, backupFile);
  fs.writeFileSync(projectsFile, `${JSON.stringify(projects, null, 2)}\n`, "utf8");

  const after = summarizeTasks(projects);
  const completionRate = after.total > 0 ? Math.round((after.complete / after.total) * 100) : 0;

  const result = {
    projectFile: projectsFile,
    backupFile,
    before,
    after: {
      ...after,
      completionRatePct: completionRate,
    },
    updated: totals,
    generatedAt: toIso(Date.now()),
  };
  console.log(JSON.stringify(result, null, 2));
}

main();
