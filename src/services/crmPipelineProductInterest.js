(function installCrmPipelineProductInterest(global) {
  'use strict';
  if (global.InCheck360CrmPipelineProductInterest) return;

  const VERSION = '20260911-crm-pipeline-products1';
  const LEAD_STATUSES = ['not contacted yet','not available','meeting booked','meeting done','negotiation','qualified','lost','disregard'];
  const DEAL_STAGES = ['In Progress','Negotiation','POC','Proposal','Lost'];
  let catalog = [];
  let retries = 0;

  const clean = v => String(v ?? '').replace(/\s+/g,' ').trim();
  const norm = v => clean(v).toLowerCase().replace(/_/g,' ').replace(/-/g,' ');
  const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const db = () => global.SupabaseClient?.getClient?.() || global.supabase || null;
  const ids = v => [...new Set((Array.isArray(v)?v:[]).map(clean).filter(x => /^[0-9a-f-]{36}$/i.test(x)))];

  function leadStatus(v) {
    const s = norm(v);
    if (!s || ['new','open','not contacted'].includes(s)) return 'not contacted yet';
    if (['disregard','disregarded','irrelevant','not relevant'].includes(s)) return 'disregard';
    if (['not available','unavailable'].includes(s)) return 'not available';
    if (['meeting booked','meeting scheduled','booked'].includes(s)) return 'meeting booked';
    if (['meeting done','meeting completed','met'].includes(s)) return 'meeting done';
    if (s.includes('negotiat')) return 'negotiation';
    if (['qualified','qualify','converted','converted to deal','coverted to deal'].includes(s)) return 'qualified';
    if (['lost','closed lost'].includes(s)) return 'lost';
    return s;
  }

  function dealStage(v) {
    const s = norm(v);
    if (!s || s === 'new' || s.includes('prospect') || s.includes('in progress')) return 'In Progress';
    if (s === 'qualified' || s.includes('negotiat')) return 'Negotiation';
    if (s === 'poc' || s.includes('proof of concept')) return 'POC';
    if (['proposal','proposal sent','converted to proposal'].includes(s) || s.includes('converted to proposal')) return 'Proposal';
    if (s === 'lost' || s.includes('closed lost')) return 'Lost';
    return clean(v) || 'In Progress';
  }

  function rewriteSelect(id, values, selected, all=false) {
    const el = document.getElementById(id);
    if (!el) return;
    const opts = all ? ['All', ...values] : values;
    el.innerHTML = opts.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (opts.includes(selected)) el.value = selected;
  }

  function wrap(obj, name, marker, factory) {
    if (!obj || typeof obj[name] !== 'function' || obj[marker]) return;
    const original = obj[name];
    obj[name] = factory(original);
    obj[marker] = true;
  }

  async function loadCatalog() {
    const client = db();
    if (!client) return [];
    const { data, error } = await client.from('proposal_catalog_items')
      .select('id,item_name,category,section,is_active,sort_order')
      .eq('is_active', true)
      .order('section').order('sort_order').order('item_name');
    if (!error) catalog = Array.isArray(data) ? data : [];
    return catalog;
  }

  function ensureProductField() {
    if (document.getElementById('dealInterestedProductIds')) return true;
    const anchor = document.getElementById('dealFormServiceInterest') || document.getElementById('dealFormStage');
    if (!anchor?.parentElement) return false;
    const field = document.createElement('div');
    field.className = anchor.parentElement.className || 'form-group';
    field.id = 'dealInterestedProductsField';
    field.innerHTML = `<label for="dealInterestedProductIds">Interested Products</label>
      <select id="dealInterestedProductIds" class="${esc(anchor.className)}" multiple size="5" aria-describedby="dealInterestedProductsHelp"></select>
      <small id="dealInterestedProductsHelp" style="display:block;margin-top:5px;opacity:.65">Select one or multiple items from the Product Catalog. Hold Ctrl/Cmd to select several items.</small>`;
    anchor.parentElement.insertAdjacentElement('afterend', field);
    return true;
  }

  function renderProducts(selected=[]) {
    const select = document.getElementById('dealInterestedProductIds');
    if (!select) return;
    const chosen = new Set(ids(selected));
    let lastSection = '';
    let html = '';
    for (const item of catalog) {
      const section = clean(item.section) || 'other';
      if (section !== lastSection) {
        if (lastSection) html += '</optgroup>';
        const label = section === 'annual_saas' ? 'Annual SaaS' : section === 'one_time_fee' ? 'One-time Fees' : section === 'hardware' ? 'Hardware' : section;
        html += `<optgroup label="${esc(label)}">`;
        lastSection = section;
      }
      html += `<option value="${esc(item.id)}"${chosen.has(clean(item.id))?' selected':''}>${esc(item.item_name)}${item.category ? ` — ${esc(item.category)}` : ''}</option>`;
    }
    if (lastSection) html += '</optgroup>';
    select.innerHTML = html || '<option disabled>No active catalog items</option>';
  }

  function selectedProducts() {
    const select = document.getElementById('dealInterestedProductIds');
    return select ? ids(Array.from(select.selectedOptions || []).map(o => o.value)) : [];
  }

  function patchLeads() {
    const L = global.Leads;
    if (!L || L.__crmPipelineProductInterestVersion === VERSION) return !!L;
    L.formDropdownDefaults = L.formDropdownDefaults || {};
    L.formDropdownDefaults.status = LEAD_STATUSES.slice();
    L.allowedLeadStatuses = () => LEAD_STATUSES.slice();
    L.normalizeLeadStatus = leadStatus;
    L.matchesOpenStatus = s => !['lost','disregard'].includes(norm(leadStatus(s)));
    L.leadStatusChip = function(status='') {
      const s = leadStatus(status);
      const variant = s === 'lost' ? 'danger' : s === 'disregard' ? 'neutral' : ['meeting done','qualified'].includes(s) ? 'success' : ['meeting booked','negotiation'].includes(s) ? 'info' : s === 'not available' ? 'warning' : 'neutral';
      return this.leadChip(s, variant);
    };
    wrap(L,'syncLeadFormDropdowns','__crmDisregardForm',original=>function(selected={}) {
      const r = original.call(this,{...selected,status:leadStatus(selected?.status)});
      rewriteSelect('leadFormStatus',LEAD_STATUSES,leadStatus(document.getElementById('leadFormStatus')?.value || selected?.status || 'not contacted yet'));
      return r;
    });
    wrap(L,'renderFilters','__crmDisregardFilters',original=>function(...args) {
      const r = original.apply(this,args);
      rewriteSelect('leadsStatusFilter',LEAD_STATUSES,this.state?.status || 'All',true);
      return r;
    });
    L.__crmPipelineProductInterestVersion = VERSION;
    try { L.renderFilters?.(); } catch(_) {}
    return true;
  }

  function patchDeals() {
    const D = global.Deals;
    if (!D || D.__crmPipelineProductInterestVersion === VERSION) return !!D;
    D.formDropdownDefaults = D.formDropdownDefaults || {};
    D.formDropdownDefaults.stage = DEAL_STAGES.slice();
    D.normalizeStage = dealStage;
    D.matchesOpenStatus = s => !['lost','proposal'].includes(norm(dealStage(s)));
    if (Array.isArray(D.columns) && !D.columns.includes('interested_product_ids')) D.columns.push('interested_product_ids');
    D.dealStageChip = function(stage='') {
      const s = dealStage(stage);
      const variant = s === 'Lost' ? 'danger' : s === 'Proposal' ? 'success' : ['POC','Negotiation'].includes(s) ? 'info' : 'neutral';
      return this.dealChip(s, variant);
    };
    wrap(D,'normalizeDeal','__crmProductsNormalize',original=>function(raw={}) {
      const row = original.call(this,raw) || {};
      row.stage = dealStage(raw?.stage ?? row.stage);
      row.interested_product_ids = ids(raw?.interested_product_ids ?? row.interested_product_ids);
      return row;
    });
    wrap(D,'backendDeal','__crmProductsBackend',original=>function(deal={},options={}) {
      const payload = original.call(this,deal,options) || {};
      if (Object.prototype.hasOwnProperty.call(deal,'stage')) payload.stage = dealStage(deal.stage);
      if (Object.prototype.hasOwnProperty.call(deal,'interested_product_ids')) payload.interested_product_ids = ids(deal.interested_product_ids);
      return payload;
    });
    wrap(D,'collectFormData','__crmProductsCollect',original=>function(...args) {
      const row = original.apply(this,args) || {};
      row.stage = dealStage(row.stage);
      row.interested_product_ids = selectedProducts();
      return row;
    });
    wrap(D,'syncDealFormDropdowns','__crmProposalStageForm',original=>function(selected={}) {
      const stage = dealStage(selected?.stage || document.getElementById('dealFormStage')?.value || 'In Progress');
      const r = original.call(this,{...selected,stage});
      rewriteSelect('dealFormStage',DEAL_STAGES,stage);
      return r;
    });
    wrap(D,'renderFilters','__crmProposalStageFilters',original=>function(...args) {
      const r = original.apply(this,args);
      const stage = this.state?.stage === 'All' ? 'All' : dealStage(this.state?.stage || 'All');
      rewriteSelect('dealsStageFilter',DEAL_STAGES,stage,true);
      return r;
    });
    wrap(D,'openForm','__crmProductsOpenForm',original=>async function(row=null) {
      const r = await original.call(this,row);
      ensureProductField();
      await loadCatalog();
      renderProducts(row?.interested_product_ids || []);
      const stage = dealStage(row?.stage || document.getElementById('dealFormStage')?.value || 'In Progress');
      rewriteSelect('dealFormStage',DEAL_STAGES,stage);
      return r;
    });
    D.__crmPipelineProductInterestVersion = VERSION;
    try { D.renderFilters?.(); } catch(_) {}
    return true;
  }

  function reconcileGridLabels() {
    const deals = document.getElementById('dealsGridView')?.querySelector('.ic-crm-kanban');
    if (deals) {
      for (const lane of deals.querySelectorAll('.ic-crm-kanban-lane')) {
        const label = lane.querySelector('.ic-crm-kanban-lane-head strong');
        if (norm(label?.textContent) === 'converted to proposal') label.textContent = 'Proposal';
      }
    }
    const leads = document.getElementById('leadsGridView')?.querySelector('.ic-crm-kanban');
    if (leads && !Array.from(leads.querySelectorAll('.ic-crm-kanban-lane-head strong')).some(el => norm(el.textContent) === 'disregard')) {
      const lane = document.createElement('section');
      lane.className = 'ic-crm-kanban-lane';
      lane.dataset.tone = 'neutral';
      lane.innerHTML = '<div class="ic-crm-kanban-lane-head"><div><span class="ic-crm-lane-dot"></span><strong>Disregard</strong></div><span class="ic-crm-lane-count">0</span></div><div class="ic-crm-kanban-cards"><div class="ic-crm-lane-empty">No records in this stage</div></div>';
      leads.appendChild(lane);
    }
  }

  function patchAll() {
    if (!patchLeads() || !patchDeals()) return false;
    try { global.InCheck360CrmGridView?.refresh?.('leads'); } catch(_) {}
    try { global.InCheck360CrmGridView?.refresh?.('deals'); } catch(_) {}
    global.setTimeout(reconcileGridLabels,100);
    return true;
  }

  document.addEventListener('click',event=>{
    if (event.target?.closest?.('#leadsTab,#dealsTab,[data-view="leads"],[data-view="deals"]')) global.setTimeout(reconcileGridLabels,120);
  });

  function boot() {
    if (patchAll()) return;
    if (retries++ < 80) global.setTimeout(boot,150);
  }

  global.InCheck360CrmPipelineProductInterest = Object.freeze({
    version: VERSION,
    leadStatuses: LEAD_STATUSES.slice(),
    dealStages: DEAL_STAGES.slice(),
    refresh: () => { patchAll(); loadCatalog().then(()=>renderProducts(selectedProducts())); }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})(window);
