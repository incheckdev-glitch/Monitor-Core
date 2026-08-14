const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = [
  { dir: path.join(root, 'database', 'bootstrap'), migrationNames: false },
  { dir: path.join(root, 'database', 'seeds'), migrationNames: false },
  { dir: path.join(root, 'database', 'migrations'), migrationNames: true }
];

function collectSqlFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSqlFiles(absolutePath);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.sql') ? [absolutePath] : [];
  }).sort();
}

const files = scanRoots.flatMap(rootInfo => collectSqlFiles(rootInfo.dir).map(file => ({ file, migrationNames: rootInfo.migrationNames })));
const errors = [];
const warnings = [];

for (const entry of files) {
  const absolutePath = entry.file;
  const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
  const fileName = path.basename(absolutePath);
  const sql = fs.readFileSync(absolutePath, 'utf8');
  if (!sql.trim()) errors.push(`${relativePath}: SQL file is empty.`);
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(sql)) errors.push(`${relativePath}: unresolved merge-conflict marker found.`);
  if (sql.includes('\u0000')) errors.push(`${relativePath}: NUL byte found.`);
  if (entry.migrationNames && !/^\d{8}_[a-z0-9][a-z0-9_-]*\.sql$/i.test(fileName)) {
    warnings.push(`${relativePath}: use YYYYMMDD_description.sql naming for future migrations.`);
  }
  if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i.test(sql)) errors.push(`${relativePath}: possible database credentials embedded in SQL.`);
  if (/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/i.test(sql)) errors.push(`${relativePath}: possible service-role key embedded in SQL.`);
}

warnings.forEach(w => console.warn(`WARNING: ${w}`));
if (errors.length) {
  errors.forEach(e => console.error(`ERROR: ${e}`));
  process.exit(1);
}
console.log(`SQL package safety validation passed for ${files.length} SQL file(s) with ${warnings.length} warning(s).`);
