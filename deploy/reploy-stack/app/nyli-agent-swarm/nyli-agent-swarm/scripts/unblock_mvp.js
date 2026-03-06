#!/usr/bin/env node
import ProjectManager from '../server/src/agent/bridge/projectManager.js';

const pm = new ProjectManager();
const projName = 'MVP Launch';
try {
  const status = pm.getProjectStatus(projName);
  if (!status) throw new Error('not found');
  console.log('before', status.tasks.map(t=>({id:t.id,status:t.status})));
  for (const t of status.tasks) {
    if (t.status === 'blocked' || t.status === 'failed' || t.status === 'pending') {
      pm.updateTaskStatus(projName, t.id, 'pending');
    }
  }
  const after = pm.getProjectStatus(projName);
  console.log('after', after.tasks.map(t=>({id:t.id,status:t.status})));
} catch (err) {
  console.error('error', err.message);
}
