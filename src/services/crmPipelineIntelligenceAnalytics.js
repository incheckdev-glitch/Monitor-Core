(function installCrmPipelineIntelligenceAnalytics(global) {
  'use strict';
  if (global.InCheck360CrmPipelineIntelligenceAnalytics) return;

  const VERSION = '20260911-crm-intelligence-analytics1';
  const LEAD_FLOW = ['not contacted yet','not available','engaged','meeting booked','meeting done','negotiation','qualified'];
  const DEAL_FLOW = ['in progress','negotiation','poc','proposal'];
  let metrics = [];
  let attempts = 0;
  let renderTimer = 0;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  const db = () => global.SupabaseClient?.getClient?.() || global.supabase || null;
  const toast = message => { try { return global.UI?.toast?.(message) || global.U?.toast?.(message); } catch (_) {} };

  function wrap(object, name, marker, factory) {
    if (!object || typeof object[name] !== 'function' || object[marker]) return;
    const original = object[name]; object[name] = factory(original); object[marker] = true;
  }

  function rows(module) {
    const controller = module === 'leads' ? global.Leads : global.Deals;
    return Array.isArray(controller?.state?.filteredRows) ? controller.state.filteredRows : (Array.isArray(controller?.state?.rows) ? controller.state.rows : []);
  }

  function findRow(module, id) {
    return rows(module).find(row => [row.id, module === 'leads' ? row.lead_id : row.deal_id].some(value => clean(value) === clean(id)));
  }

  function daysSince(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  }

  function overdueDays(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) || date.getTime() >= Date.now() ? 0 : Math.max(1, Math.floor((Date.now() - date.getTime()) / 86400000));
  }

  function ensureStyles() {
    if (document.getElementById('crmPipelineIntelligenceStyles')) return;
    const style = document.createElement('style');
    style.id = 'crmPipelineIntelligenceStyles';
    style.textContent = `
      .crm-intel-card-meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px;font-size:11px}
      .crm-intel-pill{padding:3px 7px;border-radius:999px;background:rgba(148,163,184,.14);font-weight:600}
      .crm-intel-overdue{color:#b91c1c;background:rgba(239,68,68,.12)}
      .ic-crm-kanban-card.crm-intel-card-overdue{box-shadow:inset 3px 0 0 rgba(239,68,68,.75)}
      .crm-intel-dashboard{margin-top:14px;padding:13px;border:1px solid rgba(148,163,184,.24);border-radius:14px}
      .crm-intel-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;margin-top:9px}
      .crm-intel-box{padding:11px;border:1px solid rgba(148,163,184,.18);border-radius:11px}
      .crm-intel-row{display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px solid rgba(148,163,184,.1)}
      .crm-intel-row:last-child{border-bottom:0}
    `;
    document.head.appendChild(style);
  }

  function decorateCards() {
    for (const module of ['leads','deals']) {
      document.querySelectorAll(`#${module}GridView .ic-crm-kanban-card[data-crm-grid-record]`).forEach(card => {
        const row = findRow(module, card.dataset.crmGridRecord);
        if (!row) return;
        let meta = card.querySelector('.crm-intel-card-meta');
        if (!meta) { meta = document.createElement('div'); meta.className = 'crm-intel-card-meta'; card.appendChild(meta); }
        const age = daysSince(module === 'leads' ? row.status_changed_at : row.stage_changed_at);
        const overdue = overdueDays(module === 'leads' ? (row.next_follow_up_at || row.next_follow_up) : row.next_follow_up_at);
        const locations = Number(row.number_of_locations || 0);
        const nextAction = clean(row.next_action);
        card.classList.toggle('crm-intel-card-overdue', overdue > 0);
        meta.innerHTML = `<span class="crm-intel-pill">${age}d in ${module === 'leads' ? 'status' : 'stage'}</span>${locations ? `<span class="crm-intel-pill">${locations} loc.</span>` : ''}${nextAction ? `<span class="crm-intel-pill">Next: ${esc(nextAction)}</span>` : ''}${overdue ? `<span class="crm-intel-pill crm-intel-overdue">⚠ ${overdue}d overdue</span>` : ''}`;
      });
    }
  }

  function transitionMetric(entityType, fromStage, toStage) {
    const item = metrics.find(row => norm(row.entity_type) === entityType && norm(row.from_stage) === fromStage && norm(row.to_stage) === toStage);
    if (!item?.transition_count) return 'Collecting data';
    const hours = Number(item.avg_hours || 0);
    const duration = hours >= 48 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(1)}h`;
    return `${duration} avg · ${item.transition_count}`;
  }

  function ownerWorkload(list, module) {
    const result = {};
    for (const row of list) {
      const stage = norm(module === 'leads' ? row.status : row.stage);
      if (module === 'leads' ? ['lost','disregard'].includes(stage) : stage === 'lost') continue;
      const owner = clean(row.assigned_to) || 'Unassigned';
      result[owner] ??= { active: 0, overdue: 0, locations: 0 };
      result[owner].active += 1;
      result[owner].locations += Number(row.number_of_locations || 0);
      if (overdueDays(module === 'leads' ? (row.next_follow_up_at || row.next_follow_up) : row.next_follow_up_at)) result[owner].overdue += 1;
    }
    return Object.entries(result).sort((a,b) => b[1].active - a[1].active).slice(0, 6);
  }

  function rowHtml(entries) {
    return entries.map(([label, value]) => `<div class="crm-intel-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
  }

  function renderDashboard(module) {
    const list = rows(module);
    const anchor = document.getElementById(module === 'leads' ? 'leadsStatusDistribution' : 'dealsStageDistribution');
    if (!anchor) return;
    const id = `${module}PipelineIntelligence`;
    let host = document.getElementById(id);
    if (!host) { host = document.createElement('section'); host.id = id; host.className = 'crm-intel-dashboard'; (anchor.parentElement || anchor).insertAdjacentElement('afterend', host); }

    const flow = module === 'leads' ? LEAD_FLOW : DEAL_FLOW;
    const total = Math.max(1, list.length);
    const funnel = flow.map((stage, index) => [stage, list.filter(row => {
      const current = norm(module === 'leads' ? row.status : row.stage);
      const rank = flow.indexOf(current);
      return (module === 'leads' && Boolean(row.converted_at || row.converted_deal_uuid)) || rank >= index;
    }).length]);

    const terminal = module === 'leads' ? ['lost','disregard'] : ['lost'];
    const active = list.filter(row => !terminal.includes(norm(module === 'leads' ? row.status : row.stage)));
    const changedField = module === 'leads' ? 'status_changed_at' : 'stage_changed_at';
    const averageAge = active.length ? Math.round(active.reduce((sum,row) => sum + daysSince(row[changedField]), 0) / active.length) : 0;
    const overdueCount = active.filter(row => overdueDays(module === 'leads' ? (row.next_follow_up_at || row.next_follow_up) : row.next_follow_up_at)).length;
    const locationCount = active.reduce((sum,row) => sum + Number(row.number_of_locations || 0), 0);

    const reasons = {};
    for (const row of list) {
      const stage = norm(module === 'leads' ? row.status : row.stage);
      const reason = stage === 'lost' ? clean(row.lost_reason) : (module === 'leads' && stage === 'disregard' ? clean(row.disregard_reason) : '');
      if (reason) reasons[reason] = (reasons[reason] || 0) + 1;
    }

    const speed = module === 'leads'
      ? [['Not Available → Engaged', transitionMetric('lead','not available','engaged')], ['Engaged → Meeting', transitionMetric('lead','engaged','meeting booked')], ['Meeting Done → Qualified', transitionMetric('lead','meeting done','qualified')]]
      : [['In Progress → Negotiation', transitionMetric('deal','in progress','negotiation')], ['Negotiation → POC', transitionMetric('deal','negotiation','poc')], ['POC → Proposal', transitionMetric('deal','poc','proposal')]];

    const owners = ownerWorkload(list, module);
    host.innerHTML = `<h3>${module === 'leads' ? 'Lead' : 'Deal'} Pipeline Intelligence</h3><div class="crm-intel-grid">
      <div class="crm-intel-box"><b>Conversion Funnel</b>${rowHtml(funnel.map(([stage,count]) => [stage.replace(/\b\w/g, letter => letter.toUpperCase()), `${count} · ${Math.round(count / total * 100)}%`]))}</div>
      <div class="crm-intel-box"><b>Stage Aging</b>${rowHtml([['Average', `${averageAge}d`], ['Active locations', String(locationCount)], ['Overdue follow-ups', String(overdueCount)]])}</div>
      <div class="crm-intel-box"><b>Transition Speed</b>${rowHtml(speed)}</div>
      <div class="crm-intel-box"><b>Owner Workload</b>${owners.length ? owners.map(([name,data]) => `<div class="crm-intel-row"><span>${esc(name)}</span><b>${data.active} active · ${data.overdue} overdue · ${data.locations} loc.</b></div>`).join('') : '<span class="muted">No active records.</span>'}</div>
      <div class="crm-intel-box"><b>${module === 'leads' ? 'Lost / Disregard' : 'Lost'} Reasons</b>${Object.keys(reasons).length ? rowHtml(Object.entries(reasons)) : '<span class="muted">No structured reasons yet.</span>'}</div>
    </div>`;
  }

  async function loadMetrics() {
    const client = db();
    if (!client?.rpc) return;
    const { data } = await client.rpc('crm_pipeline_transition_metrics', { p_days: 180 });
    metrics = Array.isArray(data?.metrics) ? data.metrics : [];
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { ensureStyles(); decorateCards(); renderDashboard('leads'); renderDashboard('deals'); }, 120);
    setTimeout(decorateCards, 350);
  }

  function smartDropWarning(event) {
    const lane = event.target?.closest?.('.ic-crm-kanban-lane');
    if (!lane) return;
    let payload = '';
    try { payload = clean(event.dataTransfer?.getData('text/plain')); } catch (_) {}
    const match = payload.match(/^(leads|deals):(.+)$/);
    if (!match || !lane.closest(`#${match[1]}GridView`)) return;
    const target = norm(lane.querySelector('.ic-crm-kanban-lane-head strong')?.textContent);
    const row = findRow(match[1], match[2]);
    const flow = match[1] === 'leads' ? LEAD_FLOW : DEAL_FLOW;
    if (!row || ['lost','disregard','other'].includes(target)) return;
    const current = norm(match[1] === 'leads' ? (global.Leads?.normalizeLeadStatus?.(row.status) || row.status) : (global.Deals?.normalizeStage?.(row.stage) || row.stage));
    const fromIndex = flow.indexOf(current), toIndex = flow.indexOf(target);
    if (fromIndex < 0 || toIndex < 0 || Math.abs(toIndex - fromIndex) <= 1) return;
    const skipped = Math.abs(toIndex - fromIndex) - 1;
    if (!global.confirm(`This move skips ${skipped} pipeline step${skipped === 1 ? '' : 's'}: ${current} → ${target}. Continue?`)) {
      event.preventDefault(); event.stopImmediatePropagation(); toast('Pipeline move cancelled.');
    }
  }

  function patchControllers() {
    if (!global.Leads || !global.Deals) return false;
    wrap(global.Leads, 'render', '__crmIntelAnalyticsLeadRender', original => function(...args) { const result = original.apply(this, args); scheduleRender(); return result; });
    wrap(global.Deals, 'render', '__crmIntelAnalyticsDealRender', original => function(...args) { const result = original.apply(this, args); scheduleRender(); return result; });
    return true;
  }

  function bind() {
    if (document.documentElement.dataset.crmIntelligenceAnalyticsBound === '1') return;
    document.documentElement.dataset.crmIntelligenceAnalyticsBound = '1';
    document.addEventListener('drop', smartDropWarning, true);
    document.addEventListener('click', event => {
      if (event.target?.closest?.('#leadsTab,#dealsTab,[data-view="leads"],[data-view="deals"],[data-crm-view-mode="grid"]')) scheduleRender();
    });
  }

  function boot() {
    if (!patchControllers()) { if (attempts++ < 100) setTimeout(boot, 150); return; }
    bind(); ensureStyles(); loadMetrics().finally(scheduleRender);
  }

  global.InCheck360CrmPipelineIntelligenceAnalytics = Object.freeze({ version: VERSION, refresh: () => loadMetrics().finally(scheduleRender) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})(window);
