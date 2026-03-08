import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skippedDirs = new Set(['.git', '.github', '.vscode', 'deploy', 'docs', 'node_modules', 'workflows']);
const redirectShims = new Set([
  'product-assetpilot.html',
  'product-flowpilot.html',
  'product-insightpilot.html',
]);
const sharedShellTokens = [
  'class="site-header"',
  'class="site-nav"',
  'class="nav-main"',
  'class="nav-utility"',
  'class="site-footer"',
  'class="footer-columns"',
  '/assets/styles.css?v=',
  '/assets/site.js?v=',
];
const pageSpecificAssets = new Map([
  ['contact.html', ['/assets/site-config.js?v=', '/assets/contact.js?v=']],
  ['insights.html', ['/assets/data/resources-data.js?v=', '/assets/resources.js?v=']],
  ['products.html', ['/assets/products.js?v=']],
  ['services.html', ['/assets/services.js?v=']],
  ['support.html', ['/assets/support.js?v=']],
]);

const htmlFiles = [];
const violations = [];
const assetVersions = new Map();

function extractTagMatch(content, pattern) {
  const match = content.match(pattern);
  return match ? match[1].trim() : '';
}

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function expectedPublicUrl(file) {
  if (file === 'index.html') {
    return 'https://joyfulinnovation.com/';
  }

  if (file.startsWith('blog/')) {
    return `https://joyfulinnovation.com/${file.replace(/\.html$/, '')}`;
  }

  return `https://joyfulinnovation.com/${file.replace(/\.html$/, '')}`;
}

function validateSeoAndAccessibility(file, content) {
  const title = extractTagMatch(content, /<title>([^<]+)<\/title>/i);
  const metaDescription = extractTagMatch(content, /<meta\s+name="description"\s+content="([^"]+)"/i);
  const canonicalUrl = extractTagMatch(content, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
  const ogTitle = extractTagMatch(content, /<meta\s+property="og:title"\s+content="([^"]+)"/i);
  const ogDescription = extractTagMatch(content, /<meta\s+property="og:description"\s+content="([^"]+)"/i);
  const ogUrl = extractTagMatch(content, /<meta\s+property="og:url"\s+content="([^"]+)"/i);
  const ogImage = extractTagMatch(content, /<meta\s+property="og:image"\s+content="([^"]+)"/i);
  const twitterCard = extractTagMatch(content, /<meta\s+name="twitter:card"\s+content="([^"]+)"/i);
  const twitterTitle = extractTagMatch(content, /<meta\s+name="twitter:title"\s+content="([^"]+)"/i);
  const twitterDescription = extractTagMatch(content, /<meta\s+name="twitter:description"\s+content="([^"]+)"/i);
  const twitterImage = extractTagMatch(content, /<meta\s+name="twitter:image"\s+content="([^"]+)"/i);
  const skipLinkTarget = extractTagMatch(content, /<a\s+class="skip-link"\s+href="([^"]+)"/i);
  const mainId = extractTagMatch(content, /<main\s+id="([^"]+)"/i);
  const h1Count = countMatches(content, /<h1\b/gi);
  const expectedUrl = expectedPublicUrl(file);

  if (!/<html[^>]*\slang="en"/i.test(content)) {
    recordViolation(file, 'is missing `lang="en"` on the html element.');
  }

  if (!title) {
    recordViolation(file, 'is missing a non-empty <title>.');
  }

  if (!metaDescription) {
    recordViolation(file, 'is missing a non-empty meta description.');
  }

  if (canonicalUrl !== expectedUrl) {
    recordViolation(file, `has canonical URL \`${canonicalUrl || '(missing)'}\` but expected \`${expectedUrl}\`.`);
  }

  if (!ogTitle) {
    recordViolation(file, 'is missing `og:title`.');
  }

  if (!ogDescription) {
    recordViolation(file, 'is missing `og:description`.');
  }

  if (ogUrl !== expectedUrl) {
    recordViolation(file, `has og:url \`${ogUrl || '(missing)'}\` but expected \`${expectedUrl}\`.`);
  }

  if (!ogImage || !ogImage.startsWith('https://joyfulinnovation.com/')) {
    recordViolation(file, 'is missing an absolute `og:image` on the Joyful Innovation domain.');
  }

  if (!twitterCard) {
    recordViolation(file, 'is missing `twitter:card`.');
  }

  if (!twitterTitle) {
    recordViolation(file, 'is missing `twitter:title`.');
  }

  if (!twitterDescription) {
    recordViolation(file, 'is missing `twitter:description`.');
  }

  if (!twitterImage || !twitterImage.startsWith('https://joyfulinnovation.com/')) {
    recordViolation(file, 'is missing an absolute `twitter:image` on the Joyful Innovation domain.');
  }

  if (skipLinkTarget !== '#main-content') {
    recordViolation(file, 'is missing the standard skip link target `#main-content`.');
  }

  if (mainId !== 'main-content') {
    recordViolation(file, 'is missing `<main id="main-content">`.');
  }

  if (h1Count !== 1) {
    recordViolation(file, `must contain exactly one <h1>, found ${h1Count}.`);
  }

  const imagePattern = /<img\b[^>]*>/gi;
  for (const match of content.matchAll(imagePattern)) {
    if (!/\salt="[^"]*"/i.test(match[0])) {
      recordViolation(file, 'contains an <img> without an alt attribute.');
      break;
    }
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.htaccess') {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

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

function recordViolation(file, message) {
  violations.push(`${file}: ${message}`);
}

function trackAssetVersions(file, content) {
  const assetPattern = /\/assets\/([^"'?# >]+)\?v=([^"' )<>]+)/g;
  let match;

  while ((match = assetPattern.exec(content))) {
    const asset = match[1];
    const version = match[2];
    const existing = assetVersions.get(asset) ?? new Map();
    const files = existing.get(version) ?? [];
    files.push(file);
    existing.set(version, files);
    assetVersions.set(asset, existing);
  }
}

walk(root);

for (const file of htmlFiles) {
  const fullPath = path.join(root, file);
  const content = fs.readFileSync(fullPath, 'utf8');

  if (/<script\?v=/i.test(content)) {
    recordViolation(file, 'contains malformed script tag syntax (`<script?v=...>`).');
  }

  if (/class="footer-links"/i.test(content)) {
    recordViolation(file, 'uses legacy `footer-links` markup instead of `footer-columns`.');
  }

  if (!redirectShims.has(file) && /\sstyle\s*=/i.test(content)) {
    recordViolation(file, 'contains inline style attributes on a public page.');
  }

  if (!redirectShims.has(file)) {
    for (const token of sharedShellTokens) {
      if (!content.includes(token)) {
        recordViolation(file, `is missing required shared shell token: ${token}`);
      }
    }

    validateSeoAndAccessibility(file, content);
  }

  const requiredAssets = pageSpecificAssets.get(file) ?? [];
  for (const asset of requiredAssets) {
    if (!content.includes(asset)) {
      recordViolation(file, `is missing required page asset: ${asset}`);
    }
  }

  trackAssetVersions(file, content);
}

for (const [asset, versions] of assetVersions.entries()) {
  if (versions.size <= 1) {
    continue;
  }

  const details = [...versions.entries()]
    .map(([version, files]) => `${version} -> ${files.join(', ')}`)
    .join(' | ');
  violations.push(`asset version drift for /assets/${asset}: ${details}`);
}

if (violations.length > 0) {
  console.error('Public site shell validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Validated shared shell consistency across ${htmlFiles.length} HTML files.`);