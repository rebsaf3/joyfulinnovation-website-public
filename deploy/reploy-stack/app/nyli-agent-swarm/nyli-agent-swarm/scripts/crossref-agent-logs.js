// Script to cross-reference agent logs and codebase changes
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { execSync } = require('child_process');

const LOG_FILE = path.resolve(__dirname, '../logs/agent_activity.log');
const GIT_LOG_CMD = 'git log --pretty=format:"%H|%an|%s|%ad" --date=iso';

function getAgentLogs() {
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
  return lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function getGitCommits() {
  return execSync(GIT_LOG_CMD, { encoding: 'utf-8' })
    .split('\n')
    .map(line => {
      const [hash, author, subject, date] = line.split('|');
      return { hash, author, subject, date };
    });
}

function crossReference() {
  const logs = getAgentLogs();
  const commits = getGitCommits();
  // Find commits with agent attribution and match to agent logs
  const results = commits.map(commit => {
    const agentMatch = commit.subject.match(/agent:\s*([A-Za-z]+Agent)/);
    const agent = agentMatch ? agentMatch[1] : null;
    const log = logs.find(l => l.agent === agent && l.ts && commit.date && Math.abs(new Date(l.ts) - new Date(commit.date)) < 1000 * 60 * 10);
    return { ...commit, agent, logEvent: log ? log.event : null, logTs: log ? log.ts : null };
  });
  return results;
}

if (require.main === module) {
  const results = crossReference();
  console.table(results);
}
