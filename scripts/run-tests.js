const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const testsDir = path.join(root, 'tests');
const tests = fs.readdirSync(testsDir)
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => `tests/${name}`);

const failures = [];
const startedAt = Date.now();
for (const test of tests) {
  process.stdout.write(`\n=== ${test} ===\n`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [test], { cwd: root, env: { ...process.env, NODE_ENV: 'test' }, stdio: 'inherit' });
  if (result.error || result.status !== 0) failures.push({ test, status: result.status, error: result.error?.message || null, durationMs: Date.now()-started });
}
process.stdout.write(`\nExecuted ${tests.length} regression tests in ${((Date.now()-startedAt)/1000).toFixed(2)}s.\n`);
if (failures.length) {
  process.stderr.write(`\n${failures.length} test(s) failed:\n`);
  failures.forEach(f => process.stderr.write(`- ${f.test} (${f.error || `exit ${f.status}`})\n`));
  process.exit(1);
}
process.stdout.write('All ERP regression tests passed.\n');
