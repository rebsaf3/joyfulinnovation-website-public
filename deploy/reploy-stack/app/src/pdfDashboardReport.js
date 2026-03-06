function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function rgb(r, g, b) {
  return `${clamp(r).toFixed(3)} ${clamp(g).toFixed(3)} ${clamp(b).toFixed(3)}`;
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

function formatNumberHuman(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("en-US").format(Math.round(Number(value)));
}

function formatUsd(value) {
  if (!Number.isFinite(Number(value))) return "-";
  const n = Number(value);
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function formatDateHuman(value) {
  if (!value) return "-";
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toISOString().replace("T", " ").replace(".000Z", "Z");
}

function recommendationForCategory(category) {
  const key = String(category || "").toLowerCase();
  if (key === "auth") return "Rotate/validate API keys and restart mesh services.";
  if (key === "quota") return "Increase provider credits and set spend alerts.";
  if (key === "timeout") return "Increase timeout budgets or reduce task payload size.";
  if (key === "routing" || key === "dispatch") return "Verify dispatcher health and agent liveness.";
  if (key === "parse") return "Harden payload validation and directive parsing.";
  if (key === "runtime") return "Inspect runtime exceptions and dependency integrity.";
  return "Review logs and assign remediation owner.";
}

function buildInsights(data, tokenUsage) {
  const out = [];
  if ((data.summary?.consistency?.failedChecks ?? 0) > 0) {
    out.push(`${data.summary.consistency.failedChecks} KPI consistency check(s) failed; validate data integrity before decisions.`);
  }
  if ((data.summary?.agentStates?.error ?? 0) > 0) {
    out.push(`${data.summary.agentStates.error} agent(s) currently in error state; triage provider/runtime issues.`);
  }
  if ((data.errors?.topCategory ?? data.summary?.errors?.topCategory) === "auth") {
    out.push("Authentication failures are dominant; validate provider keys and secret injection.");
  }
  if ((data.errors?.topCategory ?? data.summary?.errors?.topCategory) === "quota") {
    out.push("Quota-related failures detected; increase credits/quota to recover throughput.");
  }
  if ((data.summary?.taskCounts?.blocked ?? 0) > 0) {
    out.push(`${data.summary.taskCounts.blocked} blocked task(s) require dependency or ownership resolution.`);
  }
  if ((data.summary?.live?.failureRatePct ?? 0) >= 25) {
    out.push(`Live failure rate is ${data.summary.live.failureRatePct}%; stabilize failure sources before increasing workload.`);
  }
  if ((data.summary?.taskCounts?.completionRatePct ?? 0) < 60) {
    out.push(`Completion rate is ${data.summary.taskCounts.completionRatePct}%; rebalance assignments and remove blockers.`);
  }
  if (tokenUsage && (tokenUsage.summary?.eventCount ?? 0) === 0) {
    out.push("No token telemetry in current window; token efficiency KPIs are unavailable.");
  }
  if (!out.length) out.push("No immediate execution blockers detected in current reporting window.");
  return out;
}

function buildDashboardKpiPdf(data, tokenUsage) {
  const page = { width: 612, height: 792, margin: 42 };
  const contentWidth = page.width - page.margin * 2;
  const fonts = { regular: "F1", bold: "F2" };
  const pages = [];
  let ops = [];
  let y = 0;
  const minY = 42;

  const startPage = (first) => {
    ops = [];
    pages.push(ops);
    if (first) {
      ops.push(`${rgb(0.11, 0.20, 0.36)} rg`);
      ops.push(`0 ${(page.height - 78).toFixed(2)} ${page.width.toFixed(2)} 78 re f`);
      drawTextAt(page.margin, page.height - 34, "NyLi Swarm KPI Dashboard Report", { size: 20, bold: true, color: [1, 1, 1] });
      drawTextAt(page.margin, page.height - 50, "Executive presentation format - full KPI coverage", {
        size: 10,
        color: [0.90, 0.94, 0.98],
      });
      y = page.height - 102;
    } else {
      drawTextAt(page.margin, page.height - 30, "NyLi Swarm KPI Dashboard Report (continued)", {
        size: 11,
        bold: true,
        color: [0.16, 0.23, 0.35],
      });
      drawRule(page.margin, page.height - 36, page.width - page.margin, [0.80, 0.84, 0.90]);
      y = page.height - 56;
    }
  };

  const ensureSpace = (needed) => {
    if (y - needed >= minY) return;
    startPage(false);
  };

  const drawTextAt = (x, baselineY, text, options = {}) => {
    const size = options.size || 10;
    const fontName = options.bold ? fonts.bold : fonts.regular;
    const color = options.color || [0.10, 0.14, 0.22];
    ops.push(`BT /${fontName} ${size.toFixed(2)} Tf ${rgb(color[0], color[1], color[2])} rg 1 0 0 1 ${x.toFixed(2)} ${baselineY.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`);
  };

  const drawRule = (x1, yLine, x2, color) => {
    ops.push(`${rgb(color[0], color[1], color[2])} RG`);
    ops.push("0.9 w");
    ops.push(`${x1.toFixed(2)} ${yLine.toFixed(2)} m ${x2.toFixed(2)} ${yLine.toFixed(2)} l S`);
  };

  const fillRect = (x, yBottom, width, height, color) => {
    ops.push(`${rgb(color[0], color[1], color[2])} rg`);
    ops.push(`${x.toFixed(2)} ${yBottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  };

  const strokeRect = (x, yBottom, width, height, color) => {
    ops.push(`${rgb(color[0], color[1], color[2])} RG`);
    ops.push("0.8 w");
    ops.push(`${x.toFixed(2)} ${yBottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  };

  const wrapText = (text, maxChars) => {
    const source = String(text || "").trim();
    if (!source) return [""];
    const words = source.split(/\s+/);
    const out = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
    return out;
  };

  const trunc = (value, maxChars) => {
    const text = String(value == null ? "" : value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}...`;
  };

  const drawParagraph = (text, options = {}) => {
    const size = options.size || 10;
    const lineHeight = size + 3;
    const indent = options.indent || 0;
    const maxChars = Math.max(24, Math.floor((contentWidth - indent) / (size * 0.52)));
    const lines = wrapText(text, maxChars);
    ensureSpace(lines.length * lineHeight + 2);
    const x = page.margin + indent;
    for (const line of lines) {
      drawTextAt(x, y, line, options);
      y -= lineHeight;
    }
  };

  const sectionHeader = (title, subtitle) => {
    ensureSpace(34);
    drawTextAt(page.margin, y, title, { size: 13, bold: true, color: [0.10, 0.22, 0.40] });
    y -= 14;
    if (subtitle) {
      drawTextAt(page.margin, y, subtitle, { size: 9, color: [0.38, 0.44, 0.54] });
      y -= 12;
    }
    drawRule(page.margin, y + 4, page.width - page.margin, [0.85, 0.88, 0.93]);
    y -= 8;
  };

  const drawKpiGrid = (cards, columns) => {
    const gap = 8;
    const cardHeight = 44;
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    for (let i = 0; i < cards.length; i += columns) {
      ensureSpace(cardHeight + 8);
      const row = cards.slice(i, i + columns);
      const rowTop = y;
      row.forEach((card, idx) => {
        const x = page.margin + idx * (cardWidth + gap);
        fillRect(x, rowTop - cardHeight, cardWidth, cardHeight, [0.95, 0.97, 1.0]);
        strokeRect(x, rowTop - cardHeight, cardWidth, cardHeight, [0.82, 0.86, 0.92]);
        drawTextAt(x + 6, rowTop - 14, trunc(card.label, Math.floor((cardWidth - 12) / 4.8)), {
          size: 8,
          color: [0.34, 0.41, 0.53],
        });
        drawTextAt(x + 6, rowTop - 31, trunc(card.value, Math.floor((cardWidth - 12) / 7.2)), {
          size: 13,
          bold: true,
          color: [0.09, 0.16, 0.28],
        });
      });
      y -= cardHeight + 8;
    }
  };

  const drawTable = (title, columns, rows, options = {}) => {
    sectionHeader(title, options.subtitle || null);
    const rowHeight = options.rowHeight || 14;
    const textSize = options.textSize || 8.2;
    const maxRows = Number.isFinite(options.maxRows) ? Math.max(0, options.maxRows) : rows.length;
    const shown = rows.slice(0, maxRows);
    const weights = columns.map((c) => c.weight || 1);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
    const widths = weights.map((w) => (contentWidth * w) / totalWeight);

    const drawHeader = () => {
      ensureSpace(rowHeight * 2);
      fillRect(page.margin, y - rowHeight, contentWidth, rowHeight, [0.90, 0.93, 0.98]);
      strokeRect(page.margin, y - rowHeight, contentWidth, rowHeight, [0.78, 0.83, 0.90]);
      let x = page.margin;
      columns.forEach((col, idx) => {
        const maxChars = Math.max(4, Math.floor((widths[idx] - 6) / (textSize * 0.52)));
        drawTextAt(x + 3, y - rowHeight + 4, trunc(col.label, maxChars), {
          size: textSize,
          bold: true,
          color: [0.14, 0.21, 0.35],
        });
        x += widths[idx];
      });
      y -= rowHeight;
    };

    drawHeader();
    shown.forEach((row, rowIdx) => {
      if (y - rowHeight < minY) {
        startPage(false);
        sectionHeader(`${title} (cont.)`);
        drawHeader();
      }
      if (rowIdx % 2 === 0) fillRect(page.margin, y - rowHeight, contentWidth, rowHeight, [0.985, 0.988, 0.995]);
      strokeRect(page.margin, y - rowHeight, contentWidth, rowHeight, [0.90, 0.92, 0.95]);
      let x = page.margin;
      columns.forEach((col, idx) => {
        const maxChars = Math.max(4, Math.floor((widths[idx] - 6) / (textSize * 0.52)));
        drawTextAt(x + 3, y - rowHeight + 4, trunc(row[idx], maxChars), { size: textSize, color: [0.15, 0.20, 0.27] });
        x += widths[idx];
      });
      y -= rowHeight;
    });
    if (rows.length > shown.length) {
      drawParagraph(`Showing ${shown.length} of ${rows.length} rows in this section.`, {
        size: 8,
        color: [0.42, 0.48, 0.56],
      });
    }
    y -= 10;
  };

  startPage(true);
  drawParagraph(`Generated: ${new Date().toISOString()} | Filters: agent=${data.filtersApplied.agent}, milestone=${data.filtersApplied.milestone}, status=${data.filtersApplied.status}, period=${data.filtersApplied.period}.`, { size: 9, color: [0.35, 0.42, 0.52] });
  drawParagraph(`Data freshness: last log ${formatDateHuman(data.summary.freshness?.lastLogTs)}, last task update ${formatDateHuman(data.summary.freshness?.lastTaskUpdateTs)}.`, { size: 9, color: [0.35, 0.42, 0.52] });
  y -= 6;

  sectionHeader("Actionable Insights");
  buildInsights(data, tokenUsage).forEach((item) => drawParagraph(`- ${item}`, { size: 9.5, indent: 6 }));
  y -= 6;

  drawTable("Detected Issues", [{ label: "Category", weight: 1.0 }, { label: "Count", weight: 0.6 }, { label: "Recommended Action", weight: 2.4 }], ((data.errors?.countByCategory || []).length ? data.errors.countByCategory : [{ category: "none", count: 0 }]).map((row) => [row.category, formatNumberHuman(row.count), recommendationForCategory(row.category)]), { textSize: 8.3 });

  sectionHeader("Agent State KPIs", `Activity window: ${data.summary.agentStates.activityWindowMinutes ?? "-"} minutes`);
  drawKpiGrid([
    { label: "Online Agents", value: formatNumberHuman(data.summary.agentStates.online) },
    { label: "Active Agents", value: formatNumberHuman(data.summary.agentStates.active) },
    { label: "Stale Agents", value: formatNumberHuman(data.summary.agentStates.stale) },
    { label: "Idle Agents", value: formatNumberHuman(data.summary.agentStates.idle) },
    { label: "Error Agents", value: formatNumberHuman(data.summary.agentStates.error) },
    { label: "Agents w/ Backlog", value: formatNumberHuman(data.summary.agentStates.withBacklog) },
    { label: "Recent Execution Agents", value: formatNumberHuman(data.summary.agentStates.withRecentExecution) },
    { label: "Tracked Agents", value: formatNumberHuman(data.summary.agentStates.totalTracked) },
  ], 3);
  y -= 8;

  sectionHeader("Task Flow KPIs");
  drawKpiGrid([
    { label: "Assigned", value: formatNumberHuman(data.summary.taskCounts.assigned) },
    { label: "In Progress", value: formatNumberHuman(data.summary.taskCounts.inProgress) },
    { label: "Completed", value: formatNumberHuman(data.summary.taskCounts.completed) },
    { label: "Blocked", value: formatNumberHuman(data.summary.taskCounts.blocked) },
    { label: "Backlog", value: formatNumberHuman(data.summary.taskCounts.backlog) },
    { label: "Live In-Flight", value: formatNumberHuman(data.summary.taskCounts.liveInFlight) },
    { label: "Completion Rate", value: `${formatNumberHuman(data.summary.taskCounts.completionRatePct)}%` },
    { label: "Live Throughput / hr", value: formatNumberHuman(data.summary.live?.throughputPerHour) },
    { label: "Live Failure Rate", value: `${formatNumberHuman(data.summary.live?.failureRatePct)}%` },
  ], 3);
  drawParagraph(`Duration quality: reliable=${formatNumberHuman(data.summary.taskCounts.completedWithReliableDuration)}, estimated=${formatNumberHuman(data.summary.taskCounts.completedWithBackfilledDurationEstimate)}, unknown=${formatNumberHuman(data.summary.taskCounts.completedWithoutDuration)}.`, { size: 8.7, color: [0.38, 0.45, 0.56] });
  y -= 6;

  if (tokenUsage && typeof tokenUsage === "object") {
    sectionHeader("Token Usage Analytics");
    drawKpiGrid([
      { label: "Token Events", value: formatNumberHuman(tokenUsage.summary?.eventCount) },
      { label: "Input Tokens", value: formatNumberHuman(tokenUsage.summary?.inputTokens) },
      { label: "Output Tokens", value: formatNumberHuman(tokenUsage.summary?.outputTokens) },
      { label: "Total Tokens", value: formatNumberHuman(tokenUsage.summary?.totalTokens) },
      { label: "Avg Tokens / Event", value: formatNumberHuman(tokenUsage.summary?.avgTokensPerEvent) },
      { label: "Estimated Cost (USD)", value: formatUsd(tokenUsage.summary?.estimatedCostUsd) },
      { label: "Avg Cost / Event", value: formatUsd(tokenUsage.summary?.avgCostPerEventUsd) },
      { label: "Pricing Coverage", value: `${formatNumberHuman(tokenUsage.summary?.pricingCoveragePct)}%` },
    ], 3);
    drawParagraph(`Token window: ${tokenUsage.filtersApplied?.period || "all"} | first event ${formatDateHuman(tokenUsage.summary?.firstEventTs)} | last event ${formatDateHuman(tokenUsage.summary?.lastEventTs)}.`, { size: 8.7, color: [0.38, 0.45, 0.56] });
    drawParagraph(`Pricing assumptions: ${tokenUsage.pricing?.notes || "Estimated model/provider token pricing."}`, { size: 8.4, color: [0.38, 0.45, 0.56] });
    y -= 6;
  }

  drawTable("Data Integrity and Validation", [{ label: "Check", weight: 2.3 }, { label: "Status", weight: 0.8 }, { label: "Detail", weight: 2.4 }], (data.summary.consistency?.checks || []).map((check) => [check.label, check.ok ? "Pass" : "Fail", check.detail]));
  drawTable("Milestone Progress", [{ label: "Milestone", weight: 1.8 }, { label: "Completion Rate", weight: 0.9 }, { label: "Completed/Total", weight: 1.0 }], (data.milestones || []).map((m) => [m.key, `${formatNumberHuman(m.completionRatePct)}%`, `${formatNumberHuman(m.counts.completed)}/${formatNumberHuman(m.counts.total)}`]));
  drawTable("Tasks by Milestone", [{ label: "Milestone", weight: 1.6 }, { label: "Assigned", weight: 0.65 }, { label: "In Progress", weight: 0.75 }, { label: "Completed", weight: 0.7 }, { label: "Blocked", weight: 0.65 }, { label: "Completion Rate", weight: 0.85 }, { label: "Avg Time", weight: 0.9 }], (data.grouped?.byMilestone || []).map((row) => [row.key, formatNumberHuman(row.counts.assigned), formatNumberHuman(row.counts.inProgress), formatNumberHuman(row.counts.completed), formatNumberHuman(row.counts.blocked), `${formatNumberHuman(row.completionRatePct)}%`, formatDurationHuman(row.avgTimeToCompleteMs)]), { textSize: 8.0 });
  drawTable("Tasks by Agent", [{ label: "Agent", weight: 1.5 }, { label: "Assigned", weight: 0.65 }, { label: "In Progress", weight: 0.75 }, { label: "Completed", weight: 0.7 }, { label: "Blocked", weight: 0.65 }, { label: "Completion Rate", weight: 0.85 }, { label: "Avg Time", weight: 0.9 }], (data.grouped?.byAgent || []).map((row) => [row.key, formatNumberHuman(row.counts.assigned), formatNumberHuman(row.counts.inProgress), formatNumberHuman(row.counts.completed), formatNumberHuman(row.counts.blocked), `${formatNumberHuman(row.completionRatePct)}%`, formatDurationHuman(row.avgTimeToCompleteMs)]), { textSize: 8.0 });
  drawTable("Granular Task Ledger", [{ label: "Task", weight: 2.3 }, { label: "Milestone", weight: 1.0 }, { label: "Owner", weight: 0.85 }, { label: "Status", weight: 0.7 }, { label: "Start", weight: 1.05 }, { label: "Completion", weight: 1.05 }, { label: "Time", weight: 0.6 }], (data.tasks || []).map((task) => [`${task.project} #${task.taskId ?? "n/a"} - ${task.description || ""}`, task.milestone || "-", task.owner || "-", task.status || "-", formatDateHuman(task.startTime), formatDateHuman(task.completionTime), formatDurationHuman(task.durationMs)]), { textSize: 7.8, rowHeight: 13 });
  drawTable("Errors and Exceptions", [{ label: "Time", weight: 1.1 }, { label: "Agent", weight: 0.9 }, { label: "Event", weight: 0.9 }, { label: "Category", weight: 0.8 }, { label: "Task", weight: 0.9 }, { label: "Detail", weight: 2.2 }], (data.errors?.items || []).map((item) => [formatDateHuman(item.ts), item.agent || "-", item.event || "-", item.category || "-", item.project && item.taskId ? `${item.project}#${item.taskId}` : "-", item.detail || "-"]), { textSize: 7.8, rowHeight: 13 });
  drawTable("Recent Activity Feed", [{ label: "Time", weight: 1.1 }, { label: "Agent", weight: 0.9 }, { label: "Event", weight: 1.0 }, { label: "Project", weight: 0.8 }, { label: "Message", weight: 2.4 }], (data.recentActivity || []).map((item) => [formatDateHuman(item.ts), item.agent || "-", item.event || "-", item.project || "-", item.message || "-"]), { textSize: 7.8, rowHeight: 13, maxRows: 150 });

  if (tokenUsage && typeof tokenUsage === "object") {
    drawTable("Token Usage - Top Agents", [{ label: "Agent", weight: 1.6 }, { label: "Events", weight: 0.7 }, { label: "Input", weight: 0.8 }, { label: "Output", weight: 0.8 }, { label: "Total", weight: 0.9 }, { label: "Est. Cost", weight: 0.9 }, { label: "Cost Share", weight: 0.7 }], (tokenUsage.grouped?.byAgent || []).map((row) => [row.key, formatNumberHuman(row.count), formatNumberHuman(row.inputTokens), formatNumberHuman(row.outputTokens), formatNumberHuman(row.totalTokens), formatUsd(row.estimatedCostUsd), `${formatNumberHuman(row.shareCostPct)}%`]), { maxRows: 15 });
    drawTable("Token Usage - Provider/Model Mix", [{ label: "Type", weight: 0.75 }, { label: "Key", weight: 1.7 }, { label: "Events", weight: 0.7 }, { label: "Total Tokens", weight: 1.0 }, { label: "Est. Cost", weight: 0.95 }, { label: "Cost Share", weight: 0.7 }], [
      ...(tokenUsage.grouped?.byProvider || []).slice(0, 8).map((row) => ["Provider", row.key, formatNumberHuman(row.count), formatNumberHuman(row.totalTokens), formatUsd(row.estimatedCostUsd), `${formatNumberHuman(row.shareCostPct)}%`]),
      ...(tokenUsage.grouped?.byModel || []).slice(0, 10).map((row) => ["Model", row.key, formatNumberHuman(row.count), formatNumberHuman(row.totalTokens), formatUsd(row.estimatedCostUsd), `${formatNumberHuman(row.shareCostPct)}%`]),
    ]);
  }

  pages.forEach((pageOps, idx) => {
    const left = "NyLi Swarm KPI Dashboard Report";
    const right = `Page ${idx + 1} of ${pages.length}`;
    pageOps.push(`BT /${fonts.regular} 8 Tf ${rgb(0.44, 0.49, 0.56)} rg 1 0 0 1 ${page.margin.toFixed(2)} 20 Tm (${escapePdfText(left)}) Tj ET`);
    pageOps.push(`BT /${fonts.regular} 8 Tf ${rgb(0.44, 0.49, 0.56)} rg 1 0 0 1 ${(page.width - page.margin - 78).toFixed(2)} 20 Tm (${escapePdfText(right)}) Tj ET`);
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
    objects.push(`${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`);
    objects.push(`${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream\nendobj\n`);
  }

  objects[1] = objects[1].replace("KIDS", pageObjectNums.map((n) => `${n} 0 R`).join(" ")).replace("COUNT", String(pageObjectNums.length));

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

module.exports = { buildDashboardKpiPdf };
