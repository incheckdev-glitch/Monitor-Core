import './topbarModern.js?v=20260904-topnav2';
import './collapsibleFilters.js?v=20260904-filtertoggle3';
import './sidebarModern.js?v=20260904-menustyle1';
import './sidebarLightTheme.js?v=20260904-menulight1';
import './workspaceModuleFilters.js?v=20260904-modulefilters2';
import './salesPipelineGuard.js?v=20260912-salespipeline4';
import './dealProposalTriggerGuard.js?v=20260911-dealproposal1';
import './crmPipelineProductInterest.js?v=20260912-crm-pipeline-products5';
import './crmPipelineIntelligenceFields.js?v=20260912-crm-intelligence-fields2';
import './crmPipelineIntelligenceAnalytics.js?v=20260911-crm-intelligence-analytics2';
import './crmDealWonAutomation.js?v=20260911-crm-deal-won1';
import './crmPipelineDragDrop.js?v=20260911-crm-pipeline-dnd1';
import './leadIntelligence.js?v=20260910-leadintel1';
import './leadIntelligenceBackground.js?v=20260911-li-bg3';
import './leadIntelligenceContactEnrichment.js?v=20260911-li-contact2';
import './leadIntelligenceAdmin.js?v=20260911-li-admin-subtab2';
import './crmDailyBrief.js?v=20260911-crm-daily-brief3';
import './crmDailyBriefExecutiveLayout.js?v=20260911-crm-daily-brief-exec2';
import './proposalApprovalIntegrityGuard.js?v=20260911-proposal-approval-integrity2';
import './crmGridViewStable.js?v=20260912-crm-grid-current1';
import './allModuleGridViewStable.js?v=20260906-gridstable1';
import './statusGridGrouping.js?v=20260904-statusgrid1';
import './employeeCalendarLauncher.js?v=20260910-outlook3';
import '../ui/index.js?v=20260910-stability4';
import './crmLeadStatusAuthority.js?v=20260912-crm-lead-status-authority1';
import './crmMultiContact.js?v=20260912-crm-multi-contact1';

(function installInCheck360DarkModeSafetyPatch() {
  const styles = [
    ['incheck360-dark-mode-safety-css', '/dark-mode-safety.css?v=20260701-clear-dark1'],
    ['incheck360-dark-modern-workspaces-css', '/dark-modern-workspaces.css?v=20260701-dark-modern1'],
    ['incheck360-modern-topbar-css', '/topbar-modern.css?v=20260904-topnav1'],
    ['incheck360-responsive-shell-css', '/src/ui/responsive-shell.css?v=20260904-responsive2'],
    ['incheck360-app-like-shell-css', '/src/ui/app-like-shell.css?v=20260906-appshell1'],
    ['incheck360-app-like-shell-v2-css', '/src/ui/app-like-shell-v2.css?v=20260906-appshell4'],
    ['incheck360-crm-grid-view-css', '/src/ui/crm-grid-view.css?v=20260906-gridstable1'],
    ['incheck360-all-module-grid-view-css', '/src/ui/all-module-grid-view.css?v=20260906-gridstable1'],
    ['incheck360-grid-view-final-css', '/src/ui/grid-view-final.css?v=20260906-gridstable1'],
    ['incheck360-dark-mode-global-v2-css', '/src/ui/dark-mode-global-v2.css?v=20260906-darkmode2'],
    ['incheck360-dark-mode-module-shells-v3-css', '/src/ui/dark-mode-module-shells-v3.css?v=20260906-darkmode3'],
    ['incheck360-dark-mode-module-final-css', '/src/ui/dark-mode-module-final-overrides.css?v=20260906-darkmode4'],
    ['incheck360-employee-calendar-dark-fix-css', '/src/ui/employee-calendar-dark-fix.css?v=20260906-calendardark1'],
    ['incheck360-sidebar-hover-stable-css', '/src/ui/sidebar-hover-stable.css?v=20260907-sidebarhover2'],
    ['monitor-core-dark-mode-consistency-final-css', '/src/ui/dark-mode-consistency-final.css?v=20260907-darkconsistency1'],
    ['monitor-core-sidebar-permission-visibility-css', '/src/ui/sidebar-permission-visibility.css?v=20260908-permissions1'],
    ['monitor-core-agreement-single-provider-signer-css', '/src/ui/agreement-single-provider-signer.css?v=20260911-gm-only1']
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
