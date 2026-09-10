(function installLeadStatusExtension(global) {
  'use strict';

  if (global.InCheck360LeadStatusExtension) return;

  const STATUS_ORDER = [
    'not contacted yet',
    'not available',
    'meeting booked',
    'meeting done',
    'negotiation',
    'qualified',
    'lost'
  ];

  const STATUS_ALIASES = new Map([
    ['meeting booked', 'meeting booked'],
    ['meeting_booked', 'meeting booked'],
    ['meeting scheduled', 'meeting booked'],
    ['meeting_scheduled', 'meeting booked'],
    ['booked', 'meeting booked'],
    ['meeting done', 'meeting done'],
    ['meeting_done', 'meeting done'],
    ['meeting completed', 'meeting done'],
    ['meeting_completed', 'meeting done'],
    ['met', 'meeting done']
  ]);

  let retryCount = 0;
  let patched = false;

  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const norm = value => text(value).toLowerCase();

  function laneByLabel(kanban, label) {
    const wanted = norm(label);
    return Array.from(kanban?.querySelectorAll('.ic-crm-kanban-lane') || []).find(lane =>
      norm(lane.querySelector('.ic-crm-kanban-lane-head strong')?.textContent) === wanted
    ) || null;
  }

  function makeLane(label, tone, key) {
    const lane = document.createElement('section');
    lane.className = 'ic-crm-kanban-lane';
    lane.dataset.tone = tone;
    lane.dataset.leadStatusExtension = key;
    lane.innerHTML = `<div class="ic-crm-kanban-lane-head"><div><span class="ic-crm-lane-dot"></span><strong>${label}</strong></div><span class="ic-crm-lane-count">0</span></div><div class="ic-crm-kanban-cards"><div class="ic-crm-lane-empty">No records in this stage</div></div>`;
    return lane;
  }

  function ensureMeetingLane(kanban, label, tone, key) {
    let lane = laneByLabel(kanban, label);
    if (lane) return lane;
    lane = makeLane(label, tone, key);
    const negotiation = laneByLabel(kanban, 'Negotiation');
    if (negotiation) kanban.insertBefore(lane, negotiation);
    else kanban.appendChild(lane);
    return lane;
  }

  function refreshLaneCount(lane) {
    if (!lane) return;
    const cardsHost = lane.querySelector('.ic-crm-kanban-cards');
    const cards = cardsHost ? Array.from(cardsHost.querySelectorAll('.ic-crm-kanban-card')) : [];
    const count = lane.querySelector('.ic-crm-lane-count');
    if (count) count.textContent = String(cards.length);
    const empty = cardsHost?.querySelector('.ic-crm-lane-empty');
    if (cards.length && empty) empty.remove();
    if (!cards.length && cardsHost && !cardsHost.querySelector('.ic-crm-lane-empty')) {
      const placeholder = document.createElement('div');
      placeholder.className = 'ic-crm-lane-empty';
      placeholder.textContent = 'No records in this stage';
      cardsHost.appendChild(placeholder);
    }
  }

  function reconcileGrid() {
    const host = document.getElementById('leadsGridView');
    const kanban = host?.querySelector('.ic-crm-kanban');
    if (!kanban) return;

    const bookedLane = ensureMeetingLane(kanban, 'Meeting Booked', 'info', 'meeting booked');
    const doneLane = ensureMeetingLane(kanban, 'Meeting Done', 'success', 'meeting done');
    const bookedCards = bookedLane.querySelector('.ic-crm-kanban-cards');
    const doneCards = doneLane.querySelector('.ic-crm-kanban-cards');

    Array.from(kanban.querySelectorAll('.ic-crm-kanban-card')).forEach(card => {
      const status = norm(card.querySelector('.ic-crm-card-status')?.textContent);
      if (status === 'meeting booked' && bookedCards && card.parentElement !== bookedCards) bookedCards.appendChild(card);
      if (status === 'meeting done' && doneCards && card.parentElement !== doneCards) doneCards.appendChild(card);
    });

    Array.from(kanban.querySelectorAll('.ic-crm-kanban-lane')).forEach(refreshLaneCount);

    const otherLane = laneByLabel(kanban, 'Other');
    if (otherLane && !otherLane.querySelector('.ic-crm-kanban-card')) otherLane.remove();
  }

  function scheduleGridReconcile(delay = 80) {
    global.setTimeout(reconcileGrid, delay);
  }

  function patchLeads() {
    const Leads = global.Leads;
    if (!Leads) return false;
    if (Leads.__meetingStatusExtensionApplied) return true;

    Leads.formDropdownDefaults = Leads.formDropdownDefaults || {};
    Leads.formDropdownDefaults.status = STATUS_ORDER.slice();

    const originalNormalize = typeof Leads.normalizeLeadStatus === 'function'
      ? Leads.normalizeLeadStatus
      : status => norm(status) || 'not contacted yet';

    Leads.normalizeLeadStatus = function normalizeLeadStatusWithMeetings(status) {
      const value = norm(status);
      if (STATUS_ALIASES.has(value)) return STATUS_ALIASES.get(value);
      return originalNormalize.call(this, status);
    };

    const originalStatusChip = typeof Leads.leadStatusChip === 'function' ? Leads.leadStatusChip : null;
    Leads.leadStatusChip = function leadStatusChipWithMeetings(status = '') {
      const normalized = this.normalizeLeadStatus(status);
      if (normalized === 'meeting booked') return this.leadChip('meeting booked', 'info');
      if (normalized === 'meeting done') return this.leadChip('meeting done', 'success');
      return originalStatusChip ? originalStatusChip.call(this, status) : this.leadChip(normalized, 'neutral');
    };

    if (typeof Leads.render === 'function' && !Leads.__meetingStatusRenderWrapped) {
      const originalRender = Leads.render;
      Leads.render = function renderWithMeetingStatuses(...args) {
        const result = originalRender.apply(this, args);
        scheduleGridReconcile();
        return result;
      };
      Leads.__meetingStatusRenderWrapped = true;
    }

    Leads.__meetingStatusExtensionApplied = true;
    patched = true;

    try { Leads.renderFilters?.(); } catch (_) {}
    try { global.InCheck360CrmGridView?.refresh?.('leads'); } catch (_) {}
    scheduleGridReconcile(120);
    return true;
  }

  function boot() {
    if (patchLeads()) return;
    if (retryCount++ < 40) global.setTimeout(boot, 150);
  }

  document.addEventListener('click', event => {
    const target = event.target?.closest?.('[data-crm-view-key="leads"], #leadsTab, [data-view="leads"]');
    if (target) scheduleGridReconcile(120);
  });

  global.addEventListener('hashchange', () => {
    if (global.location.hash.includes('lead')) scheduleGridReconcile(120);
  });

  global.InCheck360LeadStatusExtension = Object.freeze({
    statuses: STATUS_ORDER.slice(),
    refresh: () => {
      patchLeads();
      try { global.Leads?.renderFilters?.(); } catch (_) {}
      try { global.InCheck360CrmGridView?.refresh?.('leads'); } catch (_) {}
      scheduleGridReconcile();
    },
    isApplied: () => patched
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
