// OrchestratorAgent — decomposes tasks and dispatches to specialist agents
import { runOrchestratorAgent } from '../agentBase.js';

const agentName = process.env.AGENT_NAME || 'OrchestratorAgent';

runOrchestratorAgent(agentName);
