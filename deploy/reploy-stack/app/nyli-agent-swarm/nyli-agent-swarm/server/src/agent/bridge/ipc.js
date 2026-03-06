// IPC module for agent communication
import { EventEmitter } from 'events';
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
}

const ipc = new EventEmitter();

// Log and relay all task assignments
ipc.on('task', ({ agent, task }) => {
  log('INFO', 'ipc_task_assigned', { agent, task: String(task).slice(0, 120) });
});

// Log all task completions
ipc.on('complete', ({ agent }) => {
  log('INFO', 'ipc_task_complete', { agent });
});

// Enable agent-to-agent messaging with logging
ipc.on('message', ({ from, to, content }) => {
  log('INFO', 'ipc_message_sent', { from, to, contentPreview: String(content).slice(0, 120) });
  setTimeout(() => {
    ipc.emit(`message:${to}`, { from, content });
  }, 10);
});

export default ipc;
