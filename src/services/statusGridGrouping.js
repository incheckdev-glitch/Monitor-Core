(function installStatusGridGrouping(global) {
  const GENERIC_HOST_SELECTOR = '.ic-module-grid-view';
  const CONTEXT_SELECTOR = [
    '[role="tabpanel"]','[data-tab-panel]','[data-tab-content]','.tab-pane','.tab-panel',
    '.subtab-panel','.sub-tab-panel','.tabs-panel','[id$="TabPanel"]','[id$="TabContent"]',
    '[id*="TabPanel"]','[id*="TabContent"]','.icds-module-page','[id$="View"]',
    '.module-view','.workspace-view','.view'
  ].join(',');

  let scanTimer = 0;
  let observer = null;

  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const norm = value => text(value).toLowerCase();

  function authenticated() {
    return Boolean(document.body && !document.body.classList.contains('auth-locked'));
  }

  function eligibleTable(table) {
    return table instanceof HTMLTableElement &&
      table.querySelectorAll('thead th').length >= 2 &&
      !table.closest('.modal,[role="dialog"],.drawer,.print-preview,[data-print-preview],.pdf-preview,.fc,.fullcalendar,.ic-module-grid-view');
  }

  function listRegion(table) {
    return table.closest(
      '.icds-table-shell,.icds-module-data,.table-wrap,.table-wrapper,.table-responsive,.table-container,' +
      '.data-table-wrap,[class*="table-wrap"],[class*="table-container"]'
    ) || table;
  }

  function contextFor(host) {
    return host.closest(CONTEXT_SELECTOR) || host.closest('main') || document.body;
  }

  function sourceTableForHost(host) {
    const direct = host.previousElementSibling;
    if (direct) {
      if (eligibleTable(direct)) return direct;
      const nested = direct.querySelector?.('table');
      if (eligibleTable(nested)) return nested;
    }

    const context = contextFor(host);
    const tables = Array.from(context.querySelectorAll('table')).filter(eligibleTable);
    const exact = tables.find(table => listRegion(table).nextElementSibling === host);
    if (exact) return exact;

    const key = text(host.dataset.moduleGridKey);
    if (key) {
      const byId = tables.find(table => key.includes(norm(table.id).replace(/[^a-z0-9]+/g, '-')));
      if (byId) return byId;
    }
    return tables[0] || null;
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

  function statusColumn(headers) {
    const rules = [
      { label: 'Status', match: /^status$/i },
      { label: 'Status', match: /(^|\s)status($|\s)/i },
      { label: 'Status', match: /status/i },
      { label: 'Status', match: /^stage$/i },
      { label: 'Status', match: /(^|\s)stage($|\s)/i },
      { label: 'Status', match: /^state$/i },
      { label: 'Status', match: /(^|\s)state($|\s)/i },
      { label: 'Status', match: /verification/i }
    ];
    for (const rule of rules) {
      const index = headers.findIndex(header => rule.match.test(header));
      if (index >= 0) return { index, label: rule.label, sourceLabel: headers[index] };
    }
    return { index: -1, label: 'Status', sourceLabel: 'Status' };
  }

  function tone(value) {
    const v = norm(value);
    if (/paid|active|approved|accepted|signed|won|qualified|complete|completed|resolved|verified|settled|received|success/.test(v)) return 'success';
    if (/overdue|late|rejected|lost|failed|cancel|expired|critical|blocked|error|inactive|unverified|closed/.test(v)) return 'danger';
    if (/pending|due|review|hold|negotiation|progress|scheduled|medium|waiting/.test(v)) return 'warning';
    if (/draft|new|open|prospect|sent|lead|processing|info|not contacted/.test(v)) return 'info';
    return 'neutral';
  }

  function laneOrder(value) {
    const v = norm(value);
    const ranks = [
      [/new|not contacted|draft|open|prospect/, 10],
      [/pending|waiting|review|sent|scheduled/, 20],
      [/progress|negotiation|processing|qualified/, 30],
      [/active|approved|accepted|signed|verified/, 40],
      [/paid|settled|received|complete|completed|resolved|won/, 50],
      [/inactive|archived/, 80],
      [/cancel|rejected|lost|failed|expired|overdue|critical|closed/, 90],
      [/no status|unspecified|other/, 99]
    ];
    return ranks.find(([matcher]) => matcher.test(v))?.[1] ?? 60;
  }

  function ensureStatusBadge(card, statusValue) {
    const top = card.querySelector('.ic-module-grid-card-top');
    if (!top) return;
    let badge = top.querySelector('.ic-module-grid-status');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ic-module-grid-status';
      top.appendChild(badge);
    }
    badge.textContent = statusValue;
    badge.dataset.tone = tone(statusValue);
  }

  function makeLane(statusValue, cards) {
    const lane = document.createElement('section');
    lane.className = 'ic-module-lane';
    lane.dataset.tone = tone(statusValue);
    lane.dataset.icStatusLane = statusValue;

    const head = document.createElement('div');
    head.className = 'ic-module-lane-head';
    const left = document.createElement('div');
    const dot = document.createElement('span');
    dot.className = 'ic-module-lane-dot';
    const title = document.createElement('strong');
    title.textContent = statusValue;
    const count = document.createElement('span');
    count.textContent = String(cards.length);
    left.append(dot, title);
    head.append(left, count);

    const body = document.createElement('div');
    body.className = 'ic-module-lane-cards';
    cards.forEach(card => body.appendChild(card));
    lane.append(head, body);
    return lane;
  }

  function statusSignature(statusSource, values) {
    return `${statusSource.index}:${statusSource.sourceLabel}:${values.join('\u001f')}`;
  }

  function enforceHost(host) {
    if (!(host instanceof HTMLElement)) return;
    const table = sourceTableForHost(host);
    if (!table) return;

    const rows = sourceRows(table);
    const cards = Array.from(host.querySelectorAll('.ic-module-grid-card[data-module-grid-row]'));
    if (!rows.length || !cards.length) return;

    const headers = headersFor(table);
    const statusSource = statusColumn(headers);
    const statuses = rows.map(row => {
      if (statusSource.index < 0) return 'No Status';
      return cellValues(row)[statusSource.index] || 'No Status';
    });
    const signature = statusSignature(statusSource, statuses);
    if (host.dataset.icStatusSignature === signature && host.querySelector('[data-ic-status-grouped="true"]')) return;

    const cardByRow = new Map();
    cards.forEach(card => {
      const index = Number(card.dataset.moduleGridRow);
      if (Number.isInteger(index)) cardByRow.set(index, card);
    });

    const groups = new Map();
    statuses.forEach((statusValue, rowIndex) => {
      const card = cardByRow.get(rowIndex);
      if (!card) return;
      ensureStatusBadge(card, statusValue);
      if (!groups.has(statusValue)) groups.set(statusValue, []);
      groups.get(statusValue).push(card);
    });
    if (!groups.size) return;

    const panel = host.querySelector('.ic-module-grid-panel') || host;
    const existingBoard = panel.querySelector('.ic-module-kanban,.ic-module-card-grid');
    const board = document.createElement('div');
    board.className = 'ic-module-kanban';
    board.dataset.icStatusGrouped = 'true';
    board.setAttribute('aria-label', 'Grid grouped by status');

    Array.from(groups.entries())
      .sort((a, b) => laneOrder(a[0]) - laneOrder(b[0]) || a[0].localeCompare(b[0]))
      .forEach(([statusValue, laneCards]) => board.appendChild(makeLane(statusValue, laneCards)));

    if (existingBoard) existingBoard.replaceWith(board);
    else panel.appendChild(board);

    const headingMeta = panel.querySelector('.ic-module-grid-heading > span:last-child');
    if (headingMeta) headingMeta.textContent = `${rows.length} records · Grouped by Status`;
    host.dataset.icStatusSignature = signature;
    host.dataset.icGroupedBy = 'status';
  }

  function markSpecialCrmBoards() {
    document.querySelectorAll('#leadsGridView,#dealsGridView').forEach(host => {
      if (!(host instanceof HTMLElement)) return;
      host.dataset.icGroupedBy = 'status';
      const meta = host.querySelector('.ic-crm-grid-heading > span:last-child');
      if (meta && !/grouped by status/i.test(meta.textContent || '')) {
        const countMatch = text(meta.textContent).match(/^\d+\s+records?/i);
        if (countMatch) meta.textContent = `${countMatch[0]} · Grouped by Status`;
      }
    });
  }

  function scan() {
    scanTimer = 0;
    if (!authenticated()) return;
    document.querySelectorAll(GENERIC_HOST_SELECTOR).forEach(enforceHost);
    markSpecialCrmBoards();
  }

  function schedule(delay = 60) {
    if (scanTimer) global.clearTimeout(scanTimer);
    scanTimer = global.setTimeout(scan, delay);
  }

  function bind() {
    if (document.documentElement.dataset.icStatusGridGroupingBound === 'true') return;
    document.documentElement.dataset.icStatusGridGroupingBound = 'true';

    document.addEventListener('click', event => {
      if (event.target.closest?.('[data-all-view-mode="grid"],[data-crm-view-mode="grid"],[role="tab"],.view-tab')) {
        schedule(25);
        global.setTimeout(() => schedule(0), 140);
      }
    }, true);

    global.addEventListener('hashchange', () => schedule(50));
    global.addEventListener('popstate', () => schedule(50));
  }

  function observe() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(records => {
      if (!authenticated()) return;
      if (records.some(record => record.addedNodes?.length || record.removedNodes?.length)) schedule(70);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    bind();
    observe();
    schedule(0);
    global.setTimeout(() => schedule(0), 350);
    global.setTimeout(() => schedule(0), 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  global.InCheck360StatusGridGrouping = Object.freeze({ refresh: () => schedule(0) });
})(window);
