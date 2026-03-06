// Task router for distributing tasks to agents
import AgentManager from './agentManager.js';
import log from './log.js';

class TaskRouter {
  constructor(agentManager) {
    this.agentManager = agentManager;
  }

  route(task) {
    const agents = Object.keys(this.agentManager.status);
    const agent = agents[Math.floor(Math.random() * agents.length)];
    log.info('task_routed', { task: String(task).slice(0, 120), agent });
    this.agentManager.assignTask(agent, task);
    return agent;
  }
}

export default TaskRouter;
