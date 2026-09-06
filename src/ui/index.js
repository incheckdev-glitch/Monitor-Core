import { UIComponents } from './components.js?v=20260904-ds2';
import { installLegacyBridge, LegacyBridge } from './legacyBridge.js?v=20260904-ds2';
import { installModulePageSystem, ModulePage } from './modulePage.js?v=20260904-ds2';
import { installResponsiveRuntime, ResponsiveRuntime } from './responsiveRuntime.js?v=20260906-appshell2';

function ensureCss() {
  const styles = [
    ['incheck360-design-system-css', '/src/ui/design-system.css?v=20260904-ds2'],
    ['incheck360-module-page-css', '/src/ui/module-page.css?v=20260904-ds2']
  ];

  styles.forEach(([id, href]) => {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });
}

function install() {
  ensureCss();
  installResponsiveRuntime();
  if (!document.body || document.body.classList.contains('auth-locked')) return;
  installLegacyBridge();
  installModulePageSystem();
}

function watchAuth() {
  if (!document.body || typeof MutationObserver === 'undefined') return;
  if (!document.body.classList.contains('auth-locked')) {
    install();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!document.body.classList.contains('auth-locked')) {
      observer.disconnect();
      install();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

function start() {
  ensureCss();
  installResponsiveRuntime();
  install();
  watchAuth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

window.InCheck360UI = Object.freeze({
  Components: UIComponents,
  ModulePage,
  Bridge: LegacyBridge,
  Responsive: ResponsiveRuntime,
  refresh() {
    ResponsiveRuntime.refresh();
    LegacyBridge.refresh();
    ModulePage.refresh();
  }
});
