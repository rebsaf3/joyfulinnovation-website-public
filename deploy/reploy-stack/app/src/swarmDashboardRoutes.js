const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { buildDashboardKpiPdf } = require("./pdfDashboardReport");
const {
  resolveSwarmRoot,
  resolveSwarmLogsDir,
  resolveSwarmServerLogsDir,
  resolveSwarmActivityLogCandidates,
  resolveSwarmProjectsFileCandidates,
  resolveMeshPort,
  resolveSwarmRuntimeMode,
} = require("./runtimePaths");

const router = express.Router();

const SWARM_ROOT = resolveSwarmRoot();
const LOGS_DIR = resolveSwarmLogsDir();
const SERVER_LOGS_DIR = resolveSwarmServerLogsDir();
const ACTIVITY_LOG = resolveSwarmActivityLogCandidates();
const PROJECTS_FILE = resolveSwarmProjectsFileCandidates();
const MESH_PORT = resolveMeshPort();
const SWARM_RUNTIME_MODE = resolveSwarmRuntimeMode();

const SWARM_DASHBOARD_AUTH_REQUIRED = String(process.env.SWARM_DASHBOARD_AUTH || "").toLowerCase() === "true";

// Swarm dashboard auth can be toggled with SWARM_DASHBOARD_AUTH=true.
// Default is open access so local swarm monitoring works without app login.
function requireAuth(req, res, next) {
  if (!SWARM_DASHBOARD_AUTH_REQUIRED) return next();
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }
  next();
}

function hasAuthenticatedSession(req) {
  return Boolean(req.session && req.session.userId);
}

function requestComesFromLocalhost(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || "").trim().toLowerCase();
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost";
}

// Harden destructive mesh control actions. If dashboard auth is disabled,
// require either localhost origin or an explicit SWARM_CONTROL_TOKEN.
function requireSwarmControlAccess(req, res, next) {
  if (SWARM_DASHBOARD_AUTH_REQUIRED) {
    if (!hasAuthenticatedSession(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized. Please log in." });
    }
    return next();
  }

  const controlToken = process.env.SWARM_CONTROL_TOKEN;
  if (controlToken) {
    const headerToken = req.get("x-swarm-control-token");
    const bodyToken = typeof req.body?.token === "string" ? req.body.token : null;
    if (headerToken === controlToken || bodyToken === controlToken) return next();
    return res.status(401).json({ ok: false, error: "Unauthorized swarm control request." });
  }

  if (requestComesFromLocalhost(req)) return next();
  return res.status(403).json({
    ok: false,
    error: "Swarm control is disabled for non-local requests until SWARM_CONTROL_TOKEN is configured.",
  });
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickFreshestFile(filePaths) {
  if (!Array.isArray(filePaths)) return filePaths;
  const available = filePaths
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => {
      try {
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return available.length ? available[0].filePath : null;
}

function readJsonLines(filePath) {
  const selectedPath = pickFreshestFile(filePath);
  if (!selectedPath) return [];
  if (!fs.existsSync(selectedPath)) return [];
  try {
    const raw = fs.readFileSync(selectedPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readProjects() {
  const selectedPath = pickFreshestFile(PROJECTS_FILE);
  if (!selectedPath) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(selectedPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function toIso(ts) {
  if (!ts) return null;
  if (typeof ts === "number") {
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const ms = Date.parse(String(ts));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeTaskStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "complete") return "completed";
  if (value === "waiting") return "blocked";
  if (value === "pending" || value === "todo" || value === "queued") return "assigned";
  if (value === "failed" || value === "stalled") return "blocked";
  if (["assigned", "in-progress", "completed", "blocked"].includes(value)) return value;
  return "assigned";
}

const MAX_RELIABLE_TASK_DURATION_MS = Number(process.env.SWARM_MAX_RELIABLE_TASK_DURATION_MS) || 4 * 60 * 60 * 1000;
const MAX_DISPLAY_TASK_DURATION_MS = Number(process.env.SWARM_MAX_DISPLAY_TASK_DURATION_MS) || 30 * 24 * 60 * 60 * 1000;

function collectProjectTasks() {
  const projects = readProjects();
  const out = [];

  // Array schema: [...]
  if (Array.isArray(projects)) {
    for (const project of projects) {
      if (!project || typeof project !== "object") continue;
      const projectName = String(project.name || project.id || "unnamed-project");
      const status = normalizeTaskStatus(project.status);
      const explicitStartedAt = toIso(project?.startedAt || project?.timestamps?.started || null);
      const fallbackStartedAt = toIso(project?.timestamps?.assigned || project?.timestamps?.created || project?.createdAt || null);
      const startedAt = explicitStartedAt || fallbackStartedAt;
      const completedAt = toIso(project?.completedAt || null);
      const durationMs = startedAt && completedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : null;
      const durationSource = completedAt
        ? explicitStartedAt
          ? "observed"
          : fallbackStartedAt
            ? "backfilled"
            : "none"
        : "none";
      out.push({
        taskKey: `${projectName}#${project.id ?? "unknown"}`,
        project: projectName,
        taskId: project.id ?? null,
        description: String(project.description || project.name || ""),
        milestone: String(project.milestone || (project.phase ? `Phase ${project.phase}` : "Uncategorized")),
        owner: String(project.assignedAgent || project.owner || "unassigned"),
        status,
        startTime: startedAt,
        completionTime: completedAt,
        durationMs,
        durationSource,
        updatedTime: completedAt || startedAt,
        resultPreview: project.result ? String(project.result).slice(0, 240) : null,
        kpis: project.kpis || {
          budget: { allocated: null, spent: null, variance: null },
          schedule: { plannedDurationDays: null, actualDurationDays: null, scheduleVarianceDays: null },
          scope: { plannedTasks: null, completedTasks: null, percentComplete: null },
          quality: { defectsReported: null, defectsResolved: null, defectRatePerKLOC: null },
          resourceUtilization: { plannedHours: null, loggedHours: null, utilizationPercent: null },
          risk: { openRisks: null, mitigatedRisks: null, riskSeverityAverage: null },
          customerSatisfaction: { surveyScore: null, netPromoterScore: null },
          compliance: { auditsCompleted: null, issuesFound: null, complianceStatus: null }
        }
      });
    }
    return out;
  }

  // New schema: { projects: [...] }
  if (Array.isArray(projects.projects)) {
    for (const project of projects.projects) {
      if (!project || typeof project !== "object") continue;
      const projectName = String(project.name || project.id || "unnamed-project");
      const tasks = Array.isArray(project.tasks) && project.tasks.length ? project.tasks : [project];
      for (const task of tasks) {
        const status = normalizeTaskStatus(task.status ?? project.status);
        const explicitStartedAt = toIso(task?.timestamps?.started || task?.startedAt || null);
        const fallbackStartedAt = toIso(
          task?.timestamps?.assigned ||
            task?.timestamps?.created ||
            task?.createdAt ||
            project?.createdAt ||
            null
        );
        const startedAt = explicitStartedAt || fallbackStartedAt;
        const completedAt = toIso(task?.timestamps?.completed || task?.completedAt || null);
        const durationMs = startedAt && completedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : null;
        const durationSource = completedAt
          ? explicitStartedAt
            ? "observed"
            : fallbackStartedAt
              ? "backfilled"
              : "none"
          : "none";
        out.push({
          taskKey: `${projectName}#${task.id ?? project.id ?? "unknown"}`,
          project: projectName,
          taskId: task.id ?? project.id ?? null,
          description: String(task.description || task.name || project.description || ""),
          milestone: String(task.milestone || (project.phase ? `Phase ${project.phase}` : "Uncategorized")),
          owner: String(task.assignedAgent || task.owner || project.assignedAgent || "unassigned"),
          status,
          startTime: startedAt,
          completionTime: completedAt,
          durationMs,
          durationSource,
          updatedTime: completedAt || startedAt,
          resultPreview: task.result ? String(task.result).slice(0, 240) : null,
          kpis: task.kpis || project.kpis || {
            budget: { allocated: null, spent: null, variance: null },
            schedule: { plannedDurationDays: null, actualDurationDays: null, scheduleVarianceDays: null },
            scope: { plannedTasks: null, completedTasks: null, percentComplete: null },
            quality: { defectsReported: null, defectsResolved: null, defectRatePerKLOC: null },
            resourceUtilization: { plannedHours: null, loggedHours: null, utilizationPercent: null },
            risk: { openRisks: null, mitigatedRisks: null, riskSeverityAverage: null },
            customerSatisfaction: { surveyScore: null, netPromoterScore: null },
            compliance: { auditsCompleted: null, issuesFound: null, complianceStatus: null }
          }
        });
      }
    }
    return out;
  }

  // Legacy schema: object map keyed by project name, containing tasks arrays.
  for (const [projectName, project] of Object.entries(projects)) {
    if (!project || typeof project !== "object") continue;
    const tasks = Array.isArray(project.tasks) ? project.tasks : [];
    for (const task of tasks) {
      const status = normalizeTaskStatus(task.status);
      const explicitStartedAt = toIso(task?.timestamps?.started || task?.startedAt || null);
      const fallbackStartedAt = toIso(task?.timestamps?.assigned || task?.timestamps?.created || null);
      const startedAt = explicitStartedAt || fallbackStartedAt;
      const completedAt = toIso(task?.timestamps?.completed || null);
      const durationMs = startedAt && completedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : null;
      const durationSource = completedAt
        ? explicitStartedAt
          ? "observed"
          : fallbackStartedAt
            ? "backfilled"
            : "none"
        : "none";
      out.push({
        taskKey: `${projectName}#${task.id ?? "unknown"}`,
        project: projectName,
        taskId: task.id ?? null,
        description: String(task.description || ""),
        milestone: String(task.milestone || "Uncategorized"),
        owner: String(task.assignedAgent || "unassigned"),
        status,
        startTime: startedAt,
        completionTime: completedAt,
        durationMs,
        durationSource,
        updatedTime: completedAt || startedAt,
        resultPreview: task.result ? String(task.result).slice(0, 240) : null,
        kpis: task.kpis || {
          budget: { allocated: null, spent: null, variance: null },
          schedule: { plannedDurationDays: null, actualDurationDays: null, scheduleVarianceDays: null },
          scope: { plannedTasks: null, completedTasks: null, percentComplete: null },
          quality: { defectsReported: null, defectsResolved: null, defectRatePerKLOC: null },
          resourceUtilization: { plannedHours: null, loggedHours: null, utilizationPercent: null },
          risk: { openRisks: null, mitigatedRisks: null, riskSeverityAverage: null },
          customerSatisfaction: { surveyScore: null, netPromoterScore: null },
          compliance: { auditsCompleted: null, issuesFound: null, complianceStatus: null }
        }
      });
    }
  }
  return out;
}

function inferErrorCategory(detail) {
  const value = String(detail || "").toLowerCase();
  if (!value) return "unknown";
  if (value.includes("401") || value.includes("auth") || value.includes("api key")) return "auth";
  if (value.includes("quota") || value.includes("credit") || value.includes("rate limit") || value.includes("429")) return "quota";
  if (value.includes("timeout") || value.includes("timed out")) return "timeout";
  if (value.includes("dispatch") || value.includes("not running")) return "routing";
  return "other";
}

function resolveTimeWindow(period, from, to) {
  const now = Date.now();
  let fromMs = from ? Date.parse(from) : Number.NaN;
  let toMs = to ? Date.parse(to) : Number.NaN;

  if (!Number.isFinite(fromMs)) {
    if (period === "1h") fromMs = now - 60 * 60 * 1000;
    else if (period === "24h") fromMs = now - 24 * 60 * 60 * 1000;
    else if (period === "7d") fromMs = now - 7 * 24 * 60 * 60 * 1000;
    else if (period === "30d") fromMs = now - 30 * 24 * 60 * 60 * 1000;
  }
  // Treat period/from filters as bounded windows ending "now" unless an explicit `to` is supplied.
  if (!Number.isFinite(toMs) && Number.isFinite(fromMs)) {
    toMs = now;
  }

  return {
    fromMs: Number.isFinite(fromMs) ? fromMs : null,
    toMs: Number.isFinite(toMs) ? toMs : null,
  };
}

function isTimestampInWindow(ts, window) {
  if (!Number.isFinite(ts)) return false;
  if (window.fromMs !== null && ts < window.fromMs) return false;
  if (window.toMs !== null && ts > window.toMs) return false;
  return true;
}

function taskMatchesWindow(task, window) {
  if (window.fromMs === null && window.toMs === null) return true;
  const startMs = Date.parse(task.startTime || "");
  const completionMs = Date.parse(task.completionTime || "");
  const updatedMs = Date.parse(task.updatedTime || "");
  return (
    isTimestampInWindow(startMs, window) ||
    isTimestampInWindow(completionMs, window) ||
    isTimestampInWindow(updatedMs, window)
  );
}

function filterByPeriod(items, period, from, to) {
  const window = resolveTimeWindow(period, from, to);

  return items.filter((item) => {
    const ts = Date.parse(item.ts || item.startTime || item.updatedTime || "");
    if (!Number.isFinite(ts)) return true;
    return isTimestampInWindow(ts, window);
  });
}

function buildProjectDashboard(filters = {}) {
  const allEvents = readJsonLines(ACTIVITY_LOG);
  const tasksAll = collectProjectTasks();
  const timeWindow = resolveTimeWindow(filters.period, filters.from, filters.to);
  const events = filterByPeriod(allEvents, filters.period, filters.from, filters.to);
  const paginate = filters.paginate !== false;

  // BKD-003: Apply pagination limits to prevent memory exhaustion
  const limit = paginate ? Math.max(1, Math.min(1000, filters.limit || 100)) : Math.max(1, tasksAll.length || 1);
  const offset = paginate ? Math.max(0, filters.offset || 0) : 0;

  const filteredTasks = tasksAll.filter((task) => {
    if (filters.agent && filters.agent !== "all" && task.owner !== filters.agent) return false;
    if (filters.milestone && filters.milestone !== "all" && task.milestone !== filters.milestone) return false;
    if (filters.status && filters.status !== "all" && task.status !== filters.status) return false;
    if (!taskMatchesWindow(task, timeWindow)) return false;
    return true;
  });

  const runtimeDurationSamples = events
    .filter((event) => ["task_complete", "work_completed"].includes(String(event.event)))
    .map((event) => Number(event.durationMs))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= MAX_RELIABLE_TASK_DURATION_MS);
  const runtimeDurationFallbackMs = runtimeDurationSamples.length
    ? Math.round(runtimeDurationSamples.reduce((sum, value) => sum + value, 0) / runtimeDurationSamples.length)
    : null;

  const normalizedTasks = filteredTasks.map((task) => {
    if (task.status !== "completed") {
      return {
        ...task,
        rawDurationMs: Number.isFinite(task.durationMs) ? Number(task.durationMs) : null,
        durationReliability: "none",
        syntheticDurationExcluded: false,
      };
    }

    const rawDurationMs = Number.isFinite(task.durationMs) ? Number(task.durationMs) : null;
    const observedDuration = rawDurationMs !== null && task.durationSource === "observed";
    const reliableDuration =
      observedDuration && rawDurationMs > 0 && rawDurationMs <= MAX_RELIABLE_TASK_DURATION_MS ? rawDurationMs : null;
    const syntheticDurationExcluded =
      observedDuration && rawDurationMs !== null && rawDurationMs > MAX_RELIABLE_TASK_DURATION_MS;
    const estimatedDuration =
      reliableDuration === null && Number.isFinite(runtimeDurationFallbackMs) ? runtimeDurationFallbackMs : null;

    return {
      ...task,
      rawDurationMs,
      durationMs: reliableDuration ?? estimatedDuration ?? null,
      durationReliability: reliableDuration !== null ? "reliable" : estimatedDuration !== null ? "estimated" : "none",
      syntheticDurationExcluded,
    };
  });

  // Apply pagination to task list
  const paginatedTasks = paginate ? normalizedTasks.slice(offset, offset + limit) : normalizedTasks;
  const tasksPagination = {
    offset,
    limit,
    total: normalizedTasks.length,
    returned: paginatedTasks.length,
    hasMore: paginate ? offset + limit < normalizedTasks.length : false,
    nextOffset: paginate && offset + limit < normalizedTasks.length ? offset + limit : null,
  };

  const allAgents = new Set();
  for (const event of allEvents) if (event.agent) allAgents.add(String(event.agent));
  for (const task of tasksAll) if (task.owner && task.owner !== "unassigned") allAgents.add(task.owner);

  const onlineAgents = new Set();
  for (const event of allEvents.slice(-1000)) {
    if (event.event === "mesh_health_check" && event.status && typeof event.status === "object") {
      for (const [agent, status] of Object.entries(event.status)) {
        if (String(status) === "alive") onlineAgents.add(String(agent));
      }
    }
  }

  const recentExecution = new Set(
    events
      .filter((event) => ["work_started", "work_completed", "task_complete"].includes(String(event.event)))
      .map((event) => String(event.agent || ""))
      .filter(Boolean)
  );

  const errorAgents = new Set(
    events
      .filter((event) => String(event.level || "").toUpperCase() === "ERROR" || String(event.event || "").includes("failed"))
      .map((event) => String(event.agent || ""))
      .filter(Boolean)
  );

  const backlogOwners = new Set(
    normalizedTasks
      .filter((task) => task.status === "assigned" || task.status === "in-progress")
      .map((task) => task.owner)
      .filter((owner) => owner && owner !== "unassigned")
  );
  const activelyWorkingTaskOwners = new Set(
    normalizedTasks
      .filter((task) => task.status === "in-progress")
      .map((task) => task.owner)
      .filter((owner) => owner && owner !== "unassigned")
  );

  const totals = {
    total: normalizedTasks.length,
    assigned: normalizedTasks.filter((task) => task.status === "assigned").length,
    inProgress: normalizedTasks.filter((task) => task.status === "in-progress").length,
    completed: normalizedTasks.filter((task) => task.status === "completed").length,
    blocked: normalizedTasks.filter((task) => task.status === "blocked").length,
  };

  const completionRatePct = totals.total > 0 ? Math.round((totals.completed / totals.total) * 100) : 0;

  const groupedBy = (keyFn) => {
    const map = new Map();
    for (const task of normalizedTasks) {
      const key = keyFn(task) || "Uncategorized";
      if (!map.has(key)) {
        map.set(key, {
          key,
          counts: { total: 0, assigned: 0, inProgress: 0, completed: 0, blocked: 0 },
          completionRatePct: 0,
          avgTimeToCompleteMs: null,
        });
      }
      const row = map.get(key);
      row.counts.total += 1;
      if (task.status === "assigned") row.counts.assigned += 1;
      if (task.status === "in-progress") row.counts.inProgress += 1;
      if (task.status === "completed") row.counts.completed += 1;
      if (task.status === "blocked") row.counts.blocked += 1;
    }
    for (const row of map.values()) {
      row.completionRatePct = row.counts.total > 0 ? Math.round((row.counts.completed / row.counts.total) * 100) : 0;
      const durations = normalizedTasks
        .filter((task) => keyFn(task) === row.key && task.status === "completed")
        .map((task) => {
          if (Number.isFinite(task.durationMs)) return Number(task.durationMs);
          if (Number.isFinite(task.rawDurationMs)) {
            const raw = Number(task.rawDurationMs);
            if (raw > 0 && raw <= MAX_DISPLAY_TASK_DURATION_MS) return raw;
          }
          return null;
        })
        .filter((value) => Number.isFinite(value));
      row.avgTimeToCompleteMs = durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null;
    }
    return Array.from(map.values()).sort((a, b) => b.counts.total - a.counts.total);
  };

  const errors = events
    .filter((event) => String(event.level || "").toUpperCase() === "ERROR" || String(event.event || "").includes("failed"))
    .map((event) => {
      const detail = String(event.error || event.reason || event.task || event.event || "");
      return {
        ts: toIso(event.ts),
        agent: String(event.agent || "unknown"),
        level: event.level || null,
        event: event.event || null,
        category: inferErrorCategory(detail),
        detail,
        project: event.project || null,
        taskId: event.taskId ?? null,
        logLink: `/api/agent-activity?limit=300`,
      };
    });

  const categoryCounts = Object.entries(
    errors.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const agentCounts = Object.entries(
    errors.reduce((acc, item) => {
      acc[item.agent] = (acc[item.agent] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([agent, count]) => ({ agent, count }))
    .sort((a, b) => b.count - a.count);

  const recentActivity = events
    .slice(-120)
    .reverse()
    .map((event) => ({
      ts: toIso(event.ts),
      type: String(event.level || "INFO"),
      event: String(event.event || "unknown"),
      agent: String(event.agent || "unknown"),
      project: event.project || null,
      taskId: event.taskId ?? null,
      message: String(event.error || event.taskDescription || event.task || event.event || ""),
    }));

  const filtersApplied = {
    agent: filters.agent || "all",
    milestone: filters.milestone || "all",
    status: filters.status || "all",
    period: filters.period || "all",
    from: filters.from || null,
    to: filters.to || null,
  };

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filtersApplied)) {
    if (value && value !== "all") query.set(key, String(value));
  }
  const baseQuery = query.toString();

  const nowIso = new Date().toISOString();
  const lastEvent = allEvents.length ? toIso(allEvents[allEvents.length - 1].ts) : null;
  const lastTaskUpdate = filteredTasks
    .map((task) => task.updatedTime)
    .filter(Boolean)
    .sort()
    .pop() || null;

  const secondsSince = (iso) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)) : null);

  const consistencyChecks = [
    {
      id: "task_total_matches_breakdown",
      label: "Task total matches status breakdown",
      ok: totals.total === totals.assigned + totals.inProgress + totals.completed + totals.blocked,
      detail: `total=${totals.total}, breakdown=${totals.assigned + totals.inProgress + totals.completed + totals.blocked}`,
    },
  ];

  const consistencyFailed = consistencyChecks.filter((item) => !item.ok).length;

  const liveCompletedEvents = events.filter((event) => event.event === "task_complete" || event.event === "work_completed");
  const liveFailedEvents = events.filter((event) => event.event === "task_failed");
  const liveTerminalCount = liveCompletedEvents.length + liveFailedEvents.length;
  const liveTimestamps = events.map((e) => Date.parse(e.ts || "")).filter(Number.isFinite);
  const liveWindowMs = liveTimestamps.length >= 2
    ? Math.max(1, Math.max(...liveTimestamps) - Math.min(...liveTimestamps))
    : 30 * 60 * 1000;
  const liveWindowMinutes = Math.round(liveWindowMs / 60000);
  const liveThroughputPerHour = liveWindowMs > 0
    ? Math.round((liveCompletedEvents.length / liveWindowMs) * 60 * 60 * 1000)
    : 0;


  return {
    filtersApplied,
    filterOptions: {
      agents: Array.from(allAgents).sort(),
      milestones: Array.from(new Set(tasksAll.map((task) => task.milestone))).sort(),
      statuses: ["assigned", "in-progress", "completed", "blocked"],
      periods: ["all", "1h", "24h", "7d", "30d"],
    },
    summary: {
      agentStates: {
        totalTracked: allAgents.size,
        online: onlineAgents.size,
        offline: Math.max(0, allAgents.size - onlineAgents.size),
        active: recentExecution.size,
        stale: Math.max(0, backlogOwners.size - recentExecution.size),
        idle: Math.max(0, onlineAgents.size - recentExecution.size - errorAgents.size),
        error: errorAgents.size,
        activelyWorkingOnTasks: activelyWorkingTaskOwners.size,
        withBacklog: backlogOwners.size,
        withRecentExecution: recentExecution.size,
        activityWindowMinutes: 30,
        errorWindowMinutes: 30,
      },
      taskCounts: {
        total: totals.total,
        assigned: totals.assigned,
        inProgress: totals.inProgress,
        completed: totals.completed,
        blocked: totals.blocked,
        backlog: totals.assigned + totals.inProgress,
        liveInFlight: totals.inProgress,
        completionRatePct,
        completedWithObservedDuration: normalizedTasks.filter((task) => task.status === "completed" && Number.isFinite(task.rawDurationMs)).length,
        completedWithReliableDuration: normalizedTasks.filter((task) => task.status === "completed" && task.durationReliability === "reliable").length,
        completedWithBackfilledDurationEstimate: normalizedTasks.filter((task) => task.status === "completed" && task.durationReliability === "estimated").length,
        completedExcludedAsSynthetic: normalizedTasks.filter((task) => task.status === "completed" && task.syntheticDurationExcluded).length,
        completedWithoutDuration: normalizedTasks.filter((task) => task.status === "completed" && task.durationReliability === "none").length,
        reclassifiedInProgressAsBlocked: 0,
        taskProgressStaleMinutes: 30,
      },
      live: {
        windowMinutes: liveWindowMinutes,
        received: events.filter((event) => event.event === "task_received").length,
        dispatched: events.filter((event) => event.event === "task_dispatched").length,
        started: events.filter((event) => event.event === "work_started").length,
        completed: liveCompletedEvents.length,
        failed: liveFailedEvents.length,
        throughputPerHour: liveThroughputPerHour,
        failureRatePct: liveTerminalCount > 0
          ? Math.round((liveFailedEvents.length / liveTerminalCount) * 100)
          : 0,
      },
      consistency: {
        scorePct: consistencyChecks.length > 0 ? Math.round(((consistencyChecks.length - consistencyFailed) / consistencyChecks.length) * 100) : 100,
        totalChecks: consistencyChecks.length,
        failedChecks: consistencyFailed,
        checks: consistencyChecks,
        flags: consistencyChecks.filter((item) => !item.ok).map((item) => item.id),
      },
      errors: {
        total: errors.length,
        byCategory: categoryCounts,
        topCategory: categoryCounts[0]?.category || null,
      },
      freshness: {
        lastLogTs: lastEvent,
        secondsSinceLastLog: secondsSince(lastEvent),
        lastTaskUpdateTs: lastTaskUpdate,
        secondsSinceLastTaskUpdate: secondsSince(lastTaskUpdate),
      },
    },
    grouped: {
      byMilestone: groupedBy((task) => task.milestone),
      byAgent: groupedBy((task) => task.owner),
    },
    milestones: groupedBy((task) => task.milestone).map((row) => {
      // Aggregate KPIs for each milestone
      const milestoneTasks = normalizedTasks.filter((task) => task.milestone === row.key);
      // Aggregate each KPI field
      const aggregateKpi = (field, subfields) => {
        const agg = {};
        for (const sub of subfields) {
          const values = milestoneTasks.map((t) => t.kpis?.[field]?.[sub]).filter((v) => v !== null && v !== undefined);
          agg[sub] = values.length ? (typeof values[0] === "number" ? values.reduce((a, b) => a + b, 0) / values.length : values[0]) : null;
        }
        return agg;
      };
      return {
        ...row,
        kpis: {
          budget: aggregateKpi("budget", ["allocated", "spent", "variance"]),
          schedule: aggregateKpi("schedule", ["plannedDurationDays", "actualDurationDays", "scheduleVarianceDays"]),
          scope: aggregateKpi("scope", ["plannedTasks", "completedTasks", "percentComplete"]),
          quality: aggregateKpi("quality", ["defectsReported", "defectsResolved", "defectRatePerKLOC"]),
          resourceUtilization: aggregateKpi("resourceUtilization", ["plannedHours", "loggedHours", "utilizationPercent"]),
          risk: aggregateKpi("risk", ["openRisks", "mitigatedRisks", "riskSeverityAverage"]),
          customerSatisfaction: aggregateKpi("customerSatisfaction", ["surveyScore", "netPromoterScore"]),
          compliance: aggregateKpi("compliance", ["auditsCompleted", "issuesFound", "complianceStatus"])
        }
      };
    }),
    tasks: paginatedTasks,
    pagination: tasksPagination,
    errors: {
      total: errors.length,
      countByAgent: agentCounts,
      countByCategory: categoryCounts,
      topCategory: categoryCounts[0]?.category || null,
      items: errors.slice(0, 100),
      logsPath: "/api/agent-activity",
    },
    recentActivity,
    export: {
      jsonUrl: `/api/project-dashboard/export?format=json${baseQuery ? `&${baseQuery}` : ""}`,
      csvUrl: `/api/project-dashboard/export?format=csv${baseQuery ? `&${baseQuery}` : ""}`,
      pdfUrl: `/api/project-dashboard/export?format=pdf${baseQuery ? `&${baseQuery}` : ""}`,
    },
    generatedAt: nowIso,
  };
}

const TOKEN_COST_MODEL_RATES = [
  { id: "openai:gpt-4o-mini", providerPattern: /openai/i, modelPattern: /gpt-4o-mini/i, inputUsdPer1M: 0.15, outputUsdPer1M: 0.60 },
  { id: "openai:gpt-4o", providerPattern: /openai/i, modelPattern: /gpt-4o(?!-mini)/i, inputUsdPer1M: 5.0, outputUsdPer1M: 15.0 },
  { id: "openai:o3-mini", providerPattern: /openai/i, modelPattern: /o3-mini/i, inputUsdPer1M: 1.10, outputUsdPer1M: 4.40 },
  { id: "anthropic:claude-haiku", providerPattern: /anthropic|claude/i, modelPattern: /haiku/i, inputUsdPer1M: 0.80, outputUsdPer1M: 4.00 },
  { id: "anthropic:claude-sonnet", providerPattern: /anthropic|claude/i, modelPattern: /sonnet/i, inputUsdPer1M: 3.00, outputUsdPer1M: 15.00 },
];

const TOKEN_COST_PROVIDER_DEFAULTS = [
  { id: "openai:provider-default", providerPattern: /openai/i, inputUsdPer1M: 2.50, outputUsdPer1M: 10.00 },
  { id: "anthropic:provider-default", providerPattern: /anthropic|claude/i, inputUsdPer1M: 3.00, outputUsdPer1M: 15.00 },
];

function resolveTokenCostRate(provider, model) {
  const providerValue = String(provider || "");
  const modelValue = String(model || "");

  for (const rate of TOKEN_COST_MODEL_RATES) {
    if (rate.providerPattern.test(providerValue) && rate.modelPattern.test(modelValue)) {
      return { ...rate, source: "model" };
    }
  }
  for (const rate of TOKEN_COST_PROVIDER_DEFAULTS) {
    if (rate.providerPattern.test(providerValue)) {
      return { ...rate, source: "provider-default" };
    }
  }
  return null;
}

function estimateEventCostUsd(event) {
  const inputTokens = safeNumber(event.inputTokens);
  const outputTokens = safeNumber(event.outputTokens);
  const rate = resolveTokenCostRate(event.provider, event.model);
  if (!rate) {
    return { estimatedCostUsd: null, pricingRateId: null, pricingSource: "unpriced" };
  }
  const estimatedCostUsd =
    (inputTokens / 1_000_000) * rate.inputUsdPer1M +
    (outputTokens / 1_000_000) * rate.outputUsdPer1M;
  return { estimatedCostUsd, pricingRateId: rate.id, pricingSource: rate.source };
}

function collectTokenUsage(filters = {}) {
  const events = readJsonLines(ACTIVITY_LOG).filter((event) => {
    const input = safeNumber(event.inputTokens, Number.NaN);
    const output = safeNumber(event.outputTokens, Number.NaN);
    return Number.isFinite(input) || Number.isFinite(output);
  });

  const filtered = filterByPeriod(events, filters.period, filters.from, filters.to).filter((event) => {
    if (filters.agent && filters.agent !== "all" && String(event.agent || "") !== filters.agent) return false;
    if (filters.project && filters.project !== "all" && String(event.project || "") !== filters.project) return false;
    if (filters.provider && filters.provider !== "all" && String(event.provider || "") !== filters.provider) return false;
    if (filters.model && filters.model !== "all" && String(event.model || "") !== filters.model) return false;
    if (filters.event && filters.event !== "all" && String(event.event || "") !== filters.event) return false;
    return true;
  });

  const limit = Math.max(1, Math.min(2000, safeNumber(filters.limit, 120)));
  const selected = filtered.slice(-limit);
  const selectedWithCost = selected.map((event) => {
    const cost = estimateEventCostUsd(event);
    return { ...event, ...cost };
  });

  const summarize = (list) => {
    const inputTokens = list.reduce((sum, item) => sum + safeNumber(item.inputTokens), 0);
    const outputTokens = list.reduce((sum, item) => sum + safeNumber(item.outputTokens), 0);
    const totalTokens = inputTokens + outputTokens;
    const estimatedCostUsd = list.reduce(
      (sum, item) => sum + (Number.isFinite(Number(item.estimatedCostUsd)) ? Number(item.estimatedCostUsd) : 0),
      0
    );
    const pricedEventCount = list.filter((item) => Number.isFinite(Number(item.estimatedCostUsd))).length;
    const unpricedEventCount = list.length - pricedEventCount;
    return { inputTokens, outputTokens, totalTokens, count: list.length, estimatedCostUsd, pricedEventCount, unpricedEventCount };
  };

  const summaryBase = summarize(selectedWithCost);

  const buildBreakdown = (keyFn) => {
    const map = new Map();
    for (const event of selectedWithCost) {
      const key = keyFn(event) || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    }
    return Array.from(map.entries())
      .map(([key, list]) => {
        const agg = summarize(list);
        return {
          key,
          count: agg.count,
          inputTokens: agg.inputTokens,
          outputTokens: agg.outputTokens,
          totalTokens: agg.totalTokens,
          avgTokensPerEvent: agg.count > 0 ? Math.round(agg.totalTokens / agg.count) : 0,
          sharePct: summaryBase.totalTokens > 0 ? Math.round((agg.totalTokens / summaryBase.totalTokens) * 100) : 0,
          estimatedCostUsd: Number(agg.estimatedCostUsd.toFixed(6)),
          pricedEventCount: agg.pricedEventCount,
          unpricedEventCount: agg.unpricedEventCount,
          shareCostPct: summaryBase.estimatedCostUsd > 0 ? Math.round((agg.estimatedCostUsd / summaryBase.estimatedCostUsd) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens);
  };

  const timelineMap = new Map();
  for (const event of selectedWithCost) {
    const ts = Date.parse(event.ts || "");
    const bucket = Number.isFinite(ts)
      ? new Date(ts - (ts % (15 * 60 * 1000))).toISOString()
      : "unknown";
    if (!timelineMap.has(bucket)) {
      timelineMap.set(bucket, { bucketStart: bucket, count: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
    }
    const row = timelineMap.get(bucket);
    row.count += 1;
    row.inputTokens += safeNumber(event.inputTokens);
    row.outputTokens += safeNumber(event.outputTokens);
    row.totalTokens += safeNumber(event.inputTokens) + safeNumber(event.outputTokens);
    row.estimatedCostUsd += Number.isFinite(Number(event.estimatedCostUsd)) ? Number(event.estimatedCostUsd) : 0;
  }

  return {
    filtersApplied: {
      agent: filters.agent || "all",
      project: filters.project || "all",
      provider: filters.provider || "all",
      model: filters.model || "all",
      event: filters.event || "all",
      period: filters.period || "all",
      from: filters.from || null,
      to: filters.to || null,
      limit,
    },
    summary: {
      eventCount: summaryBase.count,
      inputTokens: summaryBase.inputTokens,
      outputTokens: summaryBase.outputTokens,
      totalTokens: summaryBase.totalTokens,
      avgTokensPerEvent: summaryBase.count > 0 ? Math.round(summaryBase.totalTokens / summaryBase.count) : 0,
      avgInputTokensPerEvent: summaryBase.count > 0 ? Math.round(summaryBase.inputTokens / summaryBase.count) : 0,
      avgOutputTokensPerEvent: summaryBase.count > 0 ? Math.round(summaryBase.outputTokens / summaryBase.count) : 0,
      estimatedCostUsd: Number(summaryBase.estimatedCostUsd.toFixed(6)),
      avgCostPerEventUsd: summaryBase.count > 0 ? Number((summaryBase.estimatedCostUsd / summaryBase.count).toFixed(6)) : 0,
      pricedEventCount: summaryBase.pricedEventCount,
      unpricedEventCount: summaryBase.unpricedEventCount,
      pricingCoveragePct: summaryBase.count > 0 ? Math.round((summaryBase.pricedEventCount / summaryBase.count) * 100) : 0,
      firstEventTs: selectedWithCost.length ? toIso(selectedWithCost[0].ts) : null,
      lastEventTs: selectedWithCost.length ? toIso(selectedWithCost[selectedWithCost.length - 1].ts) : null,
    },
    grouped: {
      byAgent: buildBreakdown((event) => String(event.agent || "unknown")),
      byProject: buildBreakdown((event) => String(event.project || "unknown")),
      byProvider: buildBreakdown((event) => String(event.provider || "unknown")),
      byModel: buildBreakdown((event) => String(event.model || "unknown")),
    },
    pricing: {
      currency: "USD",
      unit: "per_1m_tokens",
      pricingType: "estimated",
      notes: "Model/provider rates are informational estimates and may differ from billed amounts.",
      modelRates: TOKEN_COST_MODEL_RATES.map((rate) => ({
        id: rate.id,
        inputUsdPer1M: rate.inputUsdPer1M,
        outputUsdPer1M: rate.outputUsdPer1M,
      })),
      providerDefaults: TOKEN_COST_PROVIDER_DEFAULTS.map((rate) => ({
        id: rate.id,
        inputUsdPer1M: rate.inputUsdPer1M,
        outputUsdPer1M: rate.outputUsdPer1M,
      })),
    },
    timeline: Array.from(timelineMap.values())
      .map((row) => ({ ...row, estimatedCostUsd: Number(row.estimatedCostUsd.toFixed(6)) }))
      .sort((a, b) => String(a.bucketStart).localeCompare(String(b.bucketStart))),
    events: selectedWithCost
      .map((event) => ({
        ts: toIso(event.ts),
        agent: String(event.agent || "unknown"),
        project: event.project || null,
        taskId: event.taskId ?? null,
        event: String(event.event || "unknown"),
        provider: event.provider || null,
        model: event.model || null,
        endpoint: event.endpoint || null,
        inputTokens: safeNumber(event.inputTokens),
        outputTokens: safeNumber(event.outputTokens),
        totalTokens: safeNumber(event.inputTokens) + safeNumber(event.outputTokens),
        estimatedCostUsd: Number.isFinite(Number(event.estimatedCostUsd)) ? Number(Number(event.estimatedCostUsd).toFixed(6)) : null,
        pricingRateId: event.pricingRateId || null,
        pricingSource: event.pricingSource || "unpriced",
        durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : null,
        resultPreview: event.resultPreview ? String(event.resultPreview).slice(0, 240) : null,
      }))
      .reverse(),
  };
}

function postMeshControl(pathname, payload = {}) {
  return new Promise((resolve, reject) => {
    const controlToken = process.env.SWARM_CONTROL_TOKEN;
    const mergedPayload = controlToken
      ? { ...payload, token: controlToken }
      : payload;
    const body = JSON.stringify(mergedPayload);

    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    };
    if (controlToken) headers["x-swarm-control-token"] = controlToken;

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: MESH_PORT,
        path: pathname,
        method: "POST",
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { error: raw.slice(0, 500) };
            }
          }
          resolve({ statusCode: res.statusCode || 0, body: parsed });
        });
      }
    );

    req.setTimeout(8_000, () => req.destroy(new Error("mesh control timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

function getMeshHealth() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: MESH_PORT,
        path: "/health",
        method: "GET",
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = { raw: raw.slice(0, 500) };
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            statusCode: res.statusCode || 0,
            body: parsed,
          });
        });
      }
    );
    req.setTimeout(2000, () => req.destroy(new Error("mesh health timeout")));
    req.on("error", reject);
    req.end();
  });
}

function csvEscapeField(value) {
  const text = value == null ? "" : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function formatDurationHuman(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

function buildExecutiveDashboardPdf(data) {
  const page = { width: 612, height: 792, margin: 46 };
  const fonts = { regular: "F1", bold: "F2" };
  const pages = [];
  let current = [];
  pages.push(current);

  const addOp = (op) => current.push(op);
  const newPage = () => {
    current = [];
    pages.push(current);
  };

  const clampColor = (value) => Math.max(0, Math.min(1, value));
  const rgb = (r, g, b) => `${clampColor(r).toFixed(3)} ${clampColor(g).toFixed(3)} ${clampColor(b).toFixed(3)}`;

  let y = page.height - page.margin;
  const minY = page.margin;

  const ensureSpace = (needed) => {
    if (y - needed >= minY) return;
    newPage();
    y = page.height - page.margin;
  };

  const wrapText = (text, maxChars) => {
    const src = String(text || "").trim();
    if (!src) return [""];
    const words = src.split(/\s+/);
    const out = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        if (line) out.push(line);
        if (word.length > maxChars) {
          let chunk = word;
          while (chunk.length > maxChars) {
            out.push(chunk.slice(0, maxChars - 1) + "-");
            chunk = chunk.slice(maxChars - 1);
          }
          line = chunk;
        } else {
          line = word;
        }
      }
    }
    if (line) out.push(line);
    return out;
  };

  const drawRect = (x, yBottom, width, height, fillColor) => {
    addOp(`${rgb(fillColor[0], fillColor[1], fillColor[2])} rg`);
    addOp(`${x.toFixed(2)} ${yBottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  };

  const drawRule = (x1, yLine, x2, color = [0.75, 0.80, 0.86]) => {
    addOp(`${rgb(color[0], color[1], color[2])} RG`);
    addOp("1 w");
    addOp(`${x1.toFixed(2)} ${yLine.toFixed(2)} m ${x2.toFixed(2)} ${yLine.toFixed(2)} l S`);
  };

  const drawText = (text, options = {}) => {
    const size = options.size || 10;
    const lineGap = options.lineGap ?? Math.max(3, Math.round(size * 0.35));
    const lineHeight = size + lineGap;
    const indent = options.indent || 0;
    const font = options.bold ? fonts.bold : fonts.regular;
    const color = options.color || [0.12, 0.16, 0.22];
    const maxWidth = page.width - page.margin * 2 - indent;
    const maxChars = Math.max(24, Math.floor(maxWidth / (size * 0.52)));
    const lines = wrapText(text, maxChars);
    ensureSpace(lines.length * lineHeight + 2);
    const x = page.margin + indent;
    for (const line of lines) {
      addOp(`BT /${font} ${size.toFixed(2)} Tf ${rgb(color[0], color[1], color[2])} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(line)}) Tj ET`);
      y -= lineHeight;
    }
    return lineHeight * lines.length;
  };

  const space = (height) => {
    ensureSpace(height);
    y -= height;
  };

  const metricValue = (value) => (Number.isFinite(value) ? String(value) : "-");

  const completedDurations = (data.tasks || [])
    .filter((task) => task.status === "completed" && Number.isFinite(task.durationMs))
    .map((task) => Number(task.durationMs));
  const avgCompleteMs = completedDurations.length
    ? Math.round(completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length)
    : null;

  // Header band
  drawRect(0, page.height - 88, page.width, 88, [0.11, 0.20, 0.36]);
  y = page.height - 40;
  drawText("NyLi Swarm Executive Report", { size: 20, bold: true, color: [1, 1, 1] });
  drawText(`Generated ${new Date().toISOString()} UTC`, { size: 10, color: [0.88, 0.92, 0.98] });
  y = page.height - 102;
  drawRule(page.margin, y, page.width - page.margin, [0.80, 0.86, 0.95]);
  y -= 18;

  drawText("Report Scope", { size: 12, bold: true, color: [0.10, 0.22, 0.40] });
  drawText(
    `Filters applied: agent=${data.filtersApplied.agent}, milestone=${data.filtersApplied.milestone}, status=${data.filtersApplied.status}, period=${data.filtersApplied.period}.`,
    { size: 10 }
  );
  space(4);

  drawText("Executive Summary", { size: 14, bold: true, color: [0.10, 0.22, 0.40] });
  drawText(
    `Task Portfolio: ${metricValue(data.summary.taskCounts.total)} total, ${metricValue(data.summary.taskCounts.completed)} completed (${metricValue(data.summary.taskCounts.completionRatePct)}%), ${metricValue(data.summary.taskCounts.backlog)} backlog, ${metricValue(data.summary.taskCounts.blocked)} blocked.`,
    { size: 10 }
  );
  drawText(
    `Workforce Health: ${metricValue(data.summary.agentStates.online)} online of ${metricValue(data.summary.agentStates.totalTracked)} tracked, ${metricValue(data.summary.agentStates.active)} active, ${metricValue(data.summary.agentStates.error)} in error state.`,
    { size: 10 }
  );
  if (data.summary.live) {
    drawText(
      `Live Execution (${data.summary.live.windowMinutes}m): throughput ${metricValue(data.summary.live.throughputPerHour)}/hr, failure rate ${metricValue(data.summary.live.failureRatePct)}%, completed ${metricValue(data.summary.live.completed)}, failed ${metricValue(data.summary.live.failed)}.`,
      { size: 10 }
    );
  }
  drawText(
    `Cycle Time: average completion ${formatDurationHuman(avgCompleteMs)} across ${completedDurations.length} completed task(s) with usable timing.`,
    { size: 10 }
  );
  drawText(
    `Data Quality: KPI consistency score ${metricValue(data.summary.consistency?.scorePct)}% with ${metricValue(data.summary.consistency?.failedChecks)} failed check(s).`,
    { size: 10 }
  );

  space(6);
  drawRule(page.margin, y + 4, page.width - page.margin, [0.86, 0.89, 0.94]);
  space(10);

  drawText("Top Risks & Exceptions", { size: 13, bold: true, color: [0.10, 0.22, 0.40] });
  if ((data.errors?.countByCategory || []).length > 0) {
    const categories = data.errors.countByCategory
      .slice(0, 3)
      .map((item) => `${item.category}: ${item.count}`)
      .join(" | ");
    drawText(`Dominant categories: ${categories}`, { size: 10 });
  } else {
    drawText("No categorized errors in current window.", { size: 10 });
  }

  const errorItems = (data.errors?.items || []).slice(0, 6);
  if (errorItems.length) {
    for (const item of errorItems) {
      drawText(
        `- ${item.ts || "n/a"} | ${item.agent || "unknown"} | ${item.category || "uncategorized"} | ${String(item.detail || "").slice(0, 140)}`,
        { size: 9, indent: 8 }
      );
    }
  } else {
    drawText("- No recent exception records.", { size: 9, indent: 8 });
  }

  space(10);
  drawText("Milestone Performance", { size: 13, bold: true, color: [0.10, 0.22, 0.40] });
  const topMilestones = (data.grouped?.byMilestone || []).slice(0, 8);
  if (topMilestones.length) {
    for (const milestone of topMilestones) {
      drawText(
        `- ${milestone.key}: ${metricValue(milestone.counts.total)} tasks | ${metricValue(milestone.counts.completed)} completed | ${metricValue(milestone.completionRatePct)}% completion | avg ${formatDurationHuman(milestone.avgTimeToCompleteMs)}`,
        { size: 9, indent: 8 }
      );
    }
  } else {
    drawText("- No milestone data available.", { size: 9, indent: 8 });
  }

  space(10);
  drawText("Owner Workload Snapshot", { size: 13, bold: true, color: [0.10, 0.22, 0.40] });
  const ownerRows = (data.grouped?.byAgent || [])
    .map((row) => ({
      key: row.key,
      open: (row.counts?.assigned || 0) + (row.counts?.inProgress || 0),
      blocked: row.counts?.blocked || 0,
      completed: row.counts?.completed || 0,
      total: row.counts?.total || 0,
    }))
    .sort((a, b) => b.open - a.open || b.blocked - a.blocked || b.total - a.total)
    .slice(0, 8);
  if (ownerRows.length) {
    for (const row of ownerRows) {
      drawText(
        `- ${row.key}: open ${row.open}, blocked ${row.blocked}, completed ${row.completed}, total ${row.total}`,
        { size: 9, indent: 8 }
      );
    }
  } else {
    drawText("- No owner workload data available.", { size: 9, indent: 8 });
  }

  space(10);
  drawText("Immediate Priorities", { size: 13, bold: true, color: [0.10, 0.22, 0.40] });
  const priorities = [];
  if ((data.summary.taskCounts.blocked || 0) > 0) {
    priorities.push(`Resolve ${data.summary.taskCounts.blocked} blocked task(s) to protect delivery flow.`);
  }
  if ((data.summary.agentStates.error || 0) > 0) {
    priorities.push(`Stabilize ${data.summary.agentStates.error} agent(s) currently in error state.`);
  }
  if ((data.summary.live?.failureRatePct || 0) >= 25) {
    priorities.push(`Reduce live failure rate from ${data.summary.live.failureRatePct}% by addressing provider/auth exceptions.`);
  }
  if ((data.summary.consistency?.failedChecks || 0) > 0) {
    priorities.push("Investigate KPI consistency check failures before relying on trend metrics.");
  }
  if (!priorities.length) priorities.push("No critical operational blockers detected in current reporting window.");
  priorities.slice(0, 5).forEach((item) => drawText(`- ${item}`, { size: 10, indent: 8 }));

  // Footer per page
  pages.forEach((ops, index) => {
    const footerText = `NyLi Executive Report | Page ${index + 1} of ${pages.length}`;
    ops.push(`BT /${fonts.regular} 8 Tf ${rgb(0.45, 0.49, 0.56)} rg 1 0 0 1 ${page.margin.toFixed(2)} ${(20).toFixed(2)} Tm (${escapePdfText(footerText)}) Tj ET`);
  });

  const objects = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push("2 0 obj\n<< /Type /Pages /Kids [KIDS] /Count COUNT >>\nendobj\n");
  objects.push("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  objects.push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");

  const pageObjectNums = [];
  for (let i = 0; i < pages.length; i += 1) {
    const pageObjNum = 5 + i * 2;
    const contentObjNum = pageObjNum + 1;
    pageObjectNums.push(pageObjNum);
    const stream = `${pages[i].join("\n")}\n`;
    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream\nendobj\n`
    );
  }

  objects[1] = objects[1]
    .replace("KIDS", pageObjectNums.map((num) => `${num} 0 R`).join(" "))
    .replace("COUNT", String(pageObjectNums.length));

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += obj;
  }

  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

router.get("/agent-activity", requireAuth, (req, res) => {
  const limit = Math.max(1, Math.min(5000, safeNumber(req.query.limit, 300)));
  const events = readJsonLines(ACTIVITY_LOG);
  res.json(events.slice(-limit));
});

router.get("/agent-activity/kpis", requireAuth, (_req, res) => {
  const events = readJsonLines(ACTIVITY_LOG);
  const totals = {
    totalEvents: events.length,
    errorEvents: events.filter((event) => String(event.level || "").toUpperCase() === "ERROR").length,
    dispatched: events.filter((event) => event.event === "task_dispatched").length,
    started: events.filter((event) => event.event === "work_started").length,
    completed: events.filter((event) => event.event === "task_complete" || event.event === "work_completed").length,
    failed: events.filter((event) => event.event === "task_failed").length,
    uniqueAgents: new Set(events.map((event) => String(event.agent || "")).filter(Boolean)).size,
  };
  res.json(totals);
});

router.get("/agent-verification", requireAuth, (req, res) => {
  const limit = Math.max(1, Math.min(2000, safeNumber(req.query.limit, 200)));
  const events = readJsonLines(ACTIVITY_LOG).slice(-limit);
  const startup = events.filter((event) => event.event === "agent_startup");
  const ready = events.filter((event) => event.event === "agent_ready");
  const failures = events.filter((event) => event.event === "agent_spawn_failed" || event.event === "task_failed");
  res.json({
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    totals: {
      startups: startup.length,
      ready: ready.length,
      failures: failures.length,
      uniqueAgents: new Set(ready.map((event) => String(event.agent || "")).filter(Boolean)).size,
    },
    failures: failures.slice(-50),
    recentReady: ready.slice(-100),
  });
});

router.get("/swarm-metrics", requireAuth, (_req, res) => {
  const events = readJsonLines(ACTIVITY_LOG);
  const recent = events.slice(-300).map((event) => ({
    ts: toIso(event.ts),
    event: event.event || "unknown",
    level: event.level || "INFO",
    agent: event.agent || "unknown",
    project: event.project || null,
    taskId: event.taskId ?? null,
  }));
  res.json({ totalEvents: events.length, recent });
});

router.get("/swarm-stats", requireAuth, async (_req, res) => {
  const events = readJsonLines(ACTIVITY_LOG);
  const agents = new Set(events.map((event) => String(event.agent || "")).filter(Boolean));
  const recentHealth = [...events].reverse().find((event) => event.event === "mesh_health_check" && event.status && typeof event.status === "object");
  let statusMap = recentHealth?.status || {};
  if (!statusMap || typeof statusMap !== "object" || Object.keys(statusMap).length === 0) {
    try {
      const mesh = await getMeshHealth();
      if (mesh.ok && mesh.body && typeof mesh.body === "object" && mesh.body.agents && typeof mesh.body.agents === "object") {
        statusMap = mesh.body.agents;
      }
    } catch {
      // Keep stats best-effort even when mesh health probe fails.
    }
  }
  const onlineAgents = Object.values(statusMap).filter((value) => String(value) === "alive").length;
  const trackedAgents = Math.max(agents.size, Object.keys(statusMap || {}).length);
  const totalTasks = events.filter((event) => event.event === "task_received" || event.event === "work_started").length;
  const errorCount = events.filter((event) => String(event.level || "").toUpperCase() === "ERROR" || event.event === "task_failed").length;
  const activeAgents = new Set(events.slice(-400).map((event) => String(event.agent || "")).filter(Boolean)).size;
  const staleAgents = Math.max(0, onlineAgents - activeAgents);
  const uptimePct = trackedAgents > 0 ? Math.round((onlineAgents / trackedAgents) * 100) : 0;

  res.json({
    totalAgents: trackedAgents,
    onlineAgents,
    totalTasks,
    errorCount,
    activeAgents,
    staleAgents,
    uptimePct,
    uptimeMap: statusMap,
  });
});

router.get("/swarm-status", requireAuth, async (_req, res) => {
  const keyPattern = /placeholder|your_|changeme|<|>/i;
  const keyPresence = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY && !keyPattern.test(process.env.ANTHROPIC_API_KEY)),
    openai: Boolean(process.env.OPENAI_API_KEY && !keyPattern.test(process.env.OPENAI_API_KEY)),
  };
  const hasAnyKey = keyPresence.anthropic || keyPresence.openai;

  let mesh = { ok: false, statusCode: 0, body: null };
  try {
    mesh = await getMeshHealth();
  } catch (err) {
    mesh = { ok: false, statusCode: 0, body: { error: err.message } };
  }

  let status = "offline";
  if (mesh.ok) status = hasAnyKey ? "healthy" : "degraded";
  else if (!hasAnyKey || SWARM_RUNTIME_MODE === "minimal") status = "degraded";

  return res.json({
    status,
    runtimeMode: SWARM_RUNTIME_MODE,
    keyPresence,
    mesh,
    paths: {
      swarmRoot: SWARM_ROOT,
      logsDir: LOGS_DIR,
      serverLogsDir: SERVER_LOGS_DIR,
    },
    checkedAt: new Date().toISOString(),
  });
});

router.get("/project-tasks", requireAuth, (_req, res) => {
  const tasks = collectProjectTasks();
  const byStatus = tasks.reduce(
    (acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    },
    { assigned: 0, "in-progress": 0, completed: 0, blocked: 0 }
  );

  res.json({
    summary: {
      total: tasks.length,
      byStatus,
      projects: new Set(tasks.map((task) => task.project)).size,
      owners: new Set(tasks.map((task) => task.owner)).size,
    },
    tasks,
  });
});

router.get("/token-usage", requireAuth, (req, res) => {
  res.json(
    collectTokenUsage({
      agent: req.query.agent,
      project: req.query.project,
      provider: req.query.provider,
      model: req.query.model,
      event: req.query.event,
      period: req.query.period,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    })
  );
});

router.post("/swarm-control/bridge/shutdown", requireSwarmControlAccess, async (req, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "dashboard_bridge_shutdown";
    const result = await postMeshControl("/control/bridge/shutdown", { reason });
    const statusCode = Number(result.statusCode) || 502;
    if (statusCode < 200 || statusCode >= 300) {
      return res.status(statusCode).json({
        ok: false,
        error: result.body?.error || "Bridge shutdown failed.",
        upstream: result.body || null,
      });
    }
    return res.status(statusCode).json(result.body || { ok: true });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `Bridge shutdown request failed: ${err.message}` });
  }
});

router.post("/swarm-control/shutdown", requireSwarmControlAccess, async (req, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "dashboard_swarm_shutdown";
    const result = await postMeshControl("/control/swarm/shutdown", { reason });
    const statusCode = Number(result.statusCode) || 502;
    if (statusCode < 200 || statusCode >= 300) {
      return res.status(statusCode).json({
        ok: false,
        error: result.body?.error || "Swarm shutdown failed.",
        upstream: result.body || null,
      });
    }
    return res.status(statusCode).json(result.body || { ok: true });
  } catch (err) {
    return res.status(502).json({ ok: false, error: `Swarm shutdown request failed: ${err.message}` });
  }
});

// ── Swarm start ──────────────────────────────────────────────────────────────
// Starts the agent mesh if it is not already running.  Checks the /health
// endpoint first; if healthy returns immediately.  Otherwise spawns start_mesh.js
// and polls until ready (up to 8 s) before responding.
let meshStartProc = null;

router.post("/swarm-control/start", requireSwarmControlAccess, async (req, res) => {
  // Check whether mesh is already up
  try {
    const health = await getMeshHealth();
    if (health.ok) {
      return res.json({ ok: true, status: "already_running", agents: health.body?.agentCount });
    }
  } catch {
    // not running — fall through to spawn
  }

  const meshEntry = path.join(SWARM_ROOT, "server", "src", "agent", "start_mesh.js");
  if (!fs.existsSync(meshEntry)) {
    return res.status(500).json({ ok: false, error: `Mesh entry not found: ${meshEntry}` });
  }

  if (meshStartProc && meshStartProc.exitCode === null) {
    return res.status(409).json({ ok: false, error: "Mesh start already in progress." });
  }

  meshStartProc = spawn("node", [meshEntry], {
    cwd: path.join(SWARM_ROOT, "server"),
    stdio: "ignore",
    detached: false,
    env: { ...process.env },
  });

  meshStartProc.on("error", (err) => {
    console.error("[swarm-control/start] spawn error:", err.message);
  });

  // Poll health for up to 8 seconds then respond
  const startedAt = Date.now();
  const poll = async () => {
    if (Date.now() - startedAt > 8_000) {
      return res.status(202).json({ ok: true, status: "starting", pid: meshStartProc.pid });
    }
    try {
      const health = await getMeshHealth();
      if (health.ok) {
        return res.json({ ok: true, status: "started", pid: meshStartProc.pid, agents: health.body?.agentCount });
      }
    } catch {
      // not ready yet
    }
    setTimeout(poll, 500);
  };
  setTimeout(poll, 1_000);
});

router.get("/project-dashboard", requireAuth, (req, res) => {
  // BKD-003: Add pagination to prevent memory exhaustion on large datasets
  const limit = Math.max(1, Math.min(1000, safeNumber(req.query.limit, 100)));
  const offset = Math.max(0, safeNumber(req.query.offset, 0));
  
  res.json(
    buildProjectDashboard({
      agent: req.query.agent,
      milestone: req.query.milestone,
      status: req.query.status,
      period: req.query.period,
      from: req.query.from,
      to: req.query.to,
      limit,
      offset,
    })
  );
});

router.get("/project-dashboard/export", requireAuth, (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  const data = buildProjectDashboard({
    agent: req.query.agent,
    milestone: req.query.milestone,
    status: req.query.status,
    period: req.query.period,
    from: req.query.from,
    to: req.query.to,
    paginate: false,
  });

  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"nyli-project-dashboard.json\"");
    return res.send(JSON.stringify(data, null, 2));
  }

  if (format === "csv") {
    const lines = [
      "taskKey,project,taskId,description,milestone,owner,status,startTime,completionTime,durationMs",
      ...data.tasks.map((task) =>
        [
          csvEscapeField(task.taskKey),
          csvEscapeField(task.project),
          csvEscapeField(task.taskId),
          csvEscapeField(task.description || ""),
          csvEscapeField(task.milestone),
          csvEscapeField(task.owner),
          csvEscapeField(task.status),
          csvEscapeField(task.startTime || ""),
          csvEscapeField(task.completionTime || ""),
          csvEscapeField(task.durationMs ?? ""),
        ].join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"nyli-project-dashboard.csv\"");
    return res.send(`\uFEFF${lines.join("\n")}`);
  }

  if (format === "pdf") {
    const tokenUsage = collectTokenUsage({
      agent: req.query.agent,
      period: req.query.period,
      from: req.query.from,
      to: req.query.to,
      limit: 1000,
    });
    const pdfBuffer = buildDashboardKpiPdf(data, tokenUsage);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"nyli-project-dashboard.pdf\"");
    return res.send(pdfBuffer);
  }

  return res.status(400).json({ error: "format must be one of: json, csv, pdf" });
});

module.exports = { swarmDashboardRouter: router };
