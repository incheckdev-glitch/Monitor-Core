(function installInCheck360CollapsibleFilters(global) {
  const MANAGED = 'data-incheck-filter-managed';
  const TOGGLE_ID_PREFIX = 'incheckFilterToggle';
  let scanTimer = null;

  const candidateSelector = [
    '#companyFilterCard',
    '#contactsFilterCard',
    '.leads-filter-card',
    '.deals-filter-card',
    '.rf-filter-card',
    '.pf-filter-panel',
    '.analytics-filter-bar',
    '[id$="FilterCard"]',
    '[id$="FiltersCard"]',
    '[id$="FilterPanel"]',
    '[id$="FiltersPanel"]',
    '[class*="-filter-card"]',
    '[class*="-filters-card"]',
    '[class*="-filter-panel"]'
  ].join(',');

  function installStyles() {
    if (document.getElementById('incheck360-collapsible-filters-style')) return;
    const style = document.createElement('style');
    style.id = 'incheck360-collapsible-filters-style';
    style.textContent = `
      body:not(.auth-locked) .ic-filter-toggle-row{
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:8px;
        margin:10px 0 12px;
      }
      body:not(.auth-locked) .ic-filter-toggle-btn{
        min-height:40px;
        padding:0 13px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:8px;
        border:1px solid #cbd5e1;
        border-radius:10px;
        background:#fff;
        color:#334155;
        font:inherit;
        font-size:13px;
        font-weight:800;
        cursor:pointer;
        box-shadow:0 1px 2px rgba(15,23,42,.04);
        transition:background .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease;
      }
      body:not(.auth-locked) .ic-filter-toggle-btn:hover{
        background:#f8fafc;
        border-color:#94a3b8;
        color:#1546e8;
      }
      body:not(.auth-locked) .ic-filter-toggle-btn[aria-expanded="true"]{
        border-color:#9db7ff;
        background:#f6f8ff;
        color:#1546e8;
        box-shadow:0 0 0 3px rgba(37,99,235,.08);
      }
      body:not(.auth-locked) .ic-filter-toggle-icon{
        width:18px;
        height:18px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        font-size:15px;
      }
      body:not(.auth-locked) .ic-filter-toggle-count{
        min-width:19px;
        height:19px;
        padding:0 6px;
        display:none;
        align-items:center;
        justify-content:center;
        border-radius:999px;
        background:#1546e8;
        color:#fff;
        font-size:10px;
        font-weight:900;
      }
      body:not(.auth-locked) .ic-filter-toggle-count.is-visible{display:inline-flex;}
      body:not(.auth-locked) .ic-filter-toggle-arrow{
        font-size:11px;
        color:#64748b;
        transition:transform .16s ease;
      }
      body:not(.auth-locked) .ic-filter-toggle-btn[aria-expanded="true"] .ic-filter-toggle-arrow{
        transform:rotate(180deg);
      }
      body:not(.auth-locked) .ic-collapsible-filter-panel.ic-filters-collapsed{
        display:none!important;
      }
      body:not(.auth-locked) .ic-collapsible-filter-panel:not(.ic-filters-collapsed){
        animation:icFilterReveal .14s ease-out;
      }
      @keyframes icFilterReveal{
        from{opacity:.35;transform:translateY(-4px)}
        to{opacity:1;transform:translateY(0)}
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-filter-toggle-btn,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-filter-toggle-btn{
        background:#111827;
        border-color:#334155;
        color:#dbe4f0;
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-filter-toggle-btn:hover,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-filter-toggle-btn:hover{
        background:#1e293b;
        border-color:#475569;
        color:#8fb0ff;
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-filter-toggle-btn[aria-expanded="true"],
      :root[data-theme="dark"] body:not(.auth-locked) .ic-filter-toggle-btn[aria-expanded="true"]{
        background:#16213a;
        border-color:#496bbf;
        color:#9bb6ff;
      }
      @media (max-width:720px){
        body:not(.auth-locked) .ic-filter-toggle-row{margin:8px 0 10px;}
        body:not(.auth-locked) .ic-filter-toggle-btn{width:100%;}
      }
    `;
    document.head.appendChild(style);
  }

  function isExcluded(panel) {
    return Boolean(panel.closest('.modal,[role="dialog"],.drawer,.popover,.dropdown-menu,#appHeader,#loginSection,.auth-card'));
  }

  function qualifies(panel) {
    if (!(panel instanceof Element) || !panel.isConnected || isExcluded(panel)) return false;
    const controls = panel.querySelectorAll('input:not([type="hidden"]),select,textarea');
    if (controls.length < 2) return false;
    const nested = panel.querySelector(candidateSelector);
    if (nested && nested !== panel && nested.querySelectorAll('input:not([type="hidden"]),select,textarea').length >= 2) return false;
    return true;
  }

  function activeFilterCount(panel) {
    const ignoreValues = new Set([
      '', 'all', 'any', 'all statuses', 'all status', 'all companies', 'all roles',
      'all contacts', 'all locations', 'all users', 'all modules', 'all currencies',
      'all types', 'all categories', 'all departments'
    ]);
    let count = 0;
    panel.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(control => {
      if (control.disabled) return;
      const type = String(control.type || '').toLowerCase();
      if ((type === 'checkbox' || type === 'radio')) {
        if (control.checked) count += 1;
        return;
      }
      const value = String(control.value || '').trim().toLowerCase();
      if (!ignoreValues.has(value)) count += 1;
    });
    return count;
  }

  function syncToggle(panel) {
    const toggleId = panel.getAttribute('data-incheck-filter-toggle-id');
    if (!toggleId) return;
    const button = document.getElementById(toggleId);
    if (!button) return;
    const count = activeFilterCount(panel);
    const badge = button.querySelector('.ic-filter-toggle-count');
    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle('is-visible', count > 0);
      badge.setAttribute('aria-label', `${count} active filter${count === 1 ? '' : 's'}`);
    }
  }

  function setExpanded(panel, button, expanded) {
    panel.classList.toggle('ic-filters-collapsed', !expanded);
    panel.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.title = expanded ? 'Hide filters' : 'Show filters';
    syncToggle(panel);
  }

  function decorate(panel, index) {
    if (!qualifies(panel)) return;

    const existingToggleId = panel.getAttribute('data-incheck-filter-toggle-id');
    if (panel.getAttribute(MANAGED) === 'true' && existingToggleId && document.getElementById(existingToggleId)) {
      syncToggle(panel);
      return;
    }

    const unique = `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2,7)}`;
    const toggleId = `${TOGGLE_ID_PREFIX}-${unique}`;
    const row = document.createElement('div');
    row.className = 'ic-filter-toggle-row';
    row.setAttribute('data-incheck-filter-toggle-row', 'true');

    const button = document.createElement('button');
    button.id = toggleId;
    button.type = 'button';
    button.className = 'ic-filter-toggle-btn';
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `
      <span class="ic-filter-toggle-icon" aria-hidden="true">⌁</span>
      <span>Filters</span>
      <span class="ic-filter-toggle-count" aria-hidden="false">0</span>
      <span class="ic-filter-toggle-arrow" aria-hidden="true">▾</span>
    `;

    row.appendChild(button);
    panel.parentNode?.insertBefore(row, panel);
    panel.setAttribute(MANAGED, 'true');
    panel.setAttribute('data-incheck-filter-toggle-id', toggleId);
    panel.classList.add('ic-collapsible-filter-panel');

    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      setExpanded(panel, button, !expanded);
    });

    panel.addEventListener('input', () => syncToggle(panel));
    panel.addEventListener('change', () => syncToggle(panel));

    setExpanded(panel, button, false);
  }

  function scan() {
    scanTimer = null;
    if (!document.body || document.body.classList.contains('auth-locked')) return;
    installStyles();
    const panels = Array.from(document.querySelectorAll(candidateSelector));
    panels.forEach((panel, index) => decorate(panel, index));
  }

  function scheduleScan(delay = 60) {
    if (scanTimer) global.clearTimeout(scanTimer);
    scanTimer = global.setTimeout(scan, delay);
  }

  function start() {
    if (!document.body) return;
    installStyles();
    scheduleScan(0);

    if (typeof MutationObserver !== 'undefined') {
      const contentObserver = new MutationObserver(records => {
        if (records.some(record => record.addedNodes && record.addedNodes.length)) scheduleScan(80);
      });
      contentObserver.observe(document.body, { childList: true, subtree: true });

      const authObserver = new MutationObserver(() => {
        if (!document.body.classList.contains('auth-locked')) scheduleScan(40);
      });
      authObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  global.InCheck360CollapsibleFilters = Object.freeze({
    refresh: () => scheduleScan(0)
  });
})(window);
