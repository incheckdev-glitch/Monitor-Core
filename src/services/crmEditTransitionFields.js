(function installCrmEditTransitionFields(global) {
  'use strict';

  if (global.InCheck360CrmEditTransitionFields) return;

  const VERSION = '20260917-crm-edit-transition1';
  const TRANSITION_FIELDS = new Set(['leadFormStatus', 'dealFormStage']);

  function refreshRelatedFields(event) {
    const id = event?.target?.id;
    if (!TRANSITION_FIELDS.has(id)) return;

    try {
      global.InCheck360CrmPipelineIntelligenceFields?.refresh?.();
    } catch (error) {
      console.error('[CRM Edit Transition Fields] Unable to refresh related fields:', error);
    }
  }

  function bind() {
    if (document.documentElement.dataset.crmEditTransitionFieldsBound === '1') return;
    document.documentElement.dataset.crmEditTransitionFieldsBound = '1';

    // Capture phase makes Edit-form transitions reliable even if another
    // field handler stops the event before it reaches document bubbling.
    document.addEventListener('change', refreshRelatedFields, true);
    document.addEventListener('input', refreshRelatedFields, true);
  }

  global.InCheck360CrmEditTransitionFields = Object.freeze({
    version: VERSION,
    refresh: () => global.InCheck360CrmPipelineIntelligenceFields?.refresh?.()
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})(window);
