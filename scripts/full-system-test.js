const { spawnSync } = require('child_process');
const path = require('path');
const { root, result, printResults, writeJson, nowIso } = require('./test-utils');

const steps = [
  { name: 'JavaScript syntax', cmd: process.execPath, args: ['scripts/check-js-syntax.js'] },
  { name: 'SQL migration validation', cmd: process.execPath, args: ['scripts/validate-sql-migrations.js'] },
  { name: 'ERP regression suite', cmd: process.execPath, args: ['scripts/run-tests.js'] },
  { name: 'Deployment contract', cmd: process.execPath, args: ['scripts/deployment-contract-test.js'] },
  { name: 'Production read-only checks', cmd: process.execPath, args: ['scripts/production-readonly-test.js'] },
];

const results = [];
const started = Date.now();
for (const step of steps) {
  process.stdout.write(`\n\n######## ${step.name} ########\n`);
  const run = spawnSync(step.cmd, step.args, {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  results.push(result(run.status === 0 ? 'PASS' : 'FAIL', step.name, run.status === 0 ? '' : `exit ${run.status}`));
}

const report = {
  generated_at: nowIso(),
  kind: 'full-system',
  duration_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
  results,
};
writeJson(path.join(root, 'test-results', 'full-system.json'), report);
const counts = printResults('InCheck360 Full Automated Test', results);
if (counts.FAIL) process.exit(1);
