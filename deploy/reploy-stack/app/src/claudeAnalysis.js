/**
 * Multi-provider LLM analysis service for audit comparisons.
 *
 * Supported providers:
 *   - anthropic  → Anthropic Claude (Haiku / Sonnet / Opus)
 *   - openai     → OpenAI GPT-4o-mini / GPT-3.5-turbo / GPT-4o
 *
 * Credential resolution:
 *   1. DB `settings` table (llm_provider, llm_api_key, llm_model etc.)
 *   2. ANTHROPIC_API_KEY or OPENAI_API_KEY env var (fallback)
 *
 * The DB is re-read on every call so the owner can update creds at runtime.
 */

const PROVIDER_DEFAULTS = {
  anthropic: { model: "claude-3-haiku-20240307", maxTokens: 512 },
  openai:    { model: "gpt-4o-mini",             maxTokens: 512 },
};

function createClaudeAnalyzer(db) {
  // ── Resolve config from DB → env ──────────────────────────────────
  function resolveConfig() {
    let provider = "anthropic";
    let apiKey = null;
    let model = null;
    let maxTokens = 512;
    let temperature = 0.2;
    let enabled = true;

    if (db) {
      try {
        const get = (k) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) || {}).value || null;
        provider    = get("llm_provider") || "anthropic";
        apiKey      = get("llm_api_key");
        model       = get("llm_model");
        const t     = get("llm_max_tokens");
        if (t) maxTokens = parseInt(t, 10) || 512;
        const temp  = get("llm_temperature");
        if (temp != null) temperature = parseFloat(temp);
        if (get("llm_enabled") === "false") enabled = false;
      } catch (_) { /* fall through */ }
    }

    // Env-var fallback
    if (!apiKey && provider === "anthropic") apiKey = process.env.ANTHROPIC_API_KEY || null;
    if (!apiKey && provider === "openai")    apiKey = process.env.OPENAI_API_KEY || null;

    // Default model per provider
    const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.anthropic;
    if (!model) model = defaults.model;
    if (!maxTokens) maxTokens = defaults.maxTokens;

    return { provider, apiKey, model, maxTokens, temperature, enabled };
  }

  // ── Unified chat call ─────────────────────────────────────────────
  async function chat(cfg, systemPrompt, userPrompt, tokenLimit) {
    const max = tokenLimit || cfg.maxTokens;
    if (cfg.provider === "openai") {
      return chatOpenAI(cfg, systemPrompt, userPrompt, max);
    }
    return chatAnthropic(cfg, systemPrompt, userPrompt, max);
  }

  async function chatAnthropic(cfg, systemPrompt, userPrompt, maxTokens) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        temperature: cfg.temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Anthropic ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    return {
      text: (data.content && data.content[0] && data.content[0].text) || "",
      model: data.model,
      usage: data.usage,
    };
  }

  async function chatOpenAI(cfg, systemPrompt, userPrompt, maxTokens) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        temperature: cfg.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`OpenAI ${resp.status}: ${err.error?.message || resp.statusText}`);
    }
    const data = await resp.json();
    return {
      text: data.choices?.[0]?.message?.content || "",
      model: data.model,
      usage: data.usage,
    };
  }

  // ── Parse JSON safely ─────────────────────────────────────────────
  function parseJSON(text) {
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return { rawResponse: text };
    }
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    get isConfigured() {
      const { apiKey, enabled } = resolveConfig();
      return !!(apiKey && enabled);
    },

    /**
     * Analyze a comparison report — executive summary, anomalies, categories, recommendations.
     */
    async analyze(report, options = {}) {
      const cfg = resolveConfig();
      if (!cfg.apiKey || !cfg.enabled) {
        return { error: "LLM API key not configured. Set it via Owner Portal → Integrations." };
      }
      try {
        const inactive = report.onlyInFileA.length + report.onlyInFileB.length;
        const diffs = (report.fieldDifferences || []).slice(0, 3);
        const samples = report.onlyInFileA.slice(0, 2);

        const system = "You are a software license audit analyst. Return ONLY valid JSON.";
        const user = `Audit comparison:
FileA: ${report.summary.totalFileA}, FileB: ${report.summary.totalFileB}, matched: ${report.summary.matchedUsers}, inactive: ${inactive}, onlyA: ${report.onlyInFileA.length}, onlyB: ${report.onlyInFileB.length}, key: ${report.keyColumn}, diffs: ${diffs.length}${diffs.length ? "\nSample diffs: " + diffs.map(d => d.key + "→" + Object.keys(d.differences).join(",")).join("; ") : ""}${samples.length ? "\nSample missing: " + samples.map(u => u.key).join(", ") : ""}

Return JSON: {"summary":"2-3 sentences","anomalies":["issue1",…],"categorization":{"Likely Dormant":N,"Potential Risk":N,"Normal Churn":N,"Requires Review":N},"recommendations":["step1",…]}`;

        const result = await chat(cfg, system, user, cfg.maxTokens);
        return {
          success: true,
          analysis: parseJSON(result.text),
          timestamp: new Date().toISOString(),
          model: result.model,
          usage: result.usage,
        };
      } catch (error) {
        console.error("LLM analysis error:", error);
        return { success: false, error: error.message || "Analysis failed" };
      }
    },

    /**
     * Detect anomalies — risk level, alerts, recommendations.
     */
    async detectAnomalies(report) {
      const cfg = resolveConfig();
      if (!cfg.apiKey || !cfg.enabled) {
        return { success: false, error: "LLM API key not configured." };
      }
      try {
        const system = "You are a security auditor. Return ONLY valid JSON.";
        const user = `License audit: ${report.onlyInFileA.length} removed, ${report.onlyInFileB.length} added, ${report.fieldDifferences.length} changed, verification ${(report.summary.confirmationRate || 0).toFixed(0)}%.

Return JSON: {"riskLevel":"low|medium|high","alerts":[{"severity":"…","issue":"…","impact":"…"}],"recommendations":["…"]}`;

        const result = await chat(cfg, system, user, 384);
        return {
          success: true,
          anomalies: parseJSON(result.text),
          timestamp: new Date().toISOString(),
          usage: result.usage,
        };
      } catch (error) {
        console.error("Anomaly detection error:", error);
        return { success: false, error: error.message };
      }
    },

    /**
     * Categorize inactive users.
     */
    async categorizeUsers(inactiveUsers, analysisContext = "") {
      const cfg = resolveConfig();
      if (!cfg.apiKey || !cfg.enabled) {
        return { success: false, error: "LLM API key not configured." };
      }
      try {
        const sample = inactiveUsers.slice(0, 8);
        const system = "You categorize users for license audits. Return ONLY valid JSON.";
        const user = `${inactiveUsers.length} inactive users. Sample:
${sample.map((u, i) => `${i + 1}. ${u.key || u.user_key} (${u.source})`).join("\n")}
Context: ${analysisContext || "Software license audit"}

Return JSON: {"categories":{"Likely Dormant":["…"],"Potential Risk":["…"],"Normal Churn":["…"],"Requires Review":["…"]},"reasoning":"…","actions":{"Likely Dormant":"…","Potential Risk":"…","Normal Churn":"…","Requires Review":"…"}}`;

        const result = await chat(cfg, system, user, 512);
        return {
          success: true,
          categorization: parseJSON(result.text),
          totalUsers: inactiveUsers.length,
          timestamp: new Date().toISOString(),
          usage: result.usage,
        };
      } catch (error) {
        console.error("User categorization error:", error);
        return { success: false, error: error.message };
      }
    },
  };
}

module.exports = { createClaudeAnalyzer };
