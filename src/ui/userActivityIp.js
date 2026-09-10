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
    observedTbody: null,
    refreshTimer: null,
    lastCaptureAttemptAt: 0,
    cachedDate: '',
    cachedAt: 0,
    records: []
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
        scheduleDisplay(true);
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

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  async function loadRecords(force = false) {
    if (!canViewIp()) return [];
    const client = getClient();
    if (!client) return [];

    const date = selectedDate();
    if (!force && state.cachedDate === date && Date.now() - state.cachedAt < CONFIG.cacheMs) {
      return state.records;
    }

    try {
      const bounds = dateBounds(date);
      const { data, error } = await client.functions.invoke('user-activity-ip', {
        body: { action: 'list', start: bounds.start, end: bounds.end }
      });
      if (error) throw error;
      state.cachedDate = date;
      state.cachedAt = Date.now();
      state.records = Array.isArray(data?.records) ? data.records : [];
      return state.records;
    } catch (error) {
      console.warn('[UserActivityIp] IP list load skipped', error?.message || error);
      return state.records;
    }
  }

  function latestIpByUser(records) {
    const map = new Map();
    for (const row of records) {
      const userId = clean(row?.user_id);
      if (!userId || map.has(userId)) continue;
      map.set(userId, clean(row?.ip_address));
    }
    return map;
  }

  function ensureIpColumn(records) {
    const tbody = document.getElementById('uaUsersTbody');
    const table = tbody?.closest('table');
    if (!tbody || !table) return false;

    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector('[data-ua-ip-header]')) {
      const th = document.createElement('th');
      th.dataset.uaIpHeader = 'true';
      th.textContent = 'Latest IP';
      headerRow.appendChild(th);
    }

    const latestMap = latestIpByUser(records);
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
      const value = latestMap.has(userId) ? latestMap.get(userId) : '';
      const nextValue = value || '—';
      if (cell.textContent !== nextValue) cell.textContent = nextValue;
    });
    return true;
  }

  function ensureSessionHistoryCard() {
    const grid = document.querySelector('#userActivityView .ua-detail-grid');
    if (!grid) return null;
    let card = document.getElementById('uaIpSessionHistoryCard');
    if (card) return card;

    card = document.createElement('section');
    card.id = 'uaIpSessionHistoryCard';
    card.className = 'card ua-table-card';
    card.innerHTML = `
      <div class="ua-card-heading">
        <div><strong>Session IP History</strong><span>Every ERP session for the selected user on this date.</span></div>
      </div>
      <div class="table-wrap modern-table-scroll">
        <table class="ua-table">
          <thead><tr><th>Session Start</th><th>Last Seen</th><th>Session End</th><th>IP Address</th><th>Device</th></tr></thead>
          <tbody id="uaIpSessionsTbody"><tr><td colspan="5" class="muted">Select a user to view session IP history.</td></tr></tbody>
        </table>
      </div>`;
    grid.appendChild(card);
    return card;
  }

  function selectedUserId() {
    const selectValue = clean(document.getElementById('uaUserFilter')?.value);
    if (selectValue) return selectValue;
    return clean(document.querySelector('#uaUsersTbody tr.is-selected[data-user-id]')?.dataset?.userId);
  }

  function renderSessionHistory(records) {
    ensureSessionHistoryCard();
    const tbody = document.getElementById('uaIpSessionsTbody');
    if (!tbody) return false;

    const userId = selectedUserId();
    let html = '';
    if (!userId) {
      html = '<tr><td colspan="5" class="muted">Select a user to view session IP history.</td></tr>';
    } else {
      const sessions = records
        .filter(row => clean(row?.user_id) === userId)
        .sort((a, b) => new Date(b?.started_at || 0) - new Date(a?.started_at || 0));

      html = sessions.length ? sessions.map(session => {
        const device = [clean(session?.device_type), clean(session?.browser)].filter(Boolean).join(' · ');
        const os = clean(session?.operating_system);
        const ip = clean(session?.ip_address);
        return `
          <tr>
            <td>${escapeHtml(formatDateTime(session?.started_at))}</td>
            <td>${escapeHtml(formatDateTime(session?.last_seen_at))}</td>
            <td>${escapeHtml(session?.ended_at ? formatDateTime(session.ended_at) : 'Open')}</td>
            <td><strong>${escapeHtml(ip || '—')}</strong>${ip ? '' : '<div class="muted ua-cell-sub">Not captured</div>'}</td>
            <td>${escapeHtml(device || '—')}<div class="muted ua-cell-sub">${escapeHtml(os)}</div></td>
          </tr>`;
      }).join('') : '<tr><td colspan="5" class="muted">No sessions found for this user on the selected date.</td></tr>';
    }

    if (tbody.innerHTML !== html) tbody.innerHTML = html;
    return true;
  }

  async function refreshDisplay(force = false) {
    if (!canViewIp()) return false;
    const records = await loadRecords(force);
    ensureIpColumn(records);
    renderSessionHistory(records);
    return true;
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

    const tbody = document.getElementById('uaUsersTbody');
    if (tbody && state.observedTbody !== tbody) {
      state.observer?.disconnect();
      state.observer = new MutationObserver(() => scheduleDisplay(false));
      state.observer.observe(tbody, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      state.observedTbody = tbody;
    }

    const dateFilter = document.getElementById('uaDateFilter');
    if (dateFilter && dateFilter.dataset.uaIpWired !== 'true') {
      dateFilter.dataset.uaIpWired = 'true';
      dateFilter.addEventListener('change', () => {
        state.cachedAt = 0;
        scheduleDisplay(true);
      });
    }

    const userFilter = document.getElementById('uaUserFilter');
    if (userFilter && userFilter.dataset.uaIpWired !== 'true') {
      userFilter.dataset.uaIpWired = 'true';
      userFilter.addEventListener('change', () => scheduleDisplay(false));
    }

    const refreshButton = document.getElementById('userActivityRefreshBtn');
    if (refreshButton && refreshButton.dataset.uaIpWired !== 'true') {
      refreshButton.dataset.uaIpWired = 'true';
      refreshButton.addEventListener('click', () => {
        state.cachedAt = 0;
        window.setTimeout(() => scheduleDisplay(true), 250);
      });
    }

    ensureSessionHistoryCard();
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
