// Project and Task Management for Orchestrator
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECTS_FILE = process.env.SWARM_SERVER_LOGS_DIR
  ? path.resolve(process.env.SWARM_SERVER_LOGS_DIR, 'projects.json')
  : path.resolve(__dirname, '../../../logs/projects.json');

export default class ProjectManager {
  constructor() {
    this.projects = {};
    this.load();
  }

  load() {
    if (fs.existsSync(PROJECTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
      // Handle canonical {projects: [...], metadata: {...}} format used by the dashboard
      if (raw && typeof raw === 'object' && Array.isArray(raw.projects)) {
        this.projects = Object.fromEntries(raw.projects.map(p => [p.name, p]));
        this._metadata = raw.metadata || {};
      } else if (Array.isArray(raw)) {
        // Bare array fallback
        this.projects = Object.fromEntries(raw.map(p => [p.name, p]));
        this._metadata = {};
      } else {
        // Legacy object-map format
        this.projects = raw;
        this._metadata = {};
      }
    }
  }

  save() {
    // Preserve the canonical {projects: [...], metadata: {...}} format so the dashboard can read it
    const projectsArray = Object.values(this.projects);
    const completedCount = projectsArray.filter(p => p.status === 'complete' || p.status === 'completed').length;
    const activeCount = projectsArray.filter(p => p.status === 'active').length;
    const blockedCount = projectsArray.filter(p => p.status === 'blocked').length;
    const output = {
      projects: projectsArray,
      metadata: {
        ...(this._metadata || {}),
        totalProjects: projectsArray.length,
        completedCount,
        activeCount,
        blockedCount,
        lastUpdated: new Date().toISOString(),
      },
    };
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(output, null, 2));
  }

  createProject(name, description, tasks) {
    if (this.projects[name]) throw new Error('Project already exists');
    this.projects[name] = {
      name,
      description,
      tasks: tasks.map((task, i) => ({
        id: i + 1,
        description: task,
        assignedAgent: null,
        status: 'pending',
        timestamps: {},
        result: null
      })),
      status: 'active',
      history: []
    };
    this.save();
  }

  assignTask(projectName, taskId, agent) {
    const project = this.projects[projectName];
    if (!project) throw new Error('Project not found');
    const id = Number(taskId);
    let task = project.tasks.find(t => t.id === id);
    if (!task) {
      task = { id, description: 'auto-created', assignedAgent: null, status: 'pending', timestamps: {}, result: null };
      project.tasks.push(task);
    }
    task.assignedAgent = agent;
    task.status = 'in-progress';
    task.timestamps.assigned = Date.now();
    this.save();
  }

  updateTaskStatus(projectName, taskId, status, result) {
    const project = this.projects[projectName];
    if (!project) throw new Error('Project not found');
    const id = Number(taskId);
    const task = project.tasks.find(t => t.id === id);
    if (!task) throw new Error('Task not found: id=' + id + ' (available: ' + project.tasks.map(t => t.id).join(',') + ')');
    task.status = status;
    if (result) task.result = result;
    task.timestamps[status] = Date.now();
    project.history.push({ event: 'task_status_update', taskId, status, result, ts: Date.now() });
    this.save();
  }

  getProjectStatus(projectName) {
    const project = this.projects[projectName];
    if (!project) throw new Error('Project not found');
    return {
      name: project.name,
      status: project.status,
      tasks: project.tasks.map(t => ({
        id: t.id,
        description: t.description,
        assignedAgent: t.assignedAgent,
        status: t.status,
        result: t.result
      })),
      history: project.history
    };
  }

  listProjects() {
    return Object.keys(this.projects);
  }
}
