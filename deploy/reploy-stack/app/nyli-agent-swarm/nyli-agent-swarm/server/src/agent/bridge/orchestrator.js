// Orchestrator for multi-agent workflows
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import log from './log.js';
import ProjectManager from './projectManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectManager = new ProjectManager();

export default class Orchestrator {
  constructor(agents) {
    this.agents = agents;
    this.projectManager = projectManager;
    log.info('orchestrator_init', { agentCount: agents.length });
  }

  async runTask(task, projectName, taskId, overrideAgent) {
    let assignedAgent = overrideAgent || 'CodexAgent';
    log.info('orchestrator_agent_assignment_debug', {
      overrideAgent,
      assignedAgent,
      agents: this.agents,
      projectName,
      taskId
    });
    log.info('orchestrator_task_start', { task: String(task).slice(0, 120), agentCount: this.agents.length });
    if (projectName && taskId) {
      const project = this.projectManager.projects[projectName];
      if (project) {
        const taskObj = project.tasks.find(t => t.id === Number(taskId));
        if (taskObj) {
          assignedAgent = overrideAgent || taskObj.assignedAgent || assignedAgent;
          taskObj.assignedAgent = assignedAgent;
        }
      }
      this.projectManager.assignTask(projectName, taskId, assignedAgent);
      this.projectManager.updateTaskStatus(projectName, taskId, 'in-progress');
    }
    const agentScriptMap = {
      'CodexAgent': '../agentBase.js',
      'ClaudeAgent': '../agentBase.js',
      'UIDesignerAgent': '../agentBase.js',
      'IntegrationsAgent': '../agentBase.js',
      'SecurityAgent': '../agentBase.js',
      'LoggingAgent': '../agentBase.js',
      'AuditDocumentationAgent': '../agentBase.js',
      'BridgeAgent': '../agentBase.js',
      'ErrorBoundaryAgent': '../agentBase.js',
      'DocumentationAgent': '../agentBase.js',
      'TestAgent': '../agentBase.js',
      'MigrationAgent': '../agentBase.js',
      'InsightsAgent': '../agentBase.js',
      'CIAgent': '../agentBase.js',
      'TaskManagerAgent': '../agentBase.js',
      'OrchestratorAgent': '../agentBase.js',
    };
    const agentScriptRel = agentScriptMap[assignedAgent] || '../agentBase.js';
    const agentScript = path.resolve(__dirname, agentScriptRel);
    const env = {
      ...process.env,
      AGENT_TASK: JSON.stringify({ task }),
      AGENT_NAME: assignedAgent,
      PROJECT_NAME: projectName ? String(projectName) : '',
      TASK_ID: taskId !== undefined && taskId !== null ? String(taskId) : '',
    };
    let finalizedStatus = false;
    const finalizeTask = (status, result) => {
      if (finalizedStatus || !projectName || taskId === undefined || taskId === null) return;
      try {
        this.projectManager.updateTaskStatus(projectName, taskId, status, result);
        finalizedStatus = true;
      } catch (err) {
        log.error('orchestrator_task_finalize_failed', {
          projectName,
          taskId,
          status,
          error: err?.message || String(err),
        });
      }
    };
    try {
      log.info('orchestrator_spawn_attempt', { agent: assignedAgent, script: agentScript, envTask: env.AGENT_TASK, AGENT_NAME: env.AGENT_NAME });
      log.info('work_started', { agent: assignedAgent, task: String(task).slice(0, 200), project: projectName, taskId });
      const proc = spawn('node', [agentScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      log.info('orchestrator_spawned', { agent: assignedAgent, pid: proc.pid, AGENT_NAME: env.AGENT_NAME });
      proc.on('error', (err) => {
        log.error('orchestrator_agent_spawn_error', { agent: assignedAgent, error: err.message });
        finalizeTask('failed', err.message);
      });
      proc.on('close', (code) => {
        log.info('orchestrator_agent_process_closed', { agent: assignedAgent, exitCode: code });
        if (code === 0) {
          finalizeTask('complete', `process_exit:${code}`);
          log.info('work_completed', { agent: assignedAgent, task: String(task).slice(0, 200), project: projectName, taskId, exitCode: code });
        } else {
          finalizeTask('failed', `process_exit:${code}`);
          log.error('task_failed', { agent: assignedAgent, task: String(task).slice(0, 200), project: projectName, taskId, exitCode: code });
        }
      });
      proc.stdout.on('data', (data) => {
        const output = String(data);
        log.info('orchestrator_agent_stdout', { agent: assignedAgent, output: output.slice(0, 200) });
        if (output.includes('task_complete') || output.includes('work_completed')) {
          finalizeTask('complete', output);
          log.info('work_completed', { agent: assignedAgent, task: String(task).slice(0, 200), project: projectName, taskId, result: output.slice(0, 500) });
        } else if (output.includes('task_failed')) {
          finalizeTask('failed', output);
          log.error('task_failed', { agent: assignedAgent, task: String(task).slice(0, 200), project: projectName, taskId, result: output.slice(0, 500) });
        }
      });
      proc.stderr.on('data', (data) => {
        const errorOutput = String(data);
        log.warn('orchestrator_agent_stderr', { agent: assignedAgent, error: errorOutput.slice(0, 200) });
        if (errorOutput.includes('task_failed')) {
          finalizeTask('failed', errorOutput);
        }
      });
      return { status: 'assigned', agent: assignedAgent, task, pid: proc.pid };
    } catch (err) {
      log.error('orchestrator_agent_spawn_exception', { agent: assignedAgent, error: err.message });
      return { status: 'error', agent: assignedAgent, error: err.message };
    }
  }

  getProjectStatus(projectName) {
    return this.projectManager.getProjectStatus(projectName);
  }

  listProjects() {
    return this.projectManager.listProjects();
  }
}
