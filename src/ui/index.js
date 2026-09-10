import { UIComponents } from './components.js?v=20260904-ds2';
import './widgetIsolation.js?v=20260910-widgetisolation2';
import { installLegacyBridge, LegacyBridge } from './legacyBridge.js?v=20260904-ds2';
import { installModulePageSystem, ModulePage } from './modulePage.js?v=20260910-widgetisolation2';
import { installResponsiveRuntime, ResponsiveRuntime } from './responsiveRuntime.js?v=20260906-appshell2';
import './managementCommandCenter.js?v=20260907-mcc1';
import './systemHealth.js?v=20260907-health1';
import './userActivity.js?v=20260908-ua1';
import './userActivityIp.js?v=20260910-uaip2';
import './resellerManagement.js?v=20260908-rm1';
import './resellerUserAccess.js?v=20260908-rua1';
import './resellerViewIsolation.js?v=20260908-rmviewfix1';
import './userProfile.js?v=20260908-profile2';
import './userProfileIsolation.js?v=20260908-profileisolation1';
import './userAvatarPersistence.js?v=20260908-avatarfix1';
import './userProfileMenu.js?v=20260908-profile1';
import './workflowGuide.js?v=20260908-guide1';
import './formGuide.js?v=20260908-formguide1';
import './clientSuccessCompletionOnly.js?v=20260908-csonly1';
import './clientLifecycleOperations.js?v=20260908-clientlifecycle1';
import './clientLifecycleResilience.js?v=20260908-clientlifecycle2';

function ensureCss() {
  const styles = [
    ['incheck360-design-system-css', '/src/ui/design-system.css?v=20260904-ds2'],
    ['incheck360-module-page-css', '/src/ui/module-page.css?v=20260904-ds2'],
    ['incheck360-tickets-summary-strip-removal-css', '/src/ui/tickets-summary-strip-removal.css?v=20260908-ticketsbar1'],
    ['incheck360-management-command-center-css', '/src/ui/management-command-center.css?v=20260907-mcc1'],
    ['incheck360-system-health-css', '/src/ui/system-health.css?v=20260907-health1'],
    ['incheck360-user-activity-css', '/src/ui/user-activity.css?v=20260908-ua1'],
    ['incheck360-reseller-management-css', '/src/ui/reseller-management.css?v=20260908-rm1'],
    ['incheck360-user-profile-css', '/src/ui/user-profile.css?v=20260908-profile2'],
    ['incheck360-user-profile-polish-css', '/src/ui/user-profile-polish.css?v=20260908-profilepolish1'],
    ['incheck360-user-profile-menu-css', '/src/ui/user-profile-menu.css?v=20260908-profile1'],
    ['incheck360-workflow-guide-css', '/src/ui/workflow-guide.css?v=20260908-guide1'],
    ['incheck360-form-guide-css', '/src/ui/form-guide.css?v=20260908-formguide1'],
    ['incheck360-client-success-completion-only-css', '/src/ui/client-success-completion-only.css?v=20260908-csonly1'],
    ['incheck360-client-lifecycle-css', '/src/ui/client-lifecycle-operations.css?v=20260908-clientlifecycle1'],
    ['incheck360-authenticated-dark-forms-final-css', '/src/ui/authenticated-dark-forms-final.css?v=20260907-darkforms5'],
    ['incheck360-record-view-drawer-dark-fix-css', '/src/ui/record-view-drawer-dark-fix.css?v=20260907-recorddrawer2']
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
    window.WorkflowGuide?.refresh?.();
    window.FormGuide?.refresh?.();
    window.ClientSuccessCompletionOnly?.refresh?.();
    window.ClientLifecycleOperations?.refresh?.();
    window.ClientLifecycleResilience?.refresh?.();
    window.UserAvatarPersistence?.refresh?.();
    window.UserProfileIsolation?.refresh?.();
    window.ResellerViewIsolation?.refresh?.();
    window.UserActivityIp?.refresh?.();
  }
});