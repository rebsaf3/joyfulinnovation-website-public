#!/usr/bin/env node
// utility to add a new project with roadmap tasks via projectManager
import ProjectManager from '../server/src/agent/bridge/projectManager.js';

const pm = new ProjectManager();

const ROADMAP = [
  'Improve dashboard refresh logic and clear stale blocked counts',
  'Add automated tests for supervisor and orchestrator modules',
  'Implement agent health-check API and surface in swarm dashboard',
  'Build KnowledgeBaseAgent and assign initial knowledge tasks',
  'Add user-facing error summaries for blocked tasks',
  'Create CI pipeline to start mesh and run sample projects',
];

pm.createProject('RoadmapProject', 'High-priority enhancements for v1', ROADMAP);
console.log('Roadmap project created with tasks:', ROADMAP.length);

// assign each roadmap item to a sensible starting agent
const ASSIGNMENTS = [
  'UIDesignerAgent',        // dashboard logic
  'TestAgent',              // automated tests
  'IntegrationsAgent',      // health-check API
  'DocumentationAgent',     // knowledge base
  'ErrorBoundaryAgent',     // error summaries
  'CIAgent',                // CI pipeline
];
for (let i = 0; i < ASSIGNMENTS.length; i++) {
  try {
    pm.assignTask('RoadmapProject', i + 1, ASSIGNMENTS[i]);
  } catch (e) {
    console.warn('assign failed', e.message);
  }
}
console.log('Assigned roadmap tasks to agents:', ASSIGNMENTS.join(', '));
