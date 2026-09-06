import './topbarModern.js?v=20260904-topnav2';
import './collapsibleFilters.js?v=20260904-filtertoggle3';
import './sidebarModern.js?v=20260904-menustyle1';
import './sidebarLightTheme.js?v=20260904-menulight1';
import './workspaceModuleFilters.js?v=20260904-modulefilters2';
import './crmGridView.js?v=20260904-crmgrid1';
import './allModuleGridView.js?v=20260904-allgrid4';
import './statusGridGrouping.js?v=20260904-statusgrid1';
import './employeeCalendarLauncher.js?v=20260904-employeecalendar3';
import '../ui/index.js?v=20260906-appshell2';

(function installInCheck360DarkModeSafetyPatch() {
  const styles = [
    ['incheck360-dark-mode-safety-css', '/dark-mode-safety.css?v=20260701-clear-dark1'],
    ['incheck360-dark-modern-workspaces-css', '/dark-modern-workspaces.css?v=20260701-dark-modern1'],
    ['incheck360-modern-topbar-css', '/topbar-modern.css?v=20260904-topnav1'],
    ['incheck360-responsive-shell-css', '/src/ui/responsive-shell.css?v=20260904-responsive2'],
    ['incheck360-app-like-shell-css', '/src/ui/app-like-shell.css?v=20260906-appshell1'],
    ['incheck360-app-like-shell-v2-css', '/src/ui/app-like-shell-v2.css?v=20260906-appshell4'],
    ['incheck360-crm-grid-view-css', '/src/ui/crm-grid-view.css?v=20260904-crmgrid1'],
    ['incheck360-all-module-grid-view-css', '/src/ui/all-module-grid-view.css?v=20260904-allgrid1'],
    ['incheck360-grid-view-final-css', '/src/ui/grid-view-final.css?v=20260904-allgrid3'],
    ['incheck360-dark-mode-global-v2-css', '/src/ui/dark-mode-global-v2.css?v=20260906-darkmode1']
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