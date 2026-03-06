#!/usr/bin/env node
import ProjectManager from '../server/src/agent/bridge/projectManager.js';

const pm = new ProjectManager();
const project = pm.getProjectStatus('RoadmapProject');
if (!project) {
  console.error('RoadmapProject not found');
  process.exit(1);
}
console.log('Before reset:', project.tasks.map(t=>({id:t.id,status:t.status,agent:t.assignedAgent})));

// set all tasks back to pending so supervisor/orchestrator will dispatch them
for (const t of project.tasks) {
  pm.updateTaskStatus('RoadmapProject', t.id, 'pending');
}
const after = pm.getProjectStatus('RoadmapProject');
console.log('After reset:', after.tasks.map(t=>({id:t.id,status:t.status,agent:t.assignedAgent})));
