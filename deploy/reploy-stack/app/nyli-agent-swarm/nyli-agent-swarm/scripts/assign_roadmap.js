#!/usr/bin/env node
import ProjectManager from '../server/src/agent/bridge/projectManager.js';
const pm = new ProjectManager();
const ASSIGNMENTS = [
  'UIDesignerAgent',
  'TestAgent',
  'IntegrationsAgent',
  'DocumentationAgent',
  'ErrorBoundaryAgent',
  'CIAgent',
];
for (let i = 0; i < ASSIGNMENTS.length; i++) {
  try {
    pm.assignTask('RoadmapProject', i + 1, ASSIGNMENTS[i]);
    console.log('Assigned task', i+1, 'to', ASSIGNMENTS[i]);
  } catch (e) {
    console.error('assign failed', e.message);
  }
}
