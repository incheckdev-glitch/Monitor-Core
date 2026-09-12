(function installLeadStatusPersistenceGuard(global) {
  'use strict';

  const VERSION = '20260912-lead-status-persistence3';
  const STATUS_ROWS = [
    ['Not Contacted Yet', 'not contacted yet'],
    ['Not Available', 'not available'],
    ['Engaged', 'engaged'],
    ['Meeting Booked', 'meeting booked'],
    ['Meeting Done', 'meeting done'],
    ['Negotiation', 'negotiation'],
    ['Qualified', 'qualified'],
    ['Lost', 'lost'],
    ['Disregard', 'disregard']
  ];
  const STATUSES = STATUS_ROWS.map(([, value]) => value);
  let attempts = 0;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function canonical(value) {
    const status = norm(value);
    if (!status || ['new', 'open', 'not contacted'].includes(status)) return 'not contacted yet';
    if (status === 'not contacted yet') return 'not contacted yet';
    if (['not available', 'unavailable'].includes(status)) return 'not available';
    if (['engaged', 'contacted', 'connected', 'in contact', 'initial contact'].includes(status)) return 'engaged';
    if (['meeting booked', 'meeting scheduled', 'booked'].includes(status)) return 'meeting booked';
    if (['meeting done', 'meeting completed', 'met'].includes(status)) return 'meeting done';
    if (status.includes('negotiat')) return 'negotiation';
    if (['qualified', 'qualify', 'converted', 'converted to deal', 'coverted to deal'].includes(status)) return 'qualified';
    if (['lost', 'closed lost'].includes(status)) return 'lost';
    if (['disregard', 'disregarded', 'irrelevant', 'not relevant'].includes(status)) return 'disregard';
    return status;
  }

  function leadForm() {
    return document.getElementById('leadForm');
  }

  function formRecordKey(form = leadForm()) {
    if (!form) return '';
    return clean(form.dataset?.id || 'new');
  }

  function selectedStatusFromControl() {
    const select = document.getElementById('leadFormStatus');
    if (!select) return '';
    const value = canonical(select.value);
    return STATUSES.includes(value) ? value : '';
  }

  function rememberUserSelection(value) {
    const form = leadForm();
    const status = canonical(value);
    if (!form || !STATUSES.includes(status)) return '';
    form.dataset.leadStatusUserSelection = status;
    form.dataset.leadStatusUserSelectionFor = formRecordKey(form);
    return status;
  }

  function snapshotStatusForSubmit() {
    const form = leadForm();
    if (!form) return '';
    const recordKey = formRecordKey(form);
    const remembered = form.dataset.leadStatusUserSelectionFor === recordKey
      ? canonical(form.dataset.leadStatusUserSelection)
      : '';
    const status = STATUSES.includes(remembered) ? remembered : selectedStatusFromControl();
    if (!STATUSES.includes(status)) return '';
    form.dataset.pendingLeadStatus = status;
    form.dataset.pendingLeadStatusFor = recordKey;
    return status;
  }

  function capturedStatus() {
    const form = leadForm();
    if (!form) return '';
    const recordKey = formRecordKey(form);
    const pending = form.dataset.pendingLeadStatusFor === recordKey
      ? canonical(form.dataset.pendingLeadStatus)
      : '';
    if (STATUSES.includes(pending)) return pending;
    const remembered = form.dataset.leadStatusUserSelectionFor === recordKey
      ? canonical(form.dataset.leadStatusUserSelection)
      : '';
    if (STATUSES.includes(remembered)) return remembered;
    return selectedStatusFromControl();
  }

  function clearCapturedStatus() {
    const form = leadForm();
    if (!form) return;
    delete form.dataset.pendingLeadStatus;
    delete form.dataset.pendingLeadStatusFor;
    delete form.dataset.leadStatusUserSelection;
    delete form.dataset.leadStatusUserSelectionFor;
  }

  function rewriteStatusSelect(id, selected, includeAll = false) {
    const select = document.getElementById(id);
    if (!select) return;
    const options = includeAll ? [['All', 'All'], ...STATUS_ROWS] : STATUS_ROWS;
    const current = selected === 'All' ? 'All' : canonical(selected);
    select.innerHTML = options
      .map(([label, value]) => `<option value="${esc(value)}">${esc(label)}</option>`)
      .join('');
    if (options.some(([, value]) => value === current)) select.value = current;
  }

  function wrap(object, name, marker, factory) {
    if (!object || typeof object[name] !== 'function' || object[marker]) return;
    const original = object[name];
    object[name] = factory(original);
    object[marker] = true;
  }

  function patchLeadController() {
    const Leads = global.Leads;
    if (!Leads) return false;
    if (Leads.__leadStatusPersistenceGuardVersion === VERSION) return true;

    Leads.formDropdownDefaults = Leads.formDropdownDefaults || {};
    Leads.formDropdownDefaults.status = STATUSES.slice();
    Leads.allowedLeadStatuses = () => STATUSES.slice();
    Leads.normalizeLeadStatus = canonical;
    Leads.matchesOpenStatus = status => !['lost', 'disregard'].includes(canonical(status));

    wrap(Leads, 'openForm', '__leadStatusPersistenceOpen3', original => async function(row = null) {
      clearCapturedStatus();
      const result = await original.call(this, row);
      const current = canonical(row?.status || selectedStatusFromControl() || 'not contacted yet');
      rewriteStatusSelect('leadFormStatus', current, false);
      return result;
    });

    wrap(Leads, 'collectFormData', '__leadStatusPersistenceCollect3', original => function(...args) {
      const row = original.apply(this, args) || {};
      row.status = capturedStatus() || canonical(row.status);
      return row;
    });

    wrap(Leads, 'backendLead', '__leadStatusPersistenceBackend3', original => function(lead = {}, options = {}) {
      const selected = capturedStatus();
      const source = { ...(lead || {}) };
      if (selected || Object.prototype.hasOwnProperty.call(source, 'status')) {
        source.status = selected || canonical(source.status);
      }
      const payload = original.call(this, source, options) || {};
      if (selected || Object.prototype.hasOwnProperty.call(source, 'status')) {
        payload.status = selected || canonical(payload.status || source.status);
      }
      return payload;
    });

    wrap(Leads, 'createLead', '__leadStatusPersistenceCreate3', original => async function(lead = {}) {
      const next = { ...(lead || {}) };
      next.status = capturedStatus() || canonical(next.status);
      return original.call(this, next);
    });

    wrap(Leads, 'updateLead', '__leadStatusPersistenceUpdate3', original => async function(id, updates = {}) {
      const next = { ...(updates || {}) };
      const selected = capturedStatus();
      if (selected || Object.prototype.hasOwnProperty.call(next, 'status')) {
        next.status = selected || canonical(next.status);
      }
      return original.call(this, id, next);
    });

    wrap(Leads, 'updateLeadWithVerification', '__leadStatusPersistenceVerify3', original => async function(id, updates = {}) {
      const next = { ...(updates || {}) };
      const selected = capturedStatus();
      if (selected || Object.prototype.hasOwnProperty.call(next, 'status')) {
        next.status = selected || canonical(next.status);
      }
      return original.call(this, id, next);
    });

    wrap(Leads, 'normalizeLead', '__leadStatusPersistenceNormalize3', original => function(raw = {}) {
      const row = original.call(this, raw) || {};
      row.status = canonical(raw?.status ?? row.status);
      return row;
    });

    wrap(Leads, 'syncLeadFormDropdowns', '__leadStatusPersistenceDropdown3', original => function(selected = {}) {
      const wanted = canonical(selected?.status || capturedStatus() || this.state?.currentLead?.status || 'not contacted yet');
      const result = original.call(this, { ...selected, status: wanted });
      rewriteStatusSelect('leadFormStatus', wanted, false);
      return result;
    });

    wrap(Leads, 'renderFilters', '__leadStatusPersistenceFilters3', original => function(...args) {
      const result = original.apply(this, args);
      const selected = this.state?.status === 'All' ? 'All' : canonical(this.state?.status || 'All');
      rewriteStatusSelect('leadsStatusFilter', selected, true);
      return result;
    });

    wrap(Leads, 'closeForm', '__leadStatusPersistenceClose3', original => function(...args) {
      const result = original.apply(this, args);
      clearCapturedStatus();
      return result;
    });

    Leads.leadStatusChip = function(status = '') {
      const value = canonical(status);
      const variant = value === 'lost' ? 'danger'
        : value === 'disregard' ? 'neutral'
        : ['qualified', 'meeting done'].includes(value) ? 'success'
        : ['engaged', 'meeting booked', 'negotiation'].includes(value) ? 'info'
        : value === 'not available' ? 'warning'
        : 'neutral';
      return this.leadChip(value, variant);
    };

    Leads.__leadStatusPersistenceGuardVersion = VERSION;
    try { Leads.renderFilters?.(); } catch (_) {}
    return true;
  }

  function applyStatusToDispatchPayload(payload = {}) {
    const selected = capturedStatus();
    if (!selected) return payload;
    const resource = norm(payload?.resource);
    const action = norm(payload?.action);
    if (resource !== 'leads' || !['create', 'save', 'update'].includes(action)) return payload;

    const next = { ...(payload || {}) };
    if (action === 'update') {
      next.updates = {
        ...(payload?.updates && typeof payload.updates === 'object' ? payload.updates : {}),
        status: selected
      };
    } else {
      next.status = selected;
    }

    for (const key of ['lead', 'item', 'activity', 'leads']) {
      if (payload?.[key] && typeof payload[key] === 'object' && !Array.isArray(payload[key])) {
        next[key] = { ...payload[key], status: selected };
      }
    }
    return next;
  }

  function patchSupabaseDispatch() {
    const dataLayer = global.SupabaseData;
    if (!dataLayer || typeof dataLayer.dispatch !== 'function') return false;
    if (dataLayer.__leadStatusPersistenceDispatchVersion === VERSION) return true;
    const originalDispatch = dataLayer.dispatch;
    dataLayer.dispatch = function leadStatusSafeDispatch(payload = {}) {
      return originalDispatch.call(this, applyStatusToDispatchPayload(payload));
    };
    dataLayer.__leadStatusPersistenceDispatchVersion = VERSION;
    return true;
  }

  function bindCaptureHandlers() {
    if (global.__leadStatusPersistenceCaptureBound) return;
    global.__leadStatusPersistenceCaptureBound = true;

    document.addEventListener('change', event => {
      if (event.target?.id !== 'leadFormStatus') return;
      rememberUserSelection(event.target.value);
    }, true);

    document.addEventListener('submit', event => {
      if (event.target?.id !== 'leadForm') return;
      snapshotStatusForSubmit();
    }, true);

    document.addEventListener('pointerdown', event => {
      if (!event.target?.closest?.('#leadFormSaveBtn')) return;
      snapshotStatusForSubmit();
    }, true);
  }

  function patchAll() {
    bindCaptureHandlers();
    const leadReady = patchLeadController();
    const dispatchReady = patchSupabaseDispatch();
    return leadReady && dispatchReady;
  }

  function boot() {
    if (patchAll()) return;
    if (attempts++ < 120) global.setTimeout(boot, 150);
  }

  global.InCheck360LeadStatusPersistenceGuard = Object.freeze({
    version: VERSION,
    canonical,
    statuses: STATUSES.slice(),
    refresh: patchAll
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
