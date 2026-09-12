(function installCrmFieldPersistenceAuthority(global) {
  'use strict';
  if (global.InCheck360CrmFieldPersistenceAuthority) return;

  const VERSION = '20260912-crm-field-persistence1';
  let attempts = 0;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));
  const db = () => global.SupabaseClient?.getClient?.() || global.supabase || null;
  const el = id => document.getElementById(id);

  function wrap(object, name, marker, factory) {
    if (!object || typeof object[name] !== 'function' || object[marker]) return false;
    const original = object[name];
    object[name] = factory(original);
    object[marker] = VERSION;
    return true;
  }

  function numberOrNull(id, { integer = false } = {}) {
    const node = el(id);
    if (!node) return null;
    const raw = clean(node.value);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return integer ? Math.trunc(value) : value;
  }

  function textOrNull(id) {
    const node = el(id);
    return node ? (clean(node.value) || null) : null;
  }

  function selectedValues(id) {
    const node = el(id);
    if (!node) return [];
    return [...node.selectedOptions].map(option => clean(option.value)).filter(Boolean);
  }

  function localDateTimeToIso(value) {
    const raw = clean(value);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function formVisible(kind) {
    const form = el(kind === 'lead' ? 'leadForm' : 'dealForm');
    if (!form) return false;
    const modal = form.closest('.modal') || el(kind === 'lead' ? 'leadFormModal' : 'dealFormModal');
    if (!modal) return true;
    return modal.hidden !== true && modal.style.display !== 'none' && modal.getAttribute('aria-hidden') !== 'true';
  }

  const LEAD_KEYS = [
    'number_of_locations', 'rollout_scope', 'interested_product_ids', 'contact_channel',
    'meeting_at', 'meeting_outcome', 'lost_reason', 'disregard_reason', 'next_action'
  ];
  const DEAL_KEYS = [
    'number_of_locations', 'rollout_scope', 'interested_product_ids', 'lost_reason', 'next_action',
    'poc_expected_end_date', 'probability_percent', 'expected_close_date'
  ];

  function leadDomValues() {
    const out = {};
    if (el('leadFormNumberOfLocations')) out.number_of_locations = numberOrNull('leadFormNumberOfLocations', { integer: true });
    if (el('leadFormRolloutScope')) out.rollout_scope = textOrNull('leadFormRolloutScope');
    if (el('leadInterestedProductIds')) out.interested_product_ids = selectedValues('leadInterestedProductIds');
    if (el('leadFormContactChannel')) out.contact_channel = textOrNull('leadFormContactChannel');
    if (el('leadFormMeetingAt')) out.meeting_at = localDateTimeToIso(el('leadFormMeetingAt')?.value);
    if (el('leadFormMeetingOutcome')) out.meeting_outcome = textOrNull('leadFormMeetingOutcome');
    if (el('leadFormLostReason')) out.lost_reason = textOrNull('leadFormLostReason');
    if (el('leadFormDisregardReason')) out.disregard_reason = textOrNull('leadFormDisregardReason');
    if (el('leadFormNextAction')) out.next_action = textOrNull('leadFormNextAction');
    return out;
  }

  function dealDomValues() {
    const out = {};
    if (el('dealFormNumberOfLocations')) out.number_of_locations = numberOrNull('dealFormNumberOfLocations', { integer: true });
    if (el('dealFormRolloutScope')) out.rollout_scope = textOrNull('dealFormRolloutScope');
    if (el('dealInterestedProductIds')) out.interested_product_ids = selectedValues('dealInterestedProductIds');
    if (el('dealFormLostReason')) out.lost_reason = textOrNull('dealFormLostReason');
    if (el('dealFormNextAction')) out.next_action = textOrNull('dealFormNextAction');
    if (el('dealFormPocExpectedEndDate')) out.poc_expected_end_date = textOrNull('dealFormPocExpectedEndDate');
    if (el('dealFormProbabilityPercent')) out.probability_percent = numberOrNull('dealFormProbabilityPercent', { integer: true });
    if (el('dealFormExpectedCloseDate')) out.expected_close_date = textOrNull('dealFormExpectedCloseDate');
    return out;
  }

  function copyKnown(source, target, keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source || {}, key)) target[key] = source[key];
    }
    return target;
  }

  function mergeCurrent(kind, source = {}) {
    if (!formVisible(kind)) return { ...(source || {}) };
    return {
      ...(source || {}),
      ...(kind === 'lead' ? leadDomValues() : dealDomValues())
    };
  }

  function valueEqual(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      const aa = Array.isArray(a) ? a.map(clean).filter(Boolean).sort() : [];
      const bb = Array.isArray(b) ? b.map(clean).filter(Boolean).sort() : [];
      return JSON.stringify(aa) === JSON.stringify(bb);
    }
    if (a == null || a === '') return b == null || b === '';
    if (b == null || b === '') return false;
    if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
    if (/^\d{4}-\d{2}-\d{2}/.test(String(a)) && /^\d{4}-\d{2}-\d{2}/.test(String(b))) {
      return String(a).slice(0, 10) === String(b).slice(0, 10);
    }
    return clean(a) === clean(b);
  }

  function resolveResponseId(response, fallback = '') {
    const candidates = [
      fallback,
      response?.id,
      response?.row?.id,
      response?.data?.id,
      response?.lead?.id,
      response?.deal?.id
    ];
    return clean(candidates.find(isUuid) || '');
  }

  function decorateResponse(response, row) {
    if (!row) return response;
    if (response?.row && typeof response.row === 'object') return { ...response, row: { ...response.row, ...row } };
    if (response?.data && !Array.isArray(response.data) && typeof response.data === 'object') return { ...response, data: { ...response.data, ...row } };
    if (response && typeof response === 'object' && !Array.isArray(response)) return { ...response, ...row };
    return row;
  }

  async function verifySupplementaryFields(table, id, wanted, keys) {
    const client = db();
    if (!client || !isUuid(id)) return null;
    const effectiveKeys = keys.filter(key => Object.prototype.hasOwnProperty.call(wanted || {}, key));
    const columns = ['id', ...keys].join(',');
    const first = await client.from(table).select(columns).eq('id', id).maybeSingle();
    if (first.error) {
      console.warn(`[crm-field-persistence] ${table} verification read failed`, first.error);
      return null;
    }
    if (!effectiveKeys.length) return first.data;
    const mismatch = effectiveKeys.some(key => !valueEqual(first.data?.[key], wanted?.[key]));
    if (!mismatch) return first.data;

    const correction = {};
    copyKnown(wanted, correction, effectiveKeys);
    const fixed = await client.from(table).update(correction).eq('id', id).select(columns).maybeSingle();
    if (fixed.error) {
      console.error(`[crm-field-persistence] ${table} supplementary field correction failed`, fixed.error);
      throw fixed.error;
    }
    return fixed.data;
  }

  function normalizeLeadFields(raw = {}, row = {}) {
    return {
      ...row,
      number_of_locations: raw.number_of_locations ?? row.number_of_locations ?? null,
      rollout_scope: raw.rollout_scope ?? row.rollout_scope ?? null,
      interested_product_ids: Array.isArray(raw.interested_product_ids) ? raw.interested_product_ids : (row.interested_product_ids || []),
      contact_channel: raw.contact_channel ?? row.contact_channel ?? null,
      meeting_at: raw.meeting_at ?? row.meeting_at ?? null,
      meeting_outcome: raw.meeting_outcome ?? row.meeting_outcome ?? null,
      lost_reason: raw.lost_reason ?? row.lost_reason ?? null,
      disregard_reason: raw.disregard_reason ?? row.disregard_reason ?? null,
      next_action: raw.next_action ?? row.next_action ?? null
    };
  }

  function normalizeDealFields(raw = {}, row = {}) {
    return {
      ...row,
      number_of_locations: raw.number_of_locations ?? row.number_of_locations ?? null,
      rollout_scope: raw.rollout_scope ?? row.rollout_scope ?? null,
      interested_product_ids: Array.isArray(raw.interested_product_ids) ? raw.interested_product_ids : (row.interested_product_ids || []),
      lost_reason: raw.lost_reason ?? row.lost_reason ?? null,
      next_action: raw.next_action ?? row.next_action ?? null,
      poc_expected_end_date: raw.poc_expected_end_date ?? row.poc_expected_end_date ?? null,
      probability_percent: raw.probability_percent ?? row.probability_percent ?? null,
      expected_close_date: raw.expected_close_date ?? row.expected_close_date ?? null
    };
  }

  function setValue(id, value) {
    const node = el(id);
    if (!node) return;
    node.value = value == null ? '' : String(value);
  }

  function setMulti(id, values = []) {
    const node = el(id);
    if (!node) return;
    const chosen = new Set((values || []).map(clean));
    [...node.options].forEach(option => { option.selected = chosen.has(clean(option.value)); });
  }

  function toLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return clean(value).slice(0, 16);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function applyLeadValues(row = {}) {
    setValue('leadFormNumberOfLocations', row.number_of_locations);
    setValue('leadFormRolloutScope', row.rollout_scope);
    setMulti('leadInterestedProductIds', row.interested_product_ids || []);
    setValue('leadFormContactChannel', row.contact_channel);
    setValue('leadFormMeetingAt', toLocalInput(row.meeting_at));
    setValue('leadFormMeetingOutcome', row.meeting_outcome);
    setValue('leadFormLostReason', row.lost_reason);
    setValue('leadFormDisregardReason', row.disregard_reason);
    setValue('leadFormNextAction', row.next_action);
  }

  function applyDealValues(row = {}) {
    setValue('dealFormNumberOfLocations', row.number_of_locations);
    setValue('dealFormRolloutScope', row.rollout_scope);
    setMulti('dealInterestedProductIds', row.interested_product_ids || []);
    setValue('dealFormLostReason', row.lost_reason);
    setValue('dealFormNextAction', row.next_action);
    setValue('dealFormPocExpectedEndDate', clean(row.poc_expected_end_date).slice(0, 10));
    setValue('dealFormProbabilityPercent', row.probability_percent);
    setValue('dealFormExpectedCloseDate', clean(row.expected_close_date).slice(0, 10));
  }

  async function fetchFields(table, id, keys) {
    const client = db();
    if (!client || !isUuid(id)) return null;
    const { data, error } = await client.from(table).select(['id', ...keys].join(',')).eq('id', id).maybeSingle();
    if (error) {
      console.warn(`[crm-field-persistence] unable to reload ${table} supplementary fields`, error);
      return null;
    }
    return data || null;
  }

  function requiredBadge(label) {
    if (!label) return null;
    let badge = label.querySelector('[data-crm-required-badge]');
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.crmRequiredBadge = '1';
      badge.textContent = 'Required';
      badge.style.cssText = 'margin-left:6px;font-size:11px;font-weight:700;color:var(--danger,#dc2626);';
      label.appendChild(badge);
    }
    return badge;
  }

  function labelFor(node) {
    if (!node) return null;
    const byFor = node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null;
    return byFor || node.closest('label') || node.parentElement?.querySelector(':scope > label') || node.parentElement?.querySelector('label') || null;
  }

  function setRequired(id, required) {
    const node = el(id);
    if (!node) return;
    const active = Boolean(required) && !node.disabled;
    node.required = active;
    node.setAttribute('aria-required', active ? 'true' : 'false');
    const label = labelFor(node);
    const badge = requiredBadge(label);
    if (badge) badge.hidden = !active;
    const field = node.closest('[id$="Field"]') || node.parentElement;
    if (field) field.classList.toggle('crm-field-required', active);
  }

  function refreshRequiredState() {
    const leadStatus = norm(el('leadFormStatus')?.value);
    const leadActive = Boolean(leadStatus) && !['lost', 'disregard'].includes(leadStatus);
    const leadRules = {
      leadNextFollowUpAtInput: true,
      leadFormNextFollowupDate: true,
      leadFormNotes: true,
      leadFormNextAction: leadActive,
      leadFormContactChannel: leadStatus === 'engaged',
      leadFormLastContactDate: leadStatus === 'engaged',
      leadFormMeetingAt: ['meeting booked', 'meeting done'].includes(leadStatus),
      leadFormMeetingOutcome: leadStatus === 'meeting done',
      leadFormNumberOfLocations: leadStatus === 'qualified',
      leadFormRolloutScope: leadStatus === 'qualified',
      leadInterestedProductIds: leadStatus === 'qualified',
      leadFormEstimatedValue: leadStatus === 'qualified',
      leadFormLostReason: leadStatus === 'lost',
      leadFormDisregardReason: leadStatus === 'disregard'
    };
    Object.entries(leadRules).forEach(([id, required]) => setRequired(id, required));

    const dealStage = norm(el('dealFormStage')?.value);
    const dealActive = Boolean(dealStage) && !['lost', 'won'].includes(dealStage);
    const forwardStage = ['negotiation', 'poc', 'proposal'].includes(dealStage);
    const dealRules = {
      dealNextFollowUpAtInput: true,
      dealFormNotes: true,
      dealFormNextAction: dealActive,
      dealFormNumberOfLocations: forwardStage,
      dealFormRolloutScope: forwardStage,
      dealFormPocExpectedEndDate: dealStage === 'poc',
      dealFormLostReason: dealStage === 'lost'
    };
    Object.entries(dealRules).forEach(([id, required]) => setRequired(id, required));
  }

  function patchLeads() {
    const Leads = global.Leads;
    if (!Leads) return false;
    if (Leads.__crmFieldPersistenceAuthority === VERSION) return true;

    wrap(Leads, 'normalizeLead', '__crmFieldPersistenceNormalizeLead1', original => function(raw = {}) {
      return normalizeLeadFields(raw, original.call(this, raw) || {});
    });

    wrap(Leads, 'collectFormData', '__crmFieldPersistenceCollectLead1', original => function(...args) {
      return mergeCurrent('lead', original.apply(this, args) || {});
    });

    wrap(Leads, 'backendLead', '__crmFieldPersistenceBackendLead1', original => function(lead = {}, options = {}) {
      const payload = original.call(this, lead, options) || {};
      return copyKnown(lead, payload, LEAD_KEYS);
    });

    wrap(Leads, 'createLead', '__crmFieldPersistenceCreateLead1', original => async function(lead = {}) {
      const wanted = mergeCurrent('lead', lead);
      const response = await original.call(this, wanted);
      const id = resolveResponseId(response);
      const verified = await verifySupplementaryFields('leads', id, wanted, LEAD_KEYS);
      return decorateResponse(response, verified);
    });

    wrap(Leads, 'updateLead', '__crmFieldPersistenceUpdateLead1', original => async function(id, updates = {}) {
      const wanted = mergeCurrent('lead', updates);
      const response = await original.call(this, id, wanted);
      const verified = await verifySupplementaryFields('leads', resolveResponseId(response, id), wanted, LEAD_KEYS);
      return decorateResponse(response, verified);
    });

    wrap(Leads, 'openForm', '__crmFieldPersistenceOpenLead1', original => async function(row = null) {
      const result = await original.call(this, row);
      const id = clean(row?.id || this.state?.currentLead?.id || this.state?.selectedLeadId);
      const live = isUuid(id) ? await fetchFields('leads', id, LEAD_KEYS) : null;
      applyLeadValues(normalizeLeadFields(live || row || {}, live || row || {}));
      refreshRequiredState();
      return result;
    });

    wrap(Leads, 'validateLeadWorkflow', '__crmFieldPersistenceValidateLead1', original => function(lead = {}) {
      refreshRequiredState();
      return original.call(this, lead);
    });

    Leads.__crmFieldPersistenceAuthority = VERSION;
    return true;
  }

  function patchDeals() {
    const Deals = global.Deals;
    if (!Deals) return false;
    if (Deals.__crmFieldPersistenceAuthority === VERSION) return true;

    wrap(Deals, 'normalizeDeal', '__crmFieldPersistenceNormalizeDeal1', original => function(raw = {}) {
      return normalizeDealFields(raw, original.call(this, raw) || {});
    });

    wrap(Deals, 'collectFormData', '__crmFieldPersistenceCollectDeal1', original => function(...args) {
      return mergeCurrent('deal', original.apply(this, args) || {});
    });

    wrap(Deals, 'backendDeal', '__crmFieldPersistenceBackendDeal1', original => function(deal = {}, options = {}) {
      const payload = original.call(this, deal, options) || {};
      return copyKnown(deal, payload, DEAL_KEYS);
    });

    wrap(Deals, 'createDeal', '__crmFieldPersistenceCreateDeal1', original => async function(deal = {}) {
      const wanted = mergeCurrent('deal', deal);
      const response = await original.call(this, wanted);
      const id = resolveResponseId(response);
      const verified = await verifySupplementaryFields('deals', id, wanted, DEAL_KEYS);
      return decorateResponse(response, verified);
    });

    wrap(Deals, 'updateDeal', '__crmFieldPersistenceUpdateDeal1', original => async function(id, updates = {}) {
      const wanted = mergeCurrent('deal', updates);
      const response = await original.call(this, id, wanted);
      const verified = await verifySupplementaryFields('deals', resolveResponseId(response, id), wanted, DEAL_KEYS);
      return decorateResponse(response, verified);
    });

    wrap(Deals, 'openForm', '__crmFieldPersistenceOpenDeal1', original => async function(row = null) {
      const result = await original.call(this, row);
      const id = clean(row?.id || this.state?.currentDeal?.id || this.state?.selectedDetailsId);
      const live = isUuid(id) ? await fetchFields('deals', id, DEAL_KEYS) : null;
      applyDealValues(normalizeDealFields(live || row || {}, live || row || {}));
      refreshRequiredState();
      return result;
    });

    wrap(Deals, 'validateDealWorkflow', '__crmFieldPersistenceValidateDeal1', original => function(deal = {}) {
      refreshRequiredState();
      return original.call(this, deal);
    });

    Deals.__crmFieldPersistenceAuthority = VERSION;
    return true;
  }

  function bind() {
    if (document.documentElement.dataset.crmFieldPersistenceBound === VERSION) return;
    document.documentElement.dataset.crmFieldPersistenceBound = VERSION;
    document.addEventListener('change', event => {
      if (['leadFormStatus', 'dealFormStage'].includes(event.target?.id)) refreshRequiredState();
    }, true);
  }

  function boot() {
    const ready = patchLeads() && patchDeals();
    bind();
    refreshRequiredState();
    if (!ready && attempts++ < 120) setTimeout(boot, 150);
  }

  global.InCheck360CrmFieldPersistenceAuthority = Object.freeze({
    version: VERSION,
    refreshRequiredState
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
