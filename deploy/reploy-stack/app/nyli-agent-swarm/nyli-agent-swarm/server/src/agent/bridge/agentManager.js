// Agent manager for lifecycle and orchestration
import ipc from './ipc.js';
import log from './log.js';

class AgentManager {
  constructor(agentNames) {
    this.agentNames = agentNames;
    this.status = {};
    agentNames.forEach(name => {
      this.status[name] = 'idle';
    });
    log.info('agent_manager_init', { agents: agentNames });
  }

  assignTask(agent, task) {
    this.status[agent] = 'busy';
    log.info('agent_task_assigned', { agent, task: String(task).slice(0, 120) });
    ipc.emit('task', { agent, task });
  }

  completeTask(agent) {
    this.status[agent] = 'idle';
    log.info('agent_task_complete', { agent });
    ipc.emit('complete', { agent });
  }

  sendMessage(from, to, content) {
    log.info('agent_message_sent', { from, to, contentPreview: String(content).slice(0, 120) });
    ipc.emit('message', { from, to, content });
  }

  onMessage(agent, handler) {
    ipc.on(`message:${agent}`, handler);
  }

  getStatus() {
    return this.status;
  }
}

export default AgentManager;
