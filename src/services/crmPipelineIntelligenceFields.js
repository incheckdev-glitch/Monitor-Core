(function installCrmPipelineIntelligenceFields(global) {
  'use strict';
  if (global.InCheck360CrmPipelineIntelligenceFields) return;

  const VERSION = '20260911-crm-intelligence-fields1';
  const ROLLOUT_SCOPES = ['All Locations', 'Selected Locations', 'Pilot Location(s)', 'To Be Confirmed'];
  const CONTACT_CHANNELS = ['Call', 'WhatsApp', 'Email', 'LinkedIn', 'In Person', 'Other'];
  const NEXT_ACTIONS = ['Call', 'Email', 'WhatsApp', 'LinkedIn Message', 'Meeting', 'Send Proposal', 'POC Follow-up', 'Follow-up', 'Other'];
  const LOST_REASONS = ['Price', 'Competitor', 'No Budget', 'Timing', 'No Decision', 'Product Fit', 'No Response', 'Other'];
  const DISREGARD_REASONS = ['Wrong Contact', 'Not Relevant', 'Duplicate', 'Spam', 'Outside Target Market', 'Invalid Data', 'Other'];
  let catalog = [];
  let attempts = 0;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  const db = () => global.SupabaseClient?.getClient?.() || global.supabase || null;
  const selectedIds = value => [...new Set((Array.isArray(value) ? value : []).map(clean).filter(id => /^[0-9a-f-]{36}$/i.test(id)))];
  const valueOf = id => document.getElementById(id)?.value ?? '';
  const setValue = (id, value) => { const el = document.getElementById(id); if (el) el.value = value == null ? '' : String(value); };
  const toast = message => { try { return global.UI?.toast?.(message) || global.U?.toast?.(message); } catch (_) {} };

  function wrap(object, name, marker, factory) {
    if (!object || typeof object[name] !== 'function' || object[marker]) return;
    const original = object[name];
    object[name] = factory(original);
    object[marker] = true;
  }

  function options(values, placeholder = 'Select…') {
    return `${placeholder ? `<option value="">${esc(placeholder)}</option>` : ''}${values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;
  }

  function insertField(anchor, id, html) {
    let field = document.getElementById(id);
    if (field) return field;
    if (!anchor?.parentElement) return null;
    field = document.createElement('div');
    field.id = id;
    field.className = anchor.parentElement.className || 'crm-field';
    field.innerHTML = html;
    anchor.parentElement.insertAdjacentElement('afterend', field);
    return field;
  }

  function setVisible(id, visible) {
    const field = document.getElementById(id);
    if (!field) return;
    field.hidden = !visible;
    field.style.display = visible ? '' : 'none';
  }

  async function loadCatalog() {
    if (catalog.length) return catalog;
    const client = db();
    if (!client) return [];
    const { data, error } = await client.from('proposal_catalog_items')
      .select('id,catalog_item_id,item_name,category,section,unit_price,discount_percent,quantity,default_location_name,notes,sort_order')
      .eq('is_active', true)
      .order('section').order('sort_order').order('item_name');
    if (!error) catalog = Array.isArray(data) ? data : [];
    return catalog;
  }

  function renderProductOptions(selectId, selected = []) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const chosen = new Set(selectedIds(selected));
    let html = '';
    let currentSection = '';
    for (const item of catalog) {
      const section = clean(item.section) || 'other';
      if (section !== currentSection) {
        if (currentSection) html += '</optgroup>';
        const label = section === 'annual_saas' ? 'Annual SaaS' : section === 'one_time_fee' ? 'One-time Fees' : section === 'hardware' ? 'Hardware' : section;
        html += `<optgroup label="${esc(label)}">`;
        currentSection = section;
      }
      html += `<option value="${esc(item.id)}"${chosen.has(clean(item.id)) ? ' selected' : ''}>${esc(item.item_name)}${item.category ? ` — ${esc(item.category)}` : ''}</option>`;
    }
    if (currentSection) html += '</optgroup>';
    select.innerHTML = html || '<option disabled>No active catalog items</option>';
  }

  function ensureLeadFields() {
    const status = document.getElementById('leadFormStatus');
    const interest = document.getElementById('leadFormServiceInterest') || status;
    const followUp = document.getElementById('leadNextFollowUpAtInput') || document.getElementById('leadFormNextFollowupDate') || status;
    if (!status || !interest) return false;

    let field = insertField(interest, 'leadLocationCountField', '<label class="muted">Number of Locations</label><input id="leadFormNumberOfLocations" class="input" type="number" min="1" step="1">');
    field = insertField(field?.querySelector('input') || interest, 'leadRolloutScopeField', `<label class="muted">Rollout Scope</label><select id="leadFormRolloutScope" class="input">${options(ROLLOUT_SCOPES)}</select>`);
    insertField(field?.querySelector('select') || interest, 'leadInterestedProductsIntelField', '<label class="muted">Interested Products</label><select id="leadInterestedProductIds" class="input" multiple size="5"></select><small class="muted">Required when the Lead becomes Qualified.</small>');

    field = insertField(status, 'leadContactChannelField', `<label class="muted">Contact Channel</label><select id="leadFormContactChannel" class="input">${options(CONTACT_CHANNELS)}</select>`);
    field = insertField(field?.querySelector('select') || status, 'leadMeetingAtField', '<label class="muted">Meeting Date & Time</label><input id="leadFormMeetingAt" class="input" type="datetime-local">');
    field = insertField(field?.querySelector('input') || status, 'leadMeetingOutcomeField', '<label class="muted">Meeting Outcome</label><textarea id="leadFormMeetingOutcome" class="input" rows="2"></textarea>');
    field = insertField(field?.querySelector('textarea') || status, 'leadLostReasonField', `<label class="muted">Lost Reason</label><select id="leadFormLostReason" class="input">${options(LOST_REASONS)}</select>`);
    insertField(field?.querySelector('select') || status, 'leadDisregardReasonField', `<label class="muted">Disregard Reason</label><select id="leadFormDisregardReason" class="input">${options(DISREGARD_REASONS)}</select>`);
    insertField(followUp, 'leadNextActionField', `<label class="muted">Next Action</label><select id="leadFormNextAction" class="input">${options(NEXT_ACTIONS)}</select>`);
    return true;
  }

  function ensureDealFields() {
    const stage = document.getElementById('dealFormStage');
    const interest = document.getElementById('dealFormServiceInterest') || stage;
    const followUp = document.getElementById('dealNextFollowUpAtInput') || stage;
    if (!stage || !interest) return false;

    let field = insertField(interest, 'dealLocationCountField', '<label class="muted">Number of Locations</label><input id="dealFormNumberOfLocations" class="input" type="number" min="1" step="1">');
    insertField(field?.querySelector('input') || interest, 'dealRolloutScopeField', `<label class="muted">Rollout Scope</label><select id="dealFormRolloutScope" class="input">${options(ROLLOUT_SCOPES)}</select>`);
    field = insertField(stage, 'dealPocCompletionField', '<label class="muted">POC Expected Completion</label><input id="dealFormPocExpectedEndDate" class="input" type="date">');
    field = insertField(field?.querySelector('input') || stage, 'dealLostReasonField', `<label class="muted">Lost Reason</label><select id="dealFormLostReason" class="input">${options(LOST_REASONS)}</select>`);
    insertField(field?.querySelector('select') || stage, 'dealLinkedProposalField', '<label class="muted">Linked Proposal</label><div id="dealLinkedProposalValue" class="input readonly-field">—</div>');
    insertField(followUp, 'dealNextActionField', `<label class="muted">Next Action</label><select id="dealFormNextAction" class="input">${options(NEXT_ACTIONS)}</select>`);
    return true;
  }

  function refreshConditionalFields() {
    const leadStatus = norm(valueOf('leadFormStatus'));
    setVisible('leadContactChannelField', leadStatus === 'engaged');
    setVisible('leadMeetingAtField', ['meeting booked', 'meeting done'].includes(leadStatus));
    setVisible('leadMeetingOutcomeField', leadStatus === 'meeting done');
    setVisible('leadLostReasonField', leadStatus === 'lost');
    setVisible('leadDisregardReasonField', leadStatus === 'disregard');
    setVisible('leadNextActionField', !['lost', 'disregard'].includes(leadStatus));

    const dealStage = norm(valueOf('dealFormStage'));
    setVisible('dealPocCompletionField', dealStage === 'poc');
    setVisible('dealLostReasonField', dealStage === 'lost');
    setVisible('dealNextActionField', dealStage !== 'lost');
    setVisible('dealLinkedProposalField', dealStage === 'proposal' || clean(document.getElementById('dealLinkedProposalValue')?.textContent) !== '—');
  }

  function toLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return clean(value).slice(0, 16);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function showLinkedProposal(row = {}) {
    const host = document.getElementById('dealLinkedProposalValue');
    if (!host) return;
    if (!row.id || !db()) { host.textContent = '—'; return; }
    const { data } = await db().from('proposals').select('proposal_id,ref_number,status').eq('deal_id', row.id).order('created_at', { ascending: false }).limit(1);
    host.textContent = data?.length ? `${data[0].proposal_id || data[0].ref_number} · ${data[0].status || 'draft'}` : '—';
    refreshConditionalFields();
  }

  function patchLeads() {
    const Leads = global.Leads;
    if (!Leads || Leads.__crmIntelligenceFieldsVersion === VERSION) return Boolean(Leads);

    wrap(Leads, 'normalizeLead', '__crmIntelNormalizeLead', original => function(raw = {}) {
      const row = original.call(this, raw) || {};
      return { ...row,
        number_of_locations: raw.number_of_locations ?? row.number_of_locations ?? null,
        rollout_scope: clean(raw.rollout_scope ?? row.rollout_scope),
        interested_product_ids: selectedIds(raw.interested_product_ids ?? row.interested_product_ids),
        contact_channel: clean(raw.contact_channel ?? row.contact_channel), meeting_at: raw.meeting_at ?? row.meeting_at ?? null,
        meeting_outcome: clean(raw.meeting_outcome ?? row.meeting_outcome), lost_reason: clean(raw.lost_reason ?? row.lost_reason),
        disregard_reason: clean(raw.disregard_reason ?? row.disregard_reason), next_action: clean(raw.next_action ?? row.next_action),
        status_changed_at: raw.status_changed_at ?? row.status_changed_at ?? raw.updated_at ?? row.updated_at
      };
    });

    wrap(Leads, 'backendLead', '__crmIntelBackendLead', original => function(lead = {}, options = {}) {
      const payload = original.call(this, lead, options) || {};
      for (const key of ['number_of_locations','rollout_scope','contact_channel','meeting_at','meeting_outcome','lost_reason','disregard_reason','next_action']) {
        if (Object.prototype.hasOwnProperty.call(lead, key)) payload[key] = lead[key];
      }
      if (Object.prototype.hasOwnProperty.call(lead, 'interested_product_ids')) payload.interested_product_ids = selectedIds(lead.interested_product_ids);
      return payload;
    });

    wrap(Leads, 'collectFormData', '__crmIntelCollectLead', original => function(...args) {
      const row = original.apply(this, args) || {};
      return { ...row,
        number_of_locations: valueOf('leadFormNumberOfLocations') ? Number(valueOf('leadFormNumberOfLocations')) : null,
        rollout_scope: clean(valueOf('leadFormRolloutScope')),
        interested_product_ids: Array.from(document.getElementById('leadInterestedProductIds')?.selectedOptions || []).map(option => option.value),
        contact_channel: clean(valueOf('leadFormContactChannel')),
        meeting_at: valueOf('leadFormMeetingAt') ? new Date(valueOf('leadFormMeetingAt')).toISOString() : null,
        meeting_outcome: clean(valueOf('leadFormMeetingOutcome')), lost_reason: clean(valueOf('leadFormLostReason')),
        disregard_reason: clean(valueOf('leadFormDisregardReason')), next_action: clean(valueOf('leadFormNextAction'))
      };
    });

    wrap(Leads, 'openForm', '__crmIntelOpenLead', original => async function(row = null) {
      const result = await original.call(this, row);
      ensureLeadFields();
      await loadCatalog();
      const lead = row ? this.normalizeLead(row) : {};
      setValue('leadFormNumberOfLocations', lead.number_of_locations ?? ''); setValue('leadFormRolloutScope', lead.rollout_scope || '');
      renderProductOptions('leadInterestedProductIds', lead.interested_product_ids || []); setValue('leadFormContactChannel', lead.contact_channel || '');
      setValue('leadFormMeetingAt', toLocalInput(lead.meeting_at)); setValue('leadFormMeetingOutcome', lead.meeting_outcome || '');
      setValue('leadFormLostReason', lead.lost_reason || ''); setValue('leadFormDisregardReason', lead.disregard_reason || ''); setValue('leadFormNextAction', lead.next_action || '');
      refreshConditionalFields();
      return result;
    });

    wrap(Leads, 'validateLeadWorkflow', '__crmIntelValidateLead', original => function(lead = {}) {
      if (!original.call(this, lead)) return false;
      const status = norm(this.normalizeLeadStatus?.(lead.status) || lead.status);
      const locations = Number(lead.number_of_locations || 0);
      if (!['lost','disregard'].includes(status) && !clean(lead.next_action)) { toast('Next Action is required for active leads.'); return false; }
      if (status === 'engaged' && (!clean(lead.contact_channel) || !clean(lead.last_contact))) { toast('Engaged requires Contact Channel and Last Contact date.'); return false; }
      if (status === 'meeting booked' && !clean(lead.meeting_at)) { toast('Meeting Date & Time is required.'); return false; }
      if (status === 'meeting done' && (!clean(lead.meeting_at) || !clean(lead.meeting_outcome))) { toast('Meeting Done requires Meeting Date & Time and Meeting Outcome.'); return false; }
      if (status === 'qualified' && (!(locations > 0) || !clean(lead.rollout_scope) || !(Number(lead.estimated_value || 0) > 0) || !lead.interested_product_ids?.length)) {
        toast('Qualified requires Number of Locations, Rollout Scope, Estimated Value, and at least one Interested Product.'); return false;
      }
      if (status === 'lost' && !clean(lead.lost_reason)) { toast('Lost Reason is required.'); return false; }
      if (status === 'disregard' && !clean(lead.disregard_reason)) { toast('Disregard Reason is required.'); return false; }
      return true;
    });

    Leads.__crmIntelligenceFieldsVersion = VERSION;
    return true;
  }

  function patchDeals() {
    const Deals = global.Deals;
    if (!Deals || Deals.__crmIntelligenceFieldsVersion === VERSION) return Boolean(Deals);

    wrap(Deals, 'normalizeDeal', '__crmIntelNormalizeDeal', original => function(raw = {}) {
      const row = original.call(this, raw) || {};
      return { ...row,
        number_of_locations: raw.number_of_locations ?? row.number_of_locations ?? null, rollout_scope: clean(raw.rollout_scope ?? row.rollout_scope),
        lost_reason: clean(raw.lost_reason ?? row.lost_reason), next_action: clean(raw.next_action ?? row.next_action),
        poc_expected_end_date: raw.poc_expected_end_date ?? row.poc_expected_end_date ?? null,
        stage_changed_at: raw.stage_changed_at ?? row.stage_changed_at ?? raw.updated_at ?? row.updated_at
      };
    });

    wrap(Deals, 'backendDeal', '__crmIntelBackendDeal', original => function(deal = {}, options = {}) {
      const payload = original.call(this, deal, options) || {};
      for (const key of ['number_of_locations','rollout_scope','lost_reason','next_action','poc_expected_end_date']) {
        if (Object.prototype.hasOwnProperty.call(deal, key)) payload[key] = deal[key];
      }
      return payload;
    });

    wrap(Deals, 'collectFormData', '__crmIntelCollectDeal', original => function(...args) {
      const row = original.apply(this, args) || {};
      return { ...row,
        number_of_locations: valueOf('dealFormNumberOfLocations') ? Number(valueOf('dealFormNumberOfLocations')) : null,
        rollout_scope: clean(valueOf('dealFormRolloutScope')), lost_reason: clean(valueOf('dealFormLostReason')),
        next_action: clean(valueOf('dealFormNextAction')), poc_expected_end_date: clean(valueOf('dealFormPocExpectedEndDate')) || null
      };
    });

    wrap(Deals, 'openForm', '__crmIntelOpenDeal', original => async function(row = null) {
      const result = await original.call(this, row);
      ensureDealFields();
      const deal = row ? this.normalizeDeal(row) : {};
      setValue('dealFormNumberOfLocations', deal.number_of_locations ?? ''); setValue('dealFormRolloutScope', deal.rollout_scope || '');
      setValue('dealFormLostReason', deal.lost_reason || ''); setValue('dealFormNextAction', deal.next_action || ''); setValue('dealFormPocExpectedEndDate', deal.poc_expected_end_date || '');
      showLinkedProposal(deal); refreshConditionalFields();
      return result;
    });

    wrap(Deals, 'validateDealWorkflow', '__crmIntelValidateDeal', original => function(deal = {}) {
      if (!original.call(this, deal)) return false;
      const stage = norm(this.normalizeStage?.(deal.stage) || deal.stage);
      const locations = Number(deal.number_of_locations || 0);
      if (stage !== 'lost' && !clean(deal.next_action)) { toast('Next Action is required for active deals.'); return false; }
      if (['negotiation','poc','proposal'].includes(stage) && (!(locations > 0) || !clean(deal.rollout_scope))) { toast('Number of Locations and Rollout Scope are required before moving this Deal forward.'); return false; }
      if (stage === 'poc' && !clean(deal.poc_expected_end_date)) { toast('POC Expected Completion date is required.'); return false; }
      if (stage === 'lost' && !clean(deal.lost_reason)) { toast('Lost Reason is required.'); return false; }
      return true;
    });

    Deals.__crmIntelligenceFieldsVersion = VERSION;
    return true;
  }

  function patchProposals() {
    const Proposals = global.Proposals;
    if (!Proposals || Proposals.__crmIntelligenceFieldsVersion === VERSION) return Boolean(Proposals);

    wrap(Proposals, 'proposalDraftFromDeal', '__crmIntelProposalDraft', original => async function(deal = {}) {
      const proposal = await original.call(this, deal);
      const wanted = selectedIds(deal.interested_product_ids);
      if (!wanted.length) return proposal;
      await loadCatalog();
      const locations = Math.max(1, Number(deal.number_of_locations || 1));
      const serviceStart = new Date().toISOString().slice(0, 10);
      proposal.__crmInterestedProductItems = catalog.filter(item => wanted.includes(clean(item.id))).map(item => {
        const section = clean(item.section);
        const annual = section === 'annual_saas';
        return {
          catalog_item_id: item.id, item_id: item.catalog_item_id, section, category: item.category, item_name: item.item_name,
          location_name: annual && locations > 1 ? 'ALL LOCATIONS' : clean(item.default_location_name), unit_price: Number(item.unit_price || 0),
          discount_percent: Number(item.discount_percent || 0), quantity: annual ? 12 : Math.max(1, Number(item.quantity || 1)),
          license_quantity: annual ? locations : 1, service_start_date: annual ? serviceStart : '',
          notes: [clean(item.notes), 'Prefilled from Deal interest — review quantities and pricing before saving.'].filter(Boolean).join(' | ')
        };
      });
      return proposal;
    });

    wrap(Proposals, 'openProposalForm', '__crmIntelOpenProposal', original => function(proposal, items = [], options = {}) {
      const suggested = !items?.length && proposal?.__crmInterestedProductItems?.length ? proposal.__crmInterestedProductItems : items;
      const result = original.call(this, proposal, suggested, options);
      if (proposal?.__crmInterestedProductItems?.length && !items?.length) {
        setTimeout(() => toast(`${proposal.__crmInterestedProductItems.length} interested product(s) prefilled from the Deal. Review quantities and pricing before saving.`), 100);
      }
      return result;
    });

    Proposals.__crmIntelligenceFieldsVersion = VERSION;
    return true;
  }

  function bind() {
    if (document.documentElement.dataset.crmIntelligenceFieldsBound === '1') return;
    document.documentElement.dataset.crmIntelligenceFieldsBound = '1';
    document.addEventListener('change', event => {
      if (['leadFormStatus','dealFormStage'].includes(event.target?.id)) refreshConditionalFields();
    });
  }

  function boot() {
    if (!patchLeads() || !patchDeals() || !patchProposals()) {
      if (attempts++ < 100) setTimeout(boot, 150);
      return;
    }
    bind();
    loadCatalog();
  }

  global.InCheck360CrmPipelineIntelligenceFields = Object.freeze({ version: VERSION, refresh: refreshConditionalFields });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})(window);
