#!/usr/bin/env node
import ProjectManager from '../server/src/agent/bridge/projectManager.js';

const pm = new ProjectManager();
const roadmap = pm.getProjectStatus('RoadmapProject');
if (!roadmap) {
  console.error('RoadmapProject missing');
  process.exit(1);
}

const extras = [
  'Rebuild better-sqlite3 on Node upgrade and document the step',
  'Add unit/integration tests for supervisor, orchestrator, mesh API',
  'Add dashboard auto-refresh & websocket notifications',
  'Implement agent health-check HTTP endpoint and populate /swarm/stats',
  'Create KnowledgeBaseAgent with basic Q&A capabilities',
  'Add CI task to start mesh and run a sample project for regression',
  'Add documentation for environment variables and deployment steps',
];

let added = 0;
for (const desc of extras) {
  const exists = roadmap.tasks.some((t) => t.description === desc);
  if (!exists) {
    // add at end
    const id = roadmap.tasks.length + 1;
    pm.projects['RoadmapProject'].tasks.push({
      id,
      description: desc,
      assignedAgent: null,
      status: 'pending',
      timestamps: {},
      result: null,
    });
    pm.save();
    added++;
    console.log('added roadmap task:', desc);
  }
}
if (added === 0) console.log('no new tasks needed');
