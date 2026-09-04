(function installAllModuleGridView(global) {
  const SPECIAL_VIEW_IDS = new Set(['leadsView','dealsView']);
  const VIEW_SELECTOR = '.icds-module-page,[id$="View"],[role="tabpanel"],.module-view,.workspace-view';
  const TABLE_SELECTOR = 'table.icds-table,table[id$="Table"],table[data-table],.table-wrap table,.table-wrapper table,.table-responsive table,.table-container table';
  const STORAGE_PREFIX = 'incheck360OperationsPortal.moduleViewMode.';
  let scanTimer = null;
  let observer = null;

  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const norm = value => text(value).toLowerCase();
  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const slug = value => norm(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'module';

  function authenticated() {
    return Boolean(document.body && !document.body.classList.contains('auth-locked'));
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    if (el.hidden) return false;
    const style = global.getComputedStyle?.(el);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  }

  function moduleKey(view) {
    return slug(view?.dataset?.icdsModuleKey || view?.id?.replace(/View$/i, '') || view?.getAttribute('aria-label') || 'module');
  }

  function moduleLabel(view) {
    const title = view?.querySelector('.icds-module-header h1,.icds-module-header h2,.page-header h1,.page-header h2,:scope>h1,:scope>h2');
    if (text(title?.textContent)) return text(title.textContent);
    const tab = view?.id ? document.querySelector(`[aria-controls="${CSS.escape(view.id)}"]`) : null;
    return text(tab?.textContent || view?.dataset?.icdsModuleKey || view?.id?.replace(/View$/i, '') || 'Records');
  }

  function readMode(key) {
    try { return global.localStorage?.getItem(`${STORAGE_PREFIX}${key}`) === 'grid' ? 'grid' : 'list'; }
    catch (_) { return 'list'; }
  }

  function saveMode(key, mode) {
    try { global.localStorage?.setItem(`${STORAGE_PREFIX}${key}`, mode); } catch (_) {}
  }

  function primaryTable(view) {
    if (!view) return null;
    const tables = Array.from(view.querySelectorAll(TABLE_SELECTOR)).filter(table => {
      if (!visible(table)) return false;
      if (table.closest('.modal,[role="dialog"],.print-preview,[data-print-preview],.pdf-preview,.fc,.fullcalendar,.ic-module-grid-view')) return false;
      const headers = table.querySelectorAll('thead th').length;
      return headers >= 2;
    });
    if (!tables.length) return null;
    return tables
      .map(table => {
        const cols = table.querySelectorAll('thead th').length;
        const rows = table.querySelectorAll('tbody tr').length;
        const idBoost = /table/i.test(`${table.id} ${table.className}`) ? 20 : 0;
        const shellBoost = table.closest('.icds-module-data,.icds-table-shell,.table-wrap,.table-wrapper,.table-responsive,.table-container') ? 10 : 0;
        return { table, score: cols * 5 + Math.min(rows, 30) + idBoost + shellBoost };
      })
      .sort((a, b) => b.score - a.score)[0]?.table || null;
  }

  function listRegion(table) {
    return table?.closest('.icds-table-shell,.icds-module-data,.table-wrap,.table-wrapper,.table-responsive,.table-container,.data-table-wrap,[class*="table-wrap"],[class*="table-container"]') || table;
  }

  function createButton(view) {
    const selectors = [
      '.icds-module-header [data-icds-header-actions] button',
      '.icds-module-header [data-icds-header-actions] a',
      '.icds-module-header .icds-toolbar button',
      '.icds-module-header .icds-toolbar a',
      '.page-header button','.page-header a','.section-header button','.section-header a'
    ];
    const candidates = Array.from(view.querySelectorAll(selectors.join(','))).filter(visible);
    return candidates.find(el => /^(?:\+\s*)?(?:create|new|add)\b/i.test(text(el.textContent))) || null;
  }

  function headerHost(view) {
    return view.querySelector('.icds-module-header [data-icds-header-actions]') ||
      view.querySelector('.icds-module-header .icds-toolbar') ||
      view.querySelector('.icds-module-header') ||
      view.querySelector('.page-header,.section-header,.view-header,.module-header') || view;
  }

  function positionSwitch(view, root) {
    const create = createButton(view);
    if (create?.parentElement) {
      if (root.parentElement !== create.parentElement || root.nextElementSibling !== create) create.parentElement.insertBefore(root, create);
      return;
    }
    const host = headerHost(view);
    if (host && root.parentElement !== host) host.appendChild(root);
  }

  function repositionSpecialSwitch(view) {
    if (!SPECIAL_VIEW_IDS.has(view.id)) return;
    const id = view.id === 'leadsView' ? 'leadsViewModeSwitch' : 'dealsViewModeSwitch';
    const root = document.getElementById(id);
    if (root) positionSwitch(view, root);
  }

  function ensureSwitch(view) {
    const key = moduleKey(view);
    const id = `icAllViewSwitch-${key}`;
    let root = document.getElementById(id);
    if (!root) {
      root = document.createElement('div');
      root.id = id;
      root.className = 'ic-crm-view-switch ic-all-view-switch';
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', `${moduleLabel(view)} view mode`);
      root.innerHTML = `
        <button type="button" class="ic-crm-view-btn" data-all-view-key="${esc(key)}" data-all-view-mode="list" aria-pressed="true"><span aria-hidden="true">☷</span><span>List View</span></button>
        <button type="button" class="ic-crm-view-btn" data-all-view-key="${esc(key)}" data-all-view-mode="grid" aria-pressed="false"><span aria-hidden="true">▦</span><span>Grid View</span></button>`;
    }
    positionSwitch(view, root);
    return root;
  }

  function ensureGridHost(view, region) {
    const key = moduleKey(view);
    const id = `icModuleGrid-${key}`;
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('section');
      host.id = id;
      host.className = 'ic-module-grid-view';
      host.dataset.moduleGridKey = key;
      host.hidden = true;
      if (region?.parentNode) region.parentNode.insertBefore(host, region.nextSibling);
      else view.appendChild(host);
    } else if (!view.contains(host)) {
      view.appendChild(host);
    }
    return host;
  }

  function headersFor(table) {
    return Array.from(table.querySelectorAll('thead th')).map((th, index) => text(th.textContent) || `Field ${index + 1}`);
  }

  function sourceRows(table) {
    return Array.from(table.querySelectorAll('tbody tr')).filter(row => {
      if (!visible(row) || row.classList.contains('skeleton-row')) return false;
      const cells = row.querySelectorAll(':scope > td');
      if (!cells.length) return false;
      if (cells.length === 1 && /no .*found|no records|loading|unable to load/i.test(text(cells[0].textContent))) return false;
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
      if (values.length >= 2 && values.length <= 8) return idx;
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

  function fieldsForCard(headers, values, primary, ref, group) {
    const useful = [];
    const skip = new Set([primary, ref, group]);
    headers.forEach((label, i) => {
      const value = values[i];
      if (skip.has(i) || !value) return;
      if (/actions?|more|view|edit|delete/i.test(label)) return;
      useful.push([label, value]);
    });
    return useful.slice(0, 5);
  }

  function cardMarkup(table, row, rowIndex, headers, primary, ref, group) {
    const values = cellValues(row);
    const title = values[primary] || values.find(Boolean) || 'Record';
    const reference = values[ref] || '';
    const status = group >= 0 ? values[group] : '';
    const fields = fieldsForCard(headers, values, primary, ref, group);
    return `<article class="ic-module-grid-card" role="button" tabindex="0" data-module-grid-row="${rowIndex}" aria-label="Open ${esc(title)}">
      <div class="ic-module-grid-card-top">
        <span class="ic-module-grid-ref">${esc(reference)}</span>
        ${status ? `<span class="ic-module-grid-status" data-tone="${tone(status)}">${esc(status)}</span>` : ''}
      </div>
      <strong class="ic-module-grid-title" title="${esc(title)}">${esc(title)}</strong>
      <div class="ic-module-grid-fields">${fields.map(([label,value]) => `<div><span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong></div>`).join('')}</div>
    </article>`;
  }

  function renderGrid(view, table, host) {
    const headers = headersFor(table);
    const rows = sourceRows(table);
    const primary = primaryIndex(headers);
    const ref = referenceIndex(headers, primary);
    const group = groupIndex(headers, rows);
    const label = moduleLabel(view);

    if (!rows.length) {
      host.innerHTML = `<div class="ic-module-grid-empty">No records to show in Grid View.</div>`;
      return;
    }

    if (group >= 0) {
      const groups = new Map();
      rows.forEach((row, i) => {
        const value = cellValues(row)[group] || 'Other';
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push({ row, i });
      });
      host.innerHTML = `<div class="ic-module-grid-panel">
        <div class="ic-module-grid-heading"><div><span>▦</span><strong>${esc(label)}</strong></div><span>${rows.length} records</span></div>
        <div class="ic-module-kanban">${Array.from(groups.entries()).map(([groupLabel, items]) => `<section class="ic-module-lane" data-tone="${tone(groupLabel)}">
          <div class="ic-module-lane-head"><div><span class="ic-module-lane-dot"></span><strong>${esc(groupLabel)}</strong></div><span>${items.length}</span></div>
          <div class="ic-module-lane-cards">${items.map(({row,i}) => cardMarkup(table,row,i,headers,primary,ref,group)).join('')}</div>
        </section>`).join('')}</div>
      </div>`;
      return;
    }

    host.innerHTML = `<div class="ic-module-grid-panel">
      <div class="ic-module-grid-heading"><div><span>▦</span><strong>${esc(label)}</strong></div><span>${rows.length} records</span></div>
      <div class="ic-module-card-grid">${rows.map((row,i) => cardMarkup(table,row,i,headers,primary,ref,-1)).join('')}</div>
    </div>`;
  }

  function applyMode(view, table, requestedMode, persist = true) {
    const key = moduleKey(view);
    const mode = requestedMode === 'grid' ? 'grid' : 'list';
    if (persist) saveMode(key, mode);
    view.dataset.allModuleViewMode = mode;
    const region = listRegion(table);
    if (region) region.classList.toggle('ic-all-list-hidden', mode === 'grid');
    const host = ensureGridHost(view, region);
    host.hidden = mode !== 'grid';
    const root = ensureSwitch(view);
    root.querySelectorAll('[data-all-view-mode]').forEach(button => {
      const active = button.dataset.allViewMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (mode === 'grid') renderGrid(view, table, host);
  }

  function syncView(view) {
    if (!(view instanceof Element) || !authenticated()) return;
    if (view.closest('#loginSection,.modal,[role="dialog"]')) return;
    if (SPECIAL_VIEW_IDS.has(view.id)) {
      repositionSpecialSwitch(view);
      return;
    }
    const table = primaryTable(view);
    if (!table) return;
    ensureSwitch(view);
    const region = listRegion(table);
    ensureGridHost(view, region);
    applyMode(view, table, readMode(moduleKey(view)), false);
  }

  function openGenericCard(card) {
    const host = card.closest('.ic-module-grid-view');
    const view = host?.closest(VIEW_SELECTOR);
    const table = primaryTable(view);
    const rows = table ? sourceRows(table) : [];
    const source = rows[Number(card.dataset.moduleGridRow) || 0];
    if (!source) return;
    const preferred = source.querySelector('button[data-lead-view],button[data-deal-view],button[data-company-view],button[data-contact-view],button[data-view],.view-btn,[class*="view-btn"],a[href]');
    if (preferred) preferred.click();
    else source.click();
  }

  function scan() {
    scanTimer = null;
    if (!authenticated()) return;
    document.querySelectorAll(VIEW_SELECTOR).forEach(view => {
      if (!visible(view) && !view.classList.contains('icds-module-page')) return;
      syncView(view);
    });
    const leads = document.getElementById('leadsView');
    const deals = document.getElementById('dealsView');
    if (leads) repositionSpecialSwitch(leads);
    if (deals) repositionSpecialSwitch(deals);
  }

  function schedule(delay = 80) {
    if (scanTimer) global.clearTimeout(scanTimer);
    scanTimer = global.setTimeout(scan, delay);
  }

  function bind() {
    if (document.documentElement.dataset.icAllModuleGridBound === '1') return;
    document.documentElement.dataset.icAllModuleGridBound = '1';
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-all-view-mode]');
      if (button) {
        const root = button.closest('.ic-all-view-switch');
        const view = root?.closest(VIEW_SELECTOR);
        const table = primaryTable(view);
        if (view && table) applyMode(view, table, button.dataset.allViewMode, true);
        return;
      }
      const card = event.target.closest('.ic-module-grid-card');
      if (card) openGenericCard(card);
    });
    document.addEventListener('keydown', event => {
      if (!['Enter',' '].includes(event.key)) return;
      const card = event.target.closest('.ic-module-grid-card');
      if (!card) return;
      event.preventDefault();
      openGenericCard(card);
    });
  }

  function installObserver() {
    if (observer || typeof MutationObserver === 'undefined' || !document.body) return;
    observer = new MutationObserver(records => {
      const relevant = records.some(record => {
        if (!record.addedNodes?.length && !record.removedNodes?.length) return false;
        const target = record.target instanceof Element ? record.target : null;
        return !target?.closest?.('.ic-module-grid-view');
      });
      if (relevant) schedule(90);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    bind();
    installObserver();
    schedule(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  global.InCheck360ModuleGridView = Object.freeze({ refresh: () => schedule(0) });
})(window);
