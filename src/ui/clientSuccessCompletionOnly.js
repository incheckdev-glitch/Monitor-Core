(function initClientSuccessCompletionOnly(global) {
  'use strict';

  const MODULE_VIEW_ID = 'clientSuccessView';
  const COMPLETION_TAB = 'completion';
  let syncing = false;
  let scheduled = false;

  function moduleRoot() {
    return document.getElementById(MODULE_VIEW_ID) || document.querySelector('.client-success-module');
  }

  function isVisible(root) {
    if (!root || root.hidden) return false;
    const style = global.getComputedStyle ? global.getComputedStyle(root) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  }

  function selectCompletion(root) {
    const tabs = Array.from(root.querySelectorAll('[data-cs-tab]'));
    if (!tabs.length) return false;
    const completion = tabs.find(btn => String(btn.dataset.csTab || '') === COMPLETION_TAB);
    if (!completion) return false;

    const active = tabs.find(btn => btn.classList.contains('is-active'));
    if (active !== completion) {
      completion.click();
      return true;
    }

    completion.textContent = 'Completions';
    completion.setAttribute('aria-label', 'Completions');

    // Remove the retired legacy Client Success screens from the rendered module.
    // Their database rows are intentionally preserved; this only simplifies the UI.
    tabs.forEach(btn => {
      if (btn !== completion) btn.remove();
    });

    const bar = completion.closest('.cs-tabs');
    if (bar && !bar.querySelector('[data-cs-completion-reports]')) {
      const reports = document.createElement('button');
      reports.type = 'button';
      reports.className = 'cs-tab-btn';
      reports.dataset.csCompletionReports = 'true';
      reports.textContent = 'Completion Reports';
      reports.setAttribute('aria-label', 'Completion Reports');
      reports.addEventListener('click', () => {
        const currentRoot = moduleRoot();
        const completionTab = currentRoot?.querySelector('[data-cs-tab="completion"]');
        if (completionTab && !completionTab.classList.contains('is-active')) completionTab.click();
        global.requestAnimationFrame?.(() => {
          const reportSection = currentRoot?.querySelector('.cs-completion-history');
          if (!reportSection) return;
          reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          reportSection.classList.add('cs-completion-report-focus');
          global.setTimeout(() => reportSection.classList.remove('cs-completion-report-focus'), 1400);
        });
      });
      bar.appendChild(reports);
    }

    return false;
  }

  function removeLegacyActions(root) {
    const retired = new Set([
      'task-create', 'risk-create', 'qbr-create', 'contact-create', 'review-create',
      'onboarding-create', 'renewal-create', 'activity-create', 'group-create', 'brand-create'
    ]);
    root.querySelectorAll('[data-cs-action]').forEach(node => {
      const action = String(node.dataset.csAction || '').trim();
      if (retired.has(action)) node.remove();
    });
  }

  function simplifyLabels(root) {
    root.querySelectorAll('h1,h2,h3,.cs-page-title,.cs-hero-title').forEach(node => {
      if (/^client success 360$/i.test(String(node.textContent || '').trim())) {
        node.textContent = 'Client Success 360 — Completions';
      }
    });
  }

  function sync() {
    scheduled = false;
    if (syncing) return;
    const root = moduleRoot();
    if (!root || !isVisible(root)) return;

    syncing = true;
    try {
      const rerendered = selectCompletion(root);
      if (!rerendered) {
        removeLegacyActions(root);
        simplifyLabels(root);
      }
    } finally {
      syncing = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (global.requestAnimationFrame) global.requestAnimationFrame(sync);
    else global.setTimeout(sync, 0);
  }

  function boot() {
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'style']
      });
    }

    document.addEventListener('click', event => {
      if (event.target?.closest?.('[data-view="clientSuccess"],#clientSuccessTab')) {
        global.setTimeout(schedule, 0);
      }
    }, true);

    global.addEventListener('hashchange', schedule);
    global.setTimeout(schedule, 100);
    global.setTimeout(schedule, 600);
  }

  global.ClientSuccessCompletionOnly = Object.freeze({ refresh: schedule });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
