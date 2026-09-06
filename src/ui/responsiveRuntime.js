const STATE = { installed: false, raf: 0, navInstalled: false };
const COMPACT_NAV_QUERY = '(max-width: 980px)';

function setViewportMeta() {
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content';
}

function isStandalone() {
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

function isCompactNav() {
  return Boolean(window.matchMedia?.(COMPACT_NAV_QUERY).matches);
}

function mainMenu() {
  return document.querySelector('.view-menu');
}

function filterSidebar() {
  return document.getElementById('sidebar');
}

function ensureMainMenuId() {
  const menu = mainMenu();
  if (menu && !menu.id) menu.id = 'incheck360MainMenu';
  return menu;
}

function closeFilterDrawer() {
  const sidebar = filterSidebar();
  const drawerBtn = document.getElementById('drawerBtn');
  sidebar?.classList.remove('open');
  drawerBtn?.setAttribute('aria-expanded', 'false');
  document.body?.classList.remove('drawer-open');
}

function setMobileNavOpen(open, { focus = false } = {}) {
  const body = document.body;
  const menu = ensureMainMenuId();
  const button = document.getElementById('mobileAppNavBtn');
  const backdrop = document.getElementById('icMobileNavBackdrop');
  const closeButton = document.getElementById('icMobileNavCloseBtn');
  const canOpen = Boolean(open && body && menu && isCompactNav() && !body.classList.contains('auth-locked'));

  if (canOpen) closeFilterDrawer();

  body?.classList.toggle('ic-mobile-nav-open', canOpen);
  button?.setAttribute('aria-expanded', String(canOpen));
  button?.setAttribute('aria-label', canOpen ? 'Close modules menu' : 'Open modules menu');
  button?.setAttribute('title', canOpen ? 'Close modules' : 'Modules');
  backdrop?.setAttribute('aria-hidden', String(!canOpen));
  closeButton?.setAttribute('aria-hidden', String(!canOpen));
  menu?.setAttribute('aria-hidden', String(!canOpen && isCompactNav()));

  if (canOpen) {
    const active = menu?.querySelector('.view-tab.active, .view-tab[aria-selected="true"]');
    try { active?.scrollIntoView?.({ block: 'nearest' }); } catch (_) {}
    if (focus) window.setTimeout(() => active?.focus?.({ preventScroll: true }), 30);
  } else if (menu && !isCompactNav()) {
    menu.removeAttribute('aria-hidden');
  }
}

function ensureMobileMenuCloseButton(menu) {
  const header = menu?.querySelector('.view-menu-header');
  if (!header) return null;

  let closeButton = header.querySelector('#icMobileNavCloseBtn');
  if (!closeButton) {
    closeButton = document.createElement('button');
    closeButton.id = 'icMobileNavCloseBtn';
    closeButton.className = 'ic-mobile-nav-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close modules menu');
    closeButton.setAttribute('aria-hidden', 'true');
    closeButton.title = 'Close';
    closeButton.innerHTML = '<span aria-hidden="true">×</span>';
    header.appendChild(closeButton);
  }
  return closeButton;
}

function ensureMobileNavControls() {
  const body = document.body;
  const actions = document.querySelector('#appHeader .topbar-actions');
  const menu = ensureMainMenuId();
  if (!body || !actions || !menu) return;

  let button = document.getElementById('mobileAppNavBtn');
  if (!button) {
    button = document.createElement('button');
    button.id = 'mobileAppNavBtn';
    button.className = 'topbar-icon-btn ic-mobile-app-nav-btn';
    button.type = 'button';
    button.setAttribute('aria-controls', menu.id);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open modules menu');
    button.title = 'Modules';
    button.innerHTML = '<span aria-hidden="true">☷</span>';
    actions.prepend(button);
  }

  let backdrop = document.getElementById('icMobileNavBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('button');
    backdrop.id = 'icMobileNavBackdrop';
    backdrop.type = 'button';
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', 'Close modules menu');
    backdrop.setAttribute('aria-hidden', 'true');
    body.appendChild(backdrop);
  }

  const closeButton = ensureMobileMenuCloseButton(menu);

  if (!STATE.navInstalled) {
    STATE.navInstalled = true;

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const next = !document.body?.classList.contains('ic-mobile-nav-open');
      setMobileNavOpen(next, { focus: false });
    });

    backdrop.addEventListener('click', () => setMobileNavOpen(false));
    closeButton?.addEventListener('click', () => {
      setMobileNavOpen(false);
      button?.focus?.({ preventScroll: true });
    });

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !isCompactNav()) return;

      if (target.closest('#drawerBtn')) {
        setMobileNavOpen(false);
        return;
      }

      if (target.closest('.view-menu .view-tab')) {
        setMobileNavOpen(false);
        return;
      }

      if (document.body?.classList.contains('drawer-open')) {
        if (!target.closest('#sidebar') && !target.closest('#drawerBtn')) closeFilterDrawer();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (document.body?.classList.contains('ic-mobile-nav-open')) {
        setMobileNavOpen(false);
        button?.focus?.({ preventScroll: true });
      }
      if (document.body?.classList.contains('drawer-open')) closeFilterDrawer();
    });

    window.addEventListener('hashchange', () => setMobileNavOpen(false), { passive: true });
  }
}

function syncEnvironment() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const width = Math.round(vv?.width || window.innerWidth || root.clientWidth || 0);
  const height = Math.round(vv?.height || window.innerHeight || root.clientHeight || 0);
  const layoutHeight = Math.round(window.innerHeight || root.clientHeight || height);
  const keyboardOpen = Boolean(vv && layoutHeight > 0 && height < layoutHeight * 0.72);
  const coarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches || window.matchMedia?.('(any-pointer: coarse)').matches);
  const landscape = width > height;
  const standalone = isStandalone();

  root.style.setProperty('--ic-visual-width', `${width}px`);
  root.style.setProperty('--ic-visual-height', `${height}px`);
  root.style.setProperty('--ic-layout-height', `${layoutHeight}px`);
  root.classList.toggle('ic-pwa-standalone', standalone);
  root.classList.toggle('ic-touch', coarse);
  root.classList.toggle('ic-landscape', landscape);
  root.classList.toggle('ic-keyboard-open', keyboardOpen);
  root.dataset.icViewport = width < 480 ? 'phone-small' : width < 768 ? 'phone' : width < 1200 ? 'tablet' : 'desktop';

  document.body?.classList.toggle('ic-pwa-standalone', standalone);
  document.body?.classList.toggle('ic-keyboard-open', keyboardOpen);

  ensureMobileNavControls();
  if (!isCompactNav() || document.body?.classList.contains('auth-locked')) setMobileNavOpen(false);

  window.dispatchEvent(new CustomEvent('incheck360:viewport:change', {
    detail: { width, height, layoutHeight, keyboardOpen, coarse, standalone, landscape }
  }));
}

function scheduleSync() {
  if (STATE.raf) cancelAnimationFrame(STATE.raf);
  STATE.raf = requestAnimationFrame(() => {
    STATE.raf = 0;
    syncEnvironment();
  });
}

function resizeCharts() {
  try {
    if (window.Chart?.instances) {
      const instances = window.Chart.instances instanceof Map
        ? Array.from(window.Chart.instances.values())
        : Object.values(window.Chart.instances || {});
      instances.forEach(chart => chart?.resize?.());
    }
  } catch (_) {}
}

function onViewportSettled() {
  scheduleSync();
  window.setTimeout(resizeCharts, 120);
}

export function installResponsiveRuntime() {
  if (STATE.installed) return;
  STATE.installed = true;
  setViewportMeta();
  ensureMobileNavControls();
  syncEnvironment();

  window.addEventListener('resize', onViewportSettled, { passive: true });
  window.addEventListener('orientationchange', onViewportSettled, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleSync, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleSync, { passive: true });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', scheduleSync);
  window.matchMedia?.('(pointer: coarse)').addEventListener?.('change', scheduleSync);
  window.matchMedia?.(COMPACT_NAV_QUERY).addEventListener?.('change', scheduleSync);
}

export const ResponsiveRuntime = Object.freeze({
  refresh: syncEnvironment,
  isStandalone,
  openNavigation() { setMobileNavOpen(true); },
  closeNavigation() { setMobileNavOpen(false); }
});
