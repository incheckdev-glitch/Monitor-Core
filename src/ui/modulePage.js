import { UIComponents, clean } from './components.js?v=20260904-ds2';

const state = {
  installed: false,
  scanTimer: null,
  observer: null
};

const VIEW_SELECTOR = '[id$="View"],[role="tabpanel"],.view-panel,.module-view,.workspace-view';
const HEADER_SELECTOR = [
  '.page-header','.section-header','.section-head','.view-header','.module-header','.workspace-header',
  '[class*="page-header"]','[class*="section-head"]','[class*="view-header"]'
].join(',');
const ACTION_SELECTOR = '.toolbar,.actions-bar,.page-actions,.section-actions,[class*="toolbar"],[class*="action-bar"]';
const KPI_GRID_SELECTOR = '.kpi-grid,.stats-grid,.metrics-grid,[class*="kpi-grid"],[class*="stats-grid"],[class*="metrics-grid"]';
const KPI_CARD_SELECTOR = '.kpi-card,.stat-card,.metric-card,[class*="kpi-card"],[class*="stat-card"],[class*="metric-card"]';
const FILTER_SELECTOR = [
  '#companyFilterCard','#contactsFilterCard','#mainFiltersPanel','#eventsModuleFilterCard',
  '.leads-filter-card','.deals-filter-card','.rf-filter-card','.pf-filter-panel','.analytics-filter-bar',
  '[id$="FilterCard"]','[id$="FiltersCard"]','[id$="FilterPanel"]','[id$="FiltersPanel"]',
  '[class*="-filter-card"]','[class*="-filters-card"]','[class*="-filter-panel"]'
].join(',');

function authenticated() {
  return Boolean(document.body && !document.body.classList.contains('auth-locked'));
}

function currentTab() {
  return document.querySelector('.view-tab.active, .view-tab[aria-selected="true"]');
}

function moduleInfo(tab = currentTab()) {
  if (!tab) return null;
  const group = tab.closest('.view-menu-group');
  const groupName = clean(
    group?.querySelector('.view-menu-group-label > span:last-child')?.textContent ||
    group?.getAttribute('aria-label') ||
    'Workspace'
  ).replace(/\s+modules$/i, '');
  const label = clean(tab.textContent || tab.dataset.view || tab.id || 'Module');
  const key = clean(tab.dataset.view || tab.id || label);
  return { tab, groupName, label, key };
}

function isVisible(element) {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function findView(info = moduleInfo()) {
  const controlled = info?.tab?.getAttribute('aria-controls');
  if (controlled) {
    const view = document.getElementById(controlled);
    if (view) return view;
  }
  return Array.from(document.querySelectorAll(VIEW_SELECTOR)).find(view => {
    return !view.closest('#loginSection,.modal,[role="dialog"]') && isVisible(view);
  }) || document.querySelector('main');
}

function existingHeader(view) {
  if (!(view instanceof Element)) return null;
  return view.querySelector(HEADER_SELECTOR);
}

function legacyTitle(view, label) {
  const heading = Array.from(view.querySelectorAll(':scope > h1,:scope > h2,:scope > h3')).find(node => {
    return clean(node.textContent).toLowerCase() === clean(label).toLowerCase();
  });
  return heading || null;
}

function ensureHeader(view, info) {
  let header = existingHeader(view);
  if (header) {
    UIComponents.PageHeader.adopt(header, { group: info.groupName, title: info.label });
  } else {
    header = UIComponents.PageHeader.render(view, {
      group: info.groupName,
      title: info.label
    });
    if (header) {
      header.classList.add('icds-module-generated-header');
      view.prepend(header);
      const duplicate = legacyTitle(view, info.label);
      if (duplicate && duplicate !== header && !duplicate.closest(header)) {
        duplicate.classList.add('icds-module-legacy-title');
      }
    }
  }
  if (header) {
    header.classList.add('icds-module-header');
    header.dataset.icdsModuleRegion = 'header';
  }
  return header;
}

function classifyActions(view, header) {
  const bars = Array.from(view.querySelectorAll(ACTION_SELECTOR)).filter(bar => {
    if (bar.closest('.modal,[role="dialog"],#appHeader,.view-menu')) return false;
    if (header && bar.closest('.icds-module-header') === header) return true;
    return true;
  });

  bars.forEach(bar => {
    UIComponents.ActionBar.adopt(bar);
    bar.classList.add('icds-module-actions');
    bar.dataset.icdsModuleRegion = 'actions';
  });

  const headerActionHost = header?.querySelector('[data-icds-header-actions]');
  if (!headerActionHost) return;

  const movable = bars.find(bar => {
    if (bar.closest(header)) return false;
    if (bar.querySelector('input,select,textarea')) return false;
    const buttons = bar.querySelectorAll('button,a');
    return buttons.length > 0 && buttons.length <= 6;
  });

  if (movable) {
    headerActionHost.appendChild(movable);
    movable.classList.add('icds-module-actions-in-header');
  }
}

function classifyKpis(view) {
  view.querySelectorAll(KPI_GRID_SELECTOR).forEach(grid => {
    if (grid.closest('.modal,[role="dialog"]')) return;
    UIComponents.KpiGrid.adopt(grid);
    grid.classList.add('icds-module-kpis');
    grid.dataset.icdsModuleRegion = 'kpis';
  });
  view.querySelectorAll(KPI_CARD_SELECTOR).forEach(card => {
    if (card.closest('.modal,[role="dialog"]')) return;
    UIComponents.KpiCard.adopt(card);
  });
}

function classifyFilters(view) {
  const panels = Array.from(view.querySelectorAll(FILTER_SELECTOR)).filter(panel => {
    return !panel.closest('.modal,[role="dialog"],#appHeader');
  });

  panels.forEach(panel => {
    UIComponents.FilterPanel.adopt(panel);
    panel.classList.add('icds-module-filter-panel');
    panel.dataset.icdsModuleRegion = 'filters';

    const toggleRow = panel.previousElementSibling?.matches?.('.ic-filter-toggle-row,.ic-events-filter-toggle-row')
      ? panel.previousElementSibling
      : null;
    if (toggleRow) {
      toggleRow.classList.add('icds-module-filter-toggle');
      toggleRow.dataset.icdsModuleRegion = 'filters';
    }

    const ticketSlot = panel.closest('#ticketsModuleFilterSlot,#eventsModuleFilterSlot,.ic-module-filter-slot');
    if (ticketSlot) {
      ticketSlot.classList.add('icds-module-filters');
      ticketSlot.dataset.icdsModuleRegion = 'filters';
    }
  });
}

function classifyTables(view) {
  view.querySelectorAll('table').forEach(table => {
    if (table.closest('.modal,[role="dialog"],.print-preview,[data-print-preview],.pdf-preview')) return;
    const adopted = UIComponents.DataTable.adopt(table);
    const shell = adopted?.shell;
    if (shell) {
      shell.classList.add('icds-module-data');
      shell.dataset.icdsModuleRegion = 'data';
    }
  });
}

function classifyForms(view) {
  view.querySelectorAll('form').forEach(form => {
    if (form.closest('.modal,[role="dialog"]')) return;
    UIComponents.FormSection.adopt(form);
    form.classList.add('icds-module-form');
    form.dataset.icdsModuleRegion = 'form';
  });
}

function classifyPagination(view) {
  view.querySelectorAll('.pagination,.pager,[class*="pagination"],[class*="pager"]').forEach(el => {
    if (el.closest('.modal,[role="dialog"]')) return;
    UIComponents.Pagination.adopt(el);
    el.classList.add('icds-module-pagination');
    el.dataset.icdsModuleRegion = 'pagination';
  });
}

function classifyContentBlocks(view) {
  Array.from(view.children).forEach(child => {
    if (!(child instanceof Element)) return;
    if (child.matches('script,style,template')) return;
    if (child.dataset.icdsModuleRegion) return;
    if (child.classList.contains('icds-command-overlay')) return;
    child.classList.add('icds-module-block');
  });
}

export const ModulePage = Object.freeze({
  adopt(view, info = moduleInfo()) {
    if (!(view instanceof Element) || !info || view.closest('#loginSection,.modal,[role="dialog"]')) return null;

    UIComponents.PageLayout.adopt(view);
    view.classList.add('icds-module-page');
    view.dataset.icdsComponent = 'module-page';
    view.dataset.icdsModuleKey = info.key;
    view.dataset.icdsModuleGroup = info.groupName;

    const header = ensureHeader(view, info);
    classifyActions(view, header);
    classifyKpis(view);
    classifyFilters(view);
    classifyTables(view);
    classifyForms(view);
    classifyPagination(view);
    classifyContentBlocks(view);

    return view;
  },

  current() {
    const info = moduleInfo();
    const view = findView(info);
    return { info, view };
  },

  refresh() {
    schedule(0);
  }
});

function scan() {
  state.scanTimer = null;
  if (!authenticated()) return;
  const info = moduleInfo();
  const view = findView(info);
  if (view && info) ModulePage.adopt(view, info);
}

function schedule(delay = 40) {
  if (state.scanTimer) clearTimeout(state.scanTimer);
  state.scanTimer = setTimeout(scan, delay);
}

function installObservers() {
  if (state.observer || typeof MutationObserver === 'undefined') return;
  state.observer = new MutationObserver(records => {
    if (!authenticated()) return;
    if (records.some(record => record.addedNodes && record.addedNodes.length)) schedule(80);
  });
  state.observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    if (event.target?.closest?.('.view-tab')) schedule(50);
  });
  window.addEventListener('hashchange', () => schedule(40));
  window.addEventListener('popstate', () => schedule(40));
  window.addEventListener('incheck360:ui:ready', () => schedule(15));
}

export function installModulePageSystem() {
  if (!document.body || state.installed) return;
  state.installed = true;
  installObservers();
  schedule(0);
}
