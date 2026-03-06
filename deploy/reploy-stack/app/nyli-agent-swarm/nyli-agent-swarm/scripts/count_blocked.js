const fs = require('fs');
const path = require('path');

const LOG_FILE = path.resolve(__dirname, '../logs/agent_activity.log');
const PROJECT_FILES = [
  path.resolve(__dirname, '../logs/projects.json'),
  path.resolve(__dirname, '../../logs/projects.json'),
];

function hasTimestamp(timestamps, keys) {
  for (const key of keys) {
    if (Number.isFinite(timestamps[key])) return true;
  }
  return false;
}
function normalizeWorkflowStatus(rawStatus, owner, timestamps) {
  const s = String(rawStatus).trim().toLowerCase();
  if (s === 'in-progress' || s === 'in_progress' || s === 'working') return 'in-progress';
  if (s === 'complete' || s === 'completed' || s === 'done') return 'completed';
  if (s === 'blocked' || s === 'failed' || s === 'error') return 'blocked';
  if (hasTimestamp(timestamps, ['complete','completed','work_completed','done'])) return 'completed';
  if (hasTimestamp(timestamps, ['failed','error','blocked'])) return 'blocked';
  if (hasTimestamp(timestamps, ['work_started','in-progress','in_progress','start'])) return 'in-progress';
  if (s === 'pending' || s === 'queued' || s === 'todo' || s === 'assigned' || s === '') return 'assigned';
  return owner ? 'assigned' : 'assigned';
}
function readProjects() {
  const byName = {};
  for (const file of PROJECT_FILES) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file,'utf8'));
      const entries = Array.isArray(raw)? raw.map(p=>[p.name,p]):Object.entries(raw);
      for(const [name,proj] of entries){
        byName[name]=proj;
      }
    } catch {}
  }
  return Object.values(byName);
}
function readLogs(limit=50000){
  if(!fs.existsSync(LOG_FILE)) return [];
  const lines=fs.readFileSync(LOG_FILE,'utf8').split('\n').filter(Boolean).slice(-limit);
  const logs=[];
  for(const line of lines){ try{logs.push(JSON.parse(line));}catch{} }
  return logs;
}

function computeBackground(){
  const projects = readProjects();
  const logs = readLogs();
  const runtimeByAgent = {};
  const now = Date.now();
  const AGENT_ACTIVE_WINDOW_MS = 15*60*1000;
  const AGENT_ERROR_WINDOW_MS = 20*60*1000;
  const TASK_PROGRESS_STALE_MS = 60*60*1000;

  for(const log of logs){
    const agent = log.agent||log.agentName;
    if(!agent) continue;
    if(!runtimeByAgent[agent]){runtimeByAgent[agent]={online:false,openWorkCount:0,lastActivityMs:null,lastExecutionMs:null,lastErrorMs:null,lastSuccessMs:null,recentExecutionCount:0};}
    const state=runtimeByAgent[agent];
    const ts=Date.parse(log.ts||'');
    if(isFinite(ts)){
      const inWindow = now-ts<=AGENT_ACTIVE_WINDOW_MS;
      if(['task_received','work_started','task_dispatched','work_completed','task_complete','task_failed','task_parse_error'].includes(log.event)) state.lastActivityMs=ts;
      if(['work_started','work_completed','task_complete','task_failed','task_parse_error'].includes(log.event)){
        state.lastExecutionMs=ts; if(inWindow) state.recentExecutionCount++;
      }
      if(log.level==='ERROR' || log.event==='task_failed' || log.event==='task_parse_error' || log.event==='agent_spawn_failed') state.lastErrorMs=ts;
      if(log.event==='agent_ready' || log.event==='work_completed' || log.event==='task_complete') state.lastSuccessMs=ts;
    }
    if(log.event==='agent_starting' || log.event==='agent_ready') state.online=true;
    if(log.event==='agent_shutdown' || log.event==='agent_exited'){state.online=false; state.openWorkCount=0;}
    if(log.event==='work_started') state.openWorkCount++;
    if(log.event==='work_completed' || log.event==='task_complete' || log.event==='task_failed' || log.event==='task_parse_error') state.openWorkCount=Math.max(0,state.openWorkCount-1);
  }

  function isErr(state){ if(!state.online) return false; if(!state.lastErrorMs) return false; if(now-state.lastErrorMs>AGENT_ERROR_WINDOW_MS) return false; if(state.lastSuccessMs && state.lastSuccessMs>=state.lastErrorMs) return false; return true; }
  function isExecuting(state){ return state.openWorkCount>0 || state.recentExecutionCount>0 || (state.lastExecutionMs && now-state.lastExecutionMs<=AGENT_ACTIVE_WINDOW_MS); }
  const taskRows=[];
  for(const proj of projects){
    for(const t of proj.tasks||[]){
      const owner=t.assignedAgent||'Unassigned';
      const status=normalizeWorkflowStatus(t.status,owner,t.timestamps||{});
      const startMs=pick(t.timestamps,['work_started','in-progress','in_progress','start','assigned']);
      const completionMs=pick(t.timestamps,['complete','completed','work_completed','done']);
      taskRows.push({project:proj.name,owner,status,updatedTime:pick(t.timestamps,Object.keys(t.timestamps||{}))});
    }
  }
  function pick(ts,keys){for(const k of keys){if(ts && isFinite(ts[k]))return ts[k];}return undefined;}
  let reclassified=0;
  const recon = taskRows.map(task=>{
    if(task.status!=='in-progress') return task;
    const ownerState=runtimeByAgent[task.owner];
    const ownerErrored=ownerState && isErr(ownerState);
    const ownerActivelyWorking = ownerState && ownerState.online && isExecuting(ownerState) && (!ownerErrored);
    const updatedMs = task.updatedTime||0;
    const stale = !isFinite(updatedMs) || (now-updatedMs)>TASK_PROGRESS_STALE_MS;
    if((ownerErrored||!ownerActivelyWorking) && stale){reclassified++; return {...task,status:'blocked'};} return task;
  });
  const blocked = recon.filter(t=>t.status==='blocked').length;
  console.log('reclassified',reclassified,'blocked',blocked,'total',recon.length);
}
computeBackground();
