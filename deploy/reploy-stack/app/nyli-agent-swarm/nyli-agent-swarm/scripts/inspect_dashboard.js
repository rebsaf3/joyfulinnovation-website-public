import fs from 'fs';
import path from 'path';
(async () => {
  const pd = await import('../server/src/routes/projectDashboard.js');
  const filters = { agent: undefined, milestone: undefined, status: undefined, fromMs: undefined, toMs: undefined, limitTasks:500, limitActivity:100, limitErrors:100, period: undefined };
  const data = pd.buildDashboardData(filters);
  console.log('summary.taskCounts', data.summary.taskCounts);
  console.log('reclassifiedInProgressAsBlocked', data.summary.reclassifiedInProgressAsBlocked);
  console.log('data.tasks.length', data.tasks.length);
  const blocked = data.tasks.filter(t=>t.status==='blocked');
  console.log('blocked sample', blocked.slice(0,10));
})();