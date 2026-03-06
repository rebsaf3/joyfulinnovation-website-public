import { useEffect, useMemo, useState } from "react";
import {
  fetchProjectDashboard,
  buildProjectDashboardExportUrl,
  type DashboardFilters,
  type ProjectDashboardData,
} from "../api/projectDashboard";
import { fetchTokenUsage, type TokenUsageData } from "../api/tokenUsage";
import { shutdownBridge, shutdownSwarm } from "../api/swarmControl";
import { startSwarm } from "../api/swarmControl";

function formatDate(ts: string | null): string {
  if (!ts) return "-";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (!Number.isFinite(ms)) return "-";
  const totalSeconds = Math.max(0, Math.round((ms as number) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

function formatAgeSeconds(seconds: number | null): string {
  if (!Number.isFinite(seconds)) return "-";
  const s = Math.max(0, Math.round(seconds as number));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m ago`;
}

function formatCount(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US").format(Math.round(value as number));
}

function formatUsd(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "-";
  const n = Number(value);
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function toIsoIfValid(value: string): string | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

type FilterState = {
  agent: string;
  milestone: string;
  status: string;
  period: string;
  from: string;
  to: string;
};

function toApiFilters(state: FilterState): DashboardFilters {
  const filters: DashboardFilters = {};
  if (state.agent && state.agent !== "all") filters.agent = state.agent;
  if (state.milestone && state.milestone !== "all") filters.milestone = state.milestone;
  if (state.status && state.status !== "all") filters.status = state.status as DashboardFilters["status"];
  if (state.period && state.period !== "all") filters.period = state.period as DashboardFilters["period"];
  if (state.from) {
    const isoFrom = toIsoIfValid(state.from);
    if (isoFrom) filters.from = isoFrom;
  }
  if (state.to) {
    const isoTo = toIsoIfValid(state.to);
    if (isoTo) filters.to = isoTo;
  }
  return filters;
}

const KPI_TOOLTIP_BY_LABEL: Record<string, string> = {
  "Online Agents": "Agents currently online based on recent lifecycle events.",
  "Active Agents": "Online agents with recent execution activity or open work.",
  "Stale Agents": "Online agents with assigned/open work but no recent execution.",
  "Idle Agents": "Online agents without active execution, backlog, or error state.",
  "Error Agents": "Online agents with unresolved errors in the error window.",
  "Agents Actively Working": "Unique agents currently owning at least one in-progress task.",
  "Agents w/ Backlog": "Agents that currently own assigned or in-progress tasks.",
  "Recent Execution Agents": "Agents that executed work in the active activity window.",
  "Tracked Agents": "Total unique agents tracked from logs and task ownership.",
  Assigned: "Tasks assigned but not yet started.",
  "In Progress": "Tasks currently being worked.",
  Completed: "Tasks completed successfully.",
  Blocked: "Tasks stalled by dependency, error, or missing input.",
  Backlog: "Assigned plus in-progress tasks still outstanding.",
  "Live In-Flight": "Work units currently open from runtime activity signals.",
  "Completion Rate": "Completed tasks divided by total tasks in scope.",
  "Estimated Total Project Cost": "Estimated total LLM/token spend for the currently selected project filter window.",
  "Live Throughput / hr": "Estimated completions per hour in the live window.",
  "Live Failure Rate": "Failed work share in the live activity window.",
  "Token Events": "Number of events with token telemetry in the selected window.",
  "Input Tokens": "Total prompt/input tokens consumed.",
  "Output Tokens": "Total completion/output tokens generated.",
  "Total Tokens": "Input plus output tokens.",
  "Avg Tokens / Event": "Average total tokens consumed per token-bearing event.",
  "Estimated Cost (USD)": "Estimated spend using model/provider token pricing assumptions.",
  "Avg Cost / Event": "Estimated average spend per token-bearing event.",
  "Pricing Coverage": "Percent of events with enough provider/model data to price.",
  "Consistency Score": "Percent of KPI integrity checks that currently pass.",
  "Checks Failed": "Count of KPI integrity checks currently failing.",
};

function KpiCard({
  label,
  value,
  color = "#2563eb",
  tooltip,
}: {
  label: string;
  value: number | string;
  color?: string;
  tooltip?: string;
}) {
  const resolvedTooltip = tooltip ?? KPI_TOOLTIP_BY_LABEL[label] ?? "";
  return (
    <div
      title={resolvedTooltip || undefined}
      aria-label={resolvedTooltip || label}
      style={{
        background: "#f1f5f9",
        borderRadius: 8,
        padding: "0.9rem 1.1rem",
        minWidth: 140,
        cursor: resolvedTooltip ? "help" : "default",
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ color: "#64748b", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
        <span>{label}</span>
        {resolvedTooltip ? (
          <span
            title={resolvedTooltip}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#cbd5e1",
              color: "#1e293b",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            i
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const safe = Math.max(0, Math.min(100, percent));
  const color = safe >= 80 ? "#16a34a" : safe >= 50 ? "#2563eb" : "#f59e42";
  return (
    <div style={{ width: "100%", background: "#e2e8f0", borderRadius: 999, height: 10 }}>
      <div style={{ width: `${safe}%`, background: color, borderRadius: 999, height: "100%" }} />
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 13, color: "#334155" };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, color: "#1e293b", borderTop: "1px solid #e2e8f0" };

const TABLE_TOOLTIP_BY_HEADER: Record<string, string> = {
  Category: "Classification bucket for the metric or issue type.",
  Count: "Number of records/events in this category.",
  "Recommended Action": "Suggested remediation for this condition.",
  Agent: "Agent responsible for the work or metric row.",
  Events: "Number of token-bearing events in scope.",
  "Total Tokens": "Input plus output tokens for this row.",
  Share: "Percent share of total tokens in the current filter scope.",
  Provider: "LLM provider handling the request (for example OpenAI/Anthropic).",
  Model: "Specific model used to process the event.",
  "Estimated Cost": "Estimated USD spend based on token counts and pricing assumptions.",
  "Cost Share": "Percent share of estimated spend in the current filter scope.",
  Check: "Data integrity assertion used to validate KPI consistency.",
  Status: "Current state of the check/task/record.",
  Detail: "Expanded context explaining the value or check outcome.",
  Milestone: "Major project goal category the task belongs to.",
  Assigned: "Tasks assigned but not started.",
  "In Progress": "Tasks currently being worked.",
  Completed: "Tasks completed successfully.",
  Blocked: "Tasks prevented from progressing.",
  "Completion Rate": "Completed tasks divided by total tasks in that grouping.",
  "Avg Time to Complete": "Average duration for completed tasks in this grouping.",
  Task: "Task identifier and description.",
  Owner: "Current assignee for the task.",
  Start: "When work on the task started.",
  Completion: "When the task reached completed status.",
  "Time to Complete": "Elapsed duration between start and completion.",
  Time: "Timestamp for the event/record.",
  Event: "System or agent action that was logged.",
  Logs: "Direct link to supporting log details.",
};

function KpiHeaderCell({ label, tooltip }: { label: string; tooltip?: string }) {
  const resolvedTooltip = tooltip ?? TABLE_TOOLTIP_BY_HEADER[label] ?? "";
  return (
    <th style={th} title={resolvedTooltip || undefined} aria-label={resolvedTooltip || label}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span>{label}</span>
        {resolvedTooltip ? (
          <span
            title={resolvedTooltip}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: "#cbd5e1",
              color: "#1e293b",
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            i
          </span>
        ) : null}
      </span>
    </th>
  );
}

export default function SwarmDashboard() {
  const [data, setData] = useState<ProjectDashboardData | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageData | null>(null);
  const [tokenUsageError, setTokenUsageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [controlBusy, setControlBusy] = useState<null | "bridge" | "swarm" | "swarmStart">(null);
    async function handleSwarmStart() {
      const confirmed = window.confirm("Start the full swarm and supervisor now?");
      if (!confirmed) return;
      setControlBusy("swarmStart");
      setControlError(null);
      setControlMessage(null);
      try {
        const result = await startSwarm("dashboard_swarm_start");
        setControlMessage(result.message || "Swarm start requested. Mesh will come online shortly.");
        setRefreshNonce((n) => n + 1);
      } catch (err: unknown) {
        setControlError(err instanceof Error ? err.message : "Swarm start failed.");
      } finally {
        setControlBusy(null);
      }
    }
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    agent: "all",
    milestone: "all",
    status: "all",
    period: "all",
    from: "",
    to: "",
  });

  const apiFilters = useMemo(() => toApiFilters(filters), [filters]);
  const tokenFilters = useMemo(
    () => ({
      agent: apiFilters.agent,
      period: apiFilters.period,
      from: apiFilters.from,
      to: apiFilters.to,
      limit: 120,
    }),
    [apiFilters.agent, apiFilters.period, apiFilters.from, apiFilters.to]
  );

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    async function load() {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const payload = await fetchProjectDashboard(apiFilters);
        let tokenPayload: TokenUsageData | null = null;
        let tokenErr: string | null = null;
        try {
          tokenPayload = await fetchTokenUsage(tokenFilters);
        } catch (tokenLoadErr: unknown) {
          tokenErr = tokenLoadErr instanceof Error ? tokenLoadErr.message : "Failed to load token analytics";
        }
        if (disposed) return;
        setData(payload);
        setTokenUsage(tokenPayload);
        setTokenUsageError(tokenErr);
        setError(null);
        setLastUpdated(new Date().toISOString());
      } catch (err: unknown) {
        if (disposed) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        inFlight = false;
        if (!disposed) setLoading(false);
      }
    }

    void load();
    const interval = setInterval(() => {
      void load();
    }, 10000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [apiFilters, refreshNonce, tokenFilters]);

  const insights = useMemo(() => {
    if (!data) return [] as string[];
    const out: string[] = [];
    if ((data.summary.consistency?.failedChecks ?? 0) > 0) {
      out.push(
        `${data.summary.consistency?.failedChecks} KPI consistency check(s) failed; review the data integrity panel before acting on metrics.`
      );
    }
    if (data.summary.agentStates.error > 0) {
      out.push(`${data.summary.agentStates.error} agent(s) currently in error state; review error feed and logs.`);
    }
    if ((data.errors.topCategory ?? data.summary.errors.topCategory) === "auth") {
      out.push("Authentication failures dominate current errors; validate ANTHROPIC_API_KEY/OPENAI_API_KEY and restart the mesh.");
    }
    if ((data.errors.topCategory ?? data.summary.errors.topCategory) === "quota") {
      out.push("Provider quota/credit failures detected; replenish provider credits to restore agent throughput.");
    }
    if (data.summary.agentStates.stale > 0) {
      out.push(
        `${data.summary.agentStates.stale} stale agent(s) have open work but no recent execution activity.`
      );
    }
    if (data.summary.taskCounts.blocked > 0) {
      out.push(`${data.summary.taskCounts.blocked} blocked task(s) require triage.`);
    }
    if ((data.summary.taskCounts.reclassifiedInProgressAsBlocked ?? 0) > 0) {
      out.push(
        `${data.summary.taskCounts.reclassifiedInProgressAsBlocked} stale in-progress task(s) were auto-reclassified as blocked for KPI accuracy.`
      );
    }
    if (data.summary.live && data.summary.live.failureRatePct >= 25) {
      out.push(
        `Live failure rate is ${data.summary.live.failureRatePct}% over the last ${data.summary.live.windowMinutes} minutes; triage provider/auth failures before assigning more work.`
      );
    }
    if (
      data.summary.live &&
      data.summary.live.throughputPerHour === 0 &&
      data.summary.taskCounts.assigned + data.summary.taskCounts.inProgress > 0
    ) {
      out.push("Backlog exists but live throughput is zero; verify mesh dispatch and provider credentials.");
    }
    if (data.summary.taskCounts.completionRatePct < 60) {
      out.push(`Completion rate is ${data.summary.taskCounts.completionRatePct}%; consider rebalancing assignments.`);
    }
    if (tokenUsage && tokenUsage.summary.eventCount === 0) {
      out.push("No token telemetry in the selected time window; token efficiency KPIs are not available.");
    }
    if (out.length === 0) out.push("No immediate blockers detected.");
    return out;
  }, [data, tokenUsage]);

  const exportJsonUrl = buildProjectDashboardExportUrl("json", apiFilters);
  const exportCsvUrl = buildProjectDashboardExportUrl("csv", apiFilters);
  const exportPdfUrl = buildProjectDashboardExportUrl("pdf", apiFilters);

  async function handleBridgeShutdown() {
    const confirmed = window.confirm("Shut down BridgeAgent now?");
    if (!confirmed) return;
    setControlBusy("bridge");
    setControlError(null);
    setControlMessage(null);
    try {
      const result = await shutdownBridge("dashboard_bridge_shutdown");
      setControlMessage(result.message || "BridgeAgent shutdown requested.");
      setRefreshNonce((n) => n + 1);
    } catch (err: unknown) {
      setControlError(err instanceof Error ? err.message : "Bridge shutdown failed.");
    } finally {
      setControlBusy(null);
    }
  }

  async function handleSwarmShutdown() {
    const confirmed = window.confirm("Shut down the full swarm and supervisor now?");
    if (!confirmed) return;
    setControlBusy("swarm");
    setControlError(null);
    setControlMessage(null);
    try {
      const result = await shutdownSwarm("dashboard_swarm_shutdown");
      setControlMessage(result.message || "Swarm shutdown requested. Mesh will go offline shortly.");
    } catch (err: unknown) {
      setControlError(err instanceof Error ? err.message : "Swarm shutdown failed.");
    } finally {
      setControlBusy(null);
    }
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "Inter, Arial, sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>nyli-assets Swarm Dashboard</h1>
      <p style={{ marginTop: 0, color: "#64748b" }}>
        Live visibility into agent execution, task flow, milestone progress, and errors.
      </p>
      {lastUpdated && (
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 12 }}>Last updated: {formatDate(lastUpdated)}</p>
      )}
      {data?.summary.freshness && (
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 12 }}>
          Data freshness: last log {formatAgeSeconds(data.summary.freshness.secondsSinceLastLog)}, last task update{" "}
          {formatAgeSeconds(data.summary.freshness.secondsSinceLastTaskUpdate)}.
        </p>
      )}
      {error && <div style={{ color: "#ef4444", marginBottom: 12 }}>Error: {error}</div>}

      <section style={{ marginTop: "1rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.75rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#475569" }}>Agent</span>
            <select value={filters.agent} onChange={(e) => setFilters((p) => ({ ...p, agent: e.target.value }))}>
              <option value="all">All</option>
              {(data?.filterOptions.agents ?? []).map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#475569" }}>Milestone</span>
            <select value={filters.milestone} onChange={(e) => setFilters((p) => ({ ...p, milestone: e.target.value }))}>
              <option value="all">All</option>
              {(data?.filterOptions.milestones ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#475569" }}>Status</span>
            <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
              <option value="all">All</option>
              {(data?.filterOptions.statuses ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#475569" }}>Time period</span>
            <select value={filters.period} onChange={(e) => setFilters((p) => ({ ...p, period: e.target.value }))}>
              <option value="all">All</option>
              <option value="1h">Last 1h</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="30d">Last 30d</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#475569" }}>From</span>
            <input
              type="datetime-local"
              value={filters.from}
              onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#475569" }}>To</span>
            <input
              type="datetime-local"
              value={filters.to}
              onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
            />
          </label>
          <button
            className="btn-secondary btn-sm"
            onClick={() =>
              setFilters({
                agent: "all",
                milestone: "all",
                status: "all",
                period: "all",
                from: "",
                to: "",
              })
            }
          >
            Reset
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh Stats"}
          </button>
          <a className="btn-secondary btn-sm" href={exportJsonUrl} target="_blank" rel="noreferrer">
            Export JSON
          </a>
          <a className="btn-secondary btn-sm" href={exportCsvUrl} target="_blank" rel="noreferrer">
            Export CSV
          </a>
          <a className="btn-secondary btn-sm" href={exportPdfUrl} target="_blank" rel="noreferrer">
            Export PDF
          </a>
          <button
            className="btn-secondary btn-sm"
            onClick={handleBridgeShutdown}
            disabled={controlBusy !== null}
            style={{ background: "#f59e0b", color: "#fff" }}
          >
            {controlBusy === "bridge" ? "Stopping Bridge..." : "Shut Down Bridge"}
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={handleSwarmShutdown}
            disabled={controlBusy !== null}
            style={{ background: "#dc2626", color: "#fff" }}
          >
            {controlBusy === "swarm" ? "Stopping Swarm..." : "Shut Down Swarm"}
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={handleSwarmStart}
            disabled={controlBusy !== null}
            style={{ background: "#16a34a", color: "#fff" }}
          >
            {controlBusy === "swarmStart" ? "Starting Swarm..." : "Start Swarm"}
          </button>
        </div>
      </section>

      {controlMessage && <div style={{ color: "#15803d", marginTop: 10 }}>{controlMessage}</div>}
      {controlError && <div style={{ color: "#ef4444", marginTop: 10 }}>Control error: {controlError}</div>}

      {loading && !data && <div style={{ marginTop: 12 }}>Loading...</div>}

      {data && (
        <>
          <section style={{ marginTop: "1.2rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem" }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Actionable Insights</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {insights.map((insight, idx) => (
                <li key={idx}>{insight}</li>
              ))}
            </ul>
          </section>

          <section style={{ marginTop: "1.2rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem" }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Detected Issues</h2>
            {data.errors.countByCategory && data.errors.countByCategory.length > 0 ? (
              <>
                <p style={{ marginTop: 0, color: "#64748b", fontSize: 13 }}>
                  Dominant category: <strong>{data.errors.topCategory ?? "n/a"}</strong>
                </p>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <KpiHeaderCell label="Category" />
                      <KpiHeaderCell label="Count" />
                      <KpiHeaderCell label="Recommended Action" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.errors.countByCategory.map((row) => (
                      <tr key={row.category}>
                        <td style={td}>{row.category}</td>
                        <td style={td}>{row.count}</td>
                        <td style={td}>
                          {row.category === "auth" && "Rotate/validate API keys and restart `npm run dev:stack`."}
                          {row.category === "quota" && "Increase provider credits/quota and retry blocked work."}
                          {row.category === "timeout" && "Increase timeout budgets or reduce per-task payload size."}
                          {row.category === "dispatch" && "Verify mesh dispatch health on port 3099 and agent liveness."}
                          {row.category === "parse" && "Harden task payload format validation and directive parsing."}
                          {row.category === "runtime" && "Inspect process/runtime exceptions and dependency integrity."}
                          {row.category === "other" && "Inspect raw log detail to classify and remediate root cause."}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>No categorized issues detected in the current error window.</p>
            )}
          </section>

          <section style={{ marginTop: "1.2rem" }}>
            <h2 style={{ fontSize: 20, marginBottom: 10 }}>Agent State KPIs</h2>
            {typeof data.summary.agentStates.activityWindowMinutes === "number" && (
              <p style={{ marginTop: 0, color: "#64748b", fontSize: 12 }}>
                Active/stale classification window: last {data.summary.agentStates.activityWindowMinutes} minutes.
              </p>
            )}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <KpiCard label="Online Agents" value={data.summary.agentStates.online ?? "-"} color="#0f766e" />
              <KpiCard label="Active Agents" value={data.summary.agentStates.active} color="#16a34a" />
              <KpiCard label="Stale Agents" value={data.summary.agentStates.stale} color="#f59e42" />
              <KpiCard label="Idle Agents" value={data.summary.agentStates.idle} color="#f59e42" />
              <KpiCard label="Error Agents" value={data.summary.agentStates.error} color="#ef4444" />
              <KpiCard
                label="Agents Actively Working"
                value={data.summary.agentStates.activelyWorkingOnTasks ?? "-"}
                color="#0ea5e9"
              />
              <KpiCard label="Agents w/ Backlog" value={data.summary.agentStates.withBacklog ?? "-"} color="#475569" />
              <KpiCard
                label="Recent Execution Agents"
                value={data.summary.agentStates.withRecentExecution ?? "-"}
                color="#2563eb"
              />
              <KpiCard label="Tracked Agents" value={data.summary.agentStates.totalTracked} />
            </div>
          </section>

          <section style={{ marginTop: "1.2rem" }}>
            <h2 style={{ fontSize: 20, marginBottom: 10 }}>Task Flow KPIs</h2>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <KpiCard label="Assigned" value={data.summary.taskCounts.assigned} />
              <KpiCard label="In Progress" value={data.summary.taskCounts.inProgress} color="#16a34a" />
              <KpiCard label="Completed" value={data.summary.taskCounts.completed} color="#16a34a" />
              <KpiCard label="Blocked" value={data.summary.taskCounts.blocked} color="#ef4444" />
              <KpiCard label="Backlog" value={data.summary.taskCounts.backlog ?? "-"} color="#0f766e" />
              <KpiCard label="Live In-Flight" value={data.summary.taskCounts.liveInFlight ?? "-"} color="#0369a1" />
              <KpiCard label="Completion Rate" value={`${data.summary.taskCounts.completionRatePct}%`} />
              <KpiCard
                label="Live Throughput / hr"
                value={data.summary.live ? data.summary.live.throughputPerHour : "-"}
                color="#0ea5e9"
              />
              <KpiCard
                label="Live Failure Rate"
                value={data.summary.live ? `${data.summary.live.failureRatePct}%` : "-"}
                color={data.summary.live && data.summary.live.failureRatePct >= 25 ? "#ef4444" : "#2563eb"}
              />
            </div>
            {(data.summary.taskCounts.completedWithoutDuration ?? 0) > 0 && (
              <p style={{ marginTop: 8, color: "#92400e", fontSize: 12 }}>
                {data.summary.taskCounts.completedWithoutDuration} completed task(s) still have unknown duration due missing source timing data.
              </p>
            )}
            {(data.summary.taskCounts.reclassifiedInProgressAsBlocked ?? 0) > 0 && (
              <p style={{ marginTop: 8, color: "#92400e", fontSize: 12 }}>
                {data.summary.taskCounts.reclassifiedInProgressAsBlocked} in-progress task(s) were reclassified as blocked due
                no active owner work in the last {data.summary.taskCounts.taskProgressStaleMinutes ?? 60} minutes.
              </p>
            )}
          </section>

          <section style={{ marginTop: "1.2rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem" }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Token Usage Analytics</h2>
            {tokenUsageError && (
              <p style={{ marginTop: 0, color: "#b91c1c", fontSize: 13 }}>
                Token analytics warning: {tokenUsageError}
              </p>
            )}
            {!tokenUsage && !tokenUsageError && (
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>Loading token usage analytics...</p>
            )}
            {tokenUsage && (
              <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                  <KpiCard label="Token Events" value={formatCount(tokenUsage.summary.eventCount)} color="#0f766e" />
                  <KpiCard label="Input Tokens" value={formatCount(tokenUsage.summary.inputTokens)} color="#2563eb" />
                  <KpiCard label="Output Tokens" value={formatCount(tokenUsage.summary.outputTokens)} color="#0369a1" />
                  <KpiCard label="Total Tokens" value={formatCount(tokenUsage.summary.totalTokens)} color="#16a34a" />
                  <KpiCard
                    label="Avg Tokens / Event"
                    value={formatCount(tokenUsage.summary.avgTokensPerEvent)}
                    color="#f59e42"
                  />
                  <KpiCard label="Estimated Cost (USD)" value={formatUsd(tokenUsage.summary.estimatedCostUsd)} color="#0f766e" />
                  <KpiCard label="Avg Cost / Event" value={formatUsd(tokenUsage.summary.avgCostPerEventUsd)} color="#2563eb" />
                  <KpiCard label="Pricing Coverage" value={`${tokenUsage.summary.pricingCoveragePct}%`} color="#475569" />
                </div>
                <p style={{ marginTop: 0, color: "#64748b", fontSize: 12 }}>
                  Window: {tokenUsage.filtersApplied.period}, first event {formatDate(tokenUsage.summary.firstEventTs)}, last event{" "}
                  {formatDate(tokenUsage.summary.lastEventTs)}.
                </p>
                <p style={{ marginTop: 0, color: "#64748b", fontSize: 12 }}>
                  Estimated pricing: {tokenUsage.pricing.notes} Covered events: {formatCount(tokenUsage.summary.pricedEventCount)}/
                  {formatCount(tokenUsage.summary.eventCount)}.
                </p>
                <section style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                  <div style={{ overflowX: "auto" }}>
                    <h3 style={{ fontSize: 15, marginBottom: 6 }}>Top Agents by Tokens and Cost</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <KpiHeaderCell label="Agent" />
                          <KpiHeaderCell label="Events" />
                          <KpiHeaderCell label="Total Tokens" />
                          <KpiHeaderCell label="Share" />
                          <KpiHeaderCell label="Estimated Cost" />
                          <KpiHeaderCell label="Cost Share" />
                        </tr>
                      </thead>
                      <tbody>
                        {(tokenUsage.grouped.byAgent ?? []).slice(0, 8).map((row) => (
                          <tr key={`token-agent-${row.key}`}>
                            <td style={td}>{row.key}</td>
                            <td style={td}>{formatCount(row.count)}</td>
                            <td style={td}>{formatCount(row.totalTokens)}</td>
                            <td style={td}>{row.sharePct}%</td>
                            <td style={td}>{formatUsd(row.estimatedCostUsd)}</td>
                            <td style={td}>{row.shareCostPct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ overflowX: "auto", borderTop: "1px solid #e2e8f0", paddingTop: 12, marginTop: 2 }}>
                    <h3 style={{ fontSize: 15, marginBottom: 6 }}>Provider / Model Cost Mix</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <KpiHeaderCell label="Provider" />
                          <KpiHeaderCell label="Total Tokens" />
                          <KpiHeaderCell label="Share" />
                          <KpiHeaderCell label="Estimated Cost" />
                        </tr>
                      </thead>
                      <tbody>
                        {(tokenUsage.grouped.byProvider ?? []).slice(0, 8).map((row) => (
                          <tr key={`token-provider-${row.key}`}>
                            <td style={td}>{row.key}</td>
                            <td style={td}>{formatCount(row.totalTokens)}</td>
                            <td style={td}>{row.sharePct}%</td>
                            <td style={td}>{formatUsd(row.estimatedCostUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
                      <thead>
                        <tr>
                          <KpiHeaderCell label="Model" />
                          <KpiHeaderCell label="Events" />
                          <KpiHeaderCell label="Total Tokens" />
                          <KpiHeaderCell label="Estimated Cost" />
                        </tr>
                      </thead>
                      <tbody>
                        {(tokenUsage.grouped.byModel ?? []).slice(0, 6).map((row) => (
                          <tr key={`token-model-${row.key}`}>
                            <td style={td}>{row.key}</td>
                            <td style={td}>{formatCount(row.count)}</td>
                            <td style={td}>{formatCount(row.totalTokens)}</td>
                            <td style={td}>{formatUsd(row.estimatedCostUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </section>

          <section style={{ marginTop: "1.2rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem" }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Milestone Progress</h2>
            <div style={{ display: "grid", gap: 18 }}>
              {(data.milestones ?? []).map((m) => (
                <div key={m.key} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.8rem", background: "#f8fafc" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 4 }}>
                    <strong>{m.key}</strong>
                    <span>
                      {m.completionRatePct}% ({m.counts.completed}/{m.counts.total || 0})
                    </span>
                  </div>
                  <ProgressBar percent={m.completionRatePct} />
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                    {/* Budget KPIs */}
                    <KpiCard label="Budget Allocated" value={m.kpis?.budget?.allocated ?? "-"} color="#2563eb" />
                    <KpiCard label="Budget Spent" value={m.kpis?.budget?.spent ?? "-"} color="#f59e42" />
                    <KpiCard label="Budget Variance" value={m.kpis?.budget?.variance ?? "-"} color="#ef4444" />
                    {/* Schedule KPIs */}
                    <KpiCard label="Planned Duration (days)" value={m.kpis?.schedule?.plannedDurationDays ?? "-"} color="#0369a1" />
                    <KpiCard label="Actual Duration (days)" value={m.kpis?.schedule?.actualDurationDays ?? "-"} color="#0ea5e9" />
                    <KpiCard label="Schedule Variance (days)" value={m.kpis?.schedule?.scheduleVarianceDays ?? "-"} color="#ef4444" />
                    {/* Scope KPIs */}
                    <KpiCard label="Planned Tasks" value={m.kpis?.scope?.plannedTasks ?? "-"} color="#475569" />
                    <KpiCard label="Completed Tasks" value={m.kpis?.scope?.completedTasks ?? "-"} color="#16a34a" />
                    <KpiCard label="Scope % Complete" value={m.kpis?.scope?.percentComplete ?? "-"} color="#0f766e" />
                    {/* Quality KPIs */}
                    <KpiCard label="Defects Reported" value={m.kpis?.quality?.defectsReported ?? "-"} color="#ef4444" />
                    <KpiCard label="Defects Resolved" value={m.kpis?.quality?.defectsResolved ?? "-"} color="#16a34a" />
                    <KpiCard label="Defect Rate/KLOC" value={m.kpis?.quality?.defectRatePerKLOC ?? "-"} color="#2563eb" />
                    {/* Resource Utilization KPIs */}
                    <KpiCard label="Planned Hours" value={m.kpis?.resourceUtilization?.plannedHours ?? "-"} color="#0369a1" />
                    <KpiCard label="Logged Hours" value={m.kpis?.resourceUtilization?.loggedHours ?? "-"} color="#0ea5e9" />
                    <KpiCard label="Utilization %" value={m.kpis?.resourceUtilization?.utilizationPercent ?? "-"} color="#475569" />
                    {/* Risk KPIs */}
                    <KpiCard label="Open Risks" value={m.kpis?.risk?.openRisks ?? "-"} color="#ef4444" />
                    <KpiCard label="Mitigated Risks" value={m.kpis?.risk?.mitigatedRisks ?? "-"} color="#16a34a" />
                    <KpiCard label="Risk Severity Avg" value={m.kpis?.risk?.riskSeverityAverage ?? "-"} color="#2563eb" />
                    {/* Customer Satisfaction KPIs */}
                    <KpiCard label="Survey Score" value={m.kpis?.customerSatisfaction?.surveyScore ?? "-"} color="#0ea5e9" />
                    <KpiCard label="Net Promoter Score" value={m.kpis?.customerSatisfaction?.netPromoterScore ?? "-"} color="#475569" />
                    {/* Compliance KPIs */}
                    <KpiCard label="Audits Completed" value={m.kpis?.compliance?.auditsCompleted ?? "-"} color="#0369a1" />
                    <KpiCard label="Issues Found" value={m.kpis?.compliance?.issuesFound ?? "-"} color="#ef4444" />
                    <KpiCard label="Compliance Status" value={m.kpis?.compliance?.complianceStatus ?? "-"} color="#16a34a" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginTop: "1.2rem", display: "grid", gap: 12 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem", overflowX: "auto" }}>
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>Tasks by Milestone</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <KpiHeaderCell label="Milestone" />
                    <KpiHeaderCell label="Assigned" />
                    <KpiHeaderCell label="In Progress" />
                    <KpiHeaderCell label="Completed" />
                    <KpiHeaderCell label="Blocked" />
                    <KpiHeaderCell label="Completion Rate" />
                    <KpiHeaderCell label="Avg Time to Complete" />
                  </tr>
                </thead>
                <tbody>
                  {(data.grouped?.byMilestone ?? []).map((row) => (
                    <tr key={row.key}>
                      <td style={td}>{row.key}</td>
                      <td style={td}>{row.counts.assigned}</td>
                      <td style={td}>{row.counts.inProgress}</td>
                      <td style={td}>{row.counts.completed}</td>
                      <td style={td}>{row.counts.blocked}</td>
                      <td style={td}>{row.completionRatePct}%</td>
                      <td style={td}>{formatDuration(row.avgTimeToCompleteMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem", overflowX: "auto" }}>
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>Tasks by Agent</h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <KpiHeaderCell label="Agent" />
                    <KpiHeaderCell label="Assigned" />
                    <KpiHeaderCell label="In Progress" />
                    <KpiHeaderCell label="Completed" />
                    <KpiHeaderCell label="Blocked" />
                    <KpiHeaderCell label="Completion Rate" />
                    <KpiHeaderCell label="Avg Time to Complete" />
                  </tr>
                </thead>
                <tbody>
                  {(data.grouped?.byAgent ?? []).map((row) => (
                    <tr key={row.key}>
                      <td style={td}>{row.key}</td>
                      <td style={td}>{row.counts.assigned}</td>
                      <td style={td}>{row.counts.inProgress}</td>
                      <td style={td}>{row.counts.completed}</td>
                      <td style={td}>{row.counts.blocked}</td>
                      <td style={td}>{row.completionRatePct}%</td>
                      <td style={td}>{formatDuration(row.avgTimeToCompleteMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginTop: "1.2rem", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem", overflowX: "auto" }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Granular Task Ledger</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <KpiHeaderCell label="Task" />
                  <KpiHeaderCell label="Milestone" />
                  <KpiHeaderCell label="Owner" />
                  <KpiHeaderCell label="Status" />
                  <KpiHeaderCell label="Start" />
                  <KpiHeaderCell label="Completion" />
                  <KpiHeaderCell label="Time to Complete" />
                </tr>
              </thead>
              <tbody>
                {(data.tasks ?? []).map((task) => (
                  <tr key={task.taskKey}>
                    <td style={td}>
                      <strong>{task.project}</strong> #{task.taskId} - {task.description}
                    </td>
                    <td style={td}>{task.milestone}</td>
                    <td style={td}>{task.owner}</td>
                    <td style={td}>{task.status}</td>
                    <td style={td}>{formatDate(task.startTime)}</td>
                    <td style={td}>{formatDate(task.completionTime)}</td>
                    <td style={td}>{formatDuration(task.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginTop: "1.2rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem", overflowX: "auto" }}>
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>Errors and Exceptions</h2>
              <p style={{ marginTop: 0, color: "#64748b", fontSize: 13 }}>Total errors: {data.errors.total}</p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <KpiHeaderCell label="Time" />
                    <KpiHeaderCell label="Agent" />
                    <KpiHeaderCell label="Event" />
                    <KpiHeaderCell label="Category" />
                    <KpiHeaderCell label="Task" />
                    <KpiHeaderCell label="Logs" />
                  </tr>
                </thead>
                <tbody>
                  {(data.errors.items ?? []).map((err, idx) => (
                    <tr key={`${err.agent}-${idx}-${err.ts ?? "na"}`}>
                      <td style={td}>{formatDate(err.ts)}</td>
                      <td style={td}>{err.agent}</td>
                      <td style={td}>{err.event ?? "-"}</td>
                      <td style={td}>{err.category ?? "-"}</td>
                      <td style={td}>{err.project && err.taskId ? `${err.project}#${err.taskId}` : "-"}</td>
                      <td style={td}>
                        <a href={err.logLink} target="_blank" rel="noreferrer">
                          open logs
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.9rem" }}>
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>Recent Activity Feed</h2>
              <div style={{ display: "grid", gap: 8, maxHeight: 360, overflow: "auto" }}>
                {(data.recentActivity ?? []).map((item, idx) => (
                  <div key={`${item.event}-${item.agent}-${idx}`} style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: 6 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{formatDate(item.ts)}</div>
                    <div style={{ fontSize: 13 }}>
                      <strong>{item.agent}</strong> - {item.event}
                    </div>
                    <div style={{ fontSize: 12, color: "#475569" }}>{item.message}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

        </>
      )}
    </div>
  );
}
