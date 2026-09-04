(function installAllModuleGridView(global) {
  const SPECIAL = {
    leadsView: { switchId: 'leadsViewModeSwitch', createId: 'leadsCreateBtn' },
    dealsView: { switchId: 'dealsViewModeSwitch', createId: 'dealsCreateBtn' }
  };
  const CONTEXT_SELECTOR = [
    '[role="tabpanel"]','[data-tab-panel]','[data-tab-content]','.tab-pane','.tab-panel',
    '.subtab-panel','.sub-tab-panel','.tabs-panel','[id$="TabPanel"]','[id$="TabContent"]',
    '[id*="TabPanel"]','[id*="TabContent"]','.icds-module-page','[id$="View"]',
    '.module-view','.workspace-view','.view'
  ].join(',');
  const STORAGE_PREFIX = 'incheck360OperationsPortal.tableViewMode.';
  const registry = new Map();
  let scanTimer = 0;
  let observer = null;
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
    if (table.closest('.modal,[role="dialog"],.drawer,.print-preview,[data-print-preview],.pdf-preview,.fc,.fullcalendar,.ic-module-grid-view')) return false;
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
    if (context.id) {
      const id = global.CSS?.escape ? global.CSS.escape(context.id) : context.id.replace(/[^a-zA-Z0-9_-]/g, '');
      const tab = document.querySelector(`[aria-controls="${id}"]`);
      if (text(tab?.textContent)) return text(tab.textContent);
    }
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

  function normalizedActionText(el) {
    return actionText(el).replace(/^[^A-Za-z0-9]+/, '').trim();
  }

  function createAction(context) {
    const explicit = [
      '#companyCreateBtn','#contactsCreateBtn','#leadsCreateBtn','#dealsCreateBtn',
      'button[id*="CreateBtn"]','button[id*="createBtn"]','button[id*="AddBtn"]','button[id*="addBtn"]',
      'button[data-permission-action="create"]','a[data-permission-action="create"]',
      'button[data-action*="create"]','a[data-action*="create"]'
    ];
    for (const selector of explicit) {
      const el = context.querySelector(selector);
      if (el && !el.closest('table,.modal,[role="dialog"],.ic-module-grid-view')) return el;
    }
    const candidates = Array.from(context.querySelectorAll('button,a,[role="button"]')).filter(el => {
      if (el.closest('table,.modal,[role="dialog"],.drawer,.ic-module-grid-view,.ic-crm-view-switch,.ic-all-view-switch')) return false;
      return /^(create|new|add)\b/i.test(normalizedActionText(el));
    });
    return candidates
      .map(el => {
        let score = 0;
        if (el.closest(
          '.icds-module-header,[class*="page-header"],.section-header,.view-header,.module-header,' +
          '.toolbar,.actions-bar,.page-actions,.section-actions,[data-icds-header-actions],' +
          '.leads-header-actions,.deals-header-actions'
        )) score += 100;
        if (/create|new|add/i.test(el.id || '')) score += 30;
        if (/primary|create|new|add/i.test(String(el.className || ''))) score += 20;
        return { el, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.el || null;
  }

  function headerHost(context) {
    return context.querySelector(
      '.icds-module-header [data-icds-header-actions],.icds-module-header .icds-toolbar,' +
      '.leads-header-actions,.deals-header-actions,.company-page-header,.contacts-page-header,' +
      '[class$="-page-header"],[class*=" page-header"],.page-header,.section-header,.view-header,.module-header,' +
      '.actions-bar,.page-actions,.section-actions'
    ) || context;
  }

  function positionSwitch(context, root) {
    if (!root) return;
    const create = createAction(context);
    if (create?.parentElement) {
      if (root.parentElement !== create.parentElement || root.nextElementSibling !== create) {
        create.parentElement.insertBefore(root, create);
      }
      root.dataset.icSwitchPosition = 'before-create';
      return;
    }
    const host = headerHost(context);
    if (host && root.parentElement !== host) host.appendChild(root);
    root.dataset.icSwitchPosition = 'header';
  }

  function specialInfo(context) {
    const view = context.matches?.('[id$="View"]') ? context : context.closest?.('[id$="View"]');
    return view && SPECIAL[view.id] ? { view, ...SPECIAL[view.id] } : null;
  }

  function positionSpecial(context) {
    const special = specialInfo(context);
    if (!special) return false;
    const root = document.getElementById(special.switchId);
    const create = document.getElementById(special.createId);
    if (root && create?.parentElement) {
      if (root.parentElement !== create.parentElement || root.nextElementSibling !== create) {
        create.parentElement.insertBefore(root, create);
      }
      root.dataset.icSwitchPosition = 'before-create';
    } else if (root) {
      positionSwitch(context, root);
    }
    return true;
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
        `<button type="button" class="ic-crm-view-btn" data-all-view-key="${esc(key)}" data-all-view-mode="list" aria-pressed="true">` +
        `<span aria-hidden="true">☷</span><span>List View</span></button>` +
        `<button type="button" class="ic-crm-view-btn" data-all-view-key="${esc(key)}" data-all-view-mode="grid" aria-pressed="false">` +
        `<span aria-hidden="true">▦</span><span>Grid View</span></button>`;
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
    const preferred = [
      /company name/i,/client name/i,/customer/i,/contact name/i,/full name/i,/employee name/i,
      /^name$/i,/title/i,/subject/i,/description/i,/invoice/i,/proposal/i,/agreement/i,/ticket/i,/receipt/i,/id$/i
    ];
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
      `<div class="ic-module-grid-card-top"><span class="ic-module-grid-ref">${esc(reference)}</span>` +
      `${status ? `<span class="ic-module-grid-status" data-tone="${tone(status)}">${esc(status)}</span>` : ''}</div>` +
      `<strong class="ic-module-grid-title" title="${esc(title)}">${esc(title)}</strong>` +
      `<div class="ic-module-grid-fields">${fields.slice(0, 6).map(([label, value]) =>
        `<div><span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong></div>`
      ).join('')}</div></article>`;
  }

  function renderGrid(context, table, host, key) {
    const headers = headersFor(table);
    const rows = sourceRows(table);
    if (!rows.length) {
      host.innerHTML = '<div class="ic-module-grid-empty">No records to show in Grid View.</div>';
      return;
    }
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
      host.innerHTML =
        `<div class="ic-module-grid-panel"><div class="ic-module-grid-heading"><div><span>▦</span><strong>${esc(label)}</strong></div><span>${rows.length} records</span></div>` +
        `<div class="ic-module-kanban">${Array.from(groups.entries()).map(([groupLabel, items]) =>
          `<section class="ic-module-lane" data-tone="${tone(groupLabel)}"><div class="ic-module-lane-head"><div><span class="ic-module-lane-dot"></span><strong>${esc(groupLabel)}</strong></div><span>${items.length}</span></div>` +
          `<div class="ic-module-lane-cards">${items.map(({ row, i }) => cardMarkup(row, i, headers, primary, ref, group, key)).join('')}</div></section>`
        ).join('')}</div></div>`;
    } else {
      host.innerHTML =
        `<div class="ic-module-grid-panel"><div class="ic-module-grid-heading"><div><span>▦</span><strong>${esc(label)}</strong></div><span>${rows.length} records</span></div>` +
        `<div class="ic-module-card-grid">${rows.map((row, i) => cardMarkup(row, i, headers, primary, ref, -1, key)).join('')}</div></div>`;
    }
  }

  function applyMode(entry, requestedMode, persist = true) {
    if (!entry) return;
    const { context, table, key } = entry;
    const mode = requestedMode === 'grid' ? 'grid' : 'list';
    if (persist) saveMode(key, mode);
    const region = listRegion(table);
    region.classList.toggle('ic-all-list-hidden', mode === 'grid');
    const host = ensureGridHost(context, table, key);
    host.hidden = mode !== 'grid';
    const root = ensureSwitch(context, table, key);
    root.querySelectorAll('[data-all-view-mode]').forEach(button => {
      const active = button.dataset.allViewMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (mode === 'grid') renderGrid(context, table, host, key);
  }

  function syncGeneric(context, table) {
    const key = contextKey(context, table);
    const entry = { context, table, key };
    registry.set(key, entry);
    ensureSwitch(context, table, key);
    ensureGridHost(context, table, key);
    applyMode(entry, readMode(key), false);
  }

  function syncAll() {
    scanTimer = 0;
    if (!authenticated()) return;
    const groups = groupedContexts();
    groups.forEach((tables, context) => {
      const table = primaryTable(tables);
      if (!table) return;
      if (positionSpecial(context)) return;
      syncGeneric(context, table);
    });
    Object.entries(SPECIAL).forEach(([viewId]) => {
      const view = document.getElementById(viewId);
      if (view) positionSpecial(view);
    });
  }

  function schedule(delay = 30) {
    if (scanTimer) global.clearTimeout(scanTimer);
    scanTimer = global.setTimeout(syncAll, delay);
  }

  function openGridCard(card) {
    const entry = registry.get(card.dataset.moduleGridKey || '');
    if (!entry) return;
    const rows = sourceRows(entry.table);
    const source = rows[Number(card.dataset.moduleGridRow) || 0];
    if (!source) return;
    const preferred = source.querySelector(
      'button[data-company-view],button[data-contact-view],button[data-lead-view],button[data-deal-view],' +
      'button[data-view],button[data-action="view"],.view-btn,[class*="view-btn"],a[href]'
    );
    if (preferred) preferred.click();
    else source.click();
  }

  function bindEvents() {
    if (document.documentElement.dataset.icAllModuleGridBound === 'true') return;
    document.documentElement.dataset.icAllModuleGridBound = 'true';

    document.addEventListener('click', event => {
      const modeButton = event.target.closest?.('[data-all-view-key][data-all-view-mode]');
      if (modeButton) {
        event.preventDefault();
        applyMode(registry.get(modeButton.dataset.allViewKey), modeButton.dataset.allViewMode, true);
        return;
      }
      const card = event.target.closest?.('.ic-module-grid-card[data-module-grid-key]');
      if (card) {
        event.preventDefault();
        openGridCard(card);
        return;
      }
      if (event.target.closest?.(
        '[role="tab"],.view-tab,[data-tab],[data-view],[data-tab-target],[data-subtab],[aria-controls]'
      )) schedule(0);
    }, true);

    document.addEventListener('keydown', event => {
      const card = event.target.closest?.('.ic-module-grid-card[data-module-grid-key]');
      if (!card || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openGridCard(card);
    });

    global.addEventListener('hashchange', () => schedule(0));
    global.addEventListener('popstate', () => schedule(0));
  }

  function installObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(records => {
      if (!authenticated()) return;
      const relevant = records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target?.parentElement;
        if (target?.closest?.('.ic-module-grid-view,.ic-crm-view-switch,.ic-all-view-switch')) return false;
        return Boolean(record.addedNodes?.length || record.removedNodes?.length);
      });
      if (relevant) schedule(40);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    bindEvents();
    installObserver();
    schedule(0);
    global.setTimeout(() => schedule(0), 300);
    global.setTimeout(() => schedule(0), 1200);
    global.setTimeout(() => schedule(0), 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  global.InCheck360ModuleGridView = Object.freeze({ refresh: () => schedule(0) });
})(window);