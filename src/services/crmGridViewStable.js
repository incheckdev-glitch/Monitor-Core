(function installStableCrmGridView(global) {
  const CONFIG = {
    leads: {
      controller: 'Leads', viewId: 'leadsView', tableSelector: '#leadsTable',
      storageKey: 'incheck360OperationsPortal.leadsViewMode', title: 'Leads Pipeline', singular: 'lead',
      lanes: [
        { key: 'not contacted yet', label: 'Not Contacted Yet', tone: 'info' },
        { key: 'not available', label: 'Not Available', tone: 'neutral' },
        { key: 'negotiation', label: 'Negotiation', tone: 'warning' },
        { key: 'qualified', label: 'Qualified', tone: 'success' },
        { key: 'lost', label: 'Lost', tone: 'danger' }
      ]
    },
    deals: {
      controller: 'Deals', viewId: 'dealsView', tableSelector: '#dealsTable',
      storageKey: 'incheck360OperationsPortal.dealsViewMode', title: 'Deals Pipeline', singular: 'deal',
      lanes: [
        { key: 'new', label: 'New', tone: 'info' },
        { key: 'in progress', label: 'In Progress', tone: 'warning' },
        { key: 'qualified', label: 'Qualified', tone: 'success' },
        { key: 'lost', label: 'Lost', tone: 'danger' }
      ]
    }
  };

  const patched = new Set();
  const lastSignatures = new Map();
  const syncTimers = new Map();
  let patchTimer = 0;
  let authObserver = null;

  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const norm = value => text(value).toLowerCase();
  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function controllerFor(key) {
    const config = CONFIG[key];
    return config ? global[config.controller] : null;
  }

  function readMode(key) {
    try { return global.localStorage?.getItem(CONFIG[key].storageKey) === 'grid' ? 'grid' : 'list'; }
    catch (_) { return 'list'; }
  }

  function saveMode(key, mode) {
    try { global.localStorage?.setItem(CONFIG[key].storageKey, mode); } catch (_) {}
  }

  function canonicalLane(key, row = {}) {
    if (key === 'leads') {
      const controller = controllerFor(key);
      const status = controller?.normalizeLeadStatus ? controller.normalizeLeadStatus(row.status) : norm(row.status);
      return norm(status || 'not contacted yet');
    }
    const stage = norm(row.stage || row.deal_stage || 'new');
    if (['in-progress', 'in_progress', 'progress'].includes(stage)) return 'in progress';
    return stage || 'new';
  }

  function currentRows(controller) {
    if (!controller) return [];
    if (Array.isArray(controller.state?.filteredRows)) return controller.state.filteredRows;
    return Array.isArray(controller.state?.rows) ? controller.state.rows : [];
  }

  function recordId(key, row = {}) {
    return text(row.id || (key === 'leads' ? row.lead_id : row.deal_id));
  }

  function formatMoney(row = {}) {
    const amount = Number(row.estimated_value ?? row.estimatedValue);
    if (!Number.isFinite(amount)) return '—';
    const currency = text(row.currency).toUpperCase();
    const value = amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return currency ? `${currency} ${value}` : value;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return text(value).slice(0, 10) || '—';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function initials(value) {
    const parts = text(value).split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    return `${parts[0]?.[0] || ''}${parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : ''}`.toUpperCase();
  }

  function toneForPriority(value) {
    const priority = norm(value);
    if (priority === 'high' || priority === 'urgent') return 'danger';
    if (priority === 'medium') return 'warning';
    if (priority === 'low') return 'success';
    return 'neutral';
  }

  function findListRegion(view, table) {
    return table?.closest(
      '.icds-table-shell,.icds-module-data,.leads-table-wrap,.deals-table-wrap,.table-wrap,.table-wrapper,.table-responsive,.table-container,.data-table-wrap,[class*="table-wrap"],[class*="table-container"]'
    ) || table || null;
  }

  function preferredSwitchHost(view) {
    return view?.querySelector('.icds-module-header [data-icds-header-actions]') ||
      view?.querySelector('.icds-module-header .icds-toolbar') ||
      view?.querySelector('.icds-module-header') ||
      view?.querySelector('.leads-header-actions,.deals-header-actions,.page-header,.section-header,.view-header,.module-header') || view;
  }

  function ensureSwitch(key, view) {
    const id = `${key}ViewModeSwitch`;
    let root = document.getElementById(id);
    if (!root) {
      root = document.createElement('div');
      root.id = id;
      root.className = 'ic-crm-view-switch';
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', `${key === 'leads' ? 'Leads' : 'Deals'} view mode`);
      root.innerHTML = `<button type="button" class="ic-crm-view-btn" data-crm-view-key="${key}" data-crm-view-mode="list" aria-pressed="true"><span aria-hidden="true">☷</span><span>List View</span></button><button type="button" class="ic-crm-view-btn" data-crm-view-key="${key}" data-crm-view-mode="grid" aria-pressed="false"><span aria-hidden="true">▦</span><span>Grid View</span></button>`;
    }
    const create = document.getElementById(key === 'leads' ? 'leadsCreateBtn' : 'dealsCreateBtn');
    if (create?.parentElement) {
      if (root.parentElement !== create.parentElement || root.nextElementSibling !== create) create.parentElement.insertBefore(root, create);
    } else {
      const host = preferredSwitchHost(view);
      if (host && root.parentElement !== host) host.appendChild(root);
    }
    return root;
  }

  function ensureGridHost(key, view, listRegion) {
    const id = `${key}GridView`;
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('section');
      host.id = id;
      host.className = 'ic-crm-grid-view';
      host.dataset.crmGridModule = key;
      host.hidden = true;
      if (listRegion?.parentNode) listRegion.parentNode.insertBefore(host, listRegion.nextSibling);
      else view.appendChild(host);
    } else if (listRegion?.parentNode && host.previousElementSibling !== listRegion) {
      listRegion.parentNode.insertBefore(host, listRegion.nextSibling);
    }
    return host;
  }

  function gridSignature(key, controller) {
    const loading = Boolean(controller?.state?.loading);
    const error = text(controller?.state?.loadError);
    const rows = currentRows(controller);
    const parts = rows.map(row => [
      recordId(key, row), row.status, row.stage, row.deal_stage, row.company_name, row.customer_legal_name,
      row.customer_name, row.full_name, row.contact_name, row.estimated_value, row.estimatedValue,
      row.currency, row.priority, row.assigned_to, row.next_follow_up, row.next_follow_up_at,
      row.next_follow_up_date, row.nextFollowUp, row.nextFollowUpAt, row.updated_at, row.updatedAt
    ].map(text).join('\u001f'));
    return `${loading ? '1' : '0'}\u001d${error}\u001d${parts.join('\u001e')}`;
  }

  function cardMarkup(key, row = {}) {
    const id = recordId(key, row);
    const company = text(row.company_name || row.customer_legal_name || row.customer_name) || 'No company';
    const contact = text(row.full_name || row.contact_name) || 'No contact';
    const ref = text(key === 'leads' ? row.lead_id : row.deal_id) || '—';
    const lane = canonicalLane(key, row);
    const statusLabel = CONFIG[key].lanes.find(item => item.key === lane)?.label || text(key === 'leads' ? row.status : row.stage) || 'Other';
    const priority = text(row.priority) || 'No priority';
    const assignee = text(row.assigned_to) || 'Unassigned';
    const followUp = key === 'leads' ? (row.next_follow_up || row.next_follow_up_at || row.nextFollowUp) : (row.next_follow_up_at || row.next_follow_up_date || row.nextFollowUpAt);
    const isOverdue = (() => {
      if (!followUp || ['lost', 'qualified'].includes(lane)) return false;
      const date = new Date(followUp);
      return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
    })();

    return `<article class="ic-crm-kanban-card" role="button" tabindex="0" data-crm-grid-record="${esc(id)}" data-crm-grid-module="${key}" aria-label="Open ${esc(CONFIG[key].singular)} ${esc(ref)} details"><div class="ic-crm-kanban-card-top"><span class="ic-crm-record-ref">${esc(ref)}</span><span class="ic-crm-card-status" data-tone="${CONFIG[key].lanes.find(item => item.key === lane)?.tone || 'neutral'}">${esc(statusLabel)}</span></div><strong class="ic-crm-card-company" title="${esc(company)}">${esc(company)}</strong><div class="ic-crm-card-contact"><span class="ic-crm-avatar">${esc(initials(contact))}</span><span title="${esc(contact)}">${esc(contact)}</span></div><div class="ic-crm-card-facts"><div><span>Value</span><strong>${esc(formatMoney(row))}</strong></div><div class="${isOverdue ? 'is-overdue' : ''}"><span>Next Follow-up</span><strong>${esc(formatDate(followUp))}</strong></div></div><div class="ic-crm-card-footer"><span class="ic-crm-priority" data-tone="${toneForPriority(priority)}">${esc(priority)}</span><span class="ic-crm-assignee" title="${esc(assignee)}"><span class="ic-crm-assignee-avatar">${esc(initials(assignee))}</span><span>${esc(assignee)}</span></span></div></article>`;
  }

  function captureScroll(host) {
    const kanban = host.querySelector('.ic-crm-kanban');
    const lanes = Array.from(host.querySelectorAll('.ic-crm-kanban-lane')).map(lane => ({
      label: text(lane.querySelector('.ic-crm-kanban-lane-head strong')?.textContent),
      top: lane.querySelector('.ic-crm-kanban-cards')?.scrollTop || 0
    }));
    return { left: kanban?.scrollLeft || 0, lanes };
  }

  function restoreScroll(host, state) {
    const kanban = host.querySelector('.ic-crm-kanban');
    if (kanban) kanban.scrollLeft = state?.left || 0;
    (state?.lanes || []).forEach(saved => {
      const lane = Array.from(host.querySelectorAll('.ic-crm-kanban-lane')).find(item => text(item.querySelector('.ic-crm-kanban-lane-head strong')?.textContent) === saved.label);
      const cards = lane?.querySelector('.ic-crm-kanban-cards');
      if (cards) cards.scrollTop = saved.top || 0;
    });
  }

  function renderGrid(key, host, force = false) {
    const config = CONFIG[key];
    const controller = controllerFor(key);
    if (!config || !controller || !host) return false;
    const signature = gridSignature(key, controller);
    if (!force && lastSignatures.get(key) === signature && host.childElementCount) return false;

    const scroll = captureScroll(host);
    let html = '';
    if (controller.state?.loading) {
      html = `<div class="ic-crm-grid-panel"><div class="ic-crm-grid-heading"><div><span class="ic-crm-grid-heading-icon">▦</span><strong>${esc(config.title)}</strong></div><span>Loading…</span></div><div class="ic-crm-kanban">${config.lanes.map(lane => `<section class="ic-crm-kanban-lane" data-tone="${lane.tone}"><div class="ic-crm-kanban-lane-head"><div><span class="ic-crm-lane-dot"></span><strong>${esc(lane.label)}</strong></div><span class="ic-crm-lane-count">…</span></div><div class="ic-crm-kanban-cards"><div class="ic-crm-grid-skeleton"></div></div></section>`).join('')}</div></div>`;
    } else if (controller.state?.loadError) {
      html = `<div class="ic-crm-grid-empty">${esc(controller.state.loadError)}</div>`;
    } else {
      const rows = currentRows(controller);
      const laneRows = new Map(config.lanes.map(lane => [lane.key, []]));
      const otherRows = [];
      rows.forEach(row => {
        const laneKey = canonicalLane(key, row);
        if (laneRows.has(laneKey)) laneRows.get(laneKey).push(row);
        else otherRows.push(row);
      });
      const lanes = [...config.lanes];
      if (otherRows.length) lanes.push({ key: '__other__', label: 'Other', tone: 'neutral' });
      html = `<div class="ic-crm-grid-panel"><div class="ic-crm-grid-heading"><div><span class="ic-crm-grid-heading-icon">▦</span><strong>${esc(config.title)}</strong></div><span>${rows.length} ${rows.length === 1 ? 'record' : 'records'}</span></div><div class="ic-crm-kanban" aria-label="${esc(config.title)} grid view">${lanes.map(lane => { const items = lane.key === '__other__' ? otherRows : (laneRows.get(lane.key) || []); return `<section class="ic-crm-kanban-lane" data-tone="${lane.tone}"><div class="ic-crm-kanban-lane-head"><div><span class="ic-crm-lane-dot"></span><strong>${esc(lane.label)}</strong></div><span class="ic-crm-lane-count">${items.length}</span></div><div class="ic-crm-kanban-cards">${items.length ? items.map(row => cardMarkup(key, row)).join('') : '<div class="ic-crm-lane-empty">No records in this stage</div>'}</div></section>`; }).join('')}</div></div>`;
    }

    if (host.innerHTML !== html) host.innerHTML = html;
    lastSignatures.set(key, signature);
    requestAnimationFrame(() => restoreScroll(host, scroll));
    return true;
  }

  function applyMode(key, requestedMode, { persist = true, forceRender = false } = {}) {
    const config = CONFIG[key];
    const view = document.getElementById(config?.viewId || '');
    const table = view?.querySelector(config?.tableSelector || '');
    if (!config || !view || !table) return;

    const mode = requestedMode === 'grid' ? 'grid' : 'list';
    if (persist) saveMode(key, mode);
    if (view.dataset.crmViewMode !== mode) view.dataset.crmViewMode = mode;

    const listRegion = findListRegion(view, table);
    const hide = mode === 'grid';
    if (listRegion && listRegion.classList.contains('ic-crm-list-hidden') !== hide) listRegion.classList.toggle('ic-crm-list-hidden', hide);
    const gridHost = ensureGridHost(key, view, listRegion);
    if (gridHost.hidden === (mode === 'grid')) gridHost.hidden = mode !== 'grid';

    const switchRoot = ensureSwitch(key, view);
    switchRoot.querySelectorAll('[data-crm-view-mode]').forEach(button => {
      const active = button.dataset.crmViewMode === mode;
      if (button.classList.contains('is-active') !== active) button.classList.toggle('is-active', active);
      if (button.getAttribute('aria-pressed') !== String(active)) button.setAttribute('aria-pressed', String(active));
    });

    if (mode === 'grid') renderGrid(key, gridHost, forceRender);
  }

  function syncModule(key, forceRender = false) {
    applyMode(key, readMode(key), { persist: false, forceRender });
  }

  function scheduleSync(key, delay = 35) {
    const existing = syncTimers.get(key);
    if (existing) global.clearTimeout(existing);
    syncTimers.set(key, global.setTimeout(() => {
      syncTimers.delete(key);
      syncModule(key, false);
    }, delay));
  }

  function openRecord(key, id) {
    const controller = controllerFor(key);
    if (!controller || !id) return;
    const rows = [...(Array.isArray(controller.state?.rows) ? controller.state.rows : []), ...(Array.isArray(controller.state?.filteredRows) ? controller.state.filteredRows : [])];
    const row = rows.find(item => [item?.id, key === 'leads' ? item?.lead_id : item?.deal_id].some(value => text(value) === text(id)));
    if (key === 'leads') controller.openDetails?.(row || id);
    else controller.openDetailsDrawer?.(row || id);
  }

  function patchController(key) {
    const controller = controllerFor(key);
    if (!controller || patched.has(key)) return false;
    if (typeof controller.render === 'function' && !controller.__icCrmGridStablePatched) {
      const originalRender = controller.render;
      controller.render = function stableCrmGridRender(...args) {
        const result = originalRender.apply(this, args);
        scheduleSync(key, 20);
        return result;
      };
      controller.__icCrmGridStablePatched = true;
    }
    patched.add(key);
    scheduleSync(key, 0);
    return true;
  }

  function patchAvailableControllers() {
    Object.keys(CONFIG).forEach(patchController);
    if (patched.size === Object.keys(CONFIG).length && patchTimer) {
      global.clearInterval(patchTimer);
      patchTimer = 0;
    }
  }

  function bindEvents() {
    if (document.documentElement.dataset.icCrmGridStableBound === '1') return;
    document.documentElement.dataset.icCrmGridStableBound = '1';
    document.addEventListener('click', event => {
      const modeButton = event.target?.closest?.('[data-crm-view-key][data-crm-view-mode]');
      if (modeButton) {
        event.preventDefault();
        applyMode(modeButton.dataset.crmViewKey, modeButton.dataset.crmViewMode, { persist: true, forceRender: modeButton.dataset.crmViewMode === 'grid' });
        return;
      }
      const card = event.target?.closest?.('[data-crm-grid-record][data-crm-grid-module]');
      if (card) {
        event.preventDefault();
        openRecord(card.dataset.crmGridModule, card.dataset.crmGridRecord);
        return;
      }
      if (event.target?.closest?.('.view-tab,[role="tab"]')) Object.keys(CONFIG).forEach(key => scheduleSync(key, 60));
    });

    document.addEventListener('keydown', event => {
      const card = event.target?.closest?.('[data-crm-grid-record][data-crm-grid-module]');
      if (!card || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openRecord(card.dataset.crmGridModule, card.dataset.crmGridRecord);
    });
  }

  function start() {
    if (!document.body || document.body.classList.contains('auth-locked')) return;
    bindEvents();
    patchAvailableControllers();
    if (!patchTimer && patched.size < Object.keys(CONFIG).length) patchTimer = global.setInterval(patchAvailableControllers, 700);
    Object.keys(CONFIG).forEach(key => scheduleSync(key, 250));
  }

  function watchAuth() {
    if (!document.body || authObserver || typeof MutationObserver === 'undefined') return;
    authObserver = new MutationObserver(() => {
      if (!document.body.classList.contains('auth-locked')) start();
    });
    authObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function boot() {
    start();
    watchAuth();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  global.InCheck360CrmGridView = Object.freeze({
    setMode: (key, mode) => applyMode(key, mode, { persist: true, forceRender: mode === 'grid' }),
    refresh: key => key ? scheduleSync(key, 0) : Object.keys(CONFIG).forEach(name => scheduleSync(name, 0))
  });
})(window);
