const { spawnSync } = require('child_process');
const path = require('path');
const { root, result, printResults, writeJson, nowIso } = require('./test-utils');

const steps = [
  ['JavaScript syntax', ['scripts/check-js-syntax.js']],
  ['Deployment contract', ['scripts/deployment-contract-test.js']],
];
const results = [];
for (const [name, args] of steps) {
  const run = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  results.push(result(run.status === 0 ? 'PASS' : 'FAIL', name, run.status === 0 ? '' : `exit ${run.status}`));
}
writeJson(path.join(root, 'test-results', 'smoke.json'), { generated_at: nowIso(), kind: 'smoke', results });
const counts = printResults('InCheck360 Smoke Test', results);
if (counts.FAIL) process.exit(1);
