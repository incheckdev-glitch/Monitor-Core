const UserActivityIp = (() => {
  const CONFIG = Object.freeze({
    captureMarkerKey: 'incheck.userActivity.ipCaptured.v1',
    captureRetryMs: 60 * 1000,
    pollMs: 5000,
    cacheMs: 15000
  });

  const state = {
    installed: false,
    timer: null,
    observer: null,
    refreshTimer: null,
    lastCaptureAttemptAt: 0,
    cachedDate: '',
    cachedAt: 0,
    ipByUser: new Map()
  };

  const clean = value => String(value ?? '').trim();
  const normalize = value => clean(value).toLowerCase().replace(/[\s-]+/g, '_');

  function getClient() {
    try { return window.SupabaseClient?.getClient?.() || null; } catch { return null; }
  }

  function currentRole() {
    const session = window.Session || {};
    const sessionState = session.state || {};
    let user = {};
    try { user = typeof session.user === 'function' ? (session.user() || {}) : {}; } catch {}
    const profile = sessionState.profile || user.profile || {};
    return normalize(sessionState.role_key || sessionState.role || user.role_key || user.role || profile.role_key || profile.role);
  }

  function canViewIp() {
    return ['admin', 'gm', 'general_manager', 'generalmanager'].includes(currentRole());
  }

  function readCaptureMarker() {
    try { return sessionStorage.getItem(CONFIG.captureMarkerKey) || ''; } catch { return ''; }
  }

  function writeCaptureMarker(sessionId) {
    try { sessionStorage.setItem(CONFIG.captureMarkerKey, sessionId); } catch {}
  }

  async function captureCurrentSession() {
    const client = getClient();
    const activityState = window.UserActivity?.getState?.() || {};
    const sessionId = clean(activityState.sessionId);
    if (!client || !sessionId || readCaptureMarker() === sessionId) return false;

    const now = Date.now();
    if (now - state.lastCaptureAttemptAt < CONFIG.captureRetryMs) return false;
    state.lastCaptureAttemptAt = now;

    try {
      const { data, error } = await client.functions.invoke('user-activity-ip', {
        body: { action: 'capture', session_id: sessionId }
      });
      if (error) throw error;
      if (data?.captured) {
        writeCaptureMarker(sessionId);
        state.cachedAt = 0;
        return true;
      }
    } catch (error) {
      console.warn('[UserActivityIp] IP capture skipped', error?.message || error);
    }
    return false;
  }

  function selectedDate() {
    const input = document.getElementById('uaDateFilter');
    if (input?.value) return input.value;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function dateBounds(dateString) {
    const start = new Date(`${dateString}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  async function loadIpMap(force = false) {
    if (!canViewIp()) return new Map();
    const client = getClient();
    if (!client) return new Map();

    const date = selectedDate();
    if (!force && state.cachedDate === date && Date.now() - state.cachedAt < CONFIG.cacheMs) {
      return state.ipByUser;
    }

    try {
      const bounds = dateBounds(date);
      const { data, error } = await client.functions.invoke('user-activity-ip', {
        body: { action: 'list', start: bounds.start, end: bounds.end }
      });
      if (error) throw error;
      const map = new Map();
      for (const row of data?.records || []) {
        const userId = clean(row?.user_id);
        const ipAddress = clean(row?.ip_address);
        if (userId && ipAddress && !map.has(userId)) map.set(userId, ipAddress);
      }
      state.cachedDate = date;
      state.cachedAt = Date.now();
      state.ipByUser = map;
      return map;
    } catch (error) {
      console.warn('[UserActivityIp] IP list load skipped', error?.message || error);
      return state.ipByUser;
    }
  }

  function ensureIpColumn(ipByUser) {
    const tbody = document.getElementById('uaUsersTbody');
    const table = tbody?.closest('table');
    if (!tbody || !table) return false;

    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector('[data-ua-ip-header]')) {
      const th = document.createElement('th');
      th.dataset.uaIpHeader = 'true';
      th.textContent = 'IP Address';
      headerRow.appendChild(th);
    }

    tbody.querySelectorAll('tr').forEach(row => {
      const userId = clean(row.dataset?.userId);
      if (!userId) {
        const onlyCell = row.querySelector('td[colspan]');
        if (onlyCell) onlyCell.setAttribute('colspan', '10');
        return;
      }

      let cell = row.querySelector('td[data-ua-ip-cell]');
      if (!cell) {
        cell = document.createElement('td');
        cell.dataset.uaIpCell = 'true';
        row.appendChild(cell);
      }
      const nextValue = ipByUser.get(userId) || '—';
      if (cell.textContent !== nextValue) cell.textContent = nextValue;
    });
    return true;
  }

  async function refreshDisplay(force = false) {
    if (!canViewIp()) return false;
    const ipByUser = await loadIpMap(force);
    return ensureIpColumn(ipByUser);
  }

  function scheduleDisplay(force = false) {
    if (!canViewIp()) return;
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = null;
      void refreshDisplay(force);
    }, 120);
  }

  function wireUi() {
    if (!canViewIp()) return false;
    const view = document.getElementById('userActivityView');
    if (!view) return false;

    if (!state.observer) {
      state.observer = new MutationObserver(() => scheduleDisplay(false));
      state.observer.observe(view, { childList: true, subtree: true });
    }

    const dateFilter = document.getElementById('uaDateFilter');
    if (dateFilter && dateFilter.dataset.uaIpWired !== 'true') {
      dateFilter.dataset.uaIpWired = 'true';
      dateFilter.addEventListener('change', () => {
        state.cachedAt = 0;
        scheduleDisplay(true);
      });
    }

    const refreshButton = document.getElementById('userActivityRefreshBtn');
    if (refreshButton && refreshButton.dataset.uaIpWired !== 'true') {
      refreshButton.dataset.uaIpWired = 'true';
      refreshButton.addEventListener('click', () => {
        state.cachedAt = 0;
        window.setTimeout(() => scheduleDisplay(true), 250);
      });
    }

    scheduleDisplay(false);
    return true;
  }

  function tick() {
    void captureCurrentSession();
    if (canViewIp()) wireUi();
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    tick();
    state.timer = window.setInterval(tick, CONFIG.pollMs);
    window.addEventListener('hashchange', () => window.setTimeout(tick, 100));
  }

  return Object.freeze({
    install,
    refresh: () => refreshDisplay(true),
    capture: captureCurrentSession
  });
})();

UserActivityIp.install();
window.UserActivityIp = UserActivityIp;

export { UserActivityIp };
