const ResellerViewIsolation = (() => {
  const state = { observer: null, timer: null, bound: false };
  const VIEW_SELECTOR = '.content-panels > .rm-view, .content-panels .rm-view';
  const GROUP_SELECTOR = '#resellerManagementGroup, #resellerUserWorkspaceGroup';

  function resellerViews() {
    return Array.from(document.querySelectorAll(VIEW_SELECTOR));
  }

  function resellerTabs() {
    return Array.from(document.querySelectorAll(`${GROUP_SELECTOR} .view-tab`));
  }

  function isResellerTab(tab) {
    return Boolean(tab?.closest?.(GROUP_SELECTOR));
  }

  function activeNonResellerView() {
    return document.querySelector('.content-panels .view.active:not(.rm-view), .view.active:not(.rm-view)');
  }

  function ensureIsolationCss() {
    if (document.getElementById('incheck360-reseller-view-isolation-css')) return;
    const style = document.createElement('style');
    style.id = 'incheck360-reseller-view-isolation-css';
    style.textContent = `
      .content-panels .rm-view:not(.active) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function deactivateAll() {
    resellerViews().forEach(view => {
      if (view.classList.contains('active')) view.classList.remove('active');
      view.setAttribute('aria-hidden', 'true');
    });
    resellerTabs().forEach(tab => {
      tab.classList.remove('active');
      tab.setAttribute('aria-selected', 'false');
    });
  }

  function syncAria() {
    resellerViews().forEach(view => {
      view.setAttribute('aria-hidden', view.classList.contains('active') ? 'false' : 'true');
    });
  }

  function enforce() {
    state.timer = null;
    ensureIsolationCss();
    if (activeNonResellerView()) {
      deactivateAll();
      return;
    }
    syncAria();
  }

  function schedule(delay = 0) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(enforce, delay);
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    ensureIsolationCss();

    // Native ERP tabs are handled by the core setActiveView(). Because reseller
    // views are mounted dynamically, core navigation may not know to deactivate
    // them. Close reseller panels immediately when any non-reseller tab is used.
    document.addEventListener('click', event => {
      const tab = event.target?.closest?.('.view-tab');
      if (!tab || isResellerTab(tab)) return;
      deactivateAll();
      schedule(0);
    }, true);

    // Also cover programmatic navigation (notifications, deep links, quick actions,
    // tickets, etc.) where no sidebar click occurs.
    const root = document.querySelector('.content-panels') || document.body;
    if (root && typeof MutationObserver !== 'undefined') {
      state.observer = new MutationObserver(records => {
        const relevant = records.some(record =>
          record.type === 'childList' ||
          (record.type === 'attributes' && record.attributeName === 'class')
        );
        if (relevant) schedule(0);
      });
      state.observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }

    window.addEventListener('hashchange', () => schedule(0));
    window.addEventListener('incheck360:ui:ready', () => schedule(0));
    schedule(0);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind, { once: true });
    } else {
      bind();
    }
  }

  init();
  return Object.freeze({
    refresh: () => schedule(0),
    deactivateAll
  });
})();

window.ResellerViewIsolation = ResellerViewIsolation;
