(function installCrmPipelineIntelligenceAnalytics(global) {
  'use strict';

  const VERSION = '20260911-crm-intelligence-analytics2';
  const LEAD_FLOW = ['not contacted yet','not available','engaged','meeting booked','meeting done','negotiation','qualified'];
  const DEAL_FLOW = ['in progress','negotiation','poc','proposal'];
  let attempts = 0;
  let renderTimer = 0;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  const toast = message => { try { return global.UI?.toast?.(message) || global.U?.toast?.(message); } catch (_) {} };

  function removePipelineIntelligencePanels() {
    document.getElementById('leadsPipelineIntelligence')?.remove();
    document.getElementById('dealsPipelineIntelligence')?.remove();
  }

  function wrap(object, name, marker, factory) {
    if (!object || typeof object[name] !== 'function' || object[marker]) return;
    const original = object[name];
    object[name] = factory(original);
    object[marker] = true;
  }

  function rows(module) {
    const controller = module === 'leads' ? global.Leads : global.Deals;
    return Array.isArray(controller?.state?.filteredRows)
      ? controller.state.filteredRows
      : (Array.isArray(controller?.state?.rows) ? controller.state.rows : []);
  }

  function findRow(module, id) {
    return rows(module).find(row => [row.id, module === 'leads' ? row.lead_id : row.deal_id]
      .some(value => clean(value) === clean(id)));
  }

  function daysSince(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  }

  function overdueDays(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) || date.getTime() >= Date.now()
      ? 0
      : Math.max(1, Math.floor((Date.now() - date.getTime()) / 86400000));
  }

  function ensureStyles() {
    let style = document.getElementById('crmPipelineIntelligenceStyles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'crmPipelineIntelligenceStyles';
      document.head.appendChild(style);
    }
    style.textContent = `
      #leadsPipelineIntelligence,#dealsPipelineIntelligence{display:none!important}
      .crm-intel-card-meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px;font-size:11px}
      .crm-intel-pill{padding:3px 7px;border-radius:999px;background:rgba(148,163,184,.14);font-weight:600}
      .crm-intel-overdue{color:#b91c1c;background:rgba(239,68,68,.12)}
      .ic-crm-kanban-card.crm-intel-card-overdue{box-shadow:inset 3px 0 0 rgba(239,68,68,.75)}
    `;
  }

  function decorateCards() {
    removePipelineIntelligencePanels();
    for (const module of ['leads','deals']) {
      document.querySelectorAll(`#${module}GridView .ic-crm-kanban-card[data-crm-grid-record]`).forEach(card => {
        const row = findRow(module, card.dataset.crmGridRecord);
        if (!row) return;
        let meta = card.querySelector('.crm-intel-card-meta');
        if (!meta) {
          meta = document.createElement('div');
          meta.className = 'crm-intel-card-meta';
          card.appendChild(meta);
        }

        const age = daysSince(module === 'leads' ? row.status_changed_at : row.stage_changed_at);
        const overdue = overdueDays(module === 'leads'
          ? (row.next_follow_up_at || row.next_follow_up)
          : row.next_follow_up_at);
        const rawLocations = row.number_of_locations;
        const hasLocationCount = rawLocations !== null && rawLocations !== undefined && String(rawLocations).trim() !== '';
        const parsedLocations = Number(rawLocations);
        const locationLabel = hasLocationCount && Number.isFinite(parsedLocations)
          ? `${Math.max(0, Math.trunc(parsedLocations))} location${Math.trunc(parsedLocations) === 1 ? '' : 's'}`
          : 'Locations: —';
        const nextAction = clean(row.next_action);

        card.classList.toggle('crm-intel-card-overdue', overdue > 0);
        meta.innerHTML = `<span class="crm-intel-pill">${age}d in ${module === 'leads' ? 'status' : 'stage'}</span><span class="crm-intel-pill">${esc(locationLabel)}</span>${nextAction ? `<span class="crm-intel-pill">Next: ${esc(nextAction)}</span>` : ''}${overdue ? `<span class="crm-intel-pill crm-intel-overdue">⚠ ${overdue}d overdue</span>` : ''}`;
      });
    }
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      ensureStyles();
      removePipelineIntelligencePanels();
      decorateCards();
    }, 100);
    setTimeout(() => {
      removePipelineIntelligencePanels();
      decorateCards();
    }, 350);
  }

  function smartDropWarning(event) {
    const lane = event.target?.closest?.('.ic-crm-kanban-lane');
    if (!lane) return;
    let payload = '';
    try { payload = clean(event.dataTransfer?.getData('text/plain')); } catch (_) {}
    const match = payload.match(/^(leads|deals):(.+)$/);
    if (!match || !lane.closest(`#${match[1]}GridView`)) return;
    const target = norm(lane.querySelector('.ic-crm-kanban-lane-head strong')?.textContent);
    const row = findRow(match[1], match[2]);
    const flow = match[1] === 'leads' ? LEAD_FLOW : DEAL_FLOW;
    if (!row || ['lost','disregard','other'].includes(target)) return;
    const current = norm(match[1] === 'leads'
      ? (global.Leads?.normalizeLeadStatus?.(row.status) || row.status)
      : (global.Deals?.normalizeStage?.(row.stage) || row.stage));
    const fromIndex = flow.indexOf(current);
    const toIndex = flow.indexOf(target);
    if (fromIndex < 0 || toIndex < 0 || Math.abs(toIndex - fromIndex) <= 1) return;
    const skipped = Math.abs(toIndex - fromIndex) - 1;
    if (!global.confirm(`This move skips ${skipped} pipeline step${skipped === 1 ? '' : 's'}: ${current} → ${target}. Continue?`)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Pipeline move cancelled.');
    }
  }

  function patchControllers() {
    if (!global.Leads || !global.Deals) return false;
    wrap(global.Leads, 'render', '__crmIntelAnalyticsLeadRenderV2', original => function(...args) {
      const result = original.apply(this, args);
      scheduleRender();
      return result;
    });
    wrap(global.Deals, 'render', '__crmIntelAnalyticsDealRenderV2', original => function(...args) {
      const result = original.apply(this, args);
      scheduleRender();
      return result;
    });
    return true;
  }

  function bind() {
    if (document.documentElement.dataset.crmIntelligenceAnalyticsBoundV2 === '1') return;
    document.documentElement.dataset.crmIntelligenceAnalyticsBoundV2 = '1';
    document.addEventListener('drop', smartDropWarning, true);
    document.addEventListener('click', event => {
      if (event.target?.closest?.('#leadsTab,#dealsTab,[data-view="leads"],[data-view="deals"],[data-crm-view-mode="grid"]')) {
        scheduleRender();
      }
    });
  }

  function boot() {
    ensureStyles();
    removePipelineIntelligencePanels();
    if (!patchControllers()) {
      if (attempts++ < 100) setTimeout(boot, 150);
      return;
    }
    bind();
    scheduleRender();
  }

  global.InCheck360CrmPipelineIntelligenceAnalytics = Object.freeze({
    version: VERSION,
    refresh: scheduleRender
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
