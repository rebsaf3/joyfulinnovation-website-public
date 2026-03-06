import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const PLACEHOLDER_RE = /placeholder|your_|changeme|<|>/i;

function clean(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isUsable(value, minLen) {
  const normalized = clean(value);
  return normalized.length >= minLen && !PLACEHOLDER_RE.test(normalized);
}

function pickUsable(candidates, minLen) {
  for (const candidate of candidates) {
    if (candidate && isUsable(candidate.value, minLen)) {
      return { source: candidate.source, value: clean(candidate.value) };
    }
  }
  return null;
}

function normalizeKey(target, aliases, minLen, parsedEnv = {}) {
  const current = clean(process.env[target] || '');
  if (isUsable(current, minLen)) {
    process.env[target] = current;
    return target;
  }

  const candidates = [
    ...aliases.map((name) => ({ source: name, value: process.env[name] })),
    { source: `${target} (.env)`, value: parsedEnv[target] },
    ...aliases.map((name) => ({ source: `${name} (.env)`, value: parsedEnv[name] })),
  ];
  const picked = pickUsable(candidates, minLen);
  if (picked) {
    process.env[target] = picked.value;
    return picked.source;
  }

  if (current) process.env[target] = current;
  return null;
}

export function loadSwarmEnv(baseDir) {
  const envPath = path.resolve(baseDir, '../../../.env');
  let parsed = {};

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    try {
      parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
    } catch {
      parsed = {};
    }
  }

  const anthropicSource = normalizeKey(
    'ANTHROPIC_API_KEY',
    ['SWARM_ANTHROPIC_API_KEY', 'COPILOT_ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'ANTHROPIC_KEY'],
    32,
    parsed,
  );
  const openaiSource = normalizeKey(
    'OPENAI_API_KEY',
    ['SWARM_OPENAI_API_KEY', 'COPILOT_OPENAI_API_KEY', 'OPENAI_KEY'],
    20,
    parsed,
  );

  return { envPath, anthropicSource, openaiSource };
}
