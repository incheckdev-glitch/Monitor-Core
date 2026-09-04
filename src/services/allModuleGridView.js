(function installAllModuleGridView(global) {
  const SPECIAL_SWITCHES = {
    leadsView: 'leadsViewModeSwitch',
    dealsView: 'dealsViewModeSwitch'
  };
  const TAB_CONTEXT_SELECTOR = [
    '[role="tabpanel"]','[data-tab-panel]','[data-tab-content]','.tab-pane','.tab-panel','.subtab-panel','.sub-tab-panel','.tabs-panel',
    '[id$="TabPanel"]','[id$="TabContent"]','[id*="TabPanel"]','[id*="TabContent"]',
    '.icds-module-page','[id$="View"]','.module-view','.workspace-view'
  ].join(',');
  const STORAGE_PREFIX = 'incheck360OperationsPortal.tableViewMode.';
  const registry = new Map();
  let scanTimer = null;
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

  function visible(el) {
    if (!(el instanceof Element) || el.hidden) return false;
    const style = global.getComputedStyle?.(el);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  }

  function eligibleTable(table) {
    if (!(table instanceof HTMLTableElement)) return false;
    if (table.closest('.modal,[role="dialog"],.drawer,.print-preview,[data-print-preview],.pdf-preview,.fc,.fullcalendar,.ic-module-grid-view')) return false;
    if (table.querySelectorAll('thead th').length < 2) return false;
    return true;
  }

  function tableContext(table) {
    return table.closest(TAB_CONTEXT_SELECTOR) || table.closest('main') || document.body;
  }

  function contextTables(context) {
    return Array.from(context.querySelectorAll('table')).filter(table => eligibleTable(table) && tableContext(table) === context);
  }

  function tableScore(table) {
    const cols = table.querySelectorAll('thead th').length;
    const rows = table.querySelectorAll('tbody tr').length;
    const idBoost = /table/i.test(`${table.id} ${table.className}`) ? 20 : 0;
    const shellBoost = table.closest('.icds-module-data,.icds-table-shell,.table-wrap,.table-wrapper,.table-responsive,.table-container') ? 10 : 0;
    return cols * 5 + Math.min(rows, 30) + idBoost + shellBoost;
  }

  function primaryTable(context) {
    return contextTables(context).sort((a, b) => tableScore(b) - tableScore(a))[0] || null;
  }

  function contextIdentity(context, table) {
    if (!context.dataset.icGridContextId) {
      const base = context.id || context.getAttribute('aria-label') || table?.id || `context-${++autoId}`;
      context.dataset.icGridContextId = `${slug(base)}-${autoId || 1}`;
    }
    const tablePart = slug(table?.id || table?.getAttribute('aria-label') || 'table');
    return `${context.dataset.icGridContextId}-${tablePart}`;
  }

  function contextLabel(context, table) {
    const heading = context.querySelector('.icds-module-header h1,.icds-module-header h2,.page-header h1,.page-header h2,.section-header h1,.section-header h2,:scope>h1,:scope>h2,:scope>h3');
    if (text(heading?.textContent)) return text(heading.textContent);
    const caption = table?.querySelector('caption');
    if (text(caption?.textContent)) return text(caption.textContent);
    if (context.id) {
      const escaped = global.CSS?.escape ? global.CSS.escape(context.id) : context.id.replace(/[^a-zA-Z0-9_-]/g, '');
      const tab = document.querySelector(`[aria-controls="${escaped}"]`);
      if (text(tab?.textContent)) return text(tab.textContent);
    }
    return text(context.getAttribute('aria-label') || context.id || table?.id || 'Records').replace(/View$|Table$/i, '');
  }

  function readMode(key) {
    try { return global.localStorage?.getItem(`${STORAGE_PREFIX}${key}`) === 'grid' ? 'grid' : 'list'; }
    catch (_) { return 'list'; }
  }

  function saveMode(key, mode) {
    try { global.localStorage?.setItem(`${STORAGE_PREFIX}${key}`, mode); } catch (_) {}
  }

  function listRegion(table) {
    return table?.closest('.icds-table-shell,.icds-module-data,.table-wrap,.table-wrapper,.table-responsive,.table-container,.data-table-wrap,[class*="table-wrap"],[class*="table-container"]') || table;
  }

  function actionText(el) {
    return text(el?.textContent || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title'));
  }

  function createButton(context, table) {
    const candidates = Array.from(context.querySelectorAll('button,a,[role="button"]')).filter(el => {
      if (el.closest('table,.ic-crm-view-switch,.ic-all-view-switch,.ic-module-grid-view,.modal,[role="dialog"],.filters,.filter-panel')) return false;
      return /^(?:\+\s*)?(?:create|new|add)\b/i.test(actionText(el));
    });
    if (!candidates.length) return null;
    return candidates.map(el => {
      let score = 0;
      if (el.closest('.icds-module-header,.page-header,.section-header,.view-header,.module-header,.toolbar,.actions-bar,.page-actions,.section-actions,[data-icds-header-actions]')) score += 100;
      if (el.id && /create|new|add/i.test(el.id)) score += 30;
      if (String(el.className || '').match(/primary|create|new|add/i)) score += 20;
      if (table && (el.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)) score += 15;
      if (visible(el)) score += 10;
      return { el, score };
    }).sort((a, b) => b.score - a.score)[0]?.el || null;
  }

  function ensureCreateCluster(root, create) {
    if (!root || !create?.parentElement) return false;
    let cluster = create.closest('.ic-view-switch-create-cluster');
    if (!cluster) {
      cluster = document.createElement('div');
      cluster.className = 'ic-view-switch-create-cluster';
      create.parentElement.insertBefore(cluster, create);
      cluster.appendChild(create);
    }
    if (root.parentElement !== cluster) cluster.insertBefore(root, create);
    else if (root.nextElementSibling !== create) cluster.insertBefore(root, create);
    return true;
  }

  function fallbackActionHost(context, table) {
    const selectors = [
      '.icds-module-header [data-icds-header-actions]','.icds-module-header .icds-toolbar','.icds-module-header',
      '.page-header .actions','.page-header','.section-header .actions','.section-header',
      '.toolbar','.actions-bar','.page-actions','.section-actions'
    ];
    const candidates = Array.from(context.querySelectorAll(selectors.join(','))).filter(el => !el.closest('table,.modal,[role="dialog"]'));
    if (candidates.length) return candidates[0];
    const region = listRegion(table);
    if (region?.parentElement) {
      let toolbar = region.previousElementSibling;
      if (!toolbar?.classList?.contains('ic-table-view-toolbar')) {
        toolbar = document.createElement('div');
        toolbar.className = 'ic-table-view-toolbar';
        region.parentElement.insertBefore(toolbar, region);
      }
      return toolbar;
    }
    return context;
  }

  function positionSwitch(context, table, root) {
    const create = createButton(context, table);
    if (create && ensureCreateCluster(root, create)) return;
    const host = fallbackActionHost(context, table);
    if (host && root.parentElement !== host) host.prepend(root);
  }

  function specialContext(context) {
    const view = context.matches?.('[id$="View"]') ? context : context.closest?.('[id$="View"]');
    if (!view || !SPECIAL_SWITCHES[view.id]) return null;
    return { view, switchId: SPECIAL_SWITCHES[view.id] };
  }

  function repositionSpecial(context, table) {
    const special = specialContext(context);
    if (!special) return false;
    const root = document.getElementById(special.switchId);
    if (!root) return true;
    positionSwitch(context, table, root);
    return true;
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
      root.innerHTML = `
        <button type="button" class="ic-crm-view-btn" data-all-view-key="${esc(key)}" data-all-view-mode="list" aria-pressed="true"><span aria-hidden="true">☷</span><span>List View</span></button>
        <button type="button" class="ic-crm-view-btn" data-all-view-key="${esc(key)}" data-all-view-mode="grid" aria-pressed="false"><span aria-hidden="true">▦</span><span>Grid View</span></button>`;
    }
    positionSwitch(context, table, root);
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
      if (region?.parentNode) region.parentNode.insertBefore(host, region.nextSibling);
      else context.appendChild(host);
    } else if (!context.contains(host)) {
      context.appendChild(host);
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
    const priorities = [/^stage$/i,/^status$/i,/status/i,/^priority$/i,/^state$/i,/^type$/i,/^category$/i];
    for (const matcher of priorities) {
      const idx = headers.findIndex(label => matcher.test(label));
      if (idx < 0) continue;
      const values = [...new Set(rows.map(row => cellValues(row)[idx]).filter(Boolean))];
      if (values.length >= 2 && values.length <= 10) return idx;
    }
    return -1;
  }

  function tone(value) {
    const v = norm(value);
    if (/paid|active|approved|accepted|signed|won|qualified|complete|completed|resolved|verified|settled|received/.test(v)) return 'success';
    if (/overdue|late|rejected|lost|failed|cancel|expired|critical|blocked|error/.test(v)) return 'danger';
    if (/pending|due|review|hold|negotiation|progress|scheduled|medium/.test(v)) return 'warning';
    if (/draft|new|open|prospect|sent|lead|processing|info/.test(v)) return 'info';
    return 'neutral';
  }

  function primaryIndex(headers) {
    const preferred = [/company name/i,/client name/i,/customer/i,/contact name/i,/full name/i,/name/i,/title/i,/subject/i,/description/i,/invoice/i,/proposal/i,/agreement/i,/ticket/i,/receipt/i,/id$/i];
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

  function cardFields(headers, values, primary, ref, group) {
    const skip = new Set([primary, ref, group]);
    const fields = [];
    headers.forEach((label, i) => {
      const value = values[i];
      if (skip.has(i) || !value || /actions?|more|view|edit|delete/i.test(label)) return;
      fields.push([label, value]);
    });
    return fields.slice(0, 5);
  }

  function cardMarkup(row, rowIndex, headers, primary, ref, group, key) {
    const values = cellValues(row);
    const title = values[primary] || values.find(Boolean) || 'Record';
    const reference = values[ref] || '';
    const status = group >= 0 ? values[group] : '';
    const fields = cardFields(headers, values, primary, ref, group);
    return `<article class="ic-module-grid-card" role="button" tabindex="0" data-module-grid-key="${esc(key)}" data-module-grid-row="${rowIndex}" aria-label="Open ${esc(title)}">
      <div class="ic-module-grid-card-top"><span class="ic-module-grid-ref">${esc(reference)}</span>${status ? `<span class="ic-module-grid-status" data-tone="${tone(status)}">${esc(status)}</span>` : ''}</div>
      <strong class="ic-module-grid-title" title="${esc(title)}">${esc(title)}</strong>
      <div class="ic-module-grid-fields">${fields.map(([label,value]) => `<div><span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong></div>`).join('')}</div>
    </article>`;
  }

  function renderGrid(context, table, host, key) {
    const headers = headersFor(table);
    const rows = sourceRows(table);
    const primary = primaryIndex(headers);
    const ref = referenceIndex(headers, primary);
    const group = groupIndex(headers, rows);
    const label = contextLabel(context, table);
    if (!rows.length) {
      host.innerHTML = '<div class="ic-module-grid-empty">No records to show in Grid View.</div>';
      return;
    }
    if (group >= 0) {
      const groups = new Map();
      rows.forEach((row, i) => {
        const value = cellValues(row)[group] || 'Other';
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push({ row, i });
      });
      host.innerHTML = `<div class="ic-module-grid-panel"><div class="ic-module-grid-heading"><div><span>▦</span><strong>${esc(label)}</strong></div><span>${rows.length} records</span></div><div class="ic-module-kanban">${Array.from(groups.entries()).map(([groupLabel, items]) => `<section class="ic-module-lane" data-tone="${tone(groupLabel)}"><div class="ic-module-lane-head"><div><span class="ic-module-lane-dot"></span><strong>${esc(groupLabel)}</strong></div><span>${items.length}</span></div><div class="ic-module-lane-cards">${items.map(({row,i}) => cardMarkup(row,i,headers,primary,ref,group,key)).join('')}</div></section>`).join('')}</div></div>`;
      return;
    }
    host.innerHTML = `<div class="ic-module-grid-panel"><div class="ic-module-grid-heading"><div><span>▦</span><strong>${esc(label)}</strong></div><span>${rows.length} records</span></div><div class="ic-module-card-grid">${rows.map((row,i) => cardMarkup(row,i,headers,primary,ref,-1,key)).join('')}</div></div>`;
  }

  function applyMode(entry, requestedMode, persist = true) {
    if (!entry) return;
    const { context, table, key } = entry;
    const mode = requestedMode === 'grid' ? 'grid' : 'list';
    if (persist) saveMode(key, mode);
    context.dataset.allModuleViewMode = mode;
    const region = listRegion(table);
    region?.classList.toggle('ic-all-list-hidden', mode === 'grid');
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

  function syncContext(context) {
    if (!(context instanceof Element) || !authenticated()) return;
    if (context.closest('#loginSection,.modal,[role="dialog"]')) return;
    const table = primaryTable(context);
    if (!table) return;
    if (repositionSpecial(context, table)) return;
    const key = contextIdentity(context, table);
    const entry = { context, table, key };
    registry.set(key, entry);
    ensureSwitch(context, table, key);
    ensureGridHost(context, table, key);
    applyMode(entry, readMode(key), false);
  }

  function discoverContexts() {
    const contexts = new Set();
    document.querySelectorAll('table').forEach(table => {
      if (!eligibleTable(table)) return;
      const context = tableContext(table);
      if (context) contexts.add(context);
    });
    contexts.forEach(syncContext);
    ['leadsView','dealsView'].forEach(id => {
      const view = document.getElementById(id);
      if (view) {
        const table = primaryTable(view) || view.querySelector('table');
        if (table) repositionSpecial(view, table);
      }
    });
  }

  function openGridCard(card) {
    const key = card.dataset.moduleGridKey;
    const entry = registry.get(key);
    if (!entry) return;
    const rows = sourceRows(entry.table);
    const source = rows[Number(card.dataset.moduleGridRow) || 0];
    if (!source) return;
    const preferred = source.querySelector('button[data-lead-view],button[data-deal-view],button[data-company-view],button[data-contact-view],button[data-view],.view-btn,[class*="view-btn"],a[href]');
    if (preferred) preferred.click();
    else source.click();
  }

  function schedule(delay = 60) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (authenticated()) discoverContexts();
    }, delay);
  }

  function bindEvents() {
    if (document.documentElement.dataset.icAllGridEvents === '1') return;
    document.documentElement.dataset.icAllGridEvents = '1';
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-all-view-mode]');
      if (button) {
        const entry = registry.get(button.dataset.allViewKey);
        if (entry) applyMode(entry, button.dataset.allViewMode, true);
        return;
      }
      const card = event.target.closest('.ic-module-grid-card[data-module-grid-key]');
      if (card) {
        openGridCard(card);
        return;
      }
      if (event.target.closest('.view-tab,[role="tab"],[data-tab],.tab,.tabs button,.subtab,.sub-tab')) schedule(80);
    });
    document.addEventListener('keydown', event => {
      const card = event.target.closest?.('.ic-module-grid-card[data-module-grid-key]');
      if (!card || !['Enter',' '].includes(event.key)) return;
      event.preventDefault();
      openGridCard(card);
    });
    global.addEventListener('hashchange', () => schedule(80));
    global.addEventListener('popstate', () => schedule(80));
    global.addEventListener('resize', () => schedule(120), { passive: true });
  }

  function installObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(records => {
      if (!authenticated()) return;
      if (records.some(record => record.addedNodes?.length || record.removedNodes?.length)) schedule(90);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    if (!document.body) return;
    bindEvents();
    installObserver();
    schedule(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  global.InCheck360ModuleGridView = Object.freeze({ refresh: () => schedule(0) });
})(window);
