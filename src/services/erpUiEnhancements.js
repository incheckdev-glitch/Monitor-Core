(function installInCheck360ErpUiEnhancements(global) {
  const STORAGE = {
    density: 'incheck360OperationsPortal.tableDensity',
    favorites: 'incheck360OperationsPortal.favoriteModules'
  };

  const state = {
    installed: false,
    scanTimer: null,
    palette: null,
    paletteInput: null,
    paletteResults: null,
    favoritesHost: null,
    observer: null,
    authObserver: null
  };

  const STATUS_GROUPS = {
    success: new Set(['active','active client','paid','completed','complete','accepted','signed','approved','resolved','verified','success','successful','settled','received','renewed']),
    warning: new Set(['pending','due','awaiting','awaiting approval','under review','review','partially paid','partial','scheduled','upcoming','warning','on hold']),
    danger: new Set(['overdue','rejected','critical','failed','failure','cancelled','canceled','expired','declined','blocked','error','past due']),
    info: new Set(['draft','in progress','in-progress','prospect','sent','open','new','lead','proposal','agreement','processing','working']),
    neutral: new Set(['archived','inactive','void','closed','disabled','unknown','not verified','unverified'])
  };

  const EXCLUDED_DRAWER_WORDS = ['preview','pdf','print','signature','approval','notification','confirm','delete','warning','export','import'];

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }

  function isAuthenticatedShell() {
    return Boolean(document.body && !document.body.classList.contains('auth-locked'));
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(global.localStorage?.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      global.localStorage?.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function installStyles() {
    if (document.getElementById('incheck360-enterprise-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'incheck360-enterprise-ui-style';
    style.textContent = `
      body:not(.auth-locked){
        --ic-blue:#1546e8;
        --ic-blue-strong:#0f3dc7;
        --ic-ink:#0f172a;
        --ic-muted:#64748b;
        --ic-border:#e2e8f0;
        --ic-soft:#f8fafc;
        --ic-card:#ffffff;
        --ic-radius:14px;
        --ic-shadow:0 7px 24px rgba(15,23,42,.06);
      }

      body:not(.auth-locked) .ic-standard-header{
        border:1px solid var(--ic-border)!important;
        border-radius:var(--ic-radius)!important;
        background:var(--ic-card)!important;
        box-shadow:0 3px 14px rgba(15,23,42,.04)!important;
        padding:16px 18px!important;
        margin-bottom:14px!important;
      }
      body:not(.auth-locked) .ic-breadcrumb-line{
        display:flex;
        align-items:center;
        gap:7px;
        flex-wrap:wrap;
        margin:0 0 8px;
        color:var(--ic-muted);
        font-size:11.5px;
        font-weight:700;
      }
      body:not(.auth-locked) .ic-breadcrumb-line strong{color:var(--ic-blue);font-weight:800;}
      body:not(.auth-locked) .ic-breadcrumb-line + h1,
      body:not(.auth-locked) .ic-breadcrumb-line + h2,
      body:not(.auth-locked) .ic-standard-header h1,
      body:not(.auth-locked) .ic-standard-header h2{
        color:var(--ic-ink)!important;
        letter-spacing:-.02em!important;
      }

      body:not(.auth-locked) .ic-table-shell{
        border:1px solid var(--ic-border)!important;
        border-radius:14px!important;
        overflow:auto!important;
        background:var(--ic-card)!important;
        box-shadow:0 5px 18px rgba(15,23,42,.045)!important;
      }
      body:not(.auth-locked) table.ic-enterprise-table{
        width:100%!important;
        border-collapse:separate!important;
        border-spacing:0!important;
        background:transparent!important;
      }
      body:not(.auth-locked) table.ic-enterprise-table thead th{
        position:sticky;
        top:0;
        z-index:3;
        background:#f8fafc!important;
        color:#475569!important;
        border-bottom:1px solid #dfe6ef!important;
        font-size:11px!important;
        font-weight:850!important;
        letter-spacing:.025em!important;
        text-transform:none!important;
        white-space:nowrap!important;
      }
      body:not(.auth-locked) table.ic-enterprise-table tbody td{
        border-bottom:1px solid #edf1f6!important;
        color:#334155;
        vertical-align:middle!important;
      }
      body:not(.auth-locked) table.ic-enterprise-table tbody tr:last-child td{border-bottom:0!important;}
      body:not(.auth-locked) table.ic-enterprise-table tbody tr:hover td{background:#f8faff!important;}
      body:not(.auth-locked)[data-ic-table-density="comfortable"] table.ic-enterprise-table th,
      body:not(.auth-locked)[data-ic-table-density="comfortable"] table.ic-enterprise-table td{padding:11px 12px!important;}
      body:not(.auth-locked)[data-ic-table-density="compact"] table.ic-enterprise-table th,
      body:not(.auth-locked)[data-ic-table-density="compact"] table.ic-enterprise-table td{padding:7px 9px!important;font-size:11.5px!important;}

      body:not(.auth-locked) [data-ic-status]{
        display:inline-flex!important;
        align-items:center!important;
        min-height:24px!important;
        padding:3px 9px!important;
        border-radius:999px!important;
        font-size:10.5px!important;
        font-weight:850!important;
        line-height:1.2!important;
        border:1px solid transparent!important;
        white-space:nowrap!important;
      }
      body:not(.auth-locked) [data-ic-status="success"]{background:#ecfdf3!important;color:#166534!important;border-color:#bbf7d0!important;}
      body:not(.auth-locked) [data-ic-status="warning"]{background:#fff8e6!important;color:#92400e!important;border-color:#fde68a!important;}
      body:not(.auth-locked) [data-ic-status="danger"]{background:#fef2f2!important;color:#b91c1c!important;border-color:#fecaca!important;}
      body:not(.auth-locked) [data-ic-status="info"]{background:#eef4ff!important;color:#1d4ed8!important;border-color:#c7d7fe!important;}
      body:not(.auth-locked) [data-ic-status="neutral"]{background:#f1f5f9!important;color:#475569!important;border-color:#dbe3ec!important;}

      body:not(.auth-locked) .ic-empty-state{
        display:flex;
        align-items:center;
        justify-content:center;
        min-height:110px;
        padding:20px;
        margin-top:10px;
        border:1px dashed #cbd5e1;
        border-radius:12px;
        background:#fbfdff;
        color:#64748b;
        font-size:12px;
        font-weight:700;
        text-align:center;
      }

      body:not(.auth-locked) .ic-form-polish input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),
      body:not(.auth-locked) .ic-form-polish select,
      body:not(.auth-locked) .ic-form-polish textarea{
        border-radius:10px!important;
        border-color:#d6deea!important;
        transition:border-color .14s ease,box-shadow .14s ease,background .14s ease!important;
      }
      body:not(.auth-locked) .ic-form-polish input:focus,
      body:not(.auth-locked) .ic-form-polish select:focus,
      body:not(.auth-locked) .ic-form-polish textarea:focus{
        border-color:#7fa0ff!important;
        box-shadow:0 0 0 3px rgba(21,70,232,.10)!important;
        outline:none!important;
      }
      body:not(.auth-locked) .ic-form-polish .form-actions,
      body:not(.auth-locked) .ic-form-polish .modal-actions,
      body:not(.auth-locked) .ic-form-polish .dialog-actions{
        position:sticky!important;
        bottom:0!important;
        z-index:5!important;
        margin-top:16px!important;
        padding:12px 0 2px!important;
        background:linear-gradient(180deg,rgba(255,255,255,0),#fff 24%)!important;
      }

      body:not(.auth-locked) .ic-side-drawer-host{
        align-items:stretch!important;
        justify-content:flex-end!important;
        padding:0!important;
      }
      body:not(.auth-locked) .ic-side-drawer-host > .modal-content,
      body:not(.auth-locked) .ic-side-drawer-host > .dialog-content,
      body:not(.auth-locked) .ic-side-drawer-host .modal-content:first-child{
        width:min(720px,94vw)!important;
        max-width:min(720px,94vw)!important;
        height:100vh!important;
        max-height:100vh!important;
        margin:0!important;
        border-radius:18px 0 0 18px!important;
        overflow:auto!important;
        box-shadow:-22px 0 54px rgba(15,23,42,.20)!important;
        animation:icDrawerIn .18s ease-out!important;
      }
      @keyframes icDrawerIn{from{transform:translateX(18px);opacity:.6}to{transform:translateX(0);opacity:1}}

      body:not(.auth-locked) .ic-command-overlay{
        position:fixed;
        inset:0;
        z-index:2500;
        display:flex;
        align-items:flex-start;
        justify-content:center;
        padding:12vh 18px 18px;
        background:rgba(15,23,42,.35);
        backdrop-filter:blur(4px);
      }
      body:not(.auth-locked) .ic-command-overlay[hidden]{display:none!important;}
      body:not(.auth-locked) .ic-command-palette{
        width:min(680px,96vw);
        overflow:hidden;
        border:1px solid #d8e1ee;
        border-radius:18px;
        background:#fff;
        box-shadow:0 26px 80px rgba(15,23,42,.22);
      }
      body:not(.auth-locked) .ic-command-head{padding:13px;border-bottom:1px solid #edf1f6;}
      body:not(.auth-locked) .ic-command-head input{
        width:100%;height:46px;border:1px solid #cfd9e8;border-radius:12px;padding:0 14px;
        font:inherit;font-size:14px;color:#0f172a;background:#fff;outline:none;
      }
      body:not(.auth-locked) .ic-command-head input:focus{border-color:#7fa0ff;box-shadow:0 0 0 3px rgba(21,70,232,.10);}
      body:not(.auth-locked) .ic-command-results{max-height:min(54vh,520px);overflow:auto;padding:8px;}
      body:not(.auth-locked) .ic-command-item{
        width:100%;min-height:46px;display:flex;align-items:center;gap:11px;padding:8px 11px;
        border:0;border-radius:10px;background:transparent;color:#1e293b;font:inherit;text-align:left;cursor:pointer;
      }
      body:not(.auth-locked) .ic-command-item:hover,
      body:not(.auth-locked) .ic-command-item.is-selected{background:#eef4ff;color:#1546e8;}
      body:not(.auth-locked) .ic-command-icon{width:25px;text-align:center;font-size:15px;}
      body:not(.auth-locked) .ic-command-copy{min-width:0;flex:1;}
      body:not(.auth-locked) .ic-command-copy strong{display:block;font-size:12.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      body:not(.auth-locked) .ic-command-copy span{display:block;margin-top:2px;font-size:10.5px;font-weight:650;color:#64748b;}
      body:not(.auth-locked) .ic-command-kbd{font-size:10px;font-weight:800;color:#64748b;border:1px solid #dbe3ec;border-radius:6px;padding:3px 6px;background:#f8fafc;}
      body:not(.auth-locked) .ic-command-empty{padding:24px;text-align:center;color:#64748b;font-size:12px;font-weight:700;}

      body:not(.auth-locked) .ic-profile-ui-section{padding:7px 6px;border-top:1px solid #eef2f7;margin-top:4px;}
      body:not(.auth-locked) .ic-profile-ui-label{display:block;padding:4px 5px 7px;font-size:9.5px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;}
      body:not(.auth-locked) .ic-profile-ui-button{
        width:100%;height:36px;padding:0 9px;display:flex;align-items:center;gap:8px;border:0;border-radius:9px;
        background:transparent;color:#334155;font:inherit;font-size:11.5px;font-weight:750;text-align:left;cursor:pointer;
      }
      body:not(.auth-locked) .ic-profile-ui-button:hover{background:#f1f5f9;color:#1546e8;}

      body:not(.auth-locked) .ic-favorites-group{order:-999!important;margin-bottom:4px!important;}
      body:not(.auth-locked) .ic-favorites-group .view-menu-group-body{display:block!important;}
      body:not(.auth-locked) .ic-favorite-tab{position:relative;}
      body:not(.auth-locked) .ic-favorite-tab::after{content:'★';margin-left:auto;color:#f59e0b;font-size:10px;}

      body:not(.auth-locked) .notification-preview-panel{
        border-radius:16px!important;
        border-color:#dbe3ee!important;
        box-shadow:0 20px 54px rgba(15,23,42,.16)!important;
        overflow:hidden!important;
      }
      body:not(.auth-locked) .notification-preview-header{padding:12px 14px!important;background:#fbfdff!important;border-bottom:1px solid #edf1f6!important;}
      body:not(.auth-locked) .notification-preview-list > *{border-bottom:1px solid #edf1f6!important;}
      body:not(.auth-locked) .notification-preview-list > *:last-child{border-bottom:0!important;}
      body:not(.auth-locked) .notification-unread,
      body:not(.auth-locked) [data-unread="true"]{background:#f4f7ff!important;box-shadow:inset 3px 0 0 #1546e8;}

      body:not(.auth-locked) .ic-clickable-kpi{transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease!important;}
      body:not(.auth-locked) .ic-clickable-kpi:hover{transform:translateY(-1px);box-shadow:0 9px 24px rgba(15,23,42,.08)!important;border-color:#c7d5f7!important;}

      :root:not([data-theme="light"]) body:not(.auth-locked),
      :root[data-theme="dark"] body:not(.auth-locked){
        --ic-ink:#e5edf8;--ic-muted:#94a3b8;--ic-border:#2b3a50;--ic-soft:#101827;--ic-card:#111827;--ic-shadow:0 8px 28px rgba(0,0,0,.22);
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-standard-header,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-standard-header,
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-table-shell,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-table-shell{background:#111827!important;border-color:#2b3a50!important;}
      :root:not([data-theme="light"]) body:not(.auth-locked) table.ic-enterprise-table thead th,
      :root[data-theme="dark"] body:not(.auth-locked) table.ic-enterprise-table thead th{background:#162033!important;color:#cbd5e1!important;border-bottom-color:#334155!important;}
      :root:not([data-theme="light"]) body:not(.auth-locked) table.ic-enterprise-table tbody td,
      :root[data-theme="dark"] body:not(.auth-locked) table.ic-enterprise-table tbody td{color:#d7e0ec!important;border-bottom-color:#263449!important;}
      :root:not([data-theme="light"]) body:not(.auth-locked) table.ic-enterprise-table tbody tr:hover td,
      :root[data-theme="dark"] body:not(.auth-locked) table.ic-enterprise-table tbody tr:hover td{background:#17223a!important;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-command-palette,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-command-palette{background:#111827;border-color:#334155;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-command-head,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-command-head{border-bottom-color:#263449;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-command-head input,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-command-head input{background:#0f172a;border-color:#334155;color:#e5e7eb;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-command-item,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-command-item{color:#e5e7eb;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-command-item:hover,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-command-item:hover{background:#172554;color:#a8c0ff;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-profile-ui-section,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-profile-ui-section{border-top-color:#263449;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-profile-ui-button,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-profile-ui-button{color:#dbe4f0;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-profile-ui-button:hover,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-profile-ui-button:hover{background:#172033;color:#9bb6ff;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .notification-preview-header,
      :root[data-theme="dark"] body:not(.auth-locked) .notification-preview-header{background:#111827!important;border-bottom-color:#263449!important;}

      @media(max-width:760px){
        body:not(.auth-locked) .ic-side-drawer-host > .modal-content,
        body:not(.auth-locked) .ic-side-drawer-host > .dialog-content,
        body:not(.auth-locked) .ic-side-drawer-host .modal-content:first-child{width:100vw!important;max-width:100vw!important;border-radius:0!important;}
        body:not(.auth-locked) .ic-command-overlay{padding-top:7vh;}
      }
    `;
    document.head.appendChild(style);
  }

  function currentTab() {
    return document.querySelector('.view-tab.active, .view-tab[aria-selected="true"]');
  }

  function activeView() {
    const tab = currentTab();
    const id = tab?.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  function currentModuleInfo() {
    const tab = currentTab();
    if (!tab) return null;
    const group = tab.closest('.view-menu-group');
    const groupName = clean(group?.querySelector('.view-menu-group-label > span:last-child')?.textContent || group?.getAttribute('aria-label') || 'Workspace').replace(/\s+modules$/i,'');
    const label = clean(tab.textContent || tab.dataset.view || 'Module');
    return { tab, groupName, label, key: clean(tab.dataset.view || tab.id || label) };
  }

  function decorateHeaders() {
    const view = activeView();
    const info = currentModuleInfo();
    if (!view || !info) return;

    const headerSelectors = [
      '.page-header','.section-header','.section-head','.view-header','.module-header','.workspace-header',
      '[class*="page-header"]','[class*="section-head"]','[class*="view-header"]'
    ];
    const header = headerSelectors.map(selector => view.querySelector(selector)).find(Boolean);
    if (!header) return;

    header.classList.add('ic-standard-header');
    if (!header.querySelector('.ic-breadcrumb-line')) {
      const crumb = document.createElement('div');
      crumb.className = 'ic-breadcrumb-line';
      crumb.innerHTML = `<span>${info.groupName}</span><span aria-hidden="true">/</span><strong>${info.label}</strong>`;
      header.prepend(crumb);
    }
  }

  function findTableShell(table) {
    const existing = table.closest('.table-wrap,.table-wrapper,.table-responsive,.table-container,.data-table-wrap,[class*="table-wrap"],[class*="table-container"]');
    if (existing) return existing;
    const parent = table.parentElement;
    if (!parent || parent === document.body) return null;
    return parent;
  }

  function decorateTables(root = document) {
    root.querySelectorAll?.('main table, .content table, [role="tabpanel"] table').forEach(table => {
      if (table.closest('#loginSection,.modal.preview,.print-preview,[data-print-preview]')) return;
      table.classList.add('ic-enterprise-table');
      const shell = findTableShell(table);
      if (shell) shell.classList.add('ic-table-shell');
    });
  }

  function statusGroup(value) {
    const text = normalize(value);
    for (const [group, values] of Object.entries(STATUS_GROUPS)) {
      if (values.has(text)) return group;
    }
    return '';
  }

  function decorateStatuses(root = document) {
    const candidates = root.querySelectorAll?.('td, .status, .status-badge, .badge, [class*="status-chip"], [class*="status-badge"]') || [];
    candidates.forEach(el => {
      if (el.children.length > 1 || el.querySelector('button,input,select,a')) return;
      const value = clean(el.textContent);
      if (!value || value.length > 28) return;
      const group = statusGroup(value);
      if (group) el.setAttribute('data-ic-status', group);
      else el.removeAttribute('data-ic-status');
    });
  }

  function decorateForms(root = document) {
    const forms = root.querySelectorAll?.('main form, .content form, .modal-content form, [role="dialog"] form') || [];
    forms.forEach(form => form.classList.add('ic-form-polish'));
  }

  function modalHeading(modal) {
    return normalize(modal.querySelector('h1,h2,h3,.modal-title,.dialog-title')?.textContent);
  }

  function decorateDrawers(root = document) {
    const modals = root.querySelectorAll?.('.modal,[role="dialog"],.dialog') || [];
    modals.forEach(modal => {
      if (modal.classList.contains('ic-side-drawer-host')) return;
      const content = modal.querySelector('.modal-content,.dialog-content');
      const form = content?.querySelector('form');
      const title = modalHeading(modal);
      if (!content || !form || !title) return;
      if (EXCLUDED_DRAWER_WORDS.some(word => title.includes(word))) return;
      if (!/^(add|edit|new|view|details?|create|update|company|contact|lead|deal|invoice|receipt|client|vendor|employee)/i.test(title)) return;
      modal.classList.add('ic-side-drawer-host');
    });
  }

  function decorateKpis(root = document) {
    const candidates = root.querySelectorAll?.('.kpi-card,.stat-card,.metric-card,[class*="kpi-card"],[class*="stat-card"],[class*="metric-card"]') || [];
    candidates.forEach(card => {
      if (card.matches('button,a,[role="button"]') || card.querySelector('button,a')) card.classList.add('ic-clickable-kpi');
    });
  }

  function ensureEmptyStates() {
    document.querySelectorAll('table.ic-enterprise-table').forEach(table => {
      if (!table.offsetParent) return;
      const tbody = table.tBodies?.[0];
      const shell = findTableShell(table) || table.parentElement;
      if (!tbody || !shell) return;
      const meaningful = Array.from(tbody.rows).some(row => !row.classList.contains('ic-empty-placeholder') && clean(row.textContent));
      let empty = shell.parentElement?.querySelector(':scope > .ic-empty-state[data-for-table="true"]');
      if (!meaningful) {
        if (!empty) {
          empty = document.createElement('div');
          empty.className = 'ic-empty-state';
          empty.dataset.forTable = 'true';
          empty.textContent = 'No records found. Try clearing filters or add a new record.';
          shell.insertAdjacentElement('afterend', empty);
        }
      } else if (empty) {
        empty.remove();
      }
    });
  }

  function densityValue() {
    try {
      return global.localStorage?.getItem(STORAGE.density) === 'compact' ? 'compact' : 'comfortable';
    } catch (_) {
      return 'comfortable';
    }
  }

  function applyDensity(value) {
    const next = value === 'compact' ? 'compact' : 'comfortable';
    document.body?.setAttribute('data-ic-table-density', next);
    try { global.localStorage?.setItem(STORAGE.density, next); } catch (_) {}
    document.querySelectorAll('[data-ic-density-label]').forEach(el => { el.textContent = next === 'compact' ? 'Compact tables' : 'Comfortable tables'; });
  }

  function ensureProfileUiControls() {
    const menu = document.getElementById('topbarProfileMenu');
    if (!menu || menu.querySelector('.ic-profile-ui-section')) return;

    const section = document.createElement('div');
    section.className = 'ic-profile-ui-section';
    section.innerHTML = `
      <span class="ic-profile-ui-label">Workspace</span>
      <button type="button" class="ic-profile-ui-button" data-ic-toggle-density><span aria-hidden="true">↕</span><span data-ic-density-label></span></button>
      <button type="button" class="ic-profile-ui-button" data-ic-pin-module><span aria-hidden="true">★</span><span>Pin current module</span></button>
      <button type="button" class="ic-profile-ui-button" data-ic-open-command><span aria-hidden="true">⌕</span><span>Command palette</span><span style="margin-left:auto;font-size:9px;color:#94a3b8;">Ctrl K</span></button>
    `;
    const logout = menu.querySelector('.topbar-profile-menu-logout');
    if (logout) logout.before(section); else menu.appendChild(section);

    section.querySelector('[data-ic-toggle-density]')?.addEventListener('click', event => {
      event.stopPropagation();
      applyDensity(densityValue() === 'compact' ? 'comfortable' : 'compact');
    });
    section.querySelector('[data-ic-pin-module]')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleCurrentFavorite();
    });
    section.querySelector('[data-ic-open-command]')?.addEventListener('click', event => {
      event.stopPropagation();
      closeProfileMenuBestEffort();
      openPalette();
    });
    applyDensity(densityValue());
    syncPinButton();
  }

  function closeProfileMenuBestEffort() {
    global.InCheck360ModernTopbar?.closeProfileMenu?.();
  }

  function favoriteKeys() {
    const list = readJson(STORAGE.favorites, []);
    return Array.isArray(list) ? list.map(clean).filter(Boolean) : [];
  }

  function toggleCurrentFavorite() {
    const info = currentModuleInfo();
    if (!info?.key) return;
    const list = favoriteKeys();
    const idx = list.indexOf(info.key);
    if (idx >= 0) list.splice(idx, 1); else list.unshift(info.key);
    writeJson(STORAGE.favorites, list.slice(0, 8));
    renderFavorites();
    syncPinButton();
  }

  function syncPinButton() {
    const button = document.querySelector('[data-ic-pin-module]');
    const info = currentModuleInfo();
    if (!button || !info) return;
    const pinned = favoriteKeys().includes(info.key);
    const label = button.querySelector('span:last-child');
    if (label) label.textContent = pinned ? 'Unpin current module' : 'Pin current module';
  }

  function renderFavorites() {
    const tabs = document.querySelector('.view-tabs');
    if (!tabs) return;
    const keys = favoriteKeys();
    let group = tabs.querySelector('.ic-favorites-group');
    if (!keys.length) {
      group?.remove();
      return;
    }
    if (!group) {
      group = document.createElement('div');
      group.className = 'view-menu-group is-expanded ic-favorites-group';
      group.innerHTML = `
        <div class="view-menu-group-title" aria-hidden="true">
          <span class="view-menu-group-label"><span class="view-menu-group-icon">★</span><span>Favorites</span></span>
        </div>
        <div class="view-menu-group-body"></div>`;
      tabs.prepend(group);
    }
    const signature = keys.join('|');
    if (group.dataset.icFavoritesSignature === signature) return;
    group.dataset.icFavoritesSignature = signature;
    const body = group.querySelector('.view-menu-group-body');
    body.innerHTML = '';
    keys.forEach(key => {
      const original = Array.from(document.querySelectorAll('.view-tab')).find(tab => clean(tab.dataset.view || tab.id || clean(tab.textContent)) === key && !tab.closest('.ic-favorites-group'));
      if (!original) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'view-tab ic-favorite-tab';
      button.innerHTML = original.innerHTML;
      button.title = `Open ${clean(original.textContent)}`;
      button.addEventListener('click', () => original.click());
      body.appendChild(button);
    });
  }

  function paletteItems() {
    const items = [];
    const seen = new Set();
    document.querySelectorAll('.view-tab').forEach(tab => {
      if (tab.closest('.ic-favorites-group')) return;
      const label = clean(tab.textContent);
      if (!label || tab.hidden || tab.getAttribute('aria-hidden') === 'true') return;
      const key = `${label}|${tab.dataset.view || tab.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const group = clean(tab.closest('.view-menu-group')?.querySelector('.view-menu-group-label > span:last-child')?.textContent || 'Workspace');
      const icon = clean(tab.querySelector('.icon')?.textContent || tab.closest('.view-menu-group')?.querySelector('.view-menu-group-icon')?.textContent || '›');
      items.push({ label, group, icon, action: () => tab.click() });
    });
    const globalSearch = document.getElementById('searchInput');
    if (globalSearch) items.unshift({ label:'Search the Operations Portal', group:'Global', icon:'⌕', action:() => { globalSearch.focus(); globalSearch.select?.(); } });
    return items;
  }

  function ensurePalette() {
    if (state.palette) return;
    const overlay = document.createElement('div');
    overlay.className = 'ic-command-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="ic-command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="ic-command-head"><input type="search" placeholder="Go to a module or search…" aria-label="Command palette search"></div>
        <div class="ic-command-results" role="listbox"></div>
      </div>`;
    document.body.appendChild(overlay);
    state.palette = overlay;
    state.paletteInput = overlay.querySelector('input');
    state.paletteResults = overlay.querySelector('.ic-command-results');

    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) closePalette();
    });
    state.paletteInput.addEventListener('input', renderPaletteResults);
    state.paletteInput.addEventListener('keydown', event => {
      const rows = Array.from(state.paletteResults.querySelectorAll('.ic-command-item'));
      const current = rows.findIndex(row => row.classList.contains('is-selected'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!rows.length) return;
        rows.forEach(row => row.classList.remove('is-selected'));
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = current < 0 ? (delta > 0 ? 0 : rows.length - 1) : (current + delta + rows.length) % rows.length;
        rows[next].classList.add('is-selected');
        rows[next].scrollIntoView({ block:'nearest' });
      } else if (event.key === 'Enter') {
        const selected = rows.find(row => row.classList.contains('is-selected')) || rows[0];
        if (selected) { event.preventDefault(); selected.click(); }
      } else if (event.key === 'Escape') {
        event.preventDefault(); closePalette();
      }
    });
  }

  function renderPaletteResults() {
    if (!state.paletteResults) return;
    const q = normalize(state.paletteInput?.value);
    const items = paletteItems().filter(item => !q || normalize(`${item.label} ${item.group}`).includes(q)).slice(0, 18);
    state.paletteResults.innerHTML = '';
    if (!items.length) {
      state.paletteResults.innerHTML = '<div class="ic-command-empty">No matching module found.</div>';
      return;
    }
    items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ic-command-item${index === 0 ? ' is-selected' : ''}`;
      button.setAttribute('role','option');
      button.innerHTML = `<span class="ic-command-icon" aria-hidden="true">${item.icon}</span><span class="ic-command-copy"><strong>${item.label}</strong><span>${item.group}</span></span>${index === 0 ? '<span class="ic-command-kbd">Enter</span>' : ''}`;
      button.addEventListener('click', () => { closePalette(); global.setTimeout(item.action, 0); });
      state.paletteResults.appendChild(button);
    });
  }

  function openPalette() {
    if (!isAuthenticatedShell()) return;
    ensurePalette();
    state.palette.hidden = false;
    state.paletteInput.value = '';
    renderPaletteResults();
    global.setTimeout(() => state.paletteInput.focus(), 0);
  }

  function closePalette() {
    if (!state.palette) return;
    state.palette.hidden = true;
  }

  function enhanceNotifications() {
    const panel = document.getElementById('notificationPreviewPanel');
    const header = panel?.querySelector('.notification-preview-header');
    if (!panel || !header || header.querySelector('[data-ic-mark-all-read]')) return;
    if (!global.Notifications?.markAllRead) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn ghost sm';
    button.dataset.icMarkAllRead = 'true';
    button.textContent = 'Mark all read';
    button.addEventListener('click', async event => {
      event.stopPropagation();
      try { await global.Notifications.markAllRead(); } catch (_) {}
    });
    const controls = header.querySelector('div');
    if (controls) controls.prepend(button); else header.appendChild(button);
  }

  function scan() {
    state.scanTimer = null;
    if (!isAuthenticatedShell()) return;
    decorateHeaders();
    decorateTables();
    decorateStatuses();
    decorateForms();
    decorateDrawers();
    decorateKpis();
    ensureEmptyStates();
    ensureProfileUiControls();
    renderFavorites();
    syncPinButton();
    enhanceNotifications();
  }

  function scheduleScan(delay = 70) {
    if (state.scanTimer) global.clearTimeout(state.scanTimer);
    state.scanTimer = global.setTimeout(scan, delay);
  }

  function bindGlobalEvents() {
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'k') {
        if (!isAuthenticatedShell()) return;
        event.preventDefault();
        openPalette();
      } else if (event.key === 'Escape' && state.palette && !state.palette.hidden) {
        event.preventDefault();
        closePalette();
      }
    });
    document.addEventListener('click', event => {
      if (event.target?.closest?.('.view-tab')) global.setTimeout(() => { scheduleScan(20); syncPinButton(); }, 20);
    });
    global.addEventListener('hashchange', () => scheduleScan(30));
    global.addEventListener('popstate', () => scheduleScan(30));
  }

  function install() {
    if (state.installed || !isAuthenticatedShell()) return false;
    state.installed = true;
    installStyles();
    applyDensity(densityValue());
    ensurePalette();
    bindGlobalEvents();
    scan();

    if (typeof MutationObserver !== 'undefined') {
      state.observer = new MutationObserver(records => {
        if (!isAuthenticatedShell()) return;
        if (records.some(record => record.addedNodes?.length || record.type === 'attributes')) scheduleScan(90);
      });
      state.observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','aria-selected','hidden'] });
    }
    return true;
  }

  function watchAuth() {
    if (!document.body || state.installed || typeof MutationObserver === 'undefined') return;
    if (isAuthenticatedShell()) { install(); return; }
    state.authObserver = new MutationObserver(() => {
      if (isAuthenticatedShell()) {
        state.authObserver.disconnect();
        state.authObserver = null;
        global.setTimeout(install, 0);
      }
    });
    state.authObserver.observe(document.body, { attributes:true, attributeFilter:['class'] });
  }

  function start() {
    installStyles();
    install();
    watchAuth();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();

  global.InCheck360ErpUi = Object.freeze({
    refresh: () => scheduleScan(0),
    openCommandPalette: openPalette,
    setTableDensity: applyDensity
  });
})(window);
