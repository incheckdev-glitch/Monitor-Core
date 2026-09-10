import { UIComponents } from './components.js?v=20260904-ds2';

const GUARD_KEY = '__incheck360UiStabilityGuardV1';

if (!globalThis[GUARD_KEY]) {
  const state = {
    cleanupTimer: 0,
    cleanupObserver: null,
    nativeMutationObserver: globalThis.MutationObserver || null
  };

  const COMPLEX_WIDGET_SELECTOR = [
    '.fc',
    '.fullcalendar',
    '#employeeCalendar',
    '.ec-calendar',
    '[data-fullcalendar]',
    '[data-calendar-widget]',
    '.scheduler',
    '.scheduler-container',
    '.gantt',
    '.gantt-container',
    '.timeline-widget',
    '.chart-container',
    '.chart-wrap',
    '.analytics-chart',
    '.monaco-editor',
    '.cm-editor',
    '.CodeMirror',
    '.ql-container',
    '.tox-tinymce',
    '.ProseMirror',
    '.mapboxgl-map',
    '.leaflet-container',
    '.print-preview',
    '[data-print-preview]',
    '.pdf-preview',
    '.ic-module-grid-view',
    '.ic-crm-grid-view'
  ].join(',');

  const INTERNAL_UI_SELECTOR = [
    '.icds-command-overlay',
    '#icdsFavoritesGroup',
    '.ic-module-grid-view',
    '.ic-crm-grid-view',
    '.ic-all-view-switch',
    '.ic-crm-view-switch'
  ].join(',');

  function isElement(value) {
    return Boolean(value && value.nodeType === 1);
  }

  function insideComplexWidget(element) {
    return Boolean(isElement(element) && element.closest?.(COMPLEX_WIDGET_SELECTOR));
  }

  function cleanupTable(table) {
    if (!(table instanceof HTMLTableElement) || !insideComplexWidget(table)) return;
    table.classList.remove('icds-table');
    if (table.dataset.icdsComponent === 'data-table') delete table.dataset.icdsComponent;

    const parent = table.parentElement;
    if (parent && insideComplexWidget(parent)) {
      parent.classList.remove('icds-table-shell', 'icds-module-data');
      if (parent.dataset.icdsComponent === 'data-table') delete parent.dataset.icdsComponent;
      if (parent.dataset.icdsModuleRegion === 'data') delete parent.dataset.icdsModuleRegion;
    }
  }

  function cleanupComplexWidgets(root = document) {
    const scopes = [];
    if (isElement(root) && root.matches?.(COMPLEX_WIDGET_SELECTOR)) scopes.push(root);
    if (root?.querySelectorAll) scopes.push(...root.querySelectorAll(COMPLEX_WIDGET_SELECTOR));

    scopes.forEach(scope => {
      if (scope instanceof HTMLTableElement) cleanupTable(scope);
      scope.querySelectorAll?.('table').forEach(cleanupTable);
      scope.querySelectorAll?.('.icds-table-shell,.icds-module-data').forEach(shell => {
        if (!insideComplexWidget(shell)) return;
        shell.classList.remove('icds-table-shell', 'icds-module-data');
        if (shell.dataset.icdsModuleRegion === 'data') delete shell.dataset.icdsModuleRegion;
      });
      scope.querySelectorAll?.('[data-icds-status]').forEach(node => {
        delete node.dataset.icdsStatus;
        if (node.dataset.icdsComponent === 'status-badge') delete node.dataset.icdsComponent;
      });
    });
  }

  function scheduleCleanup(delay = 0) {
    if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
    state.cleanupTimer = setTimeout(() => {
      state.cleanupTimer = 0;
      cleanupComplexWidgets(document);
    }, delay);
  }

  function patchDataTableAdopter() {
    const tableApi = UIComponents?.DataTable;
    if (!tableApi?.adopt || tableApi.adopt.__icStabilityPatched) return;
    const original = tableApi.adopt;
    const patched = function(table, ...args) {
      if (table instanceof HTMLTableElement && insideComplexWidget(table)) {
        cleanupTable(table);
        return { table, shell: null };
      }
      return original.call(this, table, ...args);
    };
    patched.__icStabilityPatched = true;
    tableApi.adopt = patched;
  }

  function patchFormAdopter() {
    const formApi = UIComponents?.FormSection;
    if (!formApi?.adopt || formApi.adopt.__icStabilityPatched) return;
    const original = formApi.adopt;
    const patched = function(form, ...args) {
      if (isElement(form) && (insideComplexWidget(form) || form.closest?.('[role="dialog"],.modal,.ec-modal'))) return form;
      return original.call(this, form, ...args);
    };
    patched.__icStabilityPatched = true;
    formApi.adopt = patched;
  }

  function patchStatusAdopter() {
    const statusApi = UIComponents?.StatusBadge;
    if (!statusApi?.adopt || statusApi.adopt.__icStabilityPatched) return;
    const original = statusApi.adopt;
    const patched = function(element, ...args) {
      if (isElement(element) && insideComplexWidget(element)) return element;
      return original.call(this, element, ...args);
    };
    patched.__icStabilityPatched = true;
    statusApi.adopt = patched;
  }

  function activeView() {
    const activeTab = document.querySelector('.view-tab.active[aria-controls],.view-tab[aria-selected="true"][aria-controls]');
    const controlledId = activeTab?.getAttribute('aria-controls');
    if (controlledId) {
      const controlled = document.getElementById(controlledId);
      if (controlled) return controlled;
    }
    return document.querySelector('.content-panels > .view.active,.content-panels > [role="tabpanel"].active,.view.active');
  }

  function relevantAddedNode(node, view) {
    if (!isElement(node)) return false;
    if (insideComplexWidget(node) || node.querySelector?.(COMPLEX_WIDGET_SELECTOR)) return false;
    if (node.closest?.(INTERNAL_UI_SELECTOR) || node.matches?.(INTERNAL_UI_SELECTOR)) return false;
    if (!view) return true;
    if (view === node || view.contains(node) || node.contains?.(view)) return true;
    if (node.closest?.('#appHeader,.view-menu,.grouped-view-tabs,.modal,[role="dialog"],.dialog')) return true;
    if (node.matches?.('#appHeader,.view-menu,.grouped-view-tabs,.modal,[role="dialog"],.dialog')) return true;
    return false;
  }

  function shouldRunUiObserver(records) {
    if (!Array.isArray(records) && !records?.length) return true;
    if (Array.from(records).some(record => record.type !== 'childList')) return true;
    const view = activeView();
    return Array.from(records).some(record => {
      return Array.from(record.addedNodes || []).some(node => relevantAddedNode(node, view));
    });
  }

  function installObserverPressureGuard() {
    const NativeObserver = state.nativeMutationObserver;
    if (typeof NativeObserver !== 'function' || globalThis.MutationObserver?.__icStabilityWrapped) return;

    function StableMutationObserver(callback) {
      const stack = String(new Error().stack || '');
      const isLegacyUiObserver = /(?:\/|\\)legacyBridge\.js(?:\?|:|$)/.test(stack);
      const isModulePageObserver = /(?:\/|\\)modulePage\.js(?:\?|:|$)/.test(stack);

      if (!isLegacyUiObserver && !isModulePageObserver) return new NativeObserver(callback);

      return new NativeObserver((records, observer) => {
        if (shouldRunUiObserver(records)) callback(records, observer);
      });
    }

    StableMutationObserver.prototype = NativeObserver.prototype;
    try { Object.setPrototypeOf(StableMutationObserver, NativeObserver); } catch (_) {}
    Object.defineProperty(StableMutationObserver, '__icStabilityWrapped', { value: true });
    globalThis.MutationObserver = StableMutationObserver;
  }

  function installCleanupObserver() {
    const NativeObserver = state.nativeMutationObserver;
    if (typeof NativeObserver !== 'function' || state.cleanupObserver || !document.documentElement) return;
    state.cleanupObserver = new NativeObserver(records => {
      const touched = records.some(record => Array.from(record.addedNodes || []).some(node => {
        if (!isElement(node)) return false;
        return insideComplexWidget(node) || Boolean(node.querySelector?.(COMPLEX_WIDGET_SELECTOR));
      }));
      if (touched) scheduleCleanup(0);
    });
    state.cleanupObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function install() {
    patchDataTableAdopter();
    patchFormAdopter();
    patchStatusAdopter();
    installObserverPressureGuard();

    const startCleanup = () => {
      installCleanupObserver();
      scheduleCleanup(0);
      setTimeout(() => scheduleCleanup(0), 150);
      setTimeout(() => scheduleCleanup(0), 700);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCleanup, { once: true });
    else startCleanup();

    document.addEventListener('click', event => {
      if (event.target?.closest?.('.view-tab,[role="tab"]')) {
        setTimeout(() => scheduleCleanup(0), 50);
        setTimeout(() => scheduleCleanup(0), 350);
      }
    }, true);
    globalThis.addEventListener?.('hashchange', () => setTimeout(() => scheduleCleanup(0), 80));
  }

  const api = Object.freeze({
    refresh: () => scheduleCleanup(0),
    cleanup: cleanupComplexWidgets
  });

  Object.defineProperty(globalThis, GUARD_KEY, { value: api, configurable: false });
  globalThis.InCheck360UiStabilityGuard = api;
  install();
}

export const UiStabilityGuard = globalThis[GUARD_KEY];
