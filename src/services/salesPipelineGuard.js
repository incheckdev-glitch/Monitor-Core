(function installSalesPipelineGuard(global) {
  'use strict';

  const VERSION = '20260912-salespipeline4';
  const LEAD_STATUSES = [
    'not contacted yet',
    'not available',
    'engaged',
    'meeting booked',
    'meeting done',
    'negotiation',
    'qualified',
    'lost',
    'disregard'
  ];
  const DEAL_FORM_STAGES = [
    'In Progress',
    'Negotiation',
    'POC',
    'Proposal',
    'Lost'
  ];
  const DEAL_GRID_STAGES = [
    'In Progress',
    'Negotiation',
    'POC',
    'Proposal',
    'Won',
    'Lost'
  ];

  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const norm = value => text(value).toLowerCase();

  function canonicalLeadStatus(value) {
    const v = norm(value).replace(/_/g, ' ').replace(/-/g, ' ');
    if (!v || ['new', 'open', 'not contacted'].includes(v)) return 'not contacted yet';
    if (v === 'not contacted yet') return 'not contacted yet';
    if (['not available', 'unavailable'].includes(v)) return 'not available';
    if (['engaged', 'contacted', 'connected', 'in contact', 'initial contact'].includes(v)) return 'engaged';
    if (['meeting booked', 'meeting scheduled', 'booked'].includes(v)) return 'meeting booked';
    if (['meeting done', 'meeting completed', 'met'].includes(v)) return 'meeting done';
    if (['negotiation', 'negotiating', 'in negotiation', 'negotiations'].includes(v)) return 'negotiation';
    if (['qualified', 'qualify', 'converted', 'converted to deal', 'coverted to deal'].includes(v)) return 'qualified';
    if (['lost', 'closed lost'].includes(v)) return 'lost';
    if (['disregard', 'disregarded', 'irrelevant', 'not relevant'].includes(v)) return 'disregard';
    return v;
  }

  function canonicalDealStage(value) {
    const v = norm(value).replace(/_/g, ' ').replace(/-/g, ' ');
    if (!v || v === 'new' || v.includes('prospect')) return 'In Progress';
    if (v === 'in progress' || v === 'progress' || v.includes('in progress')) return 'In Progress';
    if (v === 'qualified') return 'Negotiation';
    if (v.includes('negotiat')) return 'Negotiation';
    if (v === 'poc' || v.includes('proof of concept') || v.includes('proof ofconcept')) return 'POC';
    if (v === 'converted to proposal' || v === 'proposal' || v === 'proposal sent' || v.includes('converted to proposal')) return 'Proposal';
    if (v === 'won' || v === 'closed won' || v.includes('closed won')) return 'Won';
    if (v === 'lost' || v === 'closed lost' || v.includes('closed lost')) return 'Lost';
    return text(value) || 'In Progress';
  }

  function copyWith(obj, key, normalizer, fallback) {
    const next = { ...(obj && typeof obj === 'object' ? obj : {}) };
    next[key] = normalizer(next[key] == null || text(next[key]) === '' ? fallback : next[key]);
    return next;
  }

  function patchMethod(object, name, marker, wrapperFactory) {
    if (!object || typeof object[name] !== 'function' || object[marker]) return;
    const original = object[name];
    object[name] = wrapperFactory(original);
    object[marker] = true;
  }

  function rewriteSelect(id, values, selected, { includeAll = false, includeBlank = false } = {}) {
    const select = document.getElementById(id);
    if (!select) return;
    const wanted = selected == null ? '' : String(selected);
    const options = [];
    if (includeAll) options.push(['All', 'All']);
    if (includeBlank) options.push(['', '—']);
    values.forEach(value => options.push([value, value]));
    select.innerHTML = options.map(([value, label]) => `<option value="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`).join('');
    if (options.some(([value]) => value === wanted)) select.value = wanted;
  }

  function patchLeads() {
    const Leads = global.Leads;
    if (!Leads) return false;
    if (Leads.__salesPipelineGuardVersion === VERSION) return true;

    Leads.formDropdownDefaults = Leads.formDropdownDefaults || {};
    Leads.formDropdownDefaults.status = LEAD_STATUSES.slice();
    Leads.normalizeLeadStatus = canonicalLeadStatus;
    Leads.allowedLeadStatuses = () => LEAD_STATUSES.slice();
    Leads.matchesOpenStatus = status => !['lost', 'disregard'].includes(canonicalLeadStatus(status));

    patchMethod(Leads, 'normalizeLead', '__salesPipelineNormalizeLeadWrapped4', original => function guardedNormalizeLead(raw = {}) {
      const row = original.call(this, raw);
      if (row && typeof row === 'object') row.status = canonicalLeadStatus(raw?.status ?? row.status);
      return row;
    });

    patchMethod(Leads, 'collectFormData', '__salesPipelineLeadCollectWrapped4', original => function guardedCollectLead(...args) {
      const row = original.apply(this, args);
      if (row && typeof row === 'object') row.status = canonicalLeadStatus(row.status);
      return row;
    });

    patchMethod(Leads, 'createLead', '__salesPipelineLeadCreateWrapped4', original => async function guardedCreateLead(lead = {}) {
      return original.call(this, copyWith(lead, 'status', canonicalLeadStatus, 'not contacted yet'));
    });

    patchMethod(Leads, 'updateLead', '__salesPipelineLeadUpdateWrapped4', original => async function guardedUpdateLead(id, updates = {}) {
      const next = { ...(updates || {}) };
      if (Object.prototype.hasOwnProperty.call(next, 'status')) next.status = canonicalLeadStatus(next.status);
      return original.call(this, id, next);
    });

    patchMethod(Leads, 'updateLeadWithVerification', '__salesPipelineLeadVerifyWrapped4', original => async function guardedLeadVerification(id, updates = {}) {
      const result = await original.call(this, id, copyWith(updates, 'status', canonicalLeadStatus, 'not contacted yet'));
      try {
        const fresh = await this.getLead?.(id);
        if (fresh) return { ...(result || {}), row: fresh };
      } catch (_) {}
      return result;
    });

    patchMethod(Leads, 'buildDealFromLead', '__salesPipelineLeadDealBuildWrapped4', original => function guardedBuildDeal(...args) {
      const deal = original.apply(this, args) || {};
      deal.stage = 'In Progress';
      return deal;
    });

    Leads.leadStatusChip = function guardedLeadStatusChip(status = '') {
      const s = canonicalLeadStatus(status);
      const variants = {
        'not contacted yet': 'neutral',
        'not available': 'warning',
        engaged: 'info',
        'meeting booked': 'info',
        'meeting done': 'success',
        negotiation: 'info',
        qualified: 'success',
        lost: 'danger',
        disregard: 'neutral'
      };
      return this.leadChip(s, variants[s] || 'neutral');
    };

    patchMethod(Leads, 'renderFilters', '__salesPipelineLeadFiltersWrapped4', original => function guardedLeadFilters(...args) {
      const result = original.apply(this, args);
      rewriteSelect('leadsStatusFilter', LEAD_STATUSES, this.state?.status || 'All', { includeAll: true });
      return result;
    });

    patchMethod(Leads, 'syncLeadFormDropdowns', '__salesPipelineLeadDropdownWrapped4', original => function guardedLeadDropdown(selected = {}) {
      const result = original.call(this, { ...selected, status: canonicalLeadStatus(selected?.status) });
      const current = canonicalLeadStatus(document.getElementById('leadFormStatus')?.value || selected?.status || 'not contacted yet');
      rewriteSelect('leadFormStatus', LEAD_STATUSES, current);
      return result;
    });

    patchMethod(Leads, 'render', '__salesPipelineLeadRenderWrapped4', original => function guardedLeadRender(...args) {
      const result = original.apply(this, args);
      setTimeout(reconcileLeadGrid, 40);
      return result;
    });

    Leads.__salesPipelineGuardVersion = VERSION;
    try { Leads.renderFilters?.(); } catch (_) {}
    try { global.InCheck360CrmGridView?.refresh?.('leads'); } catch (_) {}
    return true;
  }

  function patchDeals() {
    const Deals = global.Deals;
    if (!Deals) return false;
    if (Deals.__salesPipelineGuardVersion === VERSION) return true;

    Deals.formDropdownDefaults = Deals.formDropdownDefaults || {};
    Deals.formDropdownDefaults.stage = DEAL_FORM_STAGES.slice();
    Deals.normalizeStage = canonicalDealStage;
    Deals.matchesOpenStatus = status => !['won', 'lost'].includes(norm(canonicalDealStage(status)));

    patchMethod(Deals, 'normalizeDeal', '__salesPipelineNormalizeDealWrapped4', original => function guardedNormalizeDeal(raw = {}) {
      const row = original.call(this, raw);
      if (row && typeof row === 'object') row.stage = canonicalDealStage(raw?.stage ?? row.stage);
      return row;
    });

    patchMethod(Deals, 'collectFormData', '__salesPipelineDealCollectWrapped4', original => function guardedCollectDeal(...args) {
      const row = original.apply(this, args);
      if (row && typeof row === 'object') row.stage = canonicalDealStage(row.stage);
      return row;
    });

    patchMethod(Deals, 'createDeal', '__salesPipelineDealCreateWrapped4', original => async function guardedCreateDeal(deal = {}) {
      return original.call(this, copyWith(deal, 'stage', canonicalDealStage, 'In Progress'));
    });

    patchMethod(Deals, 'updateDeal', '__salesPipelineDealUpdateWrapped4', original => async function guardedUpdateDeal(id, updates = {}) {
      const next = { ...(updates || {}) };
      if (Object.prototype.hasOwnProperty.call(next, 'stage')) next.stage = canonicalDealStage(next.stage);
      return original.call(this, id, next);
    });

    patchMethod(Deals, 'validateDealWorkflow', '__salesPipelineDealValidationWrapped4', original => function guardedDealWorkflow(deal = {}) {
      deal.stage = canonicalDealStage(deal.stage || 'In Progress');
      return original.call(this, deal);
    });

    patchMethod(Deals, 'syncDealFormDropdowns', '__salesPipelineDealDropdownWrapped4', original => function guardedDealDropdown(selected = {}) {
      const selectedStage = canonicalDealStage(selected?.stage || document.getElementById('dealFormStage')?.value || 'In Progress');
      const result = original.call(this, { ...selected, stage: selectedStage });
      if (selectedStage !== 'Won') rewriteSelect('dealFormStage', DEAL_FORM_STAGES, selectedStage);
      return result;
    });

    patchMethod(Deals, 'renderFilters', '__salesPipelineDealFiltersWrapped4', original => function guardedDealFilters(...args) {
      const result = original.apply(this, args);
      const stage = this.state?.stage === 'All' ? 'All' : canonicalDealStage(this.state?.stage || 'All');
      rewriteSelect('dealsStageFilter', DEAL_GRID_STAGES, stage, { includeAll: true });
      return result;
    });

    patchMethod(Deals, 'openForm', '__salesPipelineDealOpenFormWrapped4', original => async function guardedDealOpenForm(row = null) {
      const result = await original.call(this, row);
      const stage = canonicalDealStage(row?.stage || 'In Progress');
      if (stage !== 'Won') {
        rewriteSelect('dealFormStage', DEAL_FORM_STAGES, stage);
        const stageEl = document.getElementById('dealFormStage');
        if (stageEl) stageEl.value = stage;
      }
      return result;
    });

    Deals.canShowCreateProposalForDeal = function guardedCanCreateProposal(row = {}) {
      return canonicalDealStage(row?.stage) === 'POC' && !this.isProposalAlreadyCreated(row) && this.canCreateProposalFromDeal();
    };

    Deals.dealStageChip = function guardedDealStageChip(stage = '') {
      const s = canonicalDealStage(stage);
      const variant = s === 'Lost' ? 'danger' : ['Won', 'Proposal'].includes(s) ? 'success' : ['POC', 'Negotiation'].includes(s) ? 'info' : 'neutral';
      return this.dealChip(s, variant);
    };

    patchMethod(Deals, 'renderDealAnalytics', '__salesPipelineDealAnalyticsWrapped4', original => function guardedDealAnalytics(analytics) {
      const result = original.call(this, analytics);
      const safe = analytics || this.computeDealAnalytics?.(this.state?.filteredRows || []) || {};
      const host = document.getElementById('dealsStageDistribution');
      if (host && typeof this.renderDistribution === 'function') {
        const entries = DEAL_GRID_STAGES.map(stage => [stage, Number(safe.stageBreakdown?.[stage] || 0)]);
        this.renderDistribution(host, entries, Number(safe.totalDeals || 0));
      }
      return result;
    });

    patchMethod(Deals, 'render', '__salesPipelineDealRenderWrapped4', original => function guardedDealRender(...args) {
      const result = original.apply(this, args);
      setTimeout(reconcileDealGrid, 40);
      return result;
    });

    Deals.__salesPipelineGuardVersion = VERSION;
    try { Deals.renderFilters?.(); } catch (_) {}
    try { global.InCheck360CrmGridView?.refresh?.('deals'); } catch (_) {}
    return true;
  }

  function laneByLabel(kanban, label) {
    const wanted = norm(label);
    return Array.from(kanban?.querySelectorAll('.ic-crm-kanban-lane') || []).find(lane =>
      norm(lane.querySelector('.ic-crm-kanban-lane-head strong')?.textContent) === wanted
    ) || null;
  }

  function ensureLane(kanban, label, tone) {
    let lane = laneByLabel(kanban, label);
    if (lane) return lane;
    lane = document.createElement('section');
    lane.className = 'ic-crm-kanban-lane';
    lane.dataset.tone = tone;
    lane.innerHTML = `<div class="ic-crm-kanban-lane-head"><div><span class="ic-crm-lane-dot"></span><strong>${label}</strong></div><span class="ic-crm-lane-count">0</span></div><div class="ic-crm-kanban-cards"><div class="ic-crm-lane-empty">No records in this stage</div></div>`;
    kanban.appendChild(lane);
    return lane;
  }

  function updateLane(lane) {
    if (!lane) return;
    const cardsHost = lane.querySelector('.ic-crm-kanban-cards');
    const cards = Array.from(cardsHost?.querySelectorAll('.ic-crm-kanban-card') || []);
    const count = lane.querySelector('.ic-crm-lane-count');
    if (count) count.textContent = String(cards.length);
    const empty = cardsHost?.querySelector('.ic-crm-lane-empty');
    if (cards.length && empty) empty.remove();
    if (!cards.length && cardsHost && !empty) {
      const el = document.createElement('div');
      el.className = 'ic-crm-lane-empty';
      el.textContent = 'No records in this stage';
      cardsHost.appendChild(el);
    }
  }

  function reconcileGrid(hostId, stages, canonicalizer, tones, removed = []) {
    const kanban = document.getElementById(hostId)?.querySelector('.ic-crm-kanban');
    if (!kanban) return;
    const lanes = new Map(stages.map(stage => [stage, ensureLane(kanban, stage, tones[stage] || 'neutral')]));
    Array.from(kanban.querySelectorAll('.ic-crm-kanban-card')).forEach(card => {
      const stage = canonicalizer(card.querySelector('.ic-crm-card-status')?.textContent || '');
      const lane = lanes.get(stage);
      const cardsHost = lane?.querySelector('.ic-crm-kanban-cards');
      if (cardsHost && card.parentElement !== cardsHost) cardsHost.appendChild(card);
      if (card.querySelector('.ic-crm-card-status')) card.querySelector('.ic-crm-card-status').textContent = stage;
    });
    removed.forEach(label => {
      const lane = laneByLabel(kanban, label);
      if (lane && !lane.querySelector('.ic-crm-kanban-card')) lane.remove();
    });
    stages.forEach(stage => {
      const lane = lanes.get(stage);
      if (lane) kanban.appendChild(lane);
    });
    Array.from(kanban.querySelectorAll('.ic-crm-kanban-lane')).forEach(updateLane);
    const other = laneByLabel(kanban, 'Other');
    if (other && !other.querySelector('.ic-crm-kanban-card')) other.remove();
  }

  function reconcileLeadGrid() {
    const labels = ['Not Contacted Yet', 'Not Available', 'Engaged', 'Meeting Booked', 'Meeting Done', 'Negotiation', 'Qualified', 'Lost', 'Disregard'];
    const normalizeLabel = value => {
      const status = canonicalLeadStatus(value);
      return ({
        'not contacted yet': 'Not Contacted Yet',
        'not available': 'Not Available',
        engaged: 'Engaged',
        'meeting booked': 'Meeting Booked',
        'meeting done': 'Meeting Done',
        negotiation: 'Negotiation',
        qualified: 'Qualified',
        lost: 'Lost',
        disregard: 'Disregard'
      })[status] || value;
    };
    reconcileGrid('leadsGridView', labels, normalizeLabel, {
      'Not Contacted Yet': 'info',
      'Not Available': 'neutral',
      Engaged: 'warning',
      'Meeting Booked': 'info',
      'Meeting Done': 'success',
      Negotiation: 'warning',
      Qualified: 'success',
      Lost: 'danger',
      Disregard: 'neutral'
    });
  }

  function reconcileDealGrid() {
    reconcileGrid('dealsGridView', DEAL_GRID_STAGES, canonicalDealStage, {
      'In Progress': 'warning',
      Negotiation: 'warning',
      POC: 'info',
      Proposal: 'success',
      Won: 'success',
      Lost: 'danger'
    }, ['New', 'Qualified', 'Converted to Proposal']);
  }

  function refresh() {
    patchLeads();
    patchDeals();
    try { global.InCheck360CrmGridView?.refresh?.('leads'); } catch (_) {}
    try { global.InCheck360CrmGridView?.refresh?.('deals'); } catch (_) {}
    setTimeout(reconcileLeadGrid, 80);
    setTimeout(reconcileDealGrid, 80);
  }

  let lastLeads = null;
  let lastDeals = null;
  const timer = global.setInterval(() => {
    if (global.Leads !== lastLeads || global.Leads?.__salesPipelineGuardVersion !== VERSION) {
      lastLeads = global.Leads || null;
      patchLeads();
    }
    if (global.Deals !== lastDeals || global.Deals?.__salesPipelineGuardVersion !== VERSION) {
      lastDeals = global.Deals || null;
      patchDeals();
    }
  }, 750);

  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-crm-view-key], #leadsTab, #dealsTab, [data-view="leads"], [data-view="deals"]')) {
      setTimeout(refresh, 60);
    }
  });
  global.addEventListener('hashchange', () => setTimeout(refresh, 60));

  global.InCheck360SalesPipelineGuard = Object.freeze({
    version: VERSION,
    leadStatuses: LEAD_STATUSES.slice(),
    dealStages: DEAL_GRID_STAGES.slice(),
    dealFormStages: DEAL_FORM_STAGES.slice(),
    canonicalLeadStatus,
    canonicalDealStage,
    refresh,
    stop: () => global.clearInterval(timer)
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  else refresh();
})(window);
