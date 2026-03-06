#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, '../server/logs');
const PROJECTS_FILE = path.join(LOG_DIR, 'projects.json');
console.log('PROJECTS_FILE', PROJECTS_FILE);
let projects = {};
if (fs.existsSync(PROJECTS_FILE)) {
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
    projects = JSON.parse(raw);
  } catch (err) { console.error('read error', err.message); }
}
console.log('loaded projects keys', Object.keys(projects));
console.log('RoadmapProject entry', projects.RoadmapProject);
