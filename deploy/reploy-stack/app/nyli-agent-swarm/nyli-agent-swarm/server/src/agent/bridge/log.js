// Shared logger for all bridge modules
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = process.env.SWARM_LOG_DIR
  ? path.resolve(process.env.SWARM_LOG_DIR, 'agent_activity.log')
  : path.resolve(__dirname, '../../../../logs/agent_activity.log');

function log(level, event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }) + '\n';
  fs.appendFileSync(LOG_FILE, line);
  console.log(`[bridge:${event}]`, data);
}

export default {
  info:  (event, data) => log('INFO',  event, data),
  warn:  (event, data) => log('WARN',  event, data),
  error: (event, data) => log('ERROR', event, data),
};
