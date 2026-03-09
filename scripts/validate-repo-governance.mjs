/**
 * validate-repo-governance.mjs
 *
 * Meta-validator: checks that the governance files themselves are present and
 * contain their required sections. If this validator passes, a future agent
 * can enter the repo, read the governance files, and work correctly without
 * needing manual re-explanation.
 *
 * Rules come from the March 2026 governance audit. For each included rule, a
 * comment explains why it was included. Excluded rules are listed at the
 * bottom with justification.
 *
 * Run from the repo root:
 *   node scripts/validate-repo-governance.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const violations = [];

function fail(message) {
  violations.push(message);
}

function readFileOrNull(relPath) {
  const fullPath = path.join(root, relPath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : null;
}

function fileExists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

// ── Required governance files ─────────────────────────────────────────────────
// Every file listed here must be present. Without these, a future agent cannot
// understand the repo's rules, validate their work, or deploy safely.
const governanceFiles = [
  {
    path: 'AGENTS.md',
    reason: 'root-level agent instructions; the first file all agents are required to read',
  },
  {
    path: 'docs/site-standards.md',
    reason: 'operating procedure and definition of done for all public-site work',
  },
  {
    path: 'README.md',
    reason: 'repo overview, local workflow entry point, and validation instructions',
  },
  {
    path: 'CHANGELOG.md',
    reason: 'release-style change history; agents must update this on every notable change',
  },
  {
    path: 'docs/changes_summary.md',
    reason: 'narrative context log for major site, deployment, and governance changes',
  },
  {
    path: 'scripts/validate-static-site.mjs',
    reason: 'enforces required public files and internal link integrity before deploy',
  },
  {
    path: 'scripts/validate-site-shell.mjs',
    reason: 'enforces shared shell, SEO metadata, and accessibility baselines before deploy',
  },
  {
    path: 'scripts/validate-repo-governance.mjs',
    reason: 'this file; enforces that the governance layer itself stays intact over time',
  },
  {
    path: '.github/workflows/deploy.yml',
    reason: 'CI pipeline that gates all deploys on validation; must not be silently removed',
  },
];

for (const { path: relPath, reason } of governanceFiles) {
  if (!fileExists(relPath)) {
    fail(`Required governance file is missing: ${relPath} — ${reason}`);
  }
}

// ── AGENTS.md content quality ─────────────────────────────────────────────────
// AGENTS.md is the first file agents read. If its key sections are absent,
// agents will not know the repo boundaries, the sources of truth, or the
// required validators — undermining all other governance.
const agentsMd = readFileOrNull('AGENTS.md');
if (agentsMd) {
  const requiredAgentsSections = [
    // Tells agents which files to read before making changes.
    'Start Here',
    // Separates public-site surface from deploy/reploy-stack/ surface.
    'Repo Boundaries',
    // Identifies authoritative files for layout, styling, behavior, and config.
    'Sources Of Truth',
    // Hard rules that must not be bypassed regardless of task scope.
    'Non-Negotiable',
    // Names the validators agents must run before marking work done.
    'Required Validation',
    // Explicit completion criteria so agents do not close tasks prematurely.
    'Definition Of Done',
  ];
  for (const section of requiredAgentsSections) {
    if (!agentsMd.includes(section)) {
      fail(`AGENTS.md is missing required section heading: "${section}"`);
    }
  }

  // All three validators must be explicitly named in AGENTS.md so agents know
  // to run them. If a validator exists but is not listed here, it will be skipped.
  const requiredValidatorRefs = [
    'validate-static-site.mjs',
    'validate-site-shell.mjs',
    'validate-repo-governance.mjs',
  ];
  for (const validator of requiredValidatorRefs) {
    if (!agentsMd.includes(validator)) {
      fail(`AGENTS.md does not reference required validator: ${validator}`);
    }
  }
}

// ── docs/site-standards.md content quality ────────────────────────────────────
// This file is the operating procedure. It must include validation commands
// so contributors can locate the right validators without reading AGENTS.md.
// It must also include a definition of done so the standard is unambiguous.
const standardsMd = readFileOrNull('docs/site-standards.md');
if (standardsMd) {
  const requiredStandardsSections = [
    'Purpose',             // explains the scope of the operating procedure
    'Validation Commands', // runnable commands; must stay current with the script set
    'Definition Of Done',  // what completing a change means for this repo
  ];
  for (const section of requiredStandardsSections) {
    if (!standardsMd.includes(section)) {
      fail(`docs/site-standards.md is missing required section heading: "${section}"`);
    }
  }

  // All three validators must be listed in the operating procedure so their
  // existence is anchored in two governance documents, not just AGENTS.md.
  const requiredValidatorRefs = [
    'validate-static-site.mjs',
    'validate-site-shell.mjs',
    'validate-repo-governance.mjs',
  ];
  for (const validator of requiredValidatorRefs) {
    if (!standardsMd.includes(validator)) {
      fail(`docs/site-standards.md does not reference required validator: ${validator}`);
    }
  }
}

// ── README.md content quality ─────────────────────────────────────────────────
// README is the first thing a new contributor reads. It must at minimum
// surface the validation workflow and name the governance entry point.
const readmeMd = readFileOrNull('README.md');
if (readmeMd) {
  const requiredReadmeTokens = [
    // Validators must be discoverable from the README without reading AGENTS.md first.
    'validate-static-site.mjs',
    'validate-site-shell.mjs',
    'validate-repo-governance.mjs',
    // AGENTS.md is the governance entry point; README must tell people it exists.
    'AGENTS.md',
  ];
  for (const token of requiredReadmeTokens) {
    if (!readmeMd.includes(token)) {
      fail(`README.md does not reference required item: ${token}`);
    }
  }
}

// ── deploy.yml CI wiring ──────────────────────────────────────────────────────
// All three validators must run in CI before deploy. If any is missing from the
// workflow, standards drift can reach production without automated detection.
const deployYml = readFileOrNull('.github/workflows/deploy.yml');
if (deployYml) {
  const requiredCiValidators = [
    'validate-static-site.mjs',
    'validate-site-shell.mjs',
    'validate-repo-governance.mjs',
  ];
  for (const validator of requiredCiValidators) {
    if (!deployYml.includes(validator)) {
      fail(`.github/workflows/deploy.yml does not run required validator: ${validator}`);
    }
  }
}

// ── CHANGELOG.md is populated ─────────────────────────────────────────────────
// An empty or header-only changelog means changes have been made without being
// recorded. All notable changes must be logged per the repo standard.
const changelogMd = readFileOrNull('CHANGELOG.md');
if (changelogMd && !changelogMd.includes('## [')) {
  fail('CHANGELOG.md contains no version entries (expected at least one "## [" heading).');
}

// ── Excluded rules ────────────────────────────────────────────────────────────
//
// package.json at repo root: the public site has no build step and no Node
//   package. There is nothing to validate about package integrity here.
//
// Test coverage: the public site has no test suite. Enforcement is via the
//   three HTML validators, not unit or integration tests.
//
// Linting rules: no linter is configured for the static HTML/CSS/JS surface.
//   Enforcing a linting command that does not exist would cause immediate failure.
//
// License headers: not applicable to a static marketing site. No code is
//   distributed under a license that requires header attribution.
//
// deploy/reploy-stack/ governance: this surface is a separate Node.js
//   application with its own README, package.json, Dockerfile, and CI workflow
//   (railway-deploy.yml). Its governance is outside this validator's scope.
//
// railway-deploy.yml validation: scoped to the operational app. Adding checks
//   for it here would conflate two separate surfaces.
//
// Blog post metadata: per-post SEO and accessibility markers are already
//   enforced by validate-site-shell.mjs. Duplicating those checks here would
//   produce redundant failures.

// ── Report ────────────────────────────────────────────────────────────────────
if (violations.length > 0) {
  console.error('Repository governance validation failed:');
  for (const v of violations) {
    console.error(`- ${v}`);
  }
  process.exit(1);
}

console.log('Repository governance validation passed.');
