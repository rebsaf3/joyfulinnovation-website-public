// Registry for agent definitions and metadata
import log from './log.js';

export default class AgentRegistry {
  constructor() {
    this.agents = [];
  }

  register(agent) {
    this.agents.push(agent);
    log.info('agent_registered', { name: agent.name, type: agent.type });
  }

  getAgents() {
    return this.agents;
  }
}
