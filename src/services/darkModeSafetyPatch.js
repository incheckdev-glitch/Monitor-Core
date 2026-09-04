import './topbarModern.js?v=20260904-topnav2';
import './collapsibleFilters.js?v=20260904-filtertoggle3';
import './sidebarModern.js?v=20260904-menustyle1';
import './sidebarLightTheme.js?v=20260904-menulight1';
import './workspaceModuleFilters.js?v=20260904-modulefilters2';
import '../ui/index.js?v=20260904-ds1';

(function installInCheck360DarkModeSafetyPatch() {
  const styles = [
    ['incheck360-dark-mode-safety-css', '/dark-mode-safety.css?v=20260701-clear-dark1'],
    ['incheck360-dark-modern-workspaces-css', '/dark-modern-workspaces.css?v=20260701-dark-modern1'],
    ['incheck360-modern-topbar-css', '/topbar-modern.css?v=20260904-topnav1']
  ];

  for (const [id, href] of styles) {
    if (document.getElementById(id)) continue;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
})();
