(function installLeadStatusPersistenceGuard(global) {
  'use strict';
  if (global.InCheck360LeadStatusPersistenceGuard) return;

  const VERSION = '20260912-lead-status-persistence1';
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
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function canonical(value) {
    const status = norm(value);
    if (!status || ['new', 'open', 'not contacted'].includes(status)) return 'not contacted yet';
    if (['not contacted yet'].includes(status)) return 'not contacted yet';
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

  function selectedFormStatus() {
    const el = document.getElementById('leadFormStatus');
    return el ? canonical(el.value) : '';
  }

  function rewriteStatusSelect(id, selected, includeAll = false) {
    const select = document.getElementById(id);
    if (!select) return;
    const options = includeAll ? [['All', 'All'], ...STATUS_ROWS] : STATUS_ROWS;
    const current = selected === 'All' ? 'All' : canonical(selected);
    select.innerHTML = options.map(([label, value]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    if (options.some(([, value]) => value === current)) select.value = current;
  }

  function wrap(object, name, marker, factory) {
    if (!object || typeof object[name] !== 'function' || object[marker]) return;
    const original = object[name];
    object[name] = factory(original);
    object[marker] = true;
  }

  function patch() {
    const Leads = global.Leads;
    if (!Leads) return false;
    if (Leads.__leadStatusPersistenceGuardVersion === VERSION) return true;

    Leads.formDropdownDefaults = Leads.formDropdownDefaults || {};
    Leads.formDropdownDefaults.status = STATUSES.slice();
    Leads.allowedLeadStatuses = () => STATUSES.slice();
    Leads.normalizeLeadStatus = canonical;
    Leads.matchesOpenStatus = status => !['lost', 'disregard'].includes(canonical(status));

    wrap(Leads, 'collectFormData', '__leadStatusPersistenceCollect1', original => function(...args) {
      const row = original.apply(this, args) || {};
      const selected = selectedFormStatus();
      row.status = selected || canonical(row.status);
      return row;
    });

    wrap(Leads, 'createLead', '__leadStatusPersistenceCreate1', original => async function(lead = {}) {
      const next = { ...(lead || {}) };
      next.status = selectedFormStatus() || canonical(next.status);
      return original.call(this, next);
    });

    wrap(Leads, 'updateLead', '__leadStatusPersistenceUpdate1', original => async function(id, updates = {}) {
      const next = { ...(updates || {}) };
      if (Object.prototype.hasOwnProperty.call(next, 'status') || selectedFormStatus()) {
        next.status = selectedFormStatus() || canonical(next.status);
      }
      return original.call(this, id, next);
    });

    wrap(Leads, 'updateLeadWithVerification', '__leadStatusPersistenceVerify1', original => async function(id, updates = {}) {
      const next = { ...(updates || {}) };
      if (Object.prototype.hasOwnProperty.call(next, 'status') || selectedFormStatus()) {
        next.status = selectedFormStatus() || canonical(next.status);
      }
      return original.call(this, id, next);
    });

    wrap(Leads, 'normalizeLead', '__leadStatusPersistenceNormalize1', original => function(raw = {}) {
      const row = original.call(this, raw) || {};
      row.status = canonical(raw?.status ?? row.status);
      return row;
    });

    wrap(Leads, 'syncLeadFormDropdowns', '__leadStatusPersistenceDropdown1', original => function(selected = {}) {
      const wanted = canonical(selected?.status || selectedFormStatus() || this.state?.currentLead?.status || 'not contacted yet');
      const result = original.call(this, { ...selected, status: wanted });
      rewriteStatusSelect('leadFormStatus', wanted, false);
      return result;
    });

    wrap(Leads, 'renderFilters', '__leadStatusPersistenceFilters1', original => function(...args) {
      const result = original.apply(this, args);
      const selected = this.state?.status === 'All' ? 'All' : canonical(this.state?.status || 'All');
      rewriteStatusSelect('leadsStatusFilter', selected, true);
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

  function boot() {
    if (patch()) return;
    if (attempts++ < 100) global.setTimeout(boot, 150);
  }

  global.InCheck360LeadStatusPersistenceGuard = Object.freeze({ version: VERSION, canonical, statuses: STATUSES.slice(), refresh: patch });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
