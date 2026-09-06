(function installEmployeeCalendarLauncher(global) {
  'use strict';

  const TAB_ID = 'employeeCalendarTab';
  const VIEW_ID = 'employeeCalendarView';
  const STYLE_ID = 'incheck360-employee-calendar-css';
  const HASH = '#employee-calendar';
  let loadPromise = null;
  let openPromise = null;
  let bodyObserver = null;
  let initialHashHandled = false;

  function isUnlocked() {
    return !!document.body && !document.body.classList.contains('auth-locked');
  }

  function notify(message, type = 'error') {
    try {
      if (global.UI?.toast) return global.UI.toast(message, type);
      if (global.U?.toast) return global.U.toast(message, type);
    } catch (_) {}
    console[type === 'error' ? 'error' : 'log']('[calendar-launcher]', message);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = '/src/ui/employee-calendar.css?v=20260904-employeecalendar3';
    document.head.appendChild(link);
  }

  function getCrmHost() {
    return document.getElementById('crmMenuGroupBody');
  }

  function closeCalendarView({ callApi = true } = {}) {
    if (callApi) {
      try { global.InCheck360EmployeeCalendar?.hide?.(); } catch (_) {}
    }

    const view = document.getElementById(VIEW_ID);
    if (view) {
      view.hidden = true;
      view.classList.remove('active');
      view.setAttribute('aria-hidden', 'true');
      view.querySelectorAll('.ec-modal').forEach(modal => {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
      });
    }

    const tab = document.getElementById(TAB_ID);
    if (tab) {
      tab.classList.remove('active');
      tab.setAttribute('aria-selected', 'false');
    }

    document.body?.classList.remove('ic-employee-calendar-active', 'ec-modal-open');
  }

  function bindTab(tab) {
    if (!tab || tab.dataset.employeeCalendarLauncherBound === 'true') return;
    tab.dataset.employeeCalendarLauncherBound = 'true';
    tab.addEventListener('click', onCalendarClick);
  }

  function ensureTab() {
    const host = getCrmHost();
    if (!host) return null;

    let tab = document.getElementById(TAB_ID);
    if (!tab) {
      tab = document.createElement('button');
      tab.id = TAB_ID;
      tab.type = 'button';
      tab.className = 'view-tab';
      tab.dataset.view = 'employeeCalendar';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-controls', VIEW_ID);
      tab.innerHTML = '<span class="icon" aria-hidden="true">🗓️</span> Calendar';

      const dealsTab = document.getElementById('dealsTab');
      if (dealsTab?.parentElement === host) {
        dealsTab.insertAdjacentElement('afterend', tab);
      } else {
        host.appendChild(tab);
      }
    }

    bindTab(tab);
    tab.hidden = !isUnlocked();
    if (isUnlocked()) tab.style.removeProperty('display');
    else tab.style.display = 'none';
    return tab;
  }

  function setLoading(tab, loading) {
    if (!tab) return;
    tab.disabled = !!loading;
    tab.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (loading) tab.dataset.calendarLoading = 'true';
    else delete tab.dataset.calendarLoading;
  }

  function captureCalendarObservers() {
    const NativeObserver = global.MutationObserver;
    if (typeof NativeObserver !== 'function') {
      return { restore() {}, disconnect() {} };
    }

    const captured = [];
    function WrappedObserver(callback) {
      const observer = new NativeObserver(callback);
      try {
        const stack = String(new Error().stack || '');
        if (stack.includes('employeeCalendar.js')) captured.push(observer);
      } catch (_) {}
      return observer;
    }

    try {
      WrappedObserver.prototype = NativeObserver.prototype;
      Object.setPrototypeOf(WrappedObserver, NativeObserver);
      global.MutationObserver = WrappedObserver;
    } catch (_) {
      return { restore() {}, disconnect() {} };
    }

    return {
      restore() {
        try {
          if (global.MutationObserver === WrappedObserver) global.MutationObserver = NativeObserver;
        } catch (_) {}
      },
      disconnect() {
        captured.forEach((observer) => {
          try { observer.disconnect(); } catch (_) {}
        });
      }
    };
  }

  async function loadCalendar() {
    if (global.InCheck360EmployeeCalendar?.open) return global.InCheck360EmployeeCalendar;
    ensureStyle();

    if (!loadPromise) {
      const observerCapture = captureCalendarObservers();
      loadPromise = import('./employeeCalendar.js?v=20260904-employeecalendar3')
        .then(() => global.InCheck360EmployeeCalendar)
        .finally(() => {
          observerCapture.restore();
          observerCapture.disconnect();
        })
        .catch((error) => {
          loadPromise = null;
          throw error;
        });
    }

    const api = await loadPromise;
    if (!api?.open) throw new Error('Calendar module did not initialize correctly');
    return api;
  }

  async function openCalendar() {
    if (!isUnlocked()) return;
    if (openPromise) return openPromise;

    openPromise = (async () => {
      const tab = ensureTab();
      setLoading(tab, true);
      try {
        const api = await loadCalendar();
        api.open();
        const view = document.getElementById(VIEW_ID);
        if (view) view.setAttribute('aria-hidden', 'false');
      } catch (error) {
        notify(error?.message || 'Unable to open Calendar', 'error');
      } finally {
        setLoading(tab, false);
      }
    })();

    try {
      await openPromise;
    } finally {
      openPromise = null;
    }
  }

  function onCalendarClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openCalendar();
  }

  function onAnyNavigationClick(event) {
    const target = event.target instanceof Element
      ? event.target.closest('.view-tab,[role="tab"][data-view]')
      : null;
    if (!target || target.id === TAB_ID || target.dataset.view === 'employeeCalendar') return;
    closeCalendarView();
  }

  function syncAuthState() {
    const tab = ensureTab();
    if (!tab) return;

    if (!isUnlocked()) {
      closeCalendarView();
      tab.hidden = true;
      tab.style.display = 'none';
      return;
    }

    tab.hidden = false;
    tab.style.removeProperty('display');
  }

  function handleInitialHash() {
    if (initialHashHandled || !isUnlocked()) return;
    initialHashHandled = true;
    if (location.hash.startsWith(HASH)) openCalendar();
  }

  function boot() {
    syncAuthState();
    handleInitialHash();

    // Safe auth-state observer only: watches body.class itself, never the full DOM subtree.
    if (document.body && global.MutationObserver && !bodyObserver) {
      bodyObserver = new MutationObserver(() => {
        const wasUnlocked = isUnlocked();
        syncAuthState();
        if (wasUnlocked) handleInitialHash();
      });
      bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    // Event-driven navigation cleanup. No subtree/global navigation observer.
    document.addEventListener('click', onAnyNavigationClick, true);

    global.addEventListener('hashchange', () => {
      if (!isUnlocked()) return;
      if (location.hash.startsWith(HASH)) openCalendar();
      else closeCalendarView();
    });

    global.addEventListener('popstate', () => {
      if (!location.hash.startsWith(HASH)) closeCalendarView();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  global.InCheck360EmployeeCalendarLauncher = Object.freeze({
    open: openCalendar,
    close: closeCalendarView,
    load: loadCalendar
  });
})(window);