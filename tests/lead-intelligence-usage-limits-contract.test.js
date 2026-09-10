import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const migration = fs.readFileSync(new URL('../database/migrations/20260910_lead_intelligence_usage_limits.sql', import.meta.url), 'utf8');
const fix = fs.readFileSync(new URL('../database/migrations/20260910_lead_intelligence_usage_limits_fix_defaults.sql', import.meta.url), 'utf8');
const adminUi = fs.readFileSync(new URL('../src/services/leadIntelligenceAdmin.js', import.meta.url), 'utf8');
const patch = fs.readFileSync(new URL('../src/services/darkModeSafetyPatch.js', import.meta.url), 'utf8');

test('Lead Intelligence limits are enforced server-side with safe defaults', () => {
  assert.match(migration, /before insert on public\.lead_intelligence_runs/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /v_daily := 10/i);
  assert.match(migration, /v_weekly := 50/i);
  assert.match(migration, /v_monthly := 150/i);
  assert.match(migration, /Daily Lead Intelligence limit reached/i);
  assert.match(fix, /not coalesce\(v_has_row, false\)/i);
});

test('Admin and GM can view usage and manage per-user limits', () => {
  assert.match(migration, /lead_intelligence_admin_dashboard/i);
  assert.match(migration, /lead_intelligence_set_user_limits/i);
  assert.match(migration, /in \('admin', 'gm'\)/i);
  assert.match(adminUi, /AI Usage & Limits/);
  assert.match(adminUi, /Blank limit = unlimited/);
  assert.match(adminUi, /lead_intelligence_set_user_limits/);
  assert.match(adminUi, /lead_intelligence_admin_dashboard/);
});

test('Admin UI is loaded once through the main service patch', () => {
  assert.match(patch, /leadIntelligenceAdmin\.js\?v=20260910-li-admin1/);
  assert.doesNotMatch(adminUi, /MutationObserver/);
});
