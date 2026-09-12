(function installCrmLeadStatusAuthority(global) {
  'use strict';

  const VERSION = '20260912-crm-lead-status-authority1';
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
  const state = { recordKey: '', selected: '', pending: '' };
  let attempts = 0;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));

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

  function leadModalOpen() {
    const form = leadForm();
    if (!form) return false;
    const modal = document.getElementById('leadFormModal');
    return !modal || (modal.getAttribute('aria-hidden') !== 'true' && modal.style.display !== 'none');
  }

  function currentRecordKey() {
    const form = leadForm();
    return clean(form?.dataset?.id || 'new');
  }

  function currentControlStatus() {
    const value = canonical(document.getElementById('leadFormStatus')?.value || '');
    return STATUSES.includes(value) ? value : '';
  }

  function remember(value) {
    const status = canonical(value);
    if (!STATUSES.includes(status)) return '';
    state.recordKey = currentRecordKey();
    state.selected = status;
    return status;
  }

  function intendedStatus() {
    if (!leadModalOpen()) return '';
    const key = currentRecordKey();
    if (state.recordKey === key && STATUSES.includes(state.pending)) return state.pending;
    if (state.recordKey === key && STATUSES.includes(state.selected)) return state.selected;
    return currentControlStatus();
  }

  function capturePendingStatus() {
    const status = state.recordKey === currentRecordKey() && STATUSES.includes(state.selected)
      ? state.selected
      : currentControlStatus();
    if (!STATUSES.includes(status)) return '';
    state.recordKey = currentRecordKey();
    state.selected = status;
    state.pending = status;
    return status;
  }

  function resetSelection(status = '') {
    state.recordKey = currentRecordKey();
    state.selected = STATUSES.includes(canonical(status)) ? canonical(status) : '';
    state.pending = '';
  }

  function rewriteSelect(id, selected, includeAll = false) {
    const select = document.getElementById(id);
    if (!select) return;
    const rows = includeAll ? [['All', 'All'], ...STATUS_ROWS] : STATUS_ROWS;
    const wanted = selected === 'All' ? 'All' : canonical(selected);
    select.innerHTML = rows.map(([label, value]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    if (rows.some(([, value]) => value === wanted)) select.value = wanted;
  }

  function stopLegacyStatusLoop() {
    try { global.InCheck360SalesPipelineGuard?.stop?.(); } catch (_) {}
  }

  function patchLeadController() {
    const Leads = global.Leads;
    if (!Leads) return false;
    if (Leads.__crmLeadStatusAuthorityVersion === VERSION) return true;

    stopLegacyStatusLoop();
    Leads.formDropdownDefaults = Leads.formDropdownDefaults || {};
    Leads.formDropdownDefaults.status = STATUSES.slice();
    Leads.allowedLeadStatuses = () => STATUSES.slice();
    Leads.normalizeLeadStatus = canonical;
    Leads.matchesOpenStatus = status => !['lost', 'disregard'].includes(canonical(status));

    if (typeof Leads.openForm === 'function' && !Leads.__crmLeadStatusAuthorityOpen) {
      const originalOpenForm = Leads.openForm;
      Leads.openForm = async function authoritativeLeadOpenForm(row = null) {
        state.recordKey = clean(row?.id || 'new');
        state.selected = '';
        state.pending = '';
        const result = await originalOpenForm.call(this, row);
        const status = canonical(row?.status || currentControlStatus() || 'not contacted yet');
        rewriteSelect('leadFormStatus', status, false);
        resetSelection(status);
        return result;
      };
      Leads.__crmLeadStatusAuthorityOpen = true;
    }

    if (typeof Leads.syncLeadFormDropdowns === 'function' && !Leads.__crmLeadStatusAuthorityDropdown) {
      const originalSync = Leads.syncLeadFormDropdowns;
      Leads.syncLeadFormDropdowns = function authoritativeLeadDropdowns(selected = {}) {
        const remembered = state.recordKey === currentRecordKey() ? (state.pending || state.selected) : '';
        const wanted = canonical(remembered || selected?.status || currentControlStatus() || 'not contacted yet');
        const result = originalSync.call(this, { ...selected, status: wanted });
        rewriteSelect('leadFormStatus', wanted, false);
        return result;
      };
      Leads.__crmLeadStatusAuthorityDropdown = true;
    }

    if (typeof Leads.renderFilters === 'function' && !Leads.__crmLeadStatusAuthorityFilters) {
      const originalRenderFilters = Leads.renderFilters;
      Leads.renderFilters = function authoritativeLeadFilters(...args) {
        const result = originalRenderFilters.apply(this, args);
        const selected = this.state?.status === 'All' ? 'All' : canonical(this.state?.status || 'All');
        rewriteSelect('leadsStatusFilter', selected, true);
        return result;
      };
      Leads.__crmLeadStatusAuthorityFilters = true;
    }

    Leads.leadStatusChip = function authoritativeLeadStatusChip(status = '') {
      const value = canonical(status);
      const variant = value === 'lost' ? 'danger'
        : value === 'disregard' ? 'neutral'
        : ['qualified', 'meeting done'].includes(value) ? 'success'
        : ['engaged', 'meeting booked', 'negotiation'].includes(value) ? 'info'
        : value === 'not available' ? 'warning'
        : 'neutral';
      return this.leadChip(value, variant);
    };

    Leads.__crmLeadStatusAuthorityVersion = VERSION;
    try { Leads.renderFilters?.(); } catch (_) {}
    try { global.InCheck360CrmGridView?.refresh?.('leads'); } catch (_) {}
    return true;
  }

  function extractSavedLeadId(result, payload, action) {
    if (action === 'update' && isUuid(payload?.id)) return clean(payload.id);
    const candidates = [
      result?.id,
      result?.data?.id,
      result?.row?.id,
      result?.lead?.id,
      payload?.id
    ];
    return clean(candidates.find(isUuid) || '');
  }

  async function verifyPersistedStatus(leadId, wanted, fallbackResult) {
    if (!isUuid(leadId) || !STATUSES.includes(wanted)) return fallbackResult;
    const client = global.SupabaseClient?.getClient?.();
    if (!client?.from) return fallbackResult;

    const { data: fresh, error: readError } = await client
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .maybeSingle();

    if (readError || !fresh) return fallbackResult;
    if (canonical(fresh.status) === wanted) return fallbackResult;

    const { data: corrected, error: writeError } = await client
      .from('leads')
      .update({ status: wanted, updated_at: new Date().toISOString() })
      .eq('id', leadId)
      .select('*')
      .single();

    if (writeError) {
      throw new Error(`Lead saved, but status ${wanted} could not be persisted: ${writeError.message || writeError}`);
    }

    try { global.Leads?.upsertLocalRow?.(corrected); } catch (_) {}
    return corrected || fallbackResult;
  }

  function patchApiRequest() {
    const Api = global.Api;
    if (!Api || typeof Api.requestWithSession !== 'function') return false;
    if (Api.__crmLeadStatusAuthorityVersion === VERSION) return true;

    const originalRequest = Api.requestWithSession;
    Api.requestWithSession = async function authoritativeLeadRequest(resource, action, payload = {}, options = {}) {
      const resourceKey = norm(resource);
      const actionKey = norm(action);
      const isLeadWrite = resourceKey === 'leads' && ['create', 'save', 'update'].includes(actionKey);
      let wanted = '';
      let nextPayload = payload;

      if (isLeadWrite && leadModalOpen()) {
        const formKey = currentRecordKey();
        const payloadId = clean(payload?.id || '');
        const sameRecord = actionKey !== 'update' || !payloadId || formKey === 'new' || formKey === payloadId;
        if (sameRecord) wanted = intendedStatus();
      }

      if (STATUSES.includes(wanted)) {
        nextPayload = { ...(payload || {}) };
        if (actionKey === 'update') {
          nextPayload.updates = {
            ...(payload?.updates && typeof payload.updates === 'object' ? payload.updates : {}),
            status: wanted
          };
        } else {
          nextPayload.status = wanted;
          for (const key of ['lead', 'item', 'activity', 'leads']) {
            if (payload?.[key] && typeof payload[key] === 'object' && !Array.isArray(payload[key])) {
              nextPayload[key] = { ...payload[key], status: wanted };
            }
          }
        }
      }

      const result = await originalRequest.call(this, resource, action, nextPayload, options);

      if (STATUSES.includes(wanted)) {
        const leadId = extractSavedLeadId(result, nextPayload, actionKey);
        const verified = await verifyPersistedStatus(leadId, wanted, result);
        state.pending = '';
        return verified;
      }

      return result;
    };

    Api.__crmLeadStatusAuthorityVersion = VERSION;
    return true;
  }

  function bindCaptureHandlers() {
    if (global.__crmLeadStatusAuthorityCaptureBound) return;
    global.__crmLeadStatusAuthorityCaptureBound = true;

    const captureSelection = event => {
      if (event.target?.id !== 'leadFormStatus') return;
      remember(event.target.value);
    };
    document.addEventListener('input', captureSelection, true);
    document.addEventListener('change', captureSelection, true);

    document.addEventListener('submit', event => {
      if (event.target?.id === 'leadForm') capturePendingStatus();
    }, true);

    document.addEventListener('pointerdown', event => {
      if (event.target?.closest?.('#leadFormSaveBtn')) capturePendingStatus();
    }, true);
  }

  function apply() {
    bindCaptureHandlers();
    stopLegacyStatusLoop();
    const leadReady = patchLeadController();
    const apiReady = patchApiRequest();
    return leadReady && apiReady;
  }

  function boot() {
    if (apply()) return;
    if (attempts++ < 120) global.setTimeout(boot, 150);
  }

  global.InCheck360CrmLeadStatusAuthority = Object.freeze({
    version: VERSION,
    statuses: STATUSES.slice(),
    canonical,
    refresh: apply
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
