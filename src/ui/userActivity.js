const UserActivity = (() => {
  const CONFIG = Object.freeze({
    idleMs: 5 * 60 * 1000,
    heartbeatMs: 60 * 1000,
    offlineMs: 150 * 1000,
    maxHeartbeatDeltaSeconds: 120,
    sessionStorageKey: 'incheck.userActivity.session.v1',
    dashboardRefreshMs: 60 * 1000,
    maxSessions: 1500,
    maxEvents: 600,
    maxUsageRows: 1000
  });

  const state = {
    installed: false,
    trackerStarted: false,
    userId: '',
    userName: '',
    userEmail: '',
    role: '',
    sessionId: '',
    currentModule: '',
    currentSegmentId: '',
    segmentActiveSeconds: 0,
    segmentIdleSeconds: 0,
    activeSeconds: 0,
    idleSeconds: 0,
    hasActivity: false,
    activityState: 'signed_in',
    lastInteractionAt: 0,
    lastHeartbeatAt: 0,
    heartbeatTimer: null,
    dashboardTimer: null,
    authObserver: null,
    sessionUnsubscribe: null,
    adminMounted: false,
    selectedUserId: '',
    coreSetActiveView: null,
    ending: false,
    lastActionKey: '',
    lastActionAt: 0
  };

  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').trim();
  const normalize = value => clean(value).toLowerCase().replace(/[\s-]+/g, '_');
  const nowIso = () => new Date().toISOString();
  const uuid = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  function getClient() {
    try { return window.SupabaseClient?.getClient?.() || null; } catch { return null; }
  }

  function getIdentity() {
    const session = window.Session || {};
    const sessionState = session.state || {};
    let user = {};
    try { user = typeof session.user === 'function' ? (session.user() || {}) : {}; } catch {}
    const profile = sessionState.profile || user.profile || {};
    return {
      userId: clean(sessionState.user_id || sessionState.id || user.user_id || user.id || profile.id),
      name: clean(sessionState.name || user.name || profile.name || profile.full_name),
      email: clean(sessionState.email || user.email || profile.email),
      role: normalize(sessionState.role_key || sessionState.role || user.role_key || user.role || profile.role_key || profile.role)
    };
  }

  function isAuthenticated() {
    if (document.body?.classList.contains('auth-locked')) return false;
    const identity = getIdentity();
    return Boolean(identity.userId && identity.role);
  }

  function isAdmin() {
    return getIdentity().role === 'admin';
  }

  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const lower = ua.toLowerCase();
    const deviceType = /ipad|tablet/.test(lower) ? 'Tablet' : /mobi|android|iphone/.test(lower) ? 'Mobile' : 'Desktop';
    const browser = /edg\//i.test(ua) ? 'Edge' : /chrome\//i.test(ua) ? 'Chrome' : /firefox\//i.test(ua) ? 'Firefox' : /safari\//i.test(ua) && !/chrome\//i.test(ua) ? 'Safari' : 'Other';
    const operatingSystem = /windows/i.test(ua) ? 'Windows' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac os|macintosh/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Other';
    return { deviceType, browser, operatingSystem, userAgent: ua.slice(0, 500) };
  }

  function currentModule() {
    if ($('userActivityView')?.classList.contains('active')) return 'userActivity';
    const activeTab = document.querySelector('.view-tab.active[data-view], .view-tab[aria-selected="true"][data-view]');
    if (activeTab?.dataset?.view) return clean(activeTab.dataset.view);
    const activeView = document.querySelector('.content-panels > .view.active, .view.active');
    if (activeView?.id) return activeView.id.replace(/View$/, '') || 'unknown';
    return 'unknown';
  }

  function moduleLabel(value) {
    const key = clean(value);
    const labels = {
      issues: 'Tickets', calendar: 'Events', csm: 'CSM Daily Activity', clientSuccess: 'Client Success 360',
      company: 'Company', contacts: 'Contacts', leads: 'Leads', deals: 'Deals', proposals: 'Proposals',
      agreements: 'Agreements', commissionTracker: 'Commission Tracker', invoices: 'Invoices', receipts: 'Receipts',
      creditNotes: 'Credit Notes', paymentForecast: 'Payment Forecast', renewalForecast: 'Monthly Renewal Forecast',
      biners: 'Biners Control Center', hr: 'HR & Payroll', accounting: 'Accounting Foundation', backupCenter: 'Backup Center',
      lifecycleAnalytics: 'Lifecycle Analytics', clients: 'Clients', proposalCatalog: 'Proposal Catalog',
      communicationCentre: 'Communication Centre', communication_centre: 'Communication Centre', notifications: 'Notification Hub',
      notificationSetup: 'Notification Setup', workflow: 'Workflow', users: 'Users', rolePermissions: 'Role Permissions',
      userActivity: 'User Activity', unknown: 'Unknown'
    };
    return labels[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase());
  }

  function readStoredSession() {
    try {
      const raw = sessionStorage.getItem(CONFIG.sessionStorageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.id && parsed.userId ? parsed : null;
    } catch { return null; }
  }

  function storeSession(id, userId) {
    try { sessionStorage.setItem(CONFIG.sessionStorageKey, JSON.stringify({ id, userId })); } catch {}
  }

  function clearStoredSession() {
    try { sessionStorage.removeItem(CONFIG.sessionStorageKey); } catch {}
  }

  async function writeEvent(eventType, details = {}) {
    const client = getClient();
    if (!client || !state.sessionId || !state.userId) return false;
    const payload = {
      session_id: state.sessionId,
      user_id: state.userId,
      event_type: clean(eventType) || 'activity',
      module: clean(details.module || state.currentModule || currentModule()) || null,
      action: clean(details.action) || null,
      label: clean(details.label).slice(0, 240) || null,
      element_id: clean(details.elementId).slice(0, 160) || null,
      page_path: `${location.pathname}${location.hash || ''}`.slice(0, 500),
      occurred_at: nowIso(),
      metadata: details.metadata && typeof details.metadata === 'object' ? details.metadata : {}
    };
    try {
      const { error } = await client.from('user_activity_events').insert(payload);
      if (error) throw error;
      return true;
    } catch (error) {
      console.warn('[UserActivity] event write skipped', error?.message || error);
      return false;
    }
  }

  async function openModuleSegment(moduleName) {
    const client = getClient();
    if (!client || !state.sessionId || !state.userId) return false;
    const normalizedModule = clean(moduleName || 'unknown') || 'unknown';
    state.currentSegmentId = uuid();
    state.segmentActiveSeconds = 0;
    state.segmentIdleSeconds = 0;
    try {
      const { error } = await client.from('user_module_usage').insert({
        id: state.currentSegmentId,
        session_id: state.sessionId,
        user_id: state.userId,
        module: normalizedModule,
        started_at: nowIso(),
        last_seen_at: nowIso(),
        active_seconds: 0,
        idle_seconds: 0
      });
      if (error) throw error;
      return true;
    } catch (error) {
      console.warn('[UserActivity] module segment start skipped', error?.message || error);
      state.currentSegmentId = '';
      return false;
    }
  }

  async function closeModuleSegment() {
    const client = getClient();
    const segmentId = state.currentSegmentId;
    if (!client || !segmentId) return false;
    state.currentSegmentId = '';
    try {
      const { error } = await client.from('user_module_usage').update({
        ended_at: nowIso(),
        last_seen_at: nowIso(),
        active_seconds: Math.max(0, Math.round(state.segmentActiveSeconds)),
        idle_seconds: Math.max(0, Math.round(state.segmentIdleSeconds))
      }).eq('id', segmentId);
      if (error) throw error;
      return true;
    } catch (error) {
      console.warn('[UserActivity] module segment close skipped', error?.message || error);
      return false;
    }
  }

  async function syncModule(force = false) {
    if (!state.trackerStarted) return;
    const next = currentModule();
    if (!force && next === state.currentModule) return;
    const previous = state.currentModule;
    if (state.currentSegmentId) await closeModuleSegment();
    state.currentModule = next;
    await openModuleSegment(next);
    if (previous && previous !== next) {
      void writeEvent('module_open', { module: next, action: 'navigate', label: moduleLabel(next), metadata: { from_module: previous } });
    }
  }

  function deriveActivityState(now = Date.now()) {
    if (!state.hasActivity || !state.lastInteractionAt) return 'signed_in';
    if (document.hidden) return 'idle';
    return now - state.lastInteractionAt >= CONFIG.idleMs ? 'idle' : 'active';
  }

  async function heartbeat({ force = false } = {}) {
    if (!state.trackerStarted || state.ending) return false;
    const client = getClient();
    if (!client) return false;
    const now = Date.now();
    await syncModule(false);
    const deltaSeconds = state.lastHeartbeatAt
      ? Math.max(0, Math.min(CONFIG.maxHeartbeatDeltaSeconds, Math.round((now - state.lastHeartbeatAt) / 1000)))
      : 0;
    state.lastHeartbeatAt = now;
    const nextState = deriveActivityState(now);
    const previousState = state.activityState;
    state.activityState = nextState;
    if (deltaSeconds > 0) {
      if (nextState === 'active') {
        state.activeSeconds += deltaSeconds;
        state.segmentActiveSeconds += deltaSeconds;
      } else {
        state.idleSeconds += deltaSeconds;
        state.segmentIdleSeconds += deltaSeconds;
      }
    }
    if (previousState !== nextState) {
      if (nextState === 'idle') void writeEvent('idle_start', { action: 'idle', label: 'User became idle' });
      if (nextState === 'active') void writeEvent('active_resumed', { action: 'resume', label: 'User resumed activity' });
    }
    const lastInteractionIso = state.lastInteractionAt ? new Date(state.lastInteractionAt).toISOString() : null;
    try {
      const { error } = await client.from('user_activity_sessions').update({
        last_seen_at: new Date(now).toISOString(),
        last_interaction_at: lastInteractionIso,
        has_activity: state.hasActivity,
        activity_state: nextState,
        current_module: state.currentModule || currentModule(),
        active_seconds: Math.max(0, Math.round(state.activeSeconds)),
        idle_seconds: Math.max(0, Math.round(state.idleSeconds)),
        updated_at: new Date(now).toISOString()
      }).eq('id', state.sessionId);
      if (error) throw error;
      if (state.currentSegmentId) {
        const { error: segmentError } = await client.from('user_module_usage').update({
          last_seen_at: new Date(now).toISOString(),
          active_seconds: Math.max(0, Math.round(state.segmentActiveSeconds)),
          idle_seconds: Math.max(0, Math.round(state.segmentIdleSeconds))
        }).eq('id', state.currentSegmentId);
        if (segmentError) console.warn('[UserActivity] segment heartbeat skipped', segmentError.message);
      }
      if (force && isAdmin() && $('userActivityView')?.classList.contains('active')) void loadDashboard(false);
      return true;
    } catch (error) {
      console.warn('[UserActivity] heartbeat skipped', error?.message || error);
      return false;
    }
  }

  function noteInteraction() {
    if (!state.trackerStarted || state.ending || document.hidden) return;
    const now = Date.now();
    const firstActivity = !state.hasActivity;
    state.hasActivity = true;
    state.lastInteractionAt = now;
    if (firstActivity) {
      state.activityState = 'active';
      void writeEvent('activity_started', { action: 'first_activity', label: 'First activity after sign-in' });
      void heartbeat();
    }
  }

  function actionDescriptor(el) {
    if (!el) return null;
    const label = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent).replace(/\s+/g, ' ').slice(0, 200);
    const action = clean(el.dataset?.action || el.dataset?.permissionAction || el.id || el.getAttribute('role') || el.tagName).slice(0, 120);
    const resource = clean(el.dataset?.permissionResource).slice(0, 120);
    return { label, action, resource, elementId: clean(el.id) };
  }

  function handleClick(event) {
    if (!state.trackerStarted || state.ending) return;
    noteInteraction();
    const target = event.target?.closest?.('button, a, [role="button"]');
    if (!target || !document.getElementById('app')?.contains(target)) return;
    if (target.matches('.view-menu-group-toggle, [data-menu-group-toggle]')) return;
    if (target.id === 'userActivityTab') return;
    if (target.classList.contains('view-tab')) {
      window.setTimeout(() => void syncModule(false), 20);
      return;
    }
    const descriptor = actionDescriptor(target);
    if (!descriptor || (!descriptor.label && !descriptor.action)) return;
    const key = `${state.currentModule}|${descriptor.action}|${descriptor.elementId}|${descriptor.label}`;
    const now = Date.now();
    if (key === state.lastActionKey && now - state.lastActionAt < 1500) return;
    state.lastActionKey = key;
    state.lastActionAt = now;
    void writeEvent('ui_action', {
      action: descriptor.action,
      label: descriptor.label,
      elementId: descriptor.elementId,
      metadata: descriptor.resource ? { permission_resource: descriptor.resource } : {}
    });
    if (target.id === 'logoutBtn') void finishSession('logout');
  }

  async function initializeSession() {
    if (!isAuthenticated() || state.trackerStarted) return false;
    const client = getClient();
    if (!client) return false;
    const identity = getIdentity();
    state.userId = identity.userId;
    state.userName = identity.name;
    state.userEmail = identity.email;
    state.role = identity.role;
    const stored = readStoredSession();
    let existing = null;
    if (stored?.userId === state.userId) {
      try {
        const { data, error } = await client.from('user_activity_sessions')
          .select('id,active_seconds,idle_seconds,has_activity,activity_state,last_interaction_at,current_module,ended_at')
          .eq('id', stored.id)
          .eq('user_id', state.userId)
          .maybeSingle();
        if (!error && data && !data.ended_at) existing = data;
      } catch {}
    }
    state.sessionId = existing?.id || uuid();
    state.activeSeconds = Number(existing?.active_seconds || 0);
    state.idleSeconds = Number(existing?.idle_seconds || 0);
    state.hasActivity = Boolean(existing?.has_activity);
    state.activityState = clean(existing?.activity_state) || (state.hasActivity ? 'idle' : 'signed_in');
    state.lastInteractionAt = existing?.last_interaction_at ? new Date(existing.last_interaction_at).getTime() : 0;
    state.lastHeartbeatAt = Date.now();
    state.currentModule = currentModule();
    const device = deviceInfo();
    if (existing) {
      const { error } = await client.from('user_activity_sessions').update({
        last_seen_at: nowIso(),
        current_module: state.currentModule,
        device_type: device.deviceType,
        browser: device.browser,
        operating_system: device.operatingSystem,
        user_agent: device.userAgent,
        updated_at: nowIso()
      }).eq('id', state.sessionId);
      if (error) console.warn('[UserActivity] session restore update skipped', error.message);
    } else {
      const { error } = await client.from('user_activity_sessions').insert({
        id: state.sessionId,
        user_id: state.userId,
        user_name: state.userName || null,
        user_email: state.userEmail || null,
        role_key: state.role || null,
        started_at: nowIso(),
        last_seen_at: nowIso(),
        last_interaction_at: null,
        has_activity: false,
        activity_state: 'signed_in',
        current_module: state.currentModule,
        active_seconds: 0,
        idle_seconds: 0,
        device_type: device.deviceType,
        browser: device.browser,
        operating_system: device.operatingSystem,
        user_agent: device.userAgent
      });
      if (error) {
        console.warn('[UserActivity] session insert skipped', error.message);
        return false;
      }
    }
    storeSession(state.sessionId, state.userId);
    state.trackerStarted = true;
    await openModuleSegment(state.currentModule);
    if (!existing) void writeEvent('signed_in', { action: 'session_start', label: 'Signed in to ERP' });
    state.heartbeatTimer = window.setInterval(() => void heartbeat(), CONFIG.heartbeatMs);
    document.addEventListener('pointerdown', noteInteraction, { passive: true });
    document.addEventListener('keydown', noteInteraction, { passive: true });
    document.addEventListener('touchstart', noteInteraction, { passive: true });
    document.addEventListener('scroll', noteInteraction, { passive: true, capture: true });
    document.addEventListener('click', handleClick, true);
    document.addEventListener('visibilitychange', () => void heartbeat());
    return true;
  }

  async function finishSession(reason = 'ended') {
    if (!state.trackerStarted || state.ending) return false;
    state.ending = true;
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
    const client = getClient();
    const sessionId = state.sessionId;
    try {
      await closeModuleSegment();
      if (client && sessionId) {
        await writeEvent(reason === 'logout' ? 'logout' : 'session_end', { action: reason, label: reason === 'logout' ? 'Logged out of ERP' : 'Session ended' });
        await client.from('user_activity_sessions').update({
          ended_at: nowIso(),
          last_seen_at: nowIso(),
          activity_state: 'ended',
          current_module: state.currentModule || currentModule(),
          active_seconds: Math.max(0, Math.round(state.activeSeconds)),
          idle_seconds: Math.max(0, Math.round(state.idleSeconds)),
          updated_at: nowIso()
        }).eq('id', sessionId);
      }
    } catch (error) {
      console.warn('[UserActivity] session finish skipped', error?.message || error);
    }
    clearStoredSession();
    state.trackerStarted = false;
    state.sessionId = '';
    state.ending = false;
    return true;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds || 0)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m`;
    return `${total}s`;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function relativeTime(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function isToday(dateString) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return dateString === `${y}-${m}-${d}`;
  }

  function dateBounds(dateString) {
    const base = dateString ? new Date(`${dateString}T00:00:00`) : new Date();
    if (!dateString) base.setHours(0, 0, 0, 0);
    const end = new Date(base);
    end.setDate(end.getDate() + 1);
    return { start: base.toISOString(), end: end.toISOString() };
  }

  function statusForSession(session, todaySelected) {
    if (!todaySelected || !session) return 'offline';
    if (session.ended_at || clean(session.activity_state) === 'ended') return 'offline';
    const lastSeen = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
    if (!lastSeen || Date.now() - lastSeen > CONFIG.offlineMs) return 'offline';
    if (!session.has_activity) return 'signed_in';
    return clean(session.activity_state) === 'idle' ? 'idle' : 'active';
  }

  function statusBadge(status) {
    const labels = { active: 'Active', idle: 'Idle', signed_in: 'Signed in · no work', offline: 'Offline' };
    return `<span class="ua-status ua-status-${escapeHtml(status)}">${escapeHtml(labels[status] || status)}</span>`;
  }

  function mountAdminModule() {
    if (!isAdmin()) {
      $('administrationUserActivityGroup')?.remove();
      $('userActivityView')?.remove();
      state.adminMounted = false;
      return false;
    }
    if (state.adminMounted && $('userActivityTab') && $('userActivityView')) return true;
    const menu = document.querySelector('.grouped-view-tabs');
    const panels = document.querySelector('.content-panels');
    if (!menu || !panels) return false;
    const group = document.createElement('div');
    group.id = 'administrationUserActivityGroup';
    group.className = 'view-menu-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Administration modules');
    group.dataset.menuGroup = 'administration';
    group.innerHTML = `
      <button class="view-menu-group-title view-menu-group-toggle" type="button" aria-expanded="false" aria-controls="administrationUserActivityGroupBody">
        <span class="view-menu-group-label"><span class="view-menu-group-icon" aria-hidden="true">🛡️</span><span>Administration</span></span>
        <span class="view-menu-group-chevron" aria-hidden="true">▾</span>
      </button>
      <div id="administrationUserActivityGroupBody" class="view-menu-group-body">
        <button id="userActivityTab" class="view-tab" data-view="userActivity" role="tab" aria-selected="false" aria-controls="userActivityView">
          <span class="icon" aria-hidden="true">📊</span> User Activity
        </button>
      </div>`;
    menu.appendChild(group);
    const view = document.createElement('section');
    view.id = 'userActivityView';
    view.className = 'view ua-view';
    view.setAttribute('role', 'tabpanel');
    view.setAttribute('aria-labelledby', 'userActivityTab');
    view.innerHTML = `
      <div class="ua-page-shell">
        <header class="ua-page-header">
          <div><h1>User Activity</h1><p>Admin-only ERP usage, session, active/idle, navigation and meaningful action visibility.</p></div>
          <button id="userActivityRefreshBtn" class="btn ghost" type="button">↻ Refresh</button>
        </header>
        <section class="ua-summary-grid" aria-label="User activity summary">
          <article class="ua-summary-card"><span>Online Now</span><strong id="uaOnlineNow">0</strong><small>Active + signed in</small></article>
          <article class="ua-summary-card"><span>Idle Now</span><strong id="uaIdleNow">0</strong><small>Open but inactive</small></article>
          <article class="ua-summary-card"><span>Active Today</span><strong id="uaActiveToday">0</strong><small>Recorded ERP activity</small></article>
          <article class="ua-summary-card ua-warning-card"><span>Signed In · No Work</span><strong id="uaNoWork">0</strong><small>Session open, no activity yet</small></article>
        </section>
        <section class="card ua-filter-card">
          <div class="ua-filter-grid">
            <label><span>Date</span><input id="uaDateFilter" class="input" type="date" /></label>
            <label><span>User</span><select id="uaUserFilter" class="select"><option value="">All users</option></select></label>
            <label><span>Status</span><select id="uaStatusFilter" class="select"><option value="">All statuses</option><option value="active">Active</option><option value="idle">Idle</option><option value="signed_in">Signed in · no work</option><option value="offline">Offline</option></select></label>
          </div>
          <div id="uaState" class="muted">Loading user activity…</div>
        </section>
        <section class="card ua-table-card">
          <div class="ua-card-heading"><div><strong>User Usage</strong><span>Click a user row to inspect the timeline and module time.</span></div></div>
          <div class="table-wrap modern-table-scroll"><table class="ua-table"><thead><tr><th>User</th><th>Status</th><th>First Login</th><th>Last Activity</th><th>Last Used</th><th>Active</th><th>Idle</th><th>Current / Last Module</th><th>Device</th></tr></thead><tbody id="uaUsersTbody"></tbody></table></div>
        </section>
        <div class="ua-detail-grid">
          <section class="card ua-table-card">
            <div class="ua-card-heading"><div><strong id="uaTimelineTitle">Activity Timeline</strong><span id="uaTimelineSubtitle">Select a user above.</span></div></div>
            <div class="table-wrap modern-table-scroll"><table class="ua-table"><thead><tr><th>Time</th><th>Event</th><th>Module</th><th>Action</th><th>Detail</th></tr></thead><tbody id="uaTimelineTbody"><tr><td colspan="5" class="muted">Select a user to view activity.</td></tr></tbody></table></div>
          </section>
          <section class="card ua-table-card">
            <div class="ua-card-heading"><div><strong>Module Time</strong><span>Where the selected user spent the session.</span></div></div>
            <div class="table-wrap modern-table-scroll"><table class="ua-table"><thead><tr><th>Module</th><th>Active</th><th>Idle</th><th>Visits</th><th>Last Seen</th></tr></thead><tbody id="uaModuleTbody"><tr><td colspan="5" class="muted">Select a user to view module usage.</td></tr></tbody></table></div>
          </section>
        </div>
      </div>`;
    panels.appendChild(view);
    const groupToggle = group.querySelector('.view-menu-group-toggle');
    groupToggle?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const expanded = group.classList.toggle('is-expanded');
      groupToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
    $('userActivityTab')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      noteInteraction();
      activateAdminModule();
    });
    $('userActivityRefreshBtn')?.addEventListener('click', () => loadDashboard(true));
    $('uaDateFilter')?.addEventListener('change', () => { state.selectedUserId = ''; loadDashboard(true); });
    $('uaUserFilter')?.addEventListener('change', () => {
      state.selectedUserId = $('uaUserFilter')?.value || '';
      applyDashboardFilters();
      if (state.selectedUserId) void loadUserDetail(state.selectedUserId);
      else renderEmptyDetail();
    });
    $('uaStatusFilter')?.addEventListener('change', applyDashboardFilters);
    $('uaUsersTbody')?.addEventListener('click', event => {
      const row = event.target?.closest?.('tr[data-user-id]');
      if (!row) return;
      state.selectedUserId = row.dataset.userId || '';
      if ($('uaUserFilter')) $('uaUserFilter').value = state.selectedUserId;
      applyDashboardFilters();
      void loadUserDetail(state.selectedUserId);
    });
    const now = new Date();
    if ($('uaDateFilter')) $('uaDateFilter').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    state.adminMounted = true;
    if (location.hash === '#user-activity') window.setTimeout(() => activateAdminModule(), 0);
    return true;
  }

  function activateAdminModule() {
    if (!isAdmin() || !mountAdminModule()) return false;
    if (!state.coreSetActiveView && typeof window.setActiveView === 'function') state.coreSetActiveView = window.setActiveView.bind(window);
    try { state.coreSetActiveView?.('users'); } catch {}
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.view-tab').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); });
    $('userActivityView')?.classList.add('active');
    $('userActivityTab')?.classList.add('active');
    $('userActivityTab')?.setAttribute('aria-selected', 'true');
    const group = $('administrationUserActivityGroup');
    group?.classList.add('is-expanded');
    group?.querySelector('.view-menu-group-toggle')?.setAttribute('aria-expanded', 'true');
    try { history.replaceState(null, '', `${location.pathname}${location.search}#user-activity`); } catch { location.hash = '#user-activity'; }
    state.currentModule = 'userActivity';
    void syncModule(true);
    void loadDashboard(true);
    if (state.dashboardTimer) clearInterval(state.dashboardTimer);
    state.dashboardTimer = window.setInterval(() => {
      if ($('userActivityView')?.classList.contains('active')) void loadDashboard(false);
    }, CONFIG.dashboardRefreshMs);
    return true;
  }

  function deactivateAdminModule() {
    $('userActivityView')?.classList.remove('active');
    $('userActivityTab')?.classList.remove('active');
    $('userActivityTab')?.setAttribute('aria-selected', 'false');
    if (state.dashboardTimer) clearInterval(state.dashboardTimer);
    state.dashboardTimer = null;
  }

  let dashboardRows = [];

  function applyDashboardFilters() {
    const tbody = $('uaUsersTbody');
    if (!tbody) return;
    const userFilter = $('uaUserFilter')?.value || '';
    const statusFilter = $('uaStatusFilter')?.value || '';
    const rows = dashboardRows.filter(row => (!userFilter || row.userId === userFilter) && (!statusFilter || row.status === statusFilter));
    tbody.innerHTML = rows.length ? rows.map(row => `
      <tr data-user-id="${escapeHtml(row.userId)}" class="${row.userId === state.selectedUserId ? 'is-selected' : ''}">
        <td><strong>${escapeHtml(row.name || row.email || 'Unnamed user')}</strong><div class="muted ua-cell-sub">${escapeHtml(row.email || '')}</div></td>
        <td>${statusBadge(row.status)}</td>
        <td>${escapeHtml(row.firstLogin ? formatDateTime(row.firstLogin) : '—')}</td>
        <td title="${escapeHtml(row.lastActivity ? formatDateTime(row.lastActivity) : '')}">${escapeHtml(row.lastActivity ? relativeTime(row.lastActivity) : 'No activity')}</td>
        <td title="${escapeHtml(row.lastUsed ? formatDateTime(row.lastUsed) : '')}">${escapeHtml(row.lastUsed ? relativeTime(row.lastUsed) : 'Never')}</td>
        <td>${escapeHtml(formatDuration(row.activeSeconds))}</td>
        <td>${escapeHtml(formatDuration(row.idleSeconds))}</td>
        <td>${escapeHtml(moduleLabel(row.currentModule || '—'))}</td>
        <td>${escapeHtml(row.device || '—')}<div class="muted ua-cell-sub">${escapeHtml(row.os || '')}</div></td>
      </tr>`).join('') : '<tr><td colspan="9" class="muted">No users match the selected filters.</td></tr>';
  }

  async function loadDashboard(showLoading = false) {
    if (!isAdmin() || !$('userActivityView')) return false;
    const client = getClient();
    if (!client) return false;
    const date = $('uaDateFilter')?.value || '';
    const bounds = dateBounds(date);
    if (showLoading && $('uaState')) $('uaState').textContent = 'Loading user activity…';
    try {
      const [profilesResult, daySessionsResult, latestSessionsResult] = await Promise.all([
        client.from('profiles').select('id,name,full_name,email,role_key,is_active').eq('is_active', true).order('name', { ascending: true }),
        client.from('user_activity_sessions').select('*').gte('last_seen_at', bounds.start).lt('started_at', bounds.end).order('started_at', { ascending: true }).limit(CONFIG.maxSessions),
        client.from('user_activity_sessions').select('id,user_id,last_seen_at,last_interaction_at,current_module,activity_state,has_activity,ended_at,device_type,browser,operating_system').order('last_seen_at', { ascending: false }).limit(CONFIG.maxSessions)
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (daySessionsResult.error) throw daySessionsResult.error;
      if (latestSessionsResult.error) throw latestSessionsResult.error;
      const profiles = profilesResult.data || [];
      const daySessions = daySessionsResult.data || [];
      const latestSessions = latestSessionsResult.data || [];
      const byUser = new Map();
      daySessions.forEach(session => {
        const id = clean(session.user_id);
        if (!id) return;
        if (!byUser.has(id)) byUser.set(id, []);
        byUser.get(id).push(session);
      });
      const latestByUser = new Map();
      latestSessions.forEach(session => {
        const id = clean(session.user_id);
        if (id && !latestByUser.has(id)) latestByUser.set(id, session);
      });
      const todaySelected = isToday(date);
      dashboardRows = profiles.map(profile => {
        const userId = clean(profile.id);
        const sessions = byUser.get(userId) || [];
        const latestDay = sessions.slice().sort((a, b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))[0] || null;
        const latestEver = latestByUser.get(userId) || null;
        return {
          userId,
          name: clean(profile.name || profile.full_name),
          email: clean(profile.email),
          status: statusForSession(latestDay, todaySelected),
          firstLogin: sessions.length ? sessions.map(s => s.started_at).filter(Boolean).sort()[0] : null,
          lastActivity: sessions.map(s => s.last_interaction_at).filter(Boolean).sort().at(-1) || null,
          lastUsed: latestEver?.last_seen_at || null,
          activeSeconds: sessions.reduce((sum, s) => sum + Number(s.active_seconds || 0), 0),
          idleSeconds: sessions.reduce((sum, s) => sum + Number(s.idle_seconds || 0), 0),
          currentModule: latestDay?.current_module || latestEver?.current_module || '',
          device: [latestDay?.device_type || latestEver?.device_type, latestDay?.browser || latestEver?.browser].filter(Boolean).join(' · '),
          os: latestDay?.operating_system || latestEver?.operating_system || '',
          hasDaySession: sessions.length > 0,
          hasActivity: sessions.some(s => Boolean(s.has_activity))
        };
      });
      const onlineNow = dashboardRows.filter(r => r.status === 'active' || r.status === 'signed_in').length;
      const idleNow = dashboardRows.filter(r => r.status === 'idle').length;
      const activeToday = dashboardRows.filter(r => r.activeSeconds > 0 || r.hasActivity).length;
      const noWork = dashboardRows.filter(r => r.status === 'signed_in').length;
      if ($('uaOnlineNow')) $('uaOnlineNow').textContent = String(onlineNow);
      if ($('uaIdleNow')) $('uaIdleNow').textContent = String(idleNow);
      if ($('uaActiveToday')) $('uaActiveToday').textContent = String(activeToday);
      if ($('uaNoWork')) $('uaNoWork').textContent = String(noWork);
      const select = $('uaUserFilter');
      if (select) {
        const current = state.selectedUserId || select.value || '';
        select.innerHTML = '<option value="">All users</option>' + profiles.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(clean(p.name || p.full_name || p.email || p.id))}</option>`).join('');
        if ([...select.options].some(o => o.value === current)) select.value = current;
      }
      applyDashboardFilters();
      if ($('uaState')) $('uaState').textContent = `Showing ${dashboardRows.length} active ERP account${dashboardRows.length === 1 ? '' : 's'} · ${formatDateTime(new Date())}`;
      if (state.selectedUserId) void loadUserDetail(state.selectedUserId);
      return true;
    } catch (error) {
      console.error('[UserActivity] dashboard load failed', error);
      if ($('uaState')) $('uaState').textContent = `Unable to load activity: ${error?.message || error}`;
      return false;
    }
  }

  function renderEmptyDetail() {
    if ($('uaTimelineTitle')) $('uaTimelineTitle').textContent = 'Activity Timeline';
    if ($('uaTimelineSubtitle')) $('uaTimelineSubtitle').textContent = 'Select a user above.';
    if ($('uaTimelineTbody')) $('uaTimelineTbody').innerHTML = '<tr><td colspan="5" class="muted">Select a user to view activity.</td></tr>';
    if ($('uaModuleTbody')) $('uaModuleTbody').innerHTML = '<tr><td colspan="5" class="muted">Select a user to view module usage.</td></tr>';
  }

  async function loadUserDetail(userId) {
    if (!isAdmin() || !userId) return false;
    const client = getClient();
    if (!client) return false;
    const date = $('uaDateFilter')?.value || '';
    const bounds = dateBounds(date);
    const row = dashboardRows.find(item => item.userId === userId);
    if ($('uaTimelineTitle')) $('uaTimelineTitle').textContent = row?.name ? `${row.name} · Activity Timeline` : 'Activity Timeline';
    if ($('uaTimelineSubtitle')) $('uaTimelineSubtitle').textContent = row?.email || '';
    if ($('uaTimelineTbody')) $('uaTimelineTbody').innerHTML = '<tr><td colspan="5" class="muted">Loading timeline…</td></tr>';
    if ($('uaModuleTbody')) $('uaModuleTbody').innerHTML = '<tr><td colspan="5" class="muted">Loading module usage…</td></tr>';
    try {
      const [eventsResult, usageResult] = await Promise.all([
        client.from('user_activity_events').select('*').eq('user_id', userId).gte('occurred_at', bounds.start).lt('occurred_at', bounds.end).order('occurred_at', { ascending: false }).limit(CONFIG.maxEvents),
        client.from('user_module_usage').select('*').eq('user_id', userId).gte('last_seen_at', bounds.start).lt('started_at', bounds.end).order('started_at', { ascending: false }).limit(CONFIG.maxUsageRows)
      ]);
      if (eventsResult.error) throw eventsResult.error;
      if (usageResult.error) throw usageResult.error;
      const events = eventsResult.data || [];
      const usage = usageResult.data || [];
      if ($('uaTimelineTbody')) {
        $('uaTimelineTbody').innerHTML = events.length ? events.map(event => `
          <tr><td>${escapeHtml(formatDateTime(event.occurred_at))}</td><td>${escapeHtml(clean(event.event_type).replace(/_/g, ' '))}</td><td>${escapeHtml(moduleLabel(event.module || 'unknown'))}</td><td>${escapeHtml(event.action || '—')}</td><td>${escapeHtml(event.label || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">No meaningful activity recorded for this user on the selected date.</td></tr>';
      }
      const moduleMap = new Map();
      usage.forEach(segment => {
        const key = clean(segment.module) || 'unknown';
        const current = moduleMap.get(key) || { module: key, active: 0, idle: 0, visits: 0, lastSeen: null };
        current.active += Number(segment.active_seconds || 0);
        current.idle += Number(segment.idle_seconds || 0);
        current.visits += 1;
        if (!current.lastSeen || new Date(segment.last_seen_at || 0) > new Date(current.lastSeen || 0)) current.lastSeen = segment.last_seen_at;
        moduleMap.set(key, current);
      });
      const modules = [...moduleMap.values()].sort((a, b) => b.active - a.active || b.visits - a.visits);
      if ($('uaModuleTbody')) {
        $('uaModuleTbody').innerHTML = modules.length ? modules.map(item => `<tr><td><strong>${escapeHtml(moduleLabel(item.module))}</strong></td><td>${escapeHtml(formatDuration(item.active))}</td><td>${escapeHtml(formatDuration(item.idle))}</td><td>${item.visits}</td><td>${escapeHtml(item.lastSeen ? relativeTime(item.lastSeen) : '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">No module usage recorded for this user on the selected date.</td></tr>';
      }
      return true;
    } catch (error) {
      console.error('[UserActivity] detail load failed', error);
      if ($('uaTimelineTbody')) $('uaTimelineTbody').innerHTML = `<tr><td colspan="5" class="muted">Unable to load timeline: ${escapeHtml(error?.message || error)}</td></tr>`;
      if ($('uaModuleTbody')) $('uaModuleTbody').innerHTML = '<tr><td colspan="5" class="muted">Unable to load module usage.</td></tr>';
      return false;
    }
  }

  async function ensureStarted() {
    if (!isAuthenticated()) return false;
    if (!state.trackerStarted) await initializeSession();
    mountAdminModule();
    return state.trackerStarted;
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    state.coreSetActiveView = typeof window.setActiveView === 'function' ? window.setActiveView.bind(window) : null;
    const originalGlobalSetActiveView = window.setActiveView;
    if (typeof originalGlobalSetActiveView === 'function' && !originalGlobalSetActiveView.__userActivityWrapped) {
      const wrapped = function(view, ...args) {
        if (clean(view) === 'userActivity') return activateAdminModule();
        deactivateAdminModule();
        const result = originalGlobalSetActiveView.call(this, view, ...args);
        window.setTimeout(() => void syncModule(false), 20);
        return result;
      };
      wrapped.__userActivityWrapped = true;
      window.setActiveView = wrapped;
    }
    document.addEventListener('click', event => {
      const tab = event.target?.closest?.('.view-tab');
      if (tab && tab.id !== 'userActivityTab' && $('userActivityView')?.classList.contains('active')) deactivateAdminModule();
    }, true);
    if (window.Session?.subscribe) {
      state.sessionUnsubscribe = window.Session.subscribe((_user, detail = {}) => {
        if (detail.reason === 'signed_out') {
          void finishSession('signed_out');
          mountAdminModule();
          return;
        }
        window.setTimeout(() => void ensureStarted(), 0);
      });
    }
    const tryStart = () => {
      if (isAuthenticated()) void ensureStarted();
    };
    tryStart();
    if (document.body && typeof MutationObserver !== 'undefined') {
      state.authObserver = new MutationObserver(tryStart);
      state.authObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('hashchange', () => {
      if (location.hash === '#user-activity' && isAdmin()) activateAdminModule();
    });
  }

  return Object.freeze({
    install,
    refresh: () => loadDashboard(true),
    activate: activateAdminModule,
    heartbeat: () => heartbeat({ force: true }),
    getState: () => ({
      sessionId: state.sessionId,
      userId: state.userId,
      activityState: state.activityState,
      hasActivity: state.hasActivity,
      currentModule: state.currentModule,
      activeSeconds: state.activeSeconds,
      idleSeconds: state.idleSeconds
    })
  });
})();

UserActivity.install();
window.UserActivity = UserActivity;

export { UserActivity };
