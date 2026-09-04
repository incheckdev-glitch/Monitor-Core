import { UIComponents } from './components.js?v=20260904-ds1';
import { installLegacyBridge, LegacyBridge } from './legacyBridge.js?v=20260904-ds1';

function ensureCss() {
  if (document.getElementById('incheck360-design-system-css')) return;
  const link = document.createElement('link');
  link.id = 'incheck360-design-system-css';
  link.rel = 'stylesheet';
  link.href = '/src/ui/design-system.css?v=20260904-ds1';
  document.head.appendChild(link);
}

function install() {
  ensureCss();
  if (!document.body || document.body.classList.contains('auth-locked')) return;
  installLegacyBridge();
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
  Bridge: LegacyBridge,
  refresh: () => LegacyBridge.refresh()
});
