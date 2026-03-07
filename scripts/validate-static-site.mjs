import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'index.html',
  'products.html',
  'services.html',
  'insights.html',
  'support.html',
  'contact.html',
  'privacy-policy.html',
  'terms.html',
  'assets/styles.css',
  'assets/site.js',
  'assets/contact.js',
  'assets/support.js',
  'assets/site-config.js',
];
const skippedDirs = new Set(['.git', '.github', '.vscode', 'deploy', 'docs', 'node_modules', 'workflows']);
const htmlFiles = [];
const missingFiles = [];
const brokenRefs = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      if (!['.htaccess'].includes(entry.name)) {
        continue;
      }
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      if (skippedDirs.has(entry.name)) {
        continue;
      }
      walk(fullPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      htmlFiles.push(relPath);
    }
  }
}

function candidatePaths(baseDir, ref) {
  const normalizedRef = ref.split('#')[0].split('?')[0];
  if (!normalizedRef) {
    return [];
  }

  const basePath = normalizedRef.startsWith('/')
    ? path.join(root, normalizedRef.slice(1))
    : path.resolve(baseDir, normalizedRef);
  const candidates = [basePath];

  if (!path.extname(basePath)) {
    candidates.push(`${basePath}.html`);
    candidates.push(path.join(basePath, 'index.html'));
  }

  return [...new Set(candidates)];
}

function shouldValidateRef(ref) {
  return !(
    !ref ||
    ref.startsWith('#') ||
    ref.startsWith('mailto:') ||
    ref.startsWith('tel:') ||
    ref.startsWith('javascript:') ||
    ref.startsWith('data:') ||
    /^[a-z]+:\/\//i.test(ref)
  );
}

for (const relPath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relPath))) {
    missingFiles.push(relPath);
  }
}

walk(root);

for (const relPath of htmlFiles) {
  const fullPath = path.join(root, relPath);
  const dir = path.dirname(fullPath);
  const content = fs.readFileSync(fullPath, 'utf8');
  const refPattern = /(?:href|src)="([^"]+)"/g;
  let match;

  while ((match = refPattern.exec(content))) {
    const ref = match[1];
    if (!shouldValidateRef(ref)) {
      continue;
    }

    const candidates = candidatePaths(dir, ref);
    if (candidates.length === 0) {
      continue;
    }

    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      brokenRefs.push({
        file: relPath,
        ref,
      });
    }
  }
}

if (missingFiles.length > 0 || brokenRefs.length > 0) {
  if (missingFiles.length > 0) {
    console.error('Missing required site files:');
    for (const relPath of missingFiles) {
      console.error(`- ${relPath}`);
    }
  }

  if (brokenRefs.length > 0) {
    console.error('Broken internal references:');
    for (const entry of brokenRefs) {
      console.error(`- ${entry.file}: ${entry.ref}`);
    }
  }

  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} HTML files and ${requiredFiles.length} required site files.`);
