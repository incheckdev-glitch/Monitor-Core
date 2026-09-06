(function installStableAllModuleGridView(global) {
  const SPECIAL_VIEW_IDS = new Set(['leadsView', 'dealsView']);
  const CONTEXT_SELECTOR = [
    '[role="tabpanel"]','[data-tab-panel]','[data-tab-content]','.tab-pane','.tab-panel',
    '.subtab-panel','.sub-tab-panel','.tabs-panel','[id$="TabPanel"]','[id$="TabContent"]',
    '[id*="TabPanel"]','[id*="TabContent"]','.icds-module-page','[id$="View"]',
    '.module-view','.workspace-view','.view'
  ].join(',');
  const STORAGE_PREFIX = 'incheck360OperationsPortal.tableViewMode.';
  const registry = new Map();
  let observer = null;
  let scanTimer = 0;
  let autoId = 0;

  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const norm = value => text(value).toLowerCase();
  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const slug = value => norm(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table';

  function authenticated() {
    return Boolean(document.body && !document.body.classList.contains('auth-locked'));
  }

  function eligibleTable(table) {
    if (!(table instanceof HTMLTableElement)) return false;
    if (table.closest('.modal,[role="dialog"],.drawer,.print-preview,[data-print-preview],.pdf-preview,.fc,.fullcalendar,.ic-module-grid-view,.ic-crm-grid-view')) return false;
    const view = table.closest('[id$="View"]');
    if (view && SPECIAL_VIEW_IDS.has(view.id)) return false;
    return table.querySelectorAll('thead th').length >= 2;
  }

  function contextFor(table) {
    return table.closest(CONTEXT_SELECTOR) || table.closest('main') || document.body;
  }

  function tableScore(table) {
    const cols = table.querySelectorAll('thead th').length;
    const rows = table.querySelectorAll('tbody tr').length;
    const idBoost = /table/i.test(`${table.id} ${table.className}`) ? 20 : 0;
    const shellBoost = table.closest('.icds-module-data,.icds-table-shell,.table-wrap,.table-wrapper,.table-responsive,.table-container') ? 10 : 0;
    return cols * 5 + Math.min(rows, 30) + idBoost + shellBoost;
  }

  function groupedContexts() {
    const groups = new Map();
    document.querySelectorAll('table').forEach(table => {
      if (!eligibleTable(table)) return;
      const context = contextFor(table);
      if (!groups.has(context)) groups.set(context, []);
      groups.get(context).push(table);
    });
    return groups;
  }

  function primaryTable(tables) {
    return [...tables].sort((a, b) => tableScore(b) - tableScore(a))[0] || null;
  }

  function contextKey(context, table) {
    if (!context.dataset.icGridContextKey) {
      const base = context.id || context.getAttribute('aria-label') || `context-${++autoId}`;
      context.dataset.icGridContextKey = slug(base);
    }
    return `${context.dataset.icGridContextKey}-${slug(table.id || table.getAttribute('aria-label') || 'table')}`;
  }

  function contextLabel(context, table) {
    const heading = context.querySelector(
      '.icds-module-header h1,.icds-module-header h2,[class*="page-header"] h1,[class*="page-header"] h2,' +
      '.section-header h1,.section-header h2,.view-header h1,.view-header h2,:scope>h1,:scope>h2,:scope>h3'
    );
    if (text(heading?.textContent)) return text(heading.textContent);
    const caption = table.querySelector('caption');
    if (text(caption?.textContent)) return text(caption.textContent);
    return text(context.getAttribute('aria-label') || context.id || table.id || 'Records').replace(/View$|Table$/i, '');
  }

  function listRegion(table) {
    return table.closest(
      '.icds-table-shell,.icds-module-data,.table-wrap,.table-wrapper,.table-responsive,.table-container,' +
      '.data-table-wrap,[class*="table-wrap"],[class*="table-container"]'
    ) || table;
  }

  function actionText(el) {
    return text(el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title'));
  }

  function createAction(context) {
    const explicit = [
      '#companyCreateBtn','#contactsCreateBtn','button[id*="CreateBtn"]','button[id*="createBtn"]',
      'button[id*="AddBtn"]','button[id*="addBtn"]','button[data-permission-action="create"]',
      'a[data-permission-action="create"]','button[data-action*="create"]','a[data-action*="create"]'
    ];
    for (const selector of explicit) {
      const el = context.querySelector(selector);
      if (el && !el.closest('table,.modal,[role="dialog"],.ic-module-grid-view')) return el;
    }
    return Array.from(context.querySelectorAll('button,a,[role="button"]')).find(el => {
      if (el.closest('table,.modal,[role="dialog"],.drawer,.ic-module-grid-view,.ic-crm-view-switch,.ic-all-view-switch')) return false;
      return /^(create|new|add)\b/i.test(actionText(el).replace(/^[^A-Za-z0-9]+/, '').trim());
    }) || null;
  }

  function headerHost(context) {
    return context.querySelector(
      '.icds-module-header [data-icds-header-actions],.icds-module-header .icds-toolbar,' +
      '.company-page-header,.contacts-page-header,[class$="-page-header"],[class*=" page-header"],' +
      '.page-header,.section-header,.view-header,.module-header,.actions-bar,.page-actions,.section-actions'
    ) || context;
  }

  function positionSwitch(context, root) {
    const create = createAction(context);
    if (create?.parentElement) {
      if (root.parentElement !== create.parentElement || root.nextElementSibling !== create) {
        create.parentElement.insertBefore(root, create);
      }
      return;
    }
    const host = headerHost(context);
    if (host && root.parentElement !== host) host.appendChild(root);
  }

  function readMode(key) {
    try { return global.localStorage?.getItem(`${STORAGE_PREFIX}${key}`) === 'grid' ? 'grid' : 'list'; }
    catch (_) { return 'list'; }
  }

  function saveMode(key, mode) {
    try { global.localStorage?.setItem(`${STORAGE_PREFIX}${key}`, mode); } catch (_) {}
  }

  function ensureSwitch(context, table, key) {
    const id = `icAllViewSwitch-${key}`;
    let root = document.getElementById(id);
    if (!root) {
      root = document.createElement('div');
      root.id = id;
      root.className = 'ic-crm-view-switch ic-all-view-switch';
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', `${contextLabel(context, table)} view mode`);
      root.innerHTML =
        `<button type="button" class="ic-crm-view-btn" data-all-view-key="${esc(key)}" data-all-view-mode="list" aria-pressed="true"><span aria-hidden="true">☷</span><span>List View</span></button>` +
        `<button type="button" class="ic-crm-view-btn" data-all-view-key="${esc(key)}" data-all-view-mode="grid" aria-pressed="false"><span aria-hidden="true">▦</span><span>Grid View</span></button>`;
    }
    positionSwitch(context, root);
    return root;
  }

  function ensureGridHost(context, table, key) {
    const region = listRegion(table);
    const id = `icModuleGrid-${key}`;
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('section');
      host.id = id;
      host.className = 'ic-module-grid-view';
      host.dataset.moduleGridKey = key;
      host.hidden = true;
      if (region.parentNode) region.parentNode.insertBefore(host, region.nextSibling);
      else context.appendChild(host);
    } else if (region.parentNode && host.previousElementSibling !== region) {
      region.parentNode.insertBefore(host, region.nextSibling);
    }
    return host;
  }

  function headersFor(table) {
    return Array.from(table.querySelectorAll('thead th')).map((th, index) => text(th.textContent) || `Field ${index + 1}`);
  }

  function sourceRows(table) {
    return Array.from(table.querySelectorAll('tbody tr')).filter(row => {
      if (row.hidden || row.classList.contains('skeleton-row') || row.style.display === 'none') return false;
      const cells = row.querySelectorAll(':scope > td');
      if (!cells.length) return false;
      if (cells.length === 1 && /no .*found|no records|loading|unable to load|no .*show/i.test(text(cells[0].textContent))) return false;
      return true;
    });
  }

  function cellValues(row) {
    return Array.from(row.querySelectorAll(':scope > td')).map(td => text(td.textContent));
  }

  function dataSignature(table) {
    const headers = headersFor(table);
    const rows = sourceRows(table);
    return `${headers.join('\u001f')}\u001d${rows.map(row => cellValues(row).join('\u001f')).join('\u001e')}`;
  }

  function groupIndex(headers, rows) {
    const matchers = [/^stage$/i,/^status$/i,/status/i,/^priority$/i,/^state$/i,/^type$/i,/^category$/i,/verification/i];
    for (const matcher of matchers) {
      const idx = headers.findIndex(label => matcher.test(label));
      if (idx < 0) continue;
      const values = [...new Set(rows.map(row => cellValues(row)[idx]).filter(Boolean))];
      if (values.length >= 2 && values.length <= 12) return idx;
    }
    return -1;
  }

  function tone(value) {
    const v = norm(value);
    if (/paid|active|approved|accepted|signed|won|qualified|complete|completed|resolved|verified|settled|received/.test(v)) return 'success';
    if (/overdue|late|rejected|lost|failed|cancel|expired|critical|blocked|error|inactive|unverified/.test(v)) return 'danger';
    if (/pending|due|review|hold|negotiation|progress|scheduled|medium/.test(v)) return 'warning';
    if (/draft|new|open|prospect|sent|lead|processing|info/.test(v)) return 'info';
    return 'neutral';
  }

  function primaryIndex(headers) {
    const preferred = [/company name/i,/client name/i,/customer/i,/contact name/i,/full name/i,/employee name/i,/^name$/i,/title/i,/subject/i,/description/i,/invoice/i,/proposal/i,/agreement/i,/ticket/i,/receipt/i,/id$/i];
    for (const matcher of preferred) {
      const idx = headers.findIndex(label => matcher.test(label));
      if (idx >= 0) return idx;
    }
    return 0;
  }

  function referenceIndex(headers, primary) {
    const idx = headers.findIndex((label, i) => i !== primary && /(^|\s)(id|number|no\.?|ref|code)(\s|$)/i.test(label));
    return idx >= 0 ? idx : (primary === 0 ? 1 : 0);
  }

  function cardMarkup(row, rowIndex, headers, primary, ref, group, key) {
    const values = cellValues(row);
    const title = values[primary] || values.find(Boolean) || 'Record';
    const reference = values[ref] || '';
    const status = group >= 0 ? values[group] : '';
    const skip = new Set([primary, ref, group]);
    const fields = [];
    headers.forEach((label, i) => {
      const value = values[i];
      if (skip.has(i) || !value || /actions?|more|view|edit|delete/i.test(label)) return;
      fields.push([label, value]);
    });
    return `<article class="ic-module-grid-card" role="button" tabindex="0" data-module-grid-key="${esc(key)}" data-module-grid-row="${rowIndex}" aria-label="Open ${esc(title)}">` +
      `<div class="ic-module-grid-card-top"><span class="ic-module-grid-ref">${esc(reference)}</span>${status ? `<span class="ic-module-grid-status" data-tone="${tone(status)}">${esc(status)}</span>` : ''}</div>` +
      `<strong class="ic-module-grid-title" title="${esc(title)}">${esc(title)}</strong>` +
      `<div class="ic-module-grid-fields">${fields.slice(0, 6).map(([label, value]) => `<div><span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong></div>`).join('')}</div></article>`;
  }

  function captureScroll(host) {
    const kanban = host.querySelector('.ic-module-kanban');
    const lanes = Array.from(host.querySelectorAll('.ic-module-lane')).map(lane => ({
      label: text(lane.querySelector('.ic-module-lane-head strong')?.textContent),
      top: lane.querySelector('.ic-module-lane-cards')?.scrollTop || 0
    }));
    return { left: kanban?.scrollLeft || 0, lanes };
  }

  function restoreScroll(host, state) {
    if (!state) return;
    const kanban = host.querySelector('.ic-module-kanban');
    if (kanban) kanban.scrollLeft = state.left || 0;
    state.lanes.forEach(saved => {
      const lane = Array.from(host.querySelectorAll('.ic-module-lane')).find(item => text(item.querySelector('.ic-module-lane-head strong')?.textContent) === saved.label);
      const cards = lane?.querySelector('.ic-module-lane-cards');
      if (cards) cards.scrollTop = saved.top || 0;
    });
  }

  function renderGrid(entry, force = false) {
    const { context, table, host } = entry;
    const signature = dataSignature(table);
    if (!force && entry.lastSignature === signature && host.childElementCount) return false;

    const scrollState = captureScroll(host);
    const headers = headersFor(table);
    const rows = sourceRows(table);
    let html = '';

    if (!rows.length) {
      html = '<div class="ic-module-grid-empty">No records to show in Grid View.</div>';
    } else {
      const primary = primaryIndex(headers);
      const ref = referenceIndex(headers, primary);
      const group = groupIndex(headers, rows);
      const label = contextLabel(context, table);
      if (group >= 0) {
        const groups = new Map();
        rows.forEach((row, i) => {
          const value = cellValues(row)[group] || 'Other';
          if (!groups.has(value)) groups.set(value, []);
          groups.get(value).push({ row, i });
        });
        html = `<div class="ic-module-grid-panel"><div class="ic-module-grid-heading"><div><span>▦</span><strong>${esc(label)}</strong></div><span>${rows.length} records</span></div><div class="ic-module-kanban">${Array.from(groups.entries()).map(([groupLabel, items]) => `<section class="ic-module-lane" data-tone="${tone(groupLabel)}"><div class="ic-module-lane-head"><div><span class="ic-module-lane-dot"></span><strong>${esc(groupLabel)}</strong></div><span>${items.length}</span></div><div class="ic-module-lane-cards">${items.map(({ row, i }) => cardMarkup(row, i, headers, primary, ref, group, entry.key)).join('')}</div></section>`).join('')}</div></div>`;
      } else {
        html = `<div class="ic-module-grid-panel"><div class="ic-module-grid-heading"><div><span>▦</span><strong>${esc(label)}</strong></div><span>${rows.length} records</span></div><div class="ic-module-card-grid">${rows.map((row, i) => cardMarkup(row, i, headers, primary, ref, -1, entry.key)).join('')}</div></div>`;
      }
    }

    if (host.innerHTML !== html) host.innerHTML = html;
    entry.lastSignature = signature;
    requestAnimationFrame(() => restoreScroll(host, scrollState));
    return true;
  }

  function applyMode(entry, requestedMode, persist = true, forceRender = false) {
    if (!entry || !entry.table?.isConnected) return;
    const mode = requestedMode === 'grid' ? 'grid' : 'list';
    if (persist) saveMode(entry.key, mode);
    const region = listRegion(entry.table);
    entry.region = region;
    const shouldHideList = mode === 'grid';
    if (region.classList.contains('ic-all-list-hidden') !== shouldHideList) region.classList.toggle('ic-all-list-hidden', shouldHideList);

    const host = ensureGridHost(entry.context, entry.table, entry.key);
    entry.host = host;
    if (host.hidden === (mode === 'grid')) host.hidden = mode !== 'grid';

    const root = ensureSwitch(entry.context, entry.table, entry.key);
    root.querySelectorAll('[data-all-view-mode]').forEach(button => {
      const active = button.dataset.allViewMode === mode;
      if (button.classList.contains('is-active') !== active) button.classList.toggle('is-active', active);
      if (button.getAttribute('aria-pressed') !== String(active)) button.setAttribute('aria-pressed', String(active));
    });

    entry.mode = mode;
    if (mode === 'grid') renderGrid(entry, forceRender);
  }

  function syncGeneric(context, table) {
    const key = contextKey(context, table);
    let entry = registry.get(key);
    if (!entry) {
      entry = { context, table, key, mode: null, lastSignature: '', host: null, region: null };
      registry.set(key, entry);
    } else {
      entry.context = context;
      if (entry.table !== table) {
        entry.table = table;
        entry.lastSignature = '';
      }
    }
    entry.host = ensureGridHost(context, table, key);
    ensureSwitch(context, table, key);
    applyMode(entry, readMode(key), false, false);
  }

  function syncAll() {
    scanTimer = 0;
    if (!authenticated()) return;
    const liveKeys = new Set();
    groupedContexts().forEach((tables, context) => {
      const table = primaryTable(tables);
      if (!table) return;
      const key = contextKey(context, table);
      liveKeys.add(key);
      syncGeneric(context, table);
    });
    registry.forEach((entry, key) => {
      if (!liveKeys.has(key) && !entry.table?.isConnected) registry.delete(key);
    });
  }

  function schedule(delay = 60) {
    if (scanTimer) global.clearTimeout(scanTimer);
    scanTimer = global.setTimeout(syncAll, delay);
  }

  function openGridCard(card) {
    const entry = registry.get(card.dataset.moduleGridKey || '');
    if (!entry?.table?.isConnected) return;
    const rows = sourceRows(entry.table);
    const source = rows[Number(card.dataset.moduleGridRow) || 0];
    if (!source) return;
    const preferred = source.querySelector('button[data-company-view],button[data-contact-view],button[data-view],button[data-action="view"],.view-btn,[class*="view-btn"],a[href]');
    if (preferred) preferred.click();
    else source.click();
  }

  function nodeContainsEligibleTable(node) {
    if (!(node instanceof Element)) return false;
    if (node.matches('table') && eligibleTable(node)) return true;
    return Array.from(node.querySelectorAll?.('table') || []).some(eligibleTable);
  }

  function mutationTouchesSourceTable(record) {
    const target = record.target instanceof Element ? record.target : record.target?.parentElement;
    if (!target) return false;
    if (target.closest('.ic-module-grid-view,.ic-crm-grid-view,.ic-crm-view-switch,.ic-all-view-switch')) return false;
    if (target.closest('table') && eligibleTable(target.closest('table'))) return true;
    return [...(record.addedNodes || []), ...(record.removedNodes || [])].some(nodeContainsEligibleTable);
  }

  function bindEvents() {
    if (document.documentElement.dataset.icAllModuleGridStableBound === 'true') return;
    document.documentElement.dataset.icAllModuleGridStableBound = 'true';

    document.addEventListener('click', event => {
      const modeButton = event.target.closest?.('[data-all-view-key][data-all-view-mode]');
      if (modeButton) {
        event.preventDefault();
        applyMode(registry.get(modeButton.dataset.allViewKey), modeButton.dataset.allViewMode, true, modeButton.dataset.allViewMode === 'grid');
        return;
      }
      const card = event.target.closest?.('.ic-module-grid-card[data-module-grid-key]');
      if (card) {
        event.preventDefault();
        openGridCard(card);
        return;
      }
      if (event.target.closest?.('[role="tab"],.view-tab,[data-tab],[data-view],[data-tab-target],[data-subtab],[aria-controls]')) schedule(40);
    }, true);

    document.addEventListener('keydown', event => {
      const card = event.target.closest?.('.ic-module-grid-card[data-module-grid-key]');
      if (!card || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openGridCard(card);
    });

    global.addEventListener('hashchange', () => schedule(20));
    global.addEventListener('popstate', () => schedule(20));
  }

  function installObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(records => {
      if (!authenticated()) return;
      if (records.some(mutationTouchesSourceTable)) schedule(70);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    bindEvents();
    installObserver();
    schedule(0);
    global.setTimeout(() => schedule(0), 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  global.InCheck360ModuleGridView = Object.freeze({ refresh: () => schedule(0) });
})(window);
