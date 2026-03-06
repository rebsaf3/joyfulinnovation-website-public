const fs = require('fs');
const path = require('path');
const PROJECT_FILES = [
  path.resolve(__dirname, '../server/logs/projects.json'),
  path.resolve(__dirname, '../logs/projects.json'),
];
let merged = {};
for (const file of PROJECT_FILES) {
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) {
      raw.forEach((p) => (merged[p.name] = p));
    } else {
      Object.assign(merged, raw);
    }
  }
}
for (const [name, proj] of Object.entries(merged)) {
  let b = 0, i = 0, a = 0, c = 0, f = 0;
  for (const t of proj.tasks) {
    const s = String(t.status).toLowerCase();
    if (s === 'blocked' || s === 'failed' || s === 'error') b++;
    if (s === 'in-progress') i++;
    if (s === 'assigned' || s === 'pending') a++;
    if (s === 'complete' || s === 'completed') c++;
    if (s === 'failed') f++;
  }
  console.log(name, { blocked: b, inprogress: i, assigned: a, completed: c, failed: f });
}
