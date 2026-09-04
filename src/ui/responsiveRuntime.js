const STATE = { installed: false, raf: 0 };

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

function syncEnvironment() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const width = Math.round(vv?.width || window.innerWidth || root.clientWidth || 0);
  const height = Math.round(vv?.height || window.innerHeight || root.clientHeight || 0);
  const layoutHeight = Math.round(window.innerHeight || root.clientHeight || height);
  const keyboardOpen = Boolean(vv && layoutHeight > 0 && height < layoutHeight * 0.72);
  const coarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches || window.matchMedia?.('(any-pointer: coarse)').matches);
  const landscape = width > height;

  root.style.setProperty('--ic-visual-width', `${width}px`);
  root.style.setProperty('--ic-visual-height', `${height}px`);
  root.style.setProperty('--ic-layout-height', `${layoutHeight}px`);
  root.classList.toggle('ic-pwa-standalone', isStandalone());
  root.classList.toggle('ic-touch', coarse);
  root.classList.toggle('ic-landscape', landscape);
  root.classList.toggle('ic-keyboard-open', keyboardOpen);
  root.dataset.icViewport = width < 480 ? 'phone-small' : width < 768 ? 'phone' : width < 1200 ? 'tablet' : 'desktop';

  document.body?.classList.toggle('ic-pwa-standalone', isStandalone());
  document.body?.classList.toggle('ic-keyboard-open', keyboardOpen);

  window.dispatchEvent(new CustomEvent('incheck360:viewport:change', {
    detail: { width, height, layoutHeight, keyboardOpen, coarse, standalone: isStandalone(), landscape }
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
  syncEnvironment();

  window.addEventListener('resize', onViewportSettled, { passive: true });
  window.addEventListener('orientationchange', onViewportSettled, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleSync, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleSync, { passive: true });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', scheduleSync);
  window.matchMedia?.('(pointer: coarse)').addEventListener?.('change', scheduleSync);
}

export const ResponsiveRuntime = Object.freeze({
  refresh: syncEnvironment,
  isStandalone
});
