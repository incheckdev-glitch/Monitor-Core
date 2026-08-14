const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function env(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function mask(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function result(status, name, details = '') {
  return { status, name, details: details || '' };
}

function printResults(title, results) {
  const width = Math.max(46, ...results.map(item => item.name.length + 2));
  process.stdout.write(`\n${'='.repeat(width + 14)}\n`);
  process.stdout.write(` ${title}\n`);
  process.stdout.write(`${'='.repeat(width + 14)}\n`);
  for (const item of results) {
    const label = item.name.padEnd(width, ' ');
    process.stdout.write(`${label} ${item.status.padEnd(5, ' ')}${item.details ? `  ${item.details}` : ''}\n`);
  }
  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  process.stdout.write(`${'-'.repeat(width + 14)}\n`);
  process.stdout.write(`PASS ${counts.PASS || 0} / SKIP ${counts.SKIP || 0} / WARN ${counts.WARN || 0} / FAIL ${counts.FAIL || 0}\n`);
  return counts;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  root,
  nowIso,
  ensureDir,
  writeJson,
  env,
  mask,
  result,
  printResults,
  fetchWithTimeout,
};
