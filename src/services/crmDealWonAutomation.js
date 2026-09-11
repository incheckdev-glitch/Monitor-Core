(function installCrmDealWonAutomation(global) {
  'use strict';
  if (global.InCheck360CrmDealWonAutomation) return;

  const VERSION = '20260911-crm-deal-won1';
  const DISPLAY_STAGES = ['In Progress', 'Negotiation', 'POC', 'Proposal', 'Won', 'Lost'];
  const MANUAL_STAGES = ['In Progress', 'Negotiation', 'POC', 'Proposal', 'Lost'];
  let attempts = 0;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function isWon(value) {
    return ['won', 'closed won'].includes(norm(value));
  }

  function canonicalStage(value, fallback) {
    if (isWon(value)) return 'Won';
    try {
      if (typeof fallback === 'function') return fallback(value);
    } catch (_) {}
    return clean(value) || 'In Progress';
  }

  function wrap(object, name, marker, factory) {
    if (!object || typeof object[name] !== 'function' || object[marker]) return;
    const original = object[name];
    object[name] = factory(original);
    object[marker] = true;
  }

  function rewriteStageFilter(controller) {
    const select = document.getElementById('dealsStageFilter');
    if (!select) return;
    const selected = clean(controller?.state?.stage || select.value || 'All');
    const options = ['All', ...DISPLAY_STAGES];
    select.innerHTML = options.map(stage => `<option value="${esc(stage)}">${esc(stage)}</option>`).join('');
    const normalized = isWon(selected) ? 'Won' : selected;
    select.value = options.includes(normalized) ? normalized : 'All';
  }

  function renderStageDistribution(controller, analytics = {}) {
    const host = document.getElementById('dealsStageDistribution');
    if (!host || typeof controller?.renderDistribution !== 'function') return;
    const breakdown = analytics.stageBreakdown || {};
    const entries = DISPLAY_STAGES.map(stage => [stage, Number(breakdown[stage] || breakdown[stage.toLowerCase()] || 0)]);
    controller.renderDistribution(host, entries, Number(analytics.totalDeals || analytics.total || 0));
  }

  function ensureWonLane() {
    const kanban = document.getElementById('dealsGridView')?.querySelector('.ic-crm-kanban');
    if (!kanban) return;

    const lanes = Array.from(kanban.querySelectorAll('.ic-crm-kanban-lane'));
    let wonLane = lanes.find(lane => norm(lane.querySelector('.ic-crm-kanban-lane-head strong')?.textContent) === 'won');
    if (!wonLane) {
      wonLane = document.createElement('section');
      wonLane.className = 'ic-crm-kanban-lane';
      wonLane.dataset.tone = 'success';
      wonLane.dataset.systemStage = 'won';
      wonLane.innerHTML = '<div class="ic-crm-kanban-lane-head"><div><span class="ic-crm-lane-dot"></span><strong>Won</strong></div><span class="ic-crm-lane-count">0</span></div><div class="ic-crm-kanban-cards"><div class="ic-crm-lane-empty">No records in this stage</div></div>';
    }

    const lostLane = Array.from(kanban.querySelectorAll('.ic-crm-kanban-lane')).find(
      lane => norm(lane.querySelector('.ic-crm-kanban-lane-head strong')?.textContent) === 'lost'
    );
    if (lostLane) kanban.insertBefore(wonLane, lostLane);
    else kanban.appendChild(wonLane);

    const wonHost = wonLane.querySelector('.ic-crm-kanban-cards');
    Array.from(kanban.querySelectorAll('.ic-crm-kanban-card[data-crm-grid-record]')).forEach(card => {
      const statusNode = card.querySelector('.ic-crm-card-status');
      if (!isWon(statusNode?.textContent)) return;
      wonHost?.querySelector('.ic-crm-lane-empty')?.remove();
      wonHost?.appendChild(card);
      if (statusNode) statusNode.textContent = 'Won';
      card.draggable = false;
      card.dataset.crmDragEnabled = 'false';
      card.dataset.systemWon = '1';
      card.title = 'Won is automatic after the related agreement is signed and cannot be changed manually.';
    });

    Array.from(kanban.querySelectorAll('.ic-crm-kanban-lane')).forEach(lane => {
      const cardsHost = lane.querySelector('.ic-crm-kanban-cards');
      if (!cardsHost) return;
      const cards = cardsHost.querySelectorAll('.ic-crm-kanban-card');
      const count = lane.querySelector('.ic-crm-lane-count');
      if (count) count.textContent = String(cards.length);
      if (!cards.length && !cardsHost.querySelector('.ic-crm-lane-empty')) {
        cardsHost.innerHTML = '<div class="ic-crm-lane-empty">No records in this stage</div>';
      }
    });
  }

  function scheduleWonUi() {
    global.setTimeout(() => {
      try { rewriteStageFilter(global.Deals); } catch (_) {}
      try { ensureWonLane(); } catch (_) {}
    }, 260);
    global.setTimeout(() => {
      try { ensureWonLane(); } catch (_) {}
    }, 560);
  }

  function applyWonFormState(row = {}) {
    const select = document.getElementById('dealFormStage');
    if (!select) return;

    const rowWon = isWon(row?.stage || row?.deal_stage);
    const existingWon = Array.from(select.options || []).find(option => isWon(option.value) || isWon(option.textContent));

    if (rowWon) {
      if (!existingWon) {
        const option = document.createElement('option');
        option.value = 'Won';
        option.textContent = 'Won — Automatic';
        select.appendChild(option);
      } else {
        existingWon.value = 'Won';
        existingWon.textContent = 'Won — Automatic';
      }
      if (!select.dataset.wonPrevDisabled) select.dataset.wonPrevDisabled = select.disabled ? '1' : '0';
      select.value = 'Won';
      select.disabled = true;
      select.dataset.systemWon = '1';
      select.title = 'Won is set automatically when the related agreement is signed.';

      let help = document.getElementById('dealWonAutomaticHelp');
      if (!help) {
        help = document.createElement('small');
        help.id = 'dealWonAutomaticHelp';
        help.style.display = 'block';
        help.style.marginTop = '5px';
        help.style.opacity = '.7';
        select.insertAdjacentElement('afterend', help);
      }
      help.textContent = 'System-controlled: this Deal became Won automatically because its related Agreement is signed.';
      return;
    }

    Array.from(select.options || []).forEach(option => {
      if (isWon(option.value) || isWon(option.textContent)) option.remove();
    });
    document.getElementById('dealWonAutomaticHelp')?.remove();
    if (select.dataset.systemWon === '1') {
      const wasDisabled = select.dataset.wonPrevDisabled === '1';
      select.disabled = wasDisabled;
      delete select.dataset.systemWon;
      delete select.dataset.wonPrevDisabled;
      select.removeAttribute('title');
    }
  }

  function patchDeals() {
    const Deals = global.Deals;
    if (!Deals) return false;
    if (Deals.__crmDealWonAutomationVersion === VERSION) return true;

    const previousNormalize = typeof Deals.normalizeStage === 'function' ? Deals.normalizeStage.bind(Deals) : null;
    Deals.normalizeStage = value => canonicalStage(value, previousNormalize);
    Deals.matchesOpenStatus = value => !['won', 'lost'].includes(norm(Deals.normalizeStage(value)));

    Deals.dealStageChip = function systemWonDealStageChip(stage = '') {
      const normalized = this.normalizeStage(stage);
      const variant = normalized === 'Won'
        ? 'success'
        : normalized === 'Lost'
          ? 'danger'
          : normalized === 'Proposal'
            ? 'success'
            : ['POC', 'Negotiation'].includes(normalized)
              ? 'info'
              : 'neutral';
      return this.dealChip(normalized, variant);
    };

    wrap(Deals, 'computeDealAnalytics', '__crmWonAnalytics1', original => function(rows = []) {
      const analytics = original.call(this, rows) || {};
      const breakdown = Object.fromEntries(DISPLAY_STAGES.map(stage => [stage, 0]));
      for (const row of Array.isArray(rows) ? rows : []) {
        const stage = this.normalizeStage(row?.stage || row?.deal_stage);
        if (Object.prototype.hasOwnProperty.call(breakdown, stage)) breakdown[stage] += 1;
      }
      analytics.stageBreakdown = breakdown;
      analytics.wonCount = breakdown.Won;
      analytics.totalDeals = Number(analytics.totalDeals ?? analytics.total ?? (Array.isArray(rows) ? rows.length : 0));
      return analytics;
    });

    wrap(Deals, 'renderDealAnalytics', '__crmWonRenderAnalytics1', original => function(analytics) {
      const result = original.call(this, analytics);
      renderStageDistribution(this, analytics || {});
      return result;
    });

    wrap(Deals, 'renderFilters', '__crmWonFilters1', original => function(...args) {
      const result = original.apply(this, args);
      rewriteStageFilter(this);
      return result;
    });

    wrap(Deals, 'openForm', '__crmWonOpenForm1', original => async function(row = null, ...args) {
      const result = await original.call(this, row, ...args);
      applyWonFormState(row || {});
      return result;
    });

    wrap(Deals, 'render', '__crmWonGridRender1', original => function(...args) {
      const result = original.apply(this, args);
      scheduleWonUi();
      return result;
    });

    Deals.__crmDealWonAutomationVersion = VERSION;
    try { rewriteStageFilter(Deals); } catch (_) {}
    try {
      const analytics = Deals.computeDealAnalytics?.(Deals.state?.filteredRows || Deals.state?.rows || []) || {};
      Deals.renderDealAnalytics?.(analytics);
    } catch (_) {}
    scheduleWonUi();
    return true;
  }

  function bindSystemWonDragGuard() {
    if (document.documentElement.dataset.crmSystemWonDragGuard === '1') return;
    document.documentElement.dataset.crmSystemWonDragGuard = '1';

    document.addEventListener('dragstart', event => {
      const card = event.target?.closest?.('#dealsGridView .ic-crm-kanban-card[data-crm-grid-record]');
      if (!card) return;
      const status = card.querySelector('.ic-crm-card-status')?.textContent;
      if (!isWon(status)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      card.draggable = false;
    }, true);
  }

  function boot() {
    bindSystemWonDragGuard();
    if (patchDeals()) return;
    if (attempts++ < 100) global.setTimeout(boot, 150);
  }

  global.InCheck360CrmDealWonAutomation = Object.freeze({
    version: VERSION,
    displayStages: DISPLAY_STAGES.slice(),
    manualStages: MANUAL_STAGES.slice(),
    refresh: scheduleWonUi
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
