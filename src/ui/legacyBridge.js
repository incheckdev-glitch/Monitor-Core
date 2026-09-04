import {
  UIComponents,
  clean,
  normalize,
  statusTone
} from './components.js?v=20260904-ds1';

const STORAGE = {
  density: 'incheck360OperationsPortal.tableDensity',
  favorites: 'incheck360OperationsPortal.favoriteModules'
};

const DRAWER_EXCLUSIONS = ['preview','pdf','print','signature','approval','notification','confirm','delete','warning','export','import'];

const state = {
  scanTimer: null,
  observer: null,
  authObserver: null,
  palette: null,
  paletteInput: null,
  paletteResults: null
};

function isAuthenticated() {
  return Boolean(document.body && !document.body.classList.contains('auth-locked'));
}

function currentTab() {
  return document.querySelector('.view-tab.active, .view-tab[aria-selected="true"]');
}

function currentModuleInfo() {
  const tab = currentTab();
  if (!tab) return null;
  const group = tab.closest('.view-menu-group');
  const groupName = clean(
    group?.querySelector('.view-menu-group-label > span:last-child')?.textContent ||
    group?.getAttribute('aria-label') ||
    'Workspace'
  ).replace(/\s+modules$/i, '');
  const label = clean(tab.textContent || tab.dataset.view || tab.id || 'Module');
  const key = clean(tab.dataset.view || tab.id || label);
  return { tab, group, groupName, label, key };
}

function candidateViews() {
  const direct = Array.from(document.querySelectorAll('[id$="View"],[role="tabpanel"],.view-panel,.module-view,.workspace-view'));
  return direct.filter(el => !el.closest('#loginSection,.modal,[role="dialog"]'));
}

function findVisibleView() {
  const info = currentModuleInfo();
  const controlled = info?.tab?.getAttribute('aria-controls');
  if (controlled) {
    const el = document.getElementById(controlled);
    if (el) return el;
  }
  return candidateViews().find(el => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }) || document.querySelector('main');
}

function pageHeaderCandidate(view) {
  if (!(view instanceof Element)) return null;
  const selectors = [
    '.page-header','.section-header','.section-head','.view-header','.module-header','.workspace-header',
    '[class*="page-header"]','[class*="section-head"]','[class*="view-header"]'
  ];
  return selectors.map(selector => view.querySelector(selector)).find(Boolean) || null;
}

function adoptPage(view, info = currentModuleInfo()) {
  if (!(view instanceof Element) || !info) return;
  UIComponents.PageLayout.adopt(view);

  const header = pageHeaderCandidate(view);
  if (header) UIComponents.PageHeader.adopt(header, { group: info.groupName, title: info.label });

  view.querySelectorAll('.toolbar,.actions-bar,.page-actions,.section-actions,[class*="toolbar"],[class*="action-bar"]').forEach(el => {
    if (el.closest('.modal,[role="dialog"],#appHeader,.view-menu')) return;
    UIComponents.ActionBar.adopt(el);
  });

  view.querySelectorAll(
    '#companyFilterCard,#contactsFilterCard,#mainFiltersPanel,#eventsModuleFilterCard,' +
    '.leads-filter-card,.deals-filter-card,.rf-filter-card,.pf-filter-panel,.analytics-filter-bar,' +
    '[id$="FilterCard"],[id$="FiltersCard"],[id$="FilterPanel"],[id$="FiltersPanel"],' +
    '[class*="-filter-card"],[class*="-filters-card"],[class*="-filter-panel"]'
  ).forEach(panel => {
    if (panel.closest('.modal,[role="dialog"],#appHeader')) return;
    UIComponents.FilterPanel.adopt(panel);
  });

  view.querySelectorAll('.kpi-grid,.stats-grid,.metrics-grid,[class*="kpi-grid"],[class*="stats-grid"],[class*="metrics-grid"]').forEach(grid => {
    UIComponents.KpiGrid.adopt(grid);
  });

  view.querySelectorAll('.kpi-card,.stat-card,.metric-card,[class*="kpi-card"],[class*="stat-card"],[class*="metric-card"]').forEach(card => {
    UIComponents.KpiCard.adopt(card);
  });

  view.querySelectorAll('table').forEach(table => {
    if (table.closest('.print-preview,[data-print-preview],.pdf-preview')) return;
    UIComponents.DataTable.adopt(table);
  });

  view.querySelectorAll('form').forEach(form => UIComponents.FormSection.adopt(form));

  view.querySelectorAll('.pagination,.pager,[class*="pagination"],[class*="pager"]').forEach(el => {
    UIComponents.Pagination.adopt(el);
  });

  view.querySelectorAll('.dropdown-menu,.actions-menu,[class*="dropdown-menu"],[class*="actions-menu"]').forEach(el => {
    UIComponents.DropdownMenu.adopt(el);
  });
}

function adoptStatuses(root = document) {
  const candidates = root.querySelectorAll(
    '.status,.status-badge,.badge,[class*="status-chip"],[class*="status-badge"],td'
  );
  candidates.forEach(el => {
    if (el.closest('#loginSection,.print-preview,[data-print-preview]')) return;
    if (el.querySelector('button,input,select,a') || el.children.length > 1) return;
    const value = clean(el.textContent);
    if (!value || value.length > 28) return;
    const tone = statusTone(value);
    const known = tone !== 'neutral' || ['archived','inactive','void','closed','disabled','unknown','not verified','unverified'].includes(normalize(value));
    if (known) UIComponents.StatusBadge.adopt(el, value);
  });
}

function adoptDrawers(root = document) {
  root.querySelectorAll('.modal,[role="dialog"],.dialog').forEach(modal => {
    if (modal.dataset.icdsComponent === 'drawer') return;
    const content = modal.querySelector('.modal-content,.dialog-content');
    const form = content?.querySelector('form');
    const title = normalize(modal.querySelector('h1,h2,h3,.modal-title,.dialog-title')?.textContent);
    if (!content || !form || !title) return;
    if (DRAWER_EXCLUSIONS.some(word => title.includes(word))) return;
    if (!/^(add|edit|new|view|details?|create|update|company|contact|lead|deal|invoice|receipt|client|vendor|employee|agreement|proposal|credit note|expense)/i.test(title)) return;
    UIComponents.Drawer.adopt(modal);
  });
}

function ensureEmptyStates(root = document) {
  root.querySelectorAll('table.icds-table').forEach(table => {
    if (!table.offsetParent) return;
    const tbody = table.tBodies?.[0];
    if (!tbody) return;

    const rows = Array.from(tbody.rows);
    const meaningful = rows.some(row => clean(row.textContent));
    const shell = table.closest('.icds-table-shell') || table.parentElement;
    if (!shell?.parentElement) return;

    let empty = shell.parentElement.querySelector(':scope > .icds-empty[data-icds-auto-empty="true"]');
    if (!meaningful) {
      if (!empty) {
        empty = UIComponents.EmptyState.render(shell.parentElement, 'No records found. Try clearing filters or add a new record.');
        if (empty) empty.dataset.icdsAutoEmpty = 'true';
      }
    } else if (empty) {
      empty.remove();
    }
  });
}

function readDensity() {
  try {
    return localStorage.getItem(STORAGE.density) === 'compact' ? 'compact' : 'comfortable';
  } catch (_) {
    return 'comfortable';
  }
}

function applyDensity(value) {
  const density = value === 'compact' ? 'compact' : 'comfortable';
  document.body?.setAttribute('data-icds-density', density);
  try { localStorage.setItem(STORAGE.density, density); } catch (_) {}
  document.querySelectorAll('[data-icds-density-label]').forEach(el => {
    el.textContent = density === 'compact' ? 'Compact tables' : 'Comfortable tables';
  });
}

function readFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE.favorites) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function saveFavorites(items) {
  try { localStorage.setItem(STORAGE.favorites, JSON.stringify(items)); } catch (_) {}
}

function findTabByKey(key) {
  const target = clean(key);
  return Array.from(document.querySelectorAll('.view-tab')).find(tab => {
    return clean(tab.dataset.view || tab.id || tab.textContent) === target;
  }) || null;
}

function activateTab(tab) {
  if (!tab) return;
  tab.click();
}

function renderFavorites() {
  const tabsHost = document.querySelector('.view-tabs');
  if (!tabsHost) return;

  document.getElementById('icdsFavoritesGroup')?.remove();
  const favorites = readFavorites().filter(item => findTabByKey(item.key));
  if (!favorites.length) return;

  const group = document.createElement('div');
  group.id = 'icdsFavoritesGroup';
  group.className = 'view-menu-group is-expanded icds-favorites';
  group.innerHTML = `
    <button type="button" class="view-menu-group-title" aria-expanded="true">
      <span class="view-menu-group-label"><span class="view-menu-group-icon" aria-hidden="true">★</span><span>Favorites</span></span>
    </button>
    <div class="view-menu-group-body"></div>
  `;

  const body = group.querySelector('.view-menu-group-body');
  favorites.forEach(item => {
    const source = findTabByKey(item.key);
    if (!source) return;
    const clone = source.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.remove('active');
    clone.classList.add('icds-favorite');
    clone.setAttribute('aria-selected', 'false');
    clone.addEventListener('click', event => {
      event.preventDefault();
      activateTab(source);
    });
    body.appendChild(clone);
  });

  tabsHost.prepend(group);
}

function toggleCurrentFavorite() {
  const info = currentModuleInfo();
  if (!info) return;
  const items = readFavorites();
  const index = items.findIndex(item => item.key === info.key);
  if (index >= 0) items.splice(index, 1);
  else items.push({ key: info.key, label: info.label, group: info.groupName });
  saveFavorites(items);
  renderFavorites();
  syncProfileTools();
}

function syncProfileTools() {
  const info = currentModuleInfo();
  const favorites = readFavorites();
  const pinned = info && favorites.some(item => item.key === info.key);
  document.querySelectorAll('[data-icds-pin-label]').forEach(el => {
    el.textContent = pinned ? 'Unpin current module' : 'Pin current module';
  });
}

function ensureProfileTools() {
  const menu = document.getElementById('topbarProfileMenu');
  if (!menu || menu.querySelector('.icds-profile-tools')) return;

  const section = document.createElement('div');
  section.className = 'icds-profile-tools';
  section.innerHTML = `
    <span class="icds-profile-tools-label">Workspace</span>
    <button type="button" class="icds-profile-tool" data-icds-toggle-density>
      <span aria-hidden="true">↕</span><span data-icds-density-label></span>
    </button>
    <button type="button" class="icds-profile-tool" data-icds-pin-current>
      <span aria-hidden="true">★</span><span data-icds-pin-label>Pin current module</span>
    </button>
    <button type="button" class="icds-profile-tool" data-icds-open-command>
      <span aria-hidden="true">⌕</span><span>Command palette</span><span style="margin-left:auto;color:var(--icds-muted);font-size:9px">Ctrl K</span>
    </button>
  `;

  const logout = menu.querySelector('.topbar-profile-menu-logout');
  if (logout) menu.insertBefore(section, logout);
  else menu.appendChild(section);

  section.querySelector('[data-icds-toggle-density]')?.addEventListener('click', () => {
    applyDensity(readDensity() === 'compact' ? 'comfortable' : 'compact');
  });
  section.querySelector('[data-icds-pin-current]')?.addEventListener('click', toggleCurrentFavorite);
  section.querySelector('[data-icds-open-command]')?.addEventListener('click', openCommandPalette);

  applyDensity(readDensity());
  syncProfileTools();
}

function commandItems() {
  const items = [];
  document.querySelectorAll('.view-tab').forEach(tab => {
    if (tab.closest('#icdsFavoritesGroup')) return;
    const group = tab.closest('.view-menu-group');
    const groupName = clean(group?.querySelector('.view-menu-group-label > span:last-child')?.textContent || 'Workspace').replace(/\s+modules$/i,'');
    const label = clean(tab.textContent || tab.dataset.view || tab.id);
    if (!label) return;
    items.push({
      label,
      group: groupName,
      icon: clean(tab.querySelector('.icon,.view-menu-group-icon')?.textContent) || '→',
      run: () => activateTab(tab)
    });
  });
  return items;
}

function renderCommandResults(query = '') {
  if (!state.paletteResults) return;
  const q = normalize(query);
  const items = commandItems().filter(item => {
    return !q || normalize(`${item.label} ${item.group}`).includes(q);
  }).slice(0, 30);

  state.paletteResults.innerHTML = '';
  if (!items.length) {
    state.paletteResults.innerHTML = '<div class="icds-command-empty">No matching module found.</div>';
    return;
  }

  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `icds-command-item${index === 0 ? ' is-selected' : ''}`;
    button.innerHTML = `
      <span class="icds-command-icon" aria-hidden="true">${item.icon}</span>
      <span class="icds-command-copy"><strong>${item.label}</strong><span>${item.group}</span></span>
    `;
    button.addEventListener('click', () => {
      closeCommandPalette();
      item.run();
    });
    state.paletteResults.appendChild(button);
  });
}

function ensureCommandPalette() {
  if (state.palette) return;
  const overlay = document.createElement('div');
  overlay.className = 'icds-command-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="icds-command" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="icds-command-head">
        <input type="search" placeholder="Search modules…" aria-label="Search modules">
      </div>
      <div class="icds-command-results"></div>
    </section>
  `;
  document.body.appendChild(overlay);
  state.palette = overlay;
  state.paletteInput = overlay.querySelector('input');
  state.paletteResults = overlay.querySelector('.icds-command-results');

  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeCommandPalette();
  });
  state.paletteInput.addEventListener('input', () => renderCommandResults(state.paletteInput.value));
  state.paletteInput.addEventListener('keydown', event => {
    const buttons = Array.from(state.paletteResults.querySelectorAll('.icds-command-item'));
    if (!buttons.length) return;
    const current = buttons.findIndex(btn => btn.classList.contains('is-selected'));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons[current]?.classList.remove('is-selected');
      buttons[(current + 1 + buttons.length) % buttons.length].classList.add('is-selected');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[current]?.classList.remove('is-selected');
      buttons[(current - 1 + buttons.length) % buttons.length].classList.add('is-selected');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      (buttons[current >= 0 ? current : 0])?.click();
    }
  });
}

function openCommandPalette() {
  ensureCommandPalette();
  state.palette.hidden = false;
  state.paletteInput.value = '';
  renderCommandResults('');
  requestAnimationFrame(() => state.paletteInput.focus());
}

function closeCommandPalette() {
  if (!state.palette) return;
  state.palette.hidden = true;
}

function bindGlobalKeys() {
  if (document.documentElement.dataset.icdsKeysBound === 'true') return;
  document.documentElement.dataset.icdsKeysBound = 'true';

  document.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    );

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommandPalette();
      return;
    }

    if (event.key === 'Escape' && state.palette && !state.palette.hidden) {
      event.preventDefault();
      closeCommandPalette();
      return;
    }

    if (typing) return;
  });
}

function scan() {
  state.scanTimer = null;
  if (!isAuthenticated()) return;

  UIComponents.AppShell.adopt();
  applyDensity(readDensity());

  candidateViews().forEach(view => adoptPage(view));
  const visible = findVisibleView();
  if (visible) adoptPage(visible);

  adoptStatuses(document);
  adoptDrawers(document);
  ensureEmptyStates(document);
  ensureProfileTools();
  renderFavorites();
  syncProfileTools();

  window.dispatchEvent(new CustomEvent('incheck360:ui:ready', {
    detail: { module: currentModuleInfo()?.key || '' }
  }));
}

function scheduleScan(delay = 60) {
  if (state.scanTimer) clearTimeout(state.scanTimer);
  state.scanTimer = setTimeout(scan, delay);
}

function startObservers() {
  if (typeof MutationObserver === 'undefined' || state.observer) return;

  state.observer = new MutationObserver(records => {
    if (!isAuthenticated()) return;
    if (records.some(record => record.addedNodes && record.addedNodes.length)) scheduleScan(90);
  });
  state.observer.observe(document.body, { childList: true, subtree: true });

  state.authObserver = new MutationObserver(() => {
    if (isAuthenticated()) scheduleScan(20);
  });
  state.authObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('click', event => {
    if (event.target?.closest?.('.view-tab')) scheduleScan(50);
  });
  window.addEventListener('hashchange', () => scheduleScan(40));
  window.addEventListener('popstate', () => scheduleScan(40));
}

export function installLegacyBridge() {
  if (!document.body) return;
  bindGlobalKeys();
  ensureCommandPalette();
  startObservers();
  scheduleScan(0);
}

export const LegacyBridge = Object.freeze({
  refresh: () => scheduleScan(0),
  openCommandPalette,
  closeCommandPalette,
  currentModuleInfo
});
