(function installCrmPipelineProductInterest(global) {
  'use strict';
  if (global.InCheck360CrmPipelineProductInterest) return;

  const VERSION = '20260911-crm-pipeline-products3';
  const LEAD_STATUS_ROWS = [
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
  const LEAD_STATUSES = LEAD_STATUS_ROWS.map(([, key]) => key);
  const DEAL_STAGES = ['In Progress','Negotiation','POC','Proposal','Lost'];
  const DEAL_STAGE_ROWS = DEAL_STAGES.map(stage => [stage, stage]);
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
    if (['engaged','contacted','connected','in contact','initial contact'].includes(s)) return 'engaged';
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

  function rewriteLeadStatusSelect(id, selected, all=false) {
    const el = document.getElementById(id);
    if (!el) return;
    const opts = all ? [['All','All'], ...LEAD_STATUS_ROWS] : LEAD_STATUS_ROWS;
    el.innerHTML = opts.map(([label,value]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
    const normalized = selected === 'All' ? 'All' : leadStatus(selected);
    if (opts.some(([,value]) => value === normalized)) el.value = normalized;
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
    field.className = anchor.parentElement.className || 'crm-field';
    field.id = 'dealInterestedProductsField';
    field.innerHTML = `<label class="muted" for="dealInterestedProductIds">Interested Products</label>
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

  function renderLeadStatusDistribution(analytics = {}) {
    const host = document.getElementById('leadsStatusDistribution');
    if (!host) return;
    const total = Number(analytics.total || 0);
    const rows = LEAD_STATUS_ROWS.map(([label, key]) => {
      const count = Number(analytics.statusBreakdown?.[key] || 0);
      const percent = total ? (count / total) * 100 : 0;
      return `<div class="leads-status-row" data-status="${esc(key)}">
        <div class="leads-status-label"><span class="leads-status-dot"></span>${esc(label)}</div>
        <div class="leads-status-count">${count}</div>
        <div class="leads-status-track"><span class="leads-status-fill" style="width:${Math.min(100, percent).toFixed(1)}%"></span></div>
        <div class="leads-status-meta">${percent.toFixed(1)}%</div>
      </div>`;
    }).join('');
    host.innerHTML = `${rows}<div class="leads-status-row leads-status-row--total" data-status="total">
      <div class="leads-status-label"><span class="leads-status-dot"></span>Total Leads</div>
      <div class="leads-status-count">${total}</div>
      <div class="leads-status-track"><span class="leads-status-fill" style="width:${total ? 100 : 0}%"></span></div>
      <div class="leads-status-meta">${total ? '100%' : '0.0%'}</div>
    </div>`;
  }

  function renderDealStageDistribution(controller, analytics = {}) {
    const host = document.getElementById('dealsStageDistribution');
    if (!host || typeof controller?.renderDistribution !== 'function') return;
    const entries = DEAL_STAGE_ROWS.map(([label, key]) => [label, Number(analytics.stageBreakdown?.[key] || 0)]);
    controller.renderDistribution(host, entries, Number(analytics.totalDeals || 0));
  }

  function makeLane(label, tone='neutral') {
    const lane = document.createElement('section');
    lane.className = 'ic-crm-kanban-lane';
    lane.dataset.tone = tone;
    lane.innerHTML = `<div class="ic-crm-kanban-lane-head"><div><span class="ic-crm-lane-dot"></span><strong>${esc(label)}</strong></div><span class="ic-crm-lane-count">0</span></div><div class="ic-crm-kanban-cards"><div class="ic-crm-lane-empty">No records in this stage</div></div>`;
    return lane;
  }

  function reconcileKanban(module, rows, valueNormalizer) {
    const kanban = document.getElementById(`${module}GridView`)?.querySelector('.ic-crm-kanban');
    if (!kanban) return;
    const desired = rows.map(([label, key]) => ({ label, key: norm(key) }));
    const desiredKeys = new Set(desired.map(item => item.key));
    const existing = Array.from(kanban.querySelectorAll('.ic-crm-kanban-lane'));
    const laneByKey = new Map();

    for (const lane of existing) {
      const heading = lane.querySelector('.ic-crm-kanban-lane-head strong');
      const key = norm(heading?.textContent);
      if (key && !laneByKey.has(key)) laneByKey.set(key, lane);
    }

    for (const item of desired) {
      let lane = laneByKey.get(item.key);
      if (!lane) {
        const tone = item.key === 'lost' ? 'danger' : item.key === 'disregard' ? 'neutral' : ['qualified','proposal'].includes(item.key) ? 'success' : ['engaged','negotiation','poc','meeting booked'].includes(item.key) ? 'warning' : 'neutral';
        lane = makeLane(item.label, tone);
        laneByKey.set(item.key, lane);
      }
      const heading = lane.querySelector('.ic-crm-kanban-lane-head strong');
      if (heading) heading.textContent = item.label;
      kanban.appendChild(lane);
    }

    const allCards = Array.from(kanban.querySelectorAll('.ic-crm-kanban-card'));
    for (const card of allCards) {
      const statusNode = card.querySelector('.ic-crm-card-status');
      const normalized = norm(valueNormalizer(statusNode?.textContent || ''));
      const target = laneByKey.get(normalized);
      if (!target) continue;
      const cardsHost = target.querySelector('.ic-crm-kanban-cards');
      if (cardsHost) {
        cardsHost.querySelector('.ic-crm-lane-empty')?.remove();
        cardsHost.appendChild(card);
        const label = desired.find(item => item.key === normalized)?.label;
        if (label && statusNode) statusNode.textContent = label;
      }
    }

    for (const lane of Array.from(kanban.querySelectorAll('.ic-crm-kanban-lane'))) {
      const heading = lane.querySelector('.ic-crm-kanban-lane-head strong');
      const key = norm(heading?.textContent);
      const cardsHost = lane.querySelector('.ic-crm-kanban-cards');
      const cards = cardsHost ? cardsHost.querySelectorAll('.ic-crm-kanban-card') : [];
      const count = lane.querySelector('.ic-crm-lane-count');
      if (count) count.textContent = String(cards.length);
      if (!cards.length && cardsHost && !cardsHost.querySelector('.ic-crm-lane-empty')) {
        cardsHost.innerHTML = '<div class="ic-crm-lane-empty">No records in this stage</div>';
      }
      if (!cards.length && !desiredKeys.has(key)) lane.remove();
    }

    for (const item of desired) {
      const lane = laneByKey.get(item.key);
      if (lane?.isConnected) kanban.appendChild(lane);
    }
    for (const lane of Array.from(kanban.querySelectorAll('.ic-crm-kanban-lane'))) {
      const key = norm(lane.querySelector('.ic-crm-kanban-lane-head strong')?.textContent);
      if (!desiredKeys.has(key)) kanban.appendChild(lane);
    }
  }

  function reconcileGridLabels() {
    reconcileKanban('leads', LEAD_STATUS_ROWS, value => leadStatus(value));
    reconcileKanban('deals', DEAL_STAGE_ROWS, value => dealStage(value));
  }

  function scheduleReconcile() {
    global.setTimeout(reconcileGridLabels, 80);
    global.setTimeout(reconcileGridLabels, 220);
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
      const variant = s === 'lost' ? 'danger' : s === 'disregard' ? 'neutral' : ['meeting done','qualified'].includes(s) ? 'success' : ['engaged','meeting booked','negotiation'].includes(s) ? 'info' : s === 'not available' ? 'warning' : 'neutral';
      return this.leadChip(s, variant);
    };
    wrap(L,'syncLeadFormDropdowns','__crmDisregardForm3',original=>function(selected={}) {
      const r = original.call(this,{...selected,status:leadStatus(selected?.status)});
      rewriteLeadStatusSelect('leadFormStatus', document.getElementById('leadFormStatus')?.value || selected?.status || 'not contacted yet');
      return r;
    });
    wrap(L,'renderFilters','__crmDisregardFilters3',original=>function(...args) {
      const r = original.apply(this,args);
      const selected = this.state?.status === 'All' ? 'All' : leadStatus(this.state?.status || 'All');
      rewriteLeadStatusSelect('leadsStatusFilter', selected, true);
      return r;
    });
    wrap(L,'computeLeadAnalytics','__crmExpandedLeadAnalytics3',original=>function(leads=[]) {
      const analytics = original.call(this,leads) || {};
      const statusBreakdown = Object.fromEntries(LEAD_STATUSES.map(key => [key,0]));
      for (const row of Array.isArray(leads) ? leads : []) {
        const status = leadStatus(row?.status);
        if (Object.prototype.hasOwnProperty.call(statusBreakdown,status)) statusBreakdown[status] += 1;
      }
      analytics.statusBreakdown = statusBreakdown;
      analytics.engagedCount = statusBreakdown.engaged;
      analytics.meetingBookedCount = statusBreakdown['meeting booked'];
      analytics.meetingDoneCount = statusBreakdown['meeting done'];
      analytics.disregardCount = statusBreakdown.disregard;
      return analytics;
    });
    wrap(L,'renderLeadAnalytics','__crmExpandedLeadDashboard3',original=>function(analytics) {
      const r = original.call(this,analytics);
      const safe = analytics || this.computeLeadAnalytics([]);
      renderLeadStatusDistribution(safe);
      return r;
    });
    wrap(L,'render','__crmLeadGridReconcile3',original=>function(...args) {
      const r = original.apply(this,args);
      scheduleReconcile();
      return r;
    });
    L.__crmPipelineProductInterestVersion = VERSION;
    try { L.renderFilters?.(); } catch(_) {}
    try { L.rerenderSummaryIfNeeded?.(); } catch(_) {}
    return true;
  }

  function patchDeals() {
    const D = global.Deals;
    if (!D || D.__crmPipelineProductInterestVersion === VERSION) return !!D;
    D.formDropdownDefaults = D.formDropdownDefaults || {};
    D.formDropdownDefaults.stage = DEAL_STAGES.slice();
    D.normalizeStage = dealStage;
    D.matchesOpenStatus = s => norm(dealStage(s)) !== 'lost';
    if (Array.isArray(D.columns) && !D.columns.includes('interested_product_ids')) D.columns.push('interested_product_ids');
    D.dealStageChip = function(stage='') {
      const s = dealStage(stage);
      const variant = s === 'Lost' ? 'danger' : s === 'Proposal' ? 'success' : ['POC','Negotiation'].includes(s) ? 'info' : 'neutral';
      return this.dealChip(s, variant);
    };
    wrap(D,'normalizeDeal','__crmProductsNormalize3',original=>function(raw={}) {
      const row = original.call(this,raw) || {};
      row.stage = dealStage(raw?.stage ?? row.stage);
      row.interested_product_ids = ids(raw?.interested_product_ids ?? row.interested_product_ids);
      return row;
    });
    wrap(D,'backendDeal','__crmProductsBackend3',original=>function(deal={},options={}) {
      const payload = original.call(this,deal,options) || {};
      if (Object.prototype.hasOwnProperty.call(deal,'stage')) payload.stage = dealStage(deal.stage);
      if (Object.prototype.hasOwnProperty.call(deal,'interested_product_ids')) payload.interested_product_ids = ids(deal.interested_product_ids);
      return payload;
    });
    wrap(D,'collectFormData','__crmProductsCollect3',original=>function(...args) {
      const row = original.apply(this,args) || {};
      row.stage = dealStage(row.stage);
      row.interested_product_ids = selectedProducts();
      return row;
    });
    wrap(D,'syncDealFormDropdowns','__crmProposalStageForm3',original=>function(selected={}) {
      const stage = dealStage(selected?.stage || document.getElementById('dealFormStage')?.value || 'In Progress');
      const r = original.call(this,{...selected,stage});
      rewriteSelect('dealFormStage',DEAL_STAGES,stage);
      return r;
    });
    wrap(D,'renderFilters','__crmProposalStageFilters3',original=>function(...args) {
      const r = original.apply(this,args);
      const stage = this.state?.stage === 'All' ? 'All' : dealStage(this.state?.stage || 'All');
      rewriteSelect('dealsStageFilter',DEAL_STAGES,stage,true);
      return r;
    });
    wrap(D,'renderDealAnalytics','__crmProposalStageDashboard3',original=>function(analytics) {
      const r = original.call(this,analytics);
      const safe = analytics || this.computeDealAnalytics([]);
      renderDealStageDistribution(this,safe);
      return r;
    });
    wrap(D,'openForm','__crmProductsOpenForm3',original=>async function(row=null) {
      const r = await original.call(this,row);
      ensureProductField();
      await loadCatalog();
      const current = this.state?.form?.mode === 'edit' ? (this.state?.form?.currentDeal || row || {}) : (row || {});
      renderProducts(current?.interested_product_ids || row?.interested_product_ids || []);
      const stage = dealStage(row?.stage || document.getElementById('dealFormStage')?.value || 'In Progress');
      rewriteSelect('dealFormStage',DEAL_STAGES,stage);
      return r;
    });
    wrap(D,'render','__crmDealGridReconcile3',original=>function(...args) {
      const r = original.apply(this,args);
      scheduleReconcile();
      return r;
    });
    D.__crmPipelineProductInterestVersion = VERSION;
    try { D.renderFilters?.(); } catch(_) {}
    try { D.renderDealAnalytics?.(D.computeDealAnalytics?.(D.state?.filteredRows || []) || {}); } catch(_) {}
    return true;
  }

  function patchAll() {
    if (!patchLeads() || !patchDeals()) return false;
    try { global.InCheck360CrmGridView?.refresh?.('leads'); } catch(_) {}
    try { global.InCheck360CrmGridView?.refresh?.('deals'); } catch(_) {}
    scheduleReconcile();
    return true;
  }

  document.addEventListener('click',event=>{
    if (event.target?.closest?.('#leadsTab,#dealsTab,[data-view="leads"],[data-view="deals"],[data-crm-view-mode="grid"]')) scheduleReconcile();
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