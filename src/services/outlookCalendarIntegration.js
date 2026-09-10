(function installOutlookCalendarIntegration(global) {
  'use strict';

  const state = {
    installed: false,
    connection: null,
    statusBusy: false,
    syncBusy: false,
    connectBusy: false,
    handlersInstalled: false,
    autoTimer: null,
    retryCount: 0,
    lastSilentSync: 0,
    pendingSyncTimer: null
  };

  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').trim();

  function toast(message, type = 'info') {
    try {
      if (global.UI?.toast) return global.UI.toast(message, type);
      if (global.U?.toast) return global.U.toast(message, type);
    } catch (_) {}
    console[type === 'error' ? 'error' : 'log']('[outlook-calendar]', message);
  }

  function setPanelError(message = '') {
    const error = $('ecOutlookError');
    if (!error) return;
    const text = clean(message);
    error.hidden = !text;
    error.textContent = text;
  }

  function ensureCss() {
    if (document.getElementById('incheck360-outlook-calendar-css')) return;
    const link = document.createElement('link');
    link.id = 'incheck360-outlook-calendar-css';
    link.rel = 'stylesheet';
    link.href = '/src/ui/outlook-calendar.css?v=20260910-outlook1';
    document.head.appendChild(link);
  }

  function supabase() {
    return global.SupabaseClient?.getClient?.() || global.supabaseClient || global.supabase || null;
  }

  async function authHeader() {
    let token = '';
    const client = supabase();
    if (client?.auth?.getSession) {
      try {
        const result = await client.auth.getSession();
        token = clean(result?.data?.session?.access_token);
      } catch (_) {}
    }
    if (!token && typeof global.Api?.getCurrentAccessToken === 'function') {
      try { token = clean(await global.Api.getCurrentAccessToken()); } catch (_) {}
    }
    if (!token) throw new Error('Your ERP session could not be read. Please refresh the page and try again.');
    return { Authorization: `Bearer ${token}` };
  }

  async function request(path, options = {}) {
    const headers = {
      ...(await authHeader()),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(path, {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const error = new Error(clean(payload?.error) || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function fmtDate(value) {
    if (!value) return 'Never';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Never';
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(d);
    } catch (_) {
      return d.toLocaleString();
    }
  }

  function ensureUi() {
    ensureCss();
    const form = $('ecSettingsForm');
    if (!form) return false;

    if (!$('ecOutlookPanel')) {
      const actions = form.querySelector('.ec-modal-actions');
      const panel = document.createElement('section');
      panel.id = 'ecOutlookPanel';
      panel.className = 'ec-outlook-panel';
      panel.innerHTML = `
        <div class="ec-outlook-head">
          <div class="ec-outlook-title">
            <span class="ec-outlook-mark" aria-hidden="true">O</span>
            <span><strong>Microsoft Outlook Calendar</strong><small>Two-way CRM calendar synchronization</small></span>
          </div>
          <span id="ecOutlookBadge" class="ec-outlook-badge" data-state="disconnected">Not connected</span>
        </div>
        <div class="ec-outlook-meta">
          <div><small>Microsoft account</small><strong id="ecOutlookAccount">—</strong></div>
          <div><small>Outlook calendar</small><strong id="ecOutlookCalendar">—</strong></div>
          <div><small>Last sync</small><strong id="ecOutlookLastSync">Never</strong></div>
          <div><small>Live updates</small><strong id="ecOutlookWebhook">Not active</strong></div>
        </div>
        <div class="ec-outlook-options">
          <label class="ec-outlook-option">
            <input id="ecOutlookTwoWay" type="checkbox">
            <span><strong>Two-way sync</strong><small>CRM changes go to Outlook and linked Outlook changes return to CRM.</small></span>
          </label>
          <label class="ec-outlook-option">
            <input id="ecOutlookTeams" type="checkbox">
            <span><strong>Create Microsoft Teams meetings</strong><small>Meeting-type CRM items get a Teams join link when your Outlook account supports it.</small></span>
          </label>
          <label class="ec-outlook-option">
            <input id="ecOutlookInviteContacts" type="checkbox">
            <span><strong>Invite related CRM contacts</strong><small>Off by default. When enabled, a calendar item linked to a CRM Contact can send an Outlook invitation to that contact.</small></span>
          </label>
        </div>
        <div id="ecOutlookError" class="ec-outlook-error" hidden></div>
        <div class="ec-outlook-actions">
          <button id="ecOutlookConnect" class="btn primary" type="button">Connect Outlook</button>
          <button id="ecOutlookSync" class="btn" type="button" hidden>↻ Sync Now</button>
          <button id="ecOutlookDisconnect" class="btn danger" type="button" hidden>Disconnect</button>
        </div>
        <p class="ec-outlook-copy">Only CRM work items are synchronized. Personal CRM items are excluded, and unrelated personal Outlook appointments are never imported into the Operations Portal.</p>
      `;
      if (actions) form.insertBefore(panel, actions);
      else form.appendChild(panel);
    }

    const notesHost = $('ecEventForm')?.querySelector('.ec-channels');
    if (notesHost && !$('ecOutlookEventNote')) {
      const note = document.createElement('div');
      note.id = 'ecOutlookEventNote';
      note.className = 'ec-outlook-event-note';
      note.innerHTML = '<span aria-hidden="true">↔</span><span>When Outlook is connected, non-Personal calendar items sync automatically. Teams links and CRM-contact invitations follow your Outlook Calendar settings.</span>';
      notesHost.insertAdjacentElement('afterend', note);
    }

    bindUi();
    installDelegatedHandlers();
    return true;
  }

  function bindUi() {
    const settings = $('ecSettings');
    if (settings && settings.dataset.outlookBound !== 'true') {
      settings.dataset.outlookBound = 'true';
      settings.addEventListener('click', () => setTimeout(() => loadStatus(true), 0));
    }
    const eventForm = $('ecEventForm');
    if (eventForm && eventForm.dataset.outlookBound !== 'true') {
      eventForm.dataset.outlookBound = 'true';
      eventForm.addEventListener('submit', () => scheduleSync(2200));
    }
    const deleteButton = $('ecDelete');
    if (deleteButton && deleteButton.dataset.outlookBound !== 'true') {
      deleteButton.dataset.outlookBound = 'true';
      deleteButton.addEventListener('click', () => scheduleSync(1800));
    }
    const calendar = $('employeeCalendar');
    if (calendar && calendar.dataset.outlookBound !== 'true') {
      calendar.dataset.outlookBound = 'true';
      calendar.addEventListener('pointerup', () => scheduleSync(1800), { passive: true });
    }
  }

  function installDelegatedHandlers() {
    if (state.handlersInstalled) return;
    state.handlersInstalled = true;

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest('#ecOutlookConnect, #ecOutlookSync, #ecOutlookDisconnect') : null;
      if (!target) return;
      event.preventDefault();
      if (target.id === 'ecOutlookConnect') connectOutlook();
      else if (target.id === 'ecOutlookSync') syncNow(false);
      else if (target.id === 'ecOutlookDisconnect') disconnectOutlook();
    }, true);

    document.addEventListener('change', event => {
      const id = event.target?.id;
      if (id === 'ecOutlookTwoWay' || id === 'ecOutlookTeams' || id === 'ecOutlookInviteContacts') {
        saveIntegrationSettings();
      }
    }, true);
  }

  function render(connection) {
    state.connection = connection || null;
    const c = connection || {};
    const connected = c.connected === true;
    const configured = c.configured !== false;
    const badge = $('ecOutlookBadge');
    if (badge) {
      const stateName = connected ? 'connected' : (c.status || 'disconnected');
      badge.dataset.state = stateName;
      badge.textContent = connected ? 'Connected' : c.status === 'needs_reauth' ? 'Reconnect required' : c.status === 'error' ? 'Connection error' : configured ? 'Not connected' : 'Microsoft setup required';
    }
    if ($('ecOutlookAccount')) $('ecOutlookAccount').textContent = c.email || c.displayName || '—';
    if ($('ecOutlookCalendar')) $('ecOutlookCalendar').textContent = c.calendarName || '—';
    if ($('ecOutlookLastSync')) $('ecOutlookLastSync').textContent = fmtDate(c.lastSyncAt);
    if ($('ecOutlookWebhook')) $('ecOutlookWebhook').textContent = c.webhookActive ? 'Live' : connected && c.twoWayEnabled ? 'Renewing / fallback sync' : 'Not active';

    const twoWay = $('ecOutlookTwoWay');
    const teams = $('ecOutlookTeams');
    const invite = $('ecOutlookInviteContacts');
    if (twoWay) { twoWay.checked = connected && c.twoWayEnabled !== false; twoWay.disabled = !connected; }
    if (teams) { teams.checked = connected && c.teamsDefault === true; teams.disabled = !connected || c.teamsAvailable === false; }
    if (invite) { invite.checked = connected && c.inviteRelatedContacts === true; invite.disabled = !connected; }

    const connect = $('ecOutlookConnect');
    const sync = $('ecOutlookSync');
    const disconnect = $('ecOutlookDisconnect');
    if (connect) {
      connect.hidden = connected;
      connect.disabled = !configured || state.connectBusy;
      connect.textContent = state.connectBusy ? 'Opening Microsoft…' : c.status === 'needs_reauth' ? 'Reconnect Outlook' : configured ? 'Connect Outlook' : 'Microsoft setup required';
    }
    if (sync) { sync.hidden = !connected; sync.style.display = connected ? '' : 'none'; sync.disabled = state.syncBusy || c.twoWayEnabled === false; }
    if (disconnect) {
      const showDisconnect = connected || c.status === 'needs_reauth' || c.status === 'error';
      disconnect.hidden = !showDisconnect;
      disconnect.style.display = showDisconnect ? '' : 'none';
    }

    const error = $('ecOutlookError');
    if (error) {
      const message = clean(c.lastError);
      if (message) setPanelError(message);
      else if (!state.connectBusy) setPanelError('');
    }
  }

  async function loadStatus(silent = false) {
    if (state.statusBusy) return state.connection;
    if (!ensureUi()) return null;
    state.statusBusy = true;
    try {
      const payload = await request('/api/outlook/status');
      render(payload.connection || null);
      return payload.connection || null;
    } catch (error) {
      setPanelError(error.message);
      if (!silent) toast(error.message, 'error');
      return null;
    } finally {
      state.statusBusy = false;
    }
  }

  async function connectOutlook() {
    if (state.connectBusy) return;
    state.connectBusy = true;
    setPanelError('');
    const button = $('ecOutlookConnect');
    if (button) {
      button.disabled = true;
      button.textContent = 'Opening Microsoft…';
    }
    try {
      const payload = await request('/api/outlook/connect');
      if (!payload.authorizationUrl) throw new Error('Microsoft authorization URL was not returned.');
      global.location.href = payload.authorizationUrl;
    } catch (error) {
      setPanelError(error.message);
      toast(error.message, 'error');
      state.connectBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Connect Outlook';
      }
    }
  }

  async function saveIntegrationSettings() {
    if (!state.connection?.connected) return;
    try {
      setPanelError('');
      const payload = await request('/api/outlook/settings', {
        method: 'POST',
        body: JSON.stringify({
          twoWayEnabled: Boolean($('ecOutlookTwoWay')?.checked),
          teamsDefault: Boolean($('ecOutlookTeams')?.checked),
          inviteRelatedContacts: Boolean($('ecOutlookInviteContacts')?.checked)
        })
      });
      render(payload.connection || null);
      toast('Outlook Calendar settings saved');
      if (payload.connection?.twoWayEnabled) scheduleSync(500);
    } catch (error) {
      setPanelError(error.message);
      toast(error.message, 'error');
      await loadStatus(true);
    }
  }

  async function syncNow(silent = false) {
    if (state.syncBusy || !state.connection?.connected || state.connection?.twoWayEnabled === false) return;
    if (silent && Date.now() - state.lastSilentSync < 45000) return;
    state.syncBusy = true;
    if (silent) state.lastSilentSync = Date.now();
    render(state.connection);
    try {
      setPanelError('');
      const payload = await request('/api/outlook/sync', { method: 'POST', body: '{}' });
      render(payload.connection || state.connection);
      try { await global.InCheck360EmployeeCalendar?.refresh?.(); } catch (_) {}
      if (!silent) {
        const push = payload.push || {};
        const pull = payload.pull || {};
        const changes = Number(push.created || 0) + Number(push.updated || 0) + Number(push.deleted || 0) + Number(pull.updated || 0) + Number(pull.deleted || 0);
        toast(changes ? `Outlook sync complete · ${changes} change${changes === 1 ? '' : 's'}` : 'Outlook is already up to date');
      }
    } catch (error) {
      setPanelError(error.message);
      if (!silent) toast(error.message, 'error');
      await loadStatus(true);
    } finally {
      state.syncBusy = false;
      render(state.connection);
    }
  }

  async function disconnectOutlook() {
    if (!global.confirm('Disconnect Microsoft Outlook from your CRM Calendar? Existing CRM items will stay in the Operations Portal.')) return;
    try {
      setPanelError('');
      const payload = await request('/api/outlook/disconnect', { method: 'POST', body: '{}' });
      render(payload.connection || null);
      toast('Outlook Calendar disconnected');
    } catch (error) {
      setPanelError(error.message);
      toast(error.message, 'error');
    }
  }

  function scheduleSync(delay = 1200) {
    if (!state.connection?.connected || state.connection?.twoWayEnabled === false) return;
    global.clearTimeout(state.pendingSyncTimer);
    state.pendingSyncTimer = global.setTimeout(() => syncNow(true), delay);
  }

  function calendarVisible() {
    const view = $('employeeCalendarView');
    return Boolean(view && !view.hidden && view.classList.contains('active') && document.visibilityState !== 'hidden');
  }

  function startAutoSync() {
    if (state.autoTimer) return;
    state.autoTimer = global.setInterval(() => {
      if (calendarVisible() && state.connection?.connected && state.connection?.twoWayEnabled !== false) {
        syncNow(true);
      }
    }, 90000);
  }

  function handleCallbackResult() {
    const url = new URL(global.location.href);
    const result = clean(url.searchParams.get('outlook'));
    if (!result) return;
    const message = clean(url.searchParams.get('outlook_error'));
    url.searchParams.delete('outlook');
    url.searchParams.delete('outlook_error');
    global.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash || '#employee-calendar'}`);
    if (result === 'connected') toast('Microsoft Outlook Calendar connected');
    else if (result === 'error') {
      setPanelError(message || 'Unable to connect Microsoft Outlook Calendar');
      toast(message || 'Unable to connect Microsoft Outlook Calendar', 'error');
    }
  }

  async function onCalendarOpen() {
    if (!ensureUi()) return;
    const connection = await loadStatus(true);
    if (connection?.connected && connection?.twoWayEnabled !== false) scheduleSync(600);
  }

  function boot() {
    installDelegatedHandlers();
    if (state.installed) return;
    if (!ensureUi()) {
      if (state.retryCount++ < 30) global.setTimeout(boot, 120);
      return;
    }
    state.installed = true;
    handleCallbackResult();
    startAutoSync();
    loadStatus(true).then(connection => {
      if (connection?.connected && global.location.hash.startsWith('#employee-calendar')) scheduleSync(800);
    });
    global.addEventListener('focus', () => {
      if (calendarVisible()) loadStatus(true).then(() => scheduleSync(600));
    });
    global.addEventListener('hashchange', () => {
      if (global.location.hash.startsWith('#employee-calendar')) onCalendarOpen();
    });
  }

  global.InCheck360OutlookCalendar = Object.freeze({
    refresh: () => loadStatus(true),
    sync: () => syncNow(false),
    onCalendarOpen,
    connect: connectOutlook
  });

  boot();
})(window);
