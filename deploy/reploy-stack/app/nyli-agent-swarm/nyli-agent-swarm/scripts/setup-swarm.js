#!/usr/bin/env node
// setup-swarm.js — interactive setup wizard for the agent swarm
// Run from repo root: node scripts/setup-swarm.js

const readline = require('readline');
const fs       = require('fs');
const path     = require('path');
const { execSync } = require('child_process');

const ROOT       = path.resolve(__dirname, '..');
const ENV_FILE   = path.join(ROOT, '.env');
const AGENTS_DIR = path.join(ROOT, 'server', 'src', 'agent', 'agents');
const MESH_FILE  = path.join(ROOT, 'server', 'src', 'agent', 'start_mesh.js');

// ── Colour helpers ────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
};
const green  = s => `${c.green}${s}${c.reset}`;
const yellow = s => `${c.yellow}${s}${c.reset}`;
const red    = s => `${c.red}${s}${c.reset}`;
const cyan   = s => `${c.cyan}${s}${c.reset}`;
const bold   = s => `${c.bold}${s}${c.reset}`;
const dim    = s => `${c.dim}${s}${c.reset}`;

// ── Readline helper ───────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question, defaultVal) => new Promise(resolve => {
  const hint = defaultVal !== undefined ? dim(` [${defaultVal || 'skip'}]`) : '';
  rl.question(`${question}${hint}: `, answer => {
    resolve(answer.trim() || defaultVal || '');
  });
});
const confirm = async (question, def = true) => {
  const hint = def ? dim(' [Y/n]') : dim(' [y/N]');
  const answer = await ask(`${question}${hint}`, '');
  if (!answer) return def;
  return answer.toLowerCase().startsWith('y');
};

// ── .env read/write ───────────────────────────────────────────────────────────
function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  return fs.readFileSync(ENV_FILE, 'utf-8')
    .split('\n')
    .reduce((acc, line) => {
      const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (match) acc[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
      return acc;
    }, {});
}

function writeEnv(vars) {
  // Read existing file to preserve comments and structure
  let existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';
  for (const [key, value] of Object.entries(vars)) {
    if (!value && value !== 0) continue;
    const escaped = String(value).includes(' ') ? `"${value}"` : value;
    const re = new RegExp(`^(${key}=.*)$`, 'm');
    if (re.test(existing)) {
      existing = existing.replace(re, `${key}=${escaped}`);
    } else {
      existing = existing.trimEnd() + `\n${key}=${escaped}\n`;
    }
  }
  fs.writeFileSync(ENV_FILE, existing);
}

// ── Agent discovery ───────────────────────────────────────────────────────────
const STATIC_AGENTS = [
  'UIDesignerAgent', 'LLMMLAgent', 'IntegrationsAgent', 'LoggingAgent', 'OrchestratorAgent',
  'AuditDocumentationAgent', 'SecurityAgent', 'TestAgent', 'DocumentationAgent',
  'ErrorBoundaryAgent', 'BridgeAgent',
  'RegistryAgent', 'TaskManagerAgent', 'ConfigAgent', 'PackagingAgent',
  'InsightsAgent', 'MigrationAgent', 'DependencyAgent', 'CIAgent', 'ReleaseAgent',
];

function discoverAgents() {
  if (!fs.existsSync(AGENTS_DIR)) return STATIC_AGENTS;
  const files = fs.readdirSync(AGENTS_DIR);
  const dynamic = ['ClaudeAgent', 'CodexAgent'].flatMap(prefix =>
    files
      .filter(f => new RegExp(`^${prefix}(\\d+)?\\.js$`).test(f))
      .map(f => f.replace(/\.js$/, ''))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  );
  return [...new Set([...dynamic, ...STATIC_AGENTS])];
}

const PRESETS = {
  minimal: ['OrchestratorAgent', 'ErrorBoundaryAgent', 'ClaudeAgent', 'CodexAgent', 'SecurityAgent'],
  standard: null,  // all discovered
  full: null,      // same as standard, alias
};

// ── Dependency check ──────────────────────────────────────────────────────────
function checkDeps() {
  const required = ['@anthropic-ai/sdk', 'openai', 'dotenv'];
  const missing = [];
  for (const dep of required) {
    const p = path.join(ROOT, 'node_modules', dep, 'package.json');
    const sp = path.join(ROOT, 'server', 'node_modules', dep, 'package.json');
    if (!fs.existsSync(p) && !fs.existsSync(sp)) missing.push(dep);
  }
  return missing;
}

// ── Banner ────────────────────────────────────────────────────────────────────
function banner() {
  console.log('');
  console.log(bold(cyan('  ╔══════════════════════════════════════╗')));
  console.log(bold(cyan('  ║     NyLi Agent Swarm Setup Wizard    ║')));
  console.log(bold(cyan('  ╚══════════════════════════════════════╝')));
  console.log('');
}

function check(label, ok, detail = '') {
  const icon = ok ? green('✓') : red('✗');
  const msg  = ok ? green(label) : red(label);
  console.log(`  ${icon}  ${msg}${detail ? dim('  ' + detail) : ''}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  banner();

  // ── 1. Node version ─────────────────────────────────────────────────────────
  const [major] = process.versions.node.split('.').map(Number);
  check(`Node.js v${process.versions.node}`, major >= 20,
    major < 20 ? '(requires >=20)' : '');
  if (major < 20) {
    console.log(red('\n  Node 20+ required. Aborting.\n'));
    process.exit(1);
  }

  // ── 2. Key files present ────────────────────────────────────────────────────
  check('start_mesh.js found',  fs.existsSync(MESH_FILE));
  check('agents/ directory found', fs.existsSync(AGENTS_DIR));

  const allAgents = discoverAgents();
  check(`${allAgents.length} agent files discovered`, allAgents.length > 0);

  console.log('');

  // ── 3. API keys ─────────────────────────────────────────────────────────────
  console.log(bold('  API Keys'));
  console.log(dim('  ─────────────────────────────────────────'));

  const env = readEnv();
  const updates = {};

  const anthropicPresent = Boolean(env.ANTHROPIC_API_KEY && !/placeholder/i.test(env.ANTHROPIC_API_KEY));
  const openaiPresent    = Boolean(env.OPENAI_API_KEY    && !/placeholder/i.test(env.OPENAI_API_KEY));

  check('ANTHROPIC_API_KEY', anthropicPresent, anthropicPresent ? 'set' : 'not set (Claude agents will use OpenAI fallback)');
  check('OPENAI_API_KEY',    openaiPresent,    openaiPresent    ? 'set' : 'required for OrchestratorAgent');

  console.log('');

  if (!anthropicPresent) {
    const key = await ask('  Enter ANTHROPIC_API_KEY', '');
    if (key && !key.toLowerCase().includes('skip')) updates.ANTHROPIC_API_KEY = key;
  }

  if (!openaiPresent) {
    const key = await ask('  Enter OPENAI_API_KEY (required for Orchestrator)', '');
    if (key && !key.toLowerCase().includes('skip')) updates.OPENAI_API_KEY = key;
    else {
      console.log(yellow('\n  Warning: OrchestratorAgent will not function without OPENAI_API_KEY.\n'));
    }
  }

  // ── 4. Model selection ──────────────────────────────────────────────────────
  console.log('');
  console.log(bold('  Model Selection'));
  console.log(dim('  ─────────────────────────────────────────'));

  const currentAnthropicModel = env.AGENT_MODEL  || 'claude-haiku-4-5-20251001';
  const currentCodexModel     = env.CODEX_MODEL  || 'gpt-4o-mini';

  const anthropicModel = await ask(`  Anthropic model`, currentAnthropicModel);
  const codexModel     = await ask(`  OpenAI model    `, currentCodexModel);

  if (anthropicModel !== currentAnthropicModel) updates.AGENT_MODEL = anthropicModel;
  if (codexModel     !== currentCodexModel)     updates.CODEX_MODEL = codexModel;

  // ── 5. Agent selection ──────────────────────────────────────────────────────
  console.log('');
  console.log(bold('  Agent Selection'));
  console.log(dim('  ─────────────────────────────────────────'));
  console.log(`  ${dim('1)')} minimal  — ${PRESETS.minimal.join(', ')}`);
  console.log(`  ${dim('2)')} standard — all ${allAgents.length} discovered agents`);
  console.log(`  ${dim('3)')} custom   — enter a comma-separated list`);
  console.log('');

  const preset = await ask('  Choose preset', '2');
  let agentList;

  if (preset === '1' || preset.toLowerCase() === 'minimal') {
    agentList = PRESETS.minimal.filter(a => allAgents.includes(a));
  } else if (preset === '3' || preset.toLowerCase() === 'custom') {
    console.log(`\n  Available agents:\n  ${dim(allAgents.join(', '))}\n`);
    const custom = await ask('  Agent names (comma-separated)', allAgents.join(','));
    agentList = custom.split(',').map(s => s.trim()).filter(s => allAgents.includes(s));
    if (agentList.length === 0) {
      console.log(yellow('  No valid agents entered — using standard (all).'));
      agentList = allAgents;
    }
  } else {
    agentList = allAgents;
  }

  updates.AGENT_LIST = agentList.join(',');
  console.log(green(`\n  Selected ${agentList.length} agents: `) + dim(agentList.slice(0, 5).join(', ') + (agentList.length > 5 ? ` +${agentList.length - 5} more` : '')));

  // ── 6. Mesh port ─────────────────────────────────────────────────────────────
  console.log('');
  const meshPort = await ask('  Mesh dispatch port', env.MESH_PORT || '3099');
  if (meshPort !== (env.MESH_PORT || '3099')) updates.MESH_PORT = meshPort;

  // ── 7. Optional: supervisor interval ─────────────────────────────────────────
  const wantAdvanced = await confirm('\n  Configure advanced timing options?', false);
  if (wantAdvanced) {
    console.log('');
    const supInterval = await ask('  Supervisor interval (ms)', env.SUPERVISOR_INTERVAL_MS || '300000');
    const heartbeat   = await ask('  Heartbeat interval (ms)',  env.HEARTBEAT_INTERVAL_MS  || '1800000');
    const batchSize   = await ask('  Tasks per supervisor batch', env.SUPERVISOR_BATCH_SIZE || '3');
    if (supInterval !== (env.SUPERVISOR_INTERVAL_MS || '300000')) updates.SUPERVISOR_INTERVAL_MS = supInterval;
    if (heartbeat   !== (env.HEARTBEAT_INTERVAL_MS  || '1800000')) updates.HEARTBEAT_INTERVAL_MS = heartbeat;
    if (batchSize   !== (env.SUPERVISOR_BATCH_SIZE  || '3'))       updates.SUPERVISOR_BATCH_SIZE = batchSize;
  }

  // ── 8. Write .env ─────────────────────────────────────────────────────────────
  if (Object.keys(updates).length > 0) {
    writeEnv(updates);
    console.log(green('\n  ✓ .env updated'));
  } else {
    console.log(dim('\n  No .env changes needed.'));
  }

  // ── 9. Dependency check ───────────────────────────────────────────────────────
  console.log('');
  console.log(bold('  Dependencies'));
  console.log(dim('  ─────────────────────────────────────────'));
  const missing = checkDeps();
  if (missing.length > 0) {
    check('Required packages', false, missing.join(', ') + ' not found');
    const install = await confirm('  Run npm install now?', true);
    if (install) {
      console.log(dim('\n  Running npm install...\n'));
      try {
        execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
        execSync('npm install', { cwd: path.join(ROOT, 'server'), stdio: 'inherit' });
        console.log(green('\n  ✓ Dependencies installed'));
      } catch (err) {
        console.log(red(`\n  Install failed: ${err.message}`));
      }
    }
  } else {
    check('Required packages', true, '@anthropic-ai/sdk, openai, dotenv');
  }

  // ── 10. Summary ───────────────────────────────────────────────────────────────
  console.log('');
  console.log(bold(cyan('  ╔══════════════════════════════════════╗')));
  console.log(bold(cyan('  ║             Setup Complete           ║')));
  console.log(bold(cyan('  ╚══════════════════════════════════════╝')));
  console.log('');
  console.log(bold('  Start the swarm:'));
  console.log('');
  console.log(cyan('    node server/src/agent/start_mesh.js'));
  console.log('');
  console.log(bold('  Send a task:'));
  console.log('');
  console.log(cyan('    node scripts/dispatch_claude.js'));
  console.log(dim('    (or use the /dispatch HTTP endpoint on port ' + (updates.MESH_PORT || env.MESH_PORT || '3099') + ')'));
  console.log('');
  console.log(bold('  Create a project:'));
  console.log('');
  console.log(cyan(`    curl -X POST http://127.0.0.1:${updates.MESH_PORT || env.MESH_PORT || '3099'}/dispatch \\`));
  console.log(cyan(`      -H 'Content-Type: application/json' \\`));
  console.log(cyan(`      -d '{"agent":"OrchestratorAgent","task":"{\\"type\\":\\"plan_project\\",\\"name\\":\\"my-project\\",\\"description\\":\\"What to build\\",\\"goals\\":\\"Specific goals\\"}"}'`));
  console.log('');
  console.log(bold('  Monitor logs:'));
  console.log('');
  console.log(cyan('    node scripts/tail_log.js'));
  console.log(cyan('    node scripts/check_projects.js'));
  console.log('');

  rl.close();
}

main().catch(err => {
  console.error(red(`\nSetup failed: ${err.message}\n`));
  rl.close();
  process.exit(1);
});
