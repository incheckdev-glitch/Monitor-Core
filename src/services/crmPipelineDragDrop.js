(function installCrmPipelineDragDrop(global) {
  'use strict';

  if (global.InCheck360CrmPipelineDragDrop) return;

  const VERSION = '20260911-crm-pipeline-dnd1';
  const LEAD_TARGETS = new Map([
    ['not contacted yet', 'not contacted yet'],
    ['not available', 'not available'],
    ['engaged', 'engaged'],
    ['meeting booked', 'meeting booked'],
    ['meeting done', 'meeting done'],
    ['negotiation', 'negotiation'],
    ['qualified', 'qualified'],
    ['lost', 'lost'],
    ['disregard', 'disregard']
  ]);
  const DEAL_TARGETS = new Map([
    ['in progress', 'In Progress'],
    ['negotiation', 'Negotiation'],
    ['poc', 'POC'],
    ['proposal', 'Proposal'],
    ['lost', 'Lost']
  ]);

  let dragState = null;
  let suppressClickUntil = 0;
  let transitionInFlight = false;
  let bootAttempts = 0;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');

  function toast(message) {
    try {
      if (global.UI?.toast) return global.UI.toast(message);
      if (global.U?.toast) return global.U.toast(message);
    } catch (_) {}
    console.log('[CRM Pipeline Drag Drop]', message);
  }

  function ensureStyles() {
    if (document.getElementById('crmPipelineDragDropStyles')) return;
    const style = document.createElement('style');
    style.id = 'crmPipelineDragDropStyles';
    style.textContent = `
      .ic-crm-kanban-card[data-crm-drag-enabled="true"]{cursor:grab}
      .ic-crm-kanban-card[data-crm-drag-enabled="true"]:active{cursor:grabbing}
      .ic-crm-kanban-card.is-crm-dragging{opacity:.48;transform:scale(.985)}
      .ic-crm-kanban-lane.is-crm-drop-target{
        outline:2px dashed rgba(59,130,246,.72);
        outline-offset:-4px;
        border-radius:14px;
      }
      .ic-crm-kanban-lane.is-crm-drop-target .ic-crm-kanban-cards{
        background:rgba(59,130,246,.08);
      }
      body.dark-mode .ic-crm-kanban-lane.is-crm-drop-target .ic-crm-kanban-cards,
      html[data-theme="dark"] .ic-crm-kanban-lane.is-crm-drop-target .ic-crm-kanban-cards{
        background:rgba(96,165,250,.12);
      }
    `;
    document.head.appendChild(style);
  }

  function controllerFor(module) {
    return module === 'leads' ? global.Leads : module === 'deals' ? global.Deals : null;
  }

  function moduleForElement(element) {
    if (!element?.closest) return '';
    if (element.closest('#leadsGridView')) return 'leads';
    if (element.closest('#dealsGridView')) return 'deals';
    return '';
  }

  function canEdit(module) {
    try {
      if (module === 'leads') {
        const fn = global.Permissions?.canUpdateLead;
        return typeof fn === 'function' ? Boolean(fn.call(global.Permissions)) : true;
      }
      if (module === 'deals') {
        const fn = global.Deals?.canEdit;
        return typeof fn === 'function' ? Boolean(fn.call(global.Deals)) : true;
      }
    } catch (_) {
      return false;
    }
    return false;
  }

  function allRows(controller) {
    const rows = [];
    if (Array.isArray(controller?.state?.rows)) rows.push(...controller.state.rows);
    if (Array.isArray(controller?.state?.filteredRows)) rows.push(...controller.state.filteredRows);
    return rows;
  }

  function findRow(module, id) {
    const controller = controllerFor(module);
    const target = clean(id);
    if (!controller || !target) return null;
    return allRows(controller).find(row => {
      const candidates = module === 'leads'
        ? [row?.id, row?.lead_id, row?.leadId]
        : [row?.id, row?.deal_id, row?.dealId];
      return candidates.some(value => clean(value) === target);
    }) || null;
  }

  function normalizeLead(value) {
    const controller = global.Leads;
    try {
      if (typeof controller?.normalizeLeadStatus === 'function') {
        return norm(controller.normalizeLeadStatus(value));
      }
    } catch (_) {}
    return norm(value);
  }

  function normalizeDeal(value) {
    const controller = global.Deals;
    try {
      if (typeof controller?.normalizeStage === 'function') {
        return norm(controller.normalizeStage(value));
      }
    } catch (_) {}
    const valueNorm = norm(value);
    if (valueNorm === 'new') return 'in progress';
    if (valueNorm === 'qualified') return 'negotiation';
    if (['proposal sent', 'converted to proposal'].includes(valueNorm)) return 'proposal';
    return valueNorm;
  }

  function targetForLane(module, lane) {
    const label = norm(lane?.querySelector?.('.ic-crm-kanban-lane-head strong')?.textContent);
    if (!label || label === 'other') return '';
    if (module === 'leads') return LEAD_TARGETS.get(label) || '';
    if (module === 'deals') return DEAL_TARGETS.get(label) || '';
    return '';
  }

  function currentValue(module, row) {
    if (module === 'leads') return normalizeLead(row?.status);
    if (module === 'deals') return normalizeDeal(row?.stage || row?.deal_stage);
    return '';
  }

  function normalizedTarget(module, target) {
    return module === 'leads' ? normalizeLead(target) : normalizeDeal(target);
  }

  function cleanupDragUi() {
    document.querySelectorAll('.ic-crm-kanban-card.is-crm-dragging').forEach(card => {
      card.classList.remove('is-crm-dragging');
      card.setAttribute('aria-grabbed', 'false');
    });
    document.querySelectorAll('.ic-crm-kanban-lane.is-crm-drop-target').forEach(lane => {
      lane.classList.remove('is-crm-drop-target');
    });
  }

  function enhanceCards(root = document) {
    for (const module of ['leads', 'deals']) {
      const grid = root.querySelector?.(`#${module}GridView`) || document.getElementById(`${module}GridView`);
      if (!grid) continue;
      const editable = canEdit(module);
      grid.querySelectorAll('.ic-crm-kanban-card[data-crm-grid-record]').forEach(card => {
        card.draggable = editable;
        card.dataset.crmDragEnabled = editable ? 'true' : 'false';
        card.setAttribute('aria-grabbed', 'false');
        if (editable) {
          card.title = `Drag to another ${module === 'leads' ? 'status' : 'stage'}; the edit form will open before anything is saved.`;
        }
      });
    }
  }

  function scheduleEnhance() {
    global.setTimeout(() => enhanceCards(), 20);
    global.setTimeout(() => enhanceCards(), 180);
  }

  async function openTransitionForm(module, row, target) {
    if (transitionInFlight) return;
    const controller = controllerFor(module);
    if (!controller || typeof controller.openForm !== 'function') return;

    if (!canEdit(module)) {
      toast(`You do not have permission to update ${module}.`);
      return;
    }

    const current = currentValue(module, row);
    const targetNormalized = normalizedTarget(module, target);
    if (!targetNormalized || current === targetNormalized) return;

    transitionInFlight = true;
    try {
      await controller.openForm(row);

      const selectId = module === 'leads' ? 'leadFormStatus' : 'dealFormStage';
      const noteId = module === 'leads' ? 'leadFormNotes' : 'dealFormNotes';
      const select = document.getElementById(selectId);
      if (select) {
        select.value = target;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const fromLabel = module === 'leads'
        ? (LEAD_TARGETS.get(current) || clean(row?.status) || 'current status')
        : (DEAL_TARGETS.get(current) || clean(row?.stage) || 'current stage');

      toast(
        `${module === 'leads' ? 'Lead status' : 'Deal stage'} move: ${fromLabel} → ${target}. Add the required note and next follow-up, then Save to confirm.`
      );

      global.setTimeout(() => {
        const note = document.getElementById(noteId);
        if (note) {
          note.focus();
          try { note.scrollIntoView({ block: 'center' }); } catch (_) {}
        }
      }, 80);
    } catch (error) {
      console.error('[CRM Pipeline Drag Drop] Unable to open transition form:', error);
      toast('Unable to open the edit form for this move.');
    } finally {
      transitionInFlight = false;
    }
  }

  function bindDragEvents() {
    if (document.documentElement.dataset.icCrmPipelineDragDropBound === '1') return;
    document.documentElement.dataset.icCrmPipelineDragDropBound = '1';

    document.addEventListener('pointerover', event => {
      const card = event.target?.closest?.('.ic-crm-kanban-card[data-crm-grid-record]');
      if (!card) return;
      const module = moduleForElement(card);
      if (!module) return;
      const editable = canEdit(module);
      card.draggable = editable;
      card.dataset.crmDragEnabled = editable ? 'true' : 'false';
    }, true);

    document.addEventListener('dragstart', event => {
      const card = event.target?.closest?.('.ic-crm-kanban-card[data-crm-grid-record][data-crm-grid-module]');
      if (!card) return;

      const module = card.dataset.crmGridModule || moduleForElement(card);
      if (!module || !canEdit(module)) {
        event.preventDefault();
        return;
      }

      const row = findRow(module, card.dataset.crmGridRecord);
      if (!row) {
        event.preventDefault();
        return;
      }

      dragState = { module, id: card.dataset.crmGridRecord, card, row };
      card.classList.add('is-crm-dragging');
      card.setAttribute('aria-grabbed', 'true');
      suppressClickUntil = Date.now() + 1200;

      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', `${module}:${card.dataset.crmGridRecord}`);
      } catch (_) {}
    });

    document.addEventListener('dragover', event => {
      if (!dragState) return;
      const lane = event.target?.closest?.('.ic-crm-kanban-lane');
      if (!lane || moduleForElement(lane) !== dragState.module) return;
      const target = targetForLane(dragState.module, lane);
      if (!target) return;

      event.preventDefault();
      try { event.dataTransfer.dropEffect = 'move'; } catch (_) {}

      document.querySelectorAll('.ic-crm-kanban-lane.is-crm-drop-target').forEach(item => {
        if (item !== lane) item.classList.remove('is-crm-drop-target');
      });
      lane.classList.add('is-crm-drop-target');
    });

    document.addEventListener('dragleave', event => {
      const lane = event.target?.closest?.('.ic-crm-kanban-lane');
      if (!lane || !lane.classList.contains('is-crm-drop-target')) return;
      const related = event.relatedTarget;
      if (related && lane.contains(related)) return;
      lane.classList.remove('is-crm-drop-target');
    });

    document.addEventListener('drop', event => {
      if (!dragState) return;
      const state = dragState;
      const lane = event.target?.closest?.('.ic-crm-kanban-lane');
      const module = lane ? moduleForElement(lane) : '';
      const target = lane && module === state.module ? targetForLane(module, lane) : '';

      if (target) event.preventDefault();
      suppressClickUntil = Date.now() + 900;
      dragState = null;
      cleanupDragUi();

      if (!target) return;
      const row = findRow(state.module, state.id) || state.row;
      if (!row) return;
      if (currentValue(state.module, row) === normalizedTarget(state.module, target)) return;

      openTransitionForm(state.module, row, target);
    });

    document.addEventListener('dragend', () => {
      dragState = null;
      suppressClickUntil = Date.now() + 450;
      cleanupDragUi();
    });

    document.addEventListener('click', event => {
      if (Date.now() >= suppressClickUntil) return;
      if (!event.target?.closest?.('.ic-crm-kanban-card[data-crm-grid-record]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    document.addEventListener('click', event => {
      if (event.target?.closest?.(
        '#leadsTab,#dealsTab,[data-view="leads"],[data-view="deals"],[data-crm-view-mode="grid"]'
      )) scheduleEnhance();
    });
  }

  function wrapRender(controller, marker) {
    if (!controller || typeof controller.render !== 'function' || controller[marker]) return;
    const original = controller.render;
    controller.render = function crmDragAwareRender(...args) {
      const result = original.apply(this, args);
      scheduleEnhance();
      return result;
    };
    controller[marker] = true;
  }

  function patchControllers() {
    if (!global.Leads || !global.Deals) return false;
    wrapRender(global.Leads, '__crmPipelineDragDropRender');
    wrapRender(global.Deals, '__crmPipelineDragDropRender');
    return true;
  }

  function boot() {
    ensureStyles();
    bindDragEvents();
    if (patchControllers()) {
      scheduleEnhance();
      return;
    }
    if (bootAttempts++ < 80) global.setTimeout(boot, 150);
  }

  global.InCheck360CrmPipelineDragDrop = Object.freeze({
    version: VERSION,
    refresh: scheduleEnhance
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
