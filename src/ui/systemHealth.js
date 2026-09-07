const state = {
  running: false,
  results: [],
  lastRunAt: 0
};

function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function normalizeRole(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function currentRole() {
  const profile = window.Session?.authContext?.()?.profile || window.Session?.user?.() || {};
  return normalizeRole(profile.role_key || profile.role || window.Session?.role?.() || '');
}

function isAdmin() {
  return !document.body?.classList.contains('auth-locked') && (currentRole() === 'admin' || Boolean(window.Permissions?.hasAdminOverride?.()));
}

function statusRank(status = '') {
  return status === 'fail' ? 3 : status === 'warn' ? 2 : status === 'ok' ? 1 : 0;
}

function addResult(id, label, status, detail, meta = '') {
  return { id, label, status, detail: String(detail || ''), meta: String(meta || '') };
}

async function checkAuth(sb) {
  const sessionResult = await sb?.auth?.getSession?.();
  const session = sessionResult?.data?.session || null;
  const uid = String(session?.user?.id || window.Session?.userId?.() || '').trim();
  if (!session || !uid) return addResult('auth', 'Authentication', 'fail', 'No active Supabase session.');
  return addResult('auth', 'Authentication', 'ok', 'Authenticated session is active.', `user ${uid.slice(0,8)}…`);
}

async function checkProfile(sb) {
  const uid = String(window.Session?.userId?.() || '').trim();
  if (!uid) return addResult('profile', 'Profile & role', 'fail', 'Current user ID is unavailable.');
  const { data, error } = await sb.from('profiles').select('id,email,role_key,is_active').eq('id', uid).maybeSingle();
  if (error) return addResult('profile', 'Profile & role', 'fail', error.message);
  if (!data) return addResult('profile', 'Profile & role', 'fail', 'No profile row found for the signed-in user.');
  if (data.is_active === false) return addResult('profile', 'Profile & role', 'fail', 'Profile exists but is inactive.', data.role_key || 'no role');
  return addResult('profile', 'Profile & role', 'ok', 'Active profile and role resolved.', data.role_key || 'role unavailable');
}

async function checkPermissionsRpc(sb) {
  const { data, error } = await sb.rpc('get_my_role_permissions');
  if (error) return addResult('permissions', 'Permission matrix', 'fail', error.message);
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return addResult('permissions', 'Permission matrix', 'warn', 'RPC returned no active permissions.');
  return addResult('permissions', 'Permission matrix', 'ok', `${rows.length} active role-permission rows resolved.`);
}

async function checkNotificationCatalog(sb) {
  const { count, error } = await sb.from('notification_event_types').select('id', { count: 'exact', head: true }).eq('enabled', true);
  if (error) return addResult('notification-catalog', 'Notification catalog', 'fail', error.message);
  const value = Number(count || 0);
  return addResult('notification-catalog', 'Notification catalog', value >= 72 ? 'ok' : 'warn', `${value} enabled notification event types visible to the browser.`, value >= 72 ? 'Expected production coverage present.' : 'Expected at least 72 active event types.');
}

async function checkPushConfig() {
  try {
    const response = await fetch('/api/notifications/push-config', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    const key = String(payload?.vapidPublicKey || payload?.publicKey || '').trim();
    if (!response.ok || payload?.ok === false) return addResult('push-config', 'Web Push configuration', 'fail', payload?.error || `HTTP ${response.status}`);
    if (!key) return addResult('push-config', 'Web Push configuration', 'fail', 'Public VAPID key is missing.');
    return addResult('push-config', 'Web Push configuration', 'ok', 'Public VAPID configuration is available.', `key ${key.slice(0,10)}…`);
  } catch (error) {
    return addResult('push-config', 'Web Push configuration', 'fail', error?.message || error);
  }
}

async function checkServiceWorker() {
  if (!('serviceWorker' in navigator)) return addResult('service-worker', 'Service worker', 'fail', 'Service workers are not supported in this browser.');
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return addResult('service-worker', 'Service worker', 'fail', 'No service worker registration found.');
    const worker = registration.active || registration.waiting || registration.installing;
    const controller = navigator.serviceWorker.controller;
    if (!worker) return addResult('service-worker', 'Service worker', 'warn', 'Registration exists but there is no active/waiting worker.');
    return addResult('service-worker', 'Service worker', controller ? 'ok' : 'warn', controller ? 'Active service worker controls this page.' : 'Worker is registered but does not currently control this page.', worker.scriptURL || '');
  } catch (error) {
    return addResult('service-worker', 'Service worker', 'fail', error?.message || error);
  }
}

async function checkBrowserPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return addResult('push-device', 'This device push', 'fail', 'Browser push APIs are unavailable.');
  const permission = String(Notification.permission || 'default');
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager?.getSubscription?.();
    if (permission !== 'granted') return addResult('push-device', 'This device push', permission === 'denied' ? 'fail' : 'warn', `Notification permission is ${permission}.`);
    if (!subscription) return addResult('push-device', 'This device push', 'warn', 'Permission is granted but this browser has no active push subscription.');
    return addResult('push-device', 'This device push', 'ok', 'Permission granted and active browser subscription found.', `${String(subscription.endpoint || '').slice(0,28)}…`);
  } catch (error) {
    return addResult('push-device', 'This device push', 'fail', error?.message || error);
  }
}

async function checkStoredPush(sb) {
  const uid = String(window.Session?.userId?.() || '').trim();
  if (!uid) return addResult('push-db', 'Stored push devices', 'fail', 'Current user ID unavailable.');
  const { data, error } = await sb.from('user_push_subscriptions').select('id,is_active,permission_status,last_seen_at').eq('user_id', uid).eq('is_active', true).limit(20);
  if (error) return addResult('push-db', 'Stored push devices', 'fail', error.message);
  const rows = Array.isArray(data) ? data : [];
  return addResult('push-db', 'Stored push devices', rows.length ? 'ok' : 'warn', `${rows.length} active device subscription${rows.length === 1 ? '' : 's'} registered for this user.`);
}

async function checkQueue(sb) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb.from('notification_delivery_queue').select('id,status,channel,last_error,created_at,updated_at').gte('created_at', since).order('created_at', { ascending: false }).limit(250);
  if (error) return addResult('queue', 'Notification delivery queue', 'fail', error.message);
  const rows = Array.isArray(data) ? data : [];
  const failed = rows.filter(row => String(row.status || '').toLowerCase() === 'failed').length;
  const oldCutoff = Date.now() - 10 * 60 * 1000;
  const staleQueued = rows.filter(row => ['queued','processing'].includes(String(row.status || '').toLowerCase()) && new Date(row.created_at || row.updated_at || 0).getTime() < oldCutoff).length;
  const status = failed > 0 || staleQueued > 0 ? 'warn' : 'ok';
  return addResult('queue', 'Notification delivery queue', status, `${rows.length} jobs in the last 24h · ${failed} failed · ${staleQueued} queued >10 min.`, failed || staleQueued ? 'Review failed/stale jobs in Notifications.' : 'No stale queue detected.');
}

async function checkBackups(sb) {
  const { data, error } = await sb.from('backup_logs').select('backup_date,status,created_at').order('created_at', { ascending: false }).limit(1);
  if (error) return addResult('backup', 'Latest backup record', 'warn', `Backup history unavailable: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return addResult('backup', 'Latest backup record', 'warn', 'No backup log has been recorded.');
  const when = row.backup_date || row.created_at;
  const ageDays = when ? Math.floor((Date.now() - new Date(when).getTime()) / 86400000) : null;
  const status = String(row.status || '').toLowerCase() === 'success' && (ageDays === null || ageDays <= 7) ? 'ok' : 'warn';
  return addResult('backup', 'Latest backup record', status, `Latest logged backup: ${when ? new Date(when).toLocaleDateString() : 'unknown date'} · ${row.status || 'unknown status'}.`, ageDays !== null ? `${ageDays} day${ageDays === 1 ? '' : 's'} ago` : '');
}

function checkConnectivity() {
  return addResult('online', 'Browser connectivity', navigator.onLine ? 'ok' : 'fail', navigator.onLine ? 'Browser reports an active network connection.' : 'Browser reports offline mode.', window.location.hostname);
}

function buildVersionMeta() {
  const appScript = [...document.scripts].find(script => String(script.src || '').includes('/app.js'))?.src || '';
  const uiScript = [...document.scripts].find(script => String(script.src || '').includes('/src/ui/index.js'))?.src || '';
  const host = window.location.hostname;
  return { host, appScript, uiScript };
}

function renderShell() {
  const root = document.getElementById('backupCenterRoot');
  if (!root || !isAdmin()) return null;
  root.innerHTML = `
    <div class="backup-page-header system-health-header">
      <div>
        <span class="backup-eyebrow">Admin · Diagnostics · Read-only checks</span>
        <h2>System Health</h2>
        <p class="muted">Live checks for authentication, Supabase, permissions, service worker, push delivery, notification queue and backups.</p>
      </div>
      <div class="backup-actions">
        <button type="button" class="btn" data-system-health-back>Back to Backup Center</button>
        <button type="button" class="btn primary" data-system-health-refresh ${state.running ? 'disabled' : ''}>${state.running ? 'Checking…' : 'Run Health Check'}</button>
      </div>
    </div>
    <div id="systemHealthSummary" class="system-health-summary"></div>
    <div id="systemHealthChecks" class="system-health-grid"><div class="system-health-loading">Running diagnostics…</div></div>
    <div id="systemHealthMeta" class="system-health-meta"></div>`;
  return root;
}

function renderResults() {
  const summary = document.getElementById('systemHealthSummary');
  const checks = document.getElementById('systemHealthChecks');
  const meta = document.getElementById('systemHealthMeta');
  if (!summary || !checks || !meta) return;

  const ordered = [...state.results].sort((a,b) => statusRank(b.status) - statusRank(a.status));
  const totals = ordered.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
  const overall = totals.fail ? 'fail' : totals.warn ? 'warn' : 'ok';
  const overallLabel = overall === 'ok' ? 'Healthy' : overall === 'warn' ? 'Attention needed' : 'Problem detected';
  const lastRun = state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Not run';

  summary.innerHTML = `
    <div class="system-health-overall health-${overall}"><span>Overall</span><strong>${esc(overallLabel)}</strong><small>${esc(lastRun)}</small></div>
    <div class="system-health-stat"><span>Healthy</span><strong>${Number(totals.ok || 0)}</strong></div>
    <div class="system-health-stat"><span>Warnings</span><strong>${Number(totals.warn || 0)}</strong></div>
    <div class="system-health-stat"><span>Failures</span><strong>${Number(totals.fail || 0)}</strong></div>`;

  checks.innerHTML = ordered.map(item => `
    <article class="system-health-card health-${esc(item.status)}">
      <div class="system-health-card-head"><strong>${esc(item.label)}</strong><span class="system-health-badge">${esc(item.status === 'ok' ? 'OK' : item.status === 'warn' ? 'WARNING' : 'FAILED')}</span></div>
      <p>${esc(item.detail)}</p>${item.meta ? `<small>${esc(item.meta)}</small>` : ''}
    </article>`).join('');

  const version = buildVersionMeta();
  meta.innerHTML = `<strong>Runtime</strong><span>Host: ${esc(version.host)}</span><span>App: ${esc(version.appScript || 'not detected')}</span><span>UI: ${esc(version.uiScript || 'not detected')}</span>`;
}

async function run() {
  if (!isAdmin() || state.running) return;
  state.running = true;
  renderShell();
  try {
    const sb = window.SupabaseClient?.getClient?.();
    if (!sb) {
      state.results = [addResult('supabase', 'Supabase client', 'fail', 'Supabase client is unavailable.')];
    } else {
      const checks = await Promise.allSettled([
        checkAuth(sb),
        checkProfile(sb),
        checkPermissionsRpc(sb),
        checkNotificationCatalog(sb),
        checkPushConfig(),
        checkServiceWorker(),
        checkBrowserPush(),
        checkStoredPush(sb),
        checkQueue(sb),
        checkBackups(sb),
        Promise.resolve(checkConnectivity())
      ]);
      state.results = checks.map((entry, index) => {
        if (entry.status === 'fulfilled') return entry.value;
        return addResult(`check-${index}`, 'Diagnostic check', 'fail', entry.reason?.message || entry.reason || 'Unknown diagnostic error.');
      });
    }
    state.lastRunAt = Date.now();
  } finally {
    state.running = false;
    renderShell();
    renderResults();
  }
}

function ensureHealthEntry() {
  if (!isAdmin()) return;
  const tabs = document.querySelector('#backupCenterView .backup-tabs');
  if (!tabs || tabs.querySelector('[data-system-health-open]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'backup-tab';
  button.dataset.systemHealthOpen = 'true';
  button.textContent = 'System Health';
  tabs.appendChild(button);
}

function restoreBackupCenter() {
  window.BackupCenter?.render?.();
  window.setTimeout(ensureHealthEntry, 0);
}

function open() {
  if (!isAdmin()) return;
  renderShell();
  run();
}

window.addEventListener('incheck360:auth-ready', () => {
  if (!isAdmin()) return;
  window.setTimeout(ensureHealthEntry, 0);
});

document.addEventListener('click', event => {
  if (!isAdmin()) return;
  if (event.target?.closest?.('#backupCenterTab')) {
    window.setTimeout(ensureHealthEntry, 80);
    return;
  }
  if (event.target?.closest?.('#backupCenterView [data-backup-tab], #backupCenterView [data-backup-tab-open]')) {
    window.setTimeout(ensureHealthEntry, 0);
    return;
  }
  if (event.target?.closest?.('[data-system-health-open]')) {
    event.preventDefault();
    open();
    return;
  }
  if (event.target?.closest?.('[data-system-health-refresh]')) {
    event.preventDefault();
    run();
    return;
  }
  if (event.target?.closest?.('[data-system-health-back]')) {
    event.preventDefault();
    restoreBackupCenter();
  }
}, true);

export const SystemHealth = Object.freeze({ open, run });
