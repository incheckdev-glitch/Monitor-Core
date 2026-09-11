(function installCrmDailyBrief(global) {
  'use strict';

  if (global.InCheck360CrmDailyBrief) return;

  const VERSION = '20260911-crm-daily-brief1';
  const TAB_ID = 'crmDailyBriefTab';
  const VIEW_ID = 'crmDailyBriefView';
  const CSS_ID = 'crm-daily-brief-css';
  const API_URL = '/api/crm-daily-brief';
  const state = {
    installed: false,
    allowed: false,
    isAdmin: false,
    loading: false,
    generating: false,
    reports: [],
    selectedId: '',
    error: '',
  };

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function client() {
    return global.SupabaseClient?.getClient?.() || global.supabase || null;
  }

  function notify(message, type = '') {
    try {
      if (global.UI?.toast) return global.UI.toast(message, type || undefined);
      if (global.U?.toast) return global.U.toast(message, type || undefined);
    } catch (_) {}
    console[type === 'error' ? 'error' : 'log']('[CRM Daily Brief]', message);
  }

  function installCss() {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = `/src/ui/crm-daily-brief.css?v=${VERSION}`;
    document.head.appendChild(link);
  }

  function todayLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDate(value) {
    if (!value) return 'Unknown date';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(value) {
    const d = new Date(value || '');
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function viewMarkup() {
    return `
      <div class="crm-brief-shell">
        <section class="crm-brief-hero">
          <div>
            <div class="crm-brief-eyebrow">CRM · Shared AI Intelligence</div>
            <h1>AI CRM Daily Brief</h1>
            <p>One saved CRM report shared with the team. Opening or refreshing this page does not create another AI request.</p>
          </div>
          <div class="crm-brief-hero-actions">
            <span id="crmBriefStatus" class="crm-brief-status">Loading saved brief…</span>
            <button id="crmBriefGenerateBtn" class="btn primary" type="button" hidden>Generate Today's Brief</button>
            <button id="crmBriefRefreshBtn" class="btn ghost" type="button">Refresh</button>
          </div>
        </section>
        <div id="crmBriefError" class="crm-brief-error" hidden></div>
        <section class="crm-brief-layout">
          <aside class="crm-brief-history">
            <h2>Previous Reports</h2>
            <div id="crmBriefHistory" class="crm-brief-history-list"><div class="muted">No reports yet.</div></div>
          </aside>
          <main id="crmBriefReport" class="crm-brief-report">
            <div class="crm-brief-empty"><strong>No CRM brief generated yet.</strong><span>Admin or GM can generate the first shared report.</span></div>
          </main>
        </section>
      </div>`;
  }

  function ensureShell() {
    if (state.installed && document.getElementById(TAB_ID) && document.getElementById(VIEW_ID)) return true;
    const leadsTab = document.getElementById('leadsTab');
    const leadsView = document.getElementById('leadsView');
    if (!leadsTab || !leadsView) return false;

    installCss();

    let tab = document.getElementById(TAB_ID);
    if (!tab) {
      tab = document.createElement('button');
      tab.id = TAB_ID;
      tab.className = 'view-tab';
      tab.type = 'button';
      tab.dataset.view = 'crmDailyBrief';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-controls', VIEW_ID);
      tab.innerHTML = '<span class="icon" aria-hidden="true">🧠</span> AI CRM Brief';
      tab.hidden = true;
      const leadIntelTab = document.getElementById('leadIntelligenceTab');
      (leadIntelTab || leadsTab).parentElement?.insertBefore(tab, leadIntelTab || leadsTab);
      tab.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openView();
      });
    }

    let view = document.getElementById(VIEW_ID);
    if (!view) {
      view = document.createElement('section');
      view.id = VIEW_ID;
      view.className = 'view crm-brief-view';
      view.setAttribute('role', 'tabpanel');
      view.setAttribute('aria-labelledby', TAB_ID);
      view.style.display = 'none';
      view.innerHTML = viewMarkup();
      const leadIntelView = document.getElementById('leadIntelligenceView');
      (leadIntelView || leadsView).parentElement?.insertBefore(view, leadIntelView || leadsView);
      wireView();
    }

    state.installed = true;
    return true;
  }

  function closeOwnView() {
    const view = document.getElementById(VIEW_ID);
    const tab = document.getElementById(TAB_ID);
    if (view) {
      view.classList.remove('active');
      view.style.display = 'none';
      view.setAttribute('aria-hidden', 'true');
    }
    if (tab) {
      tab.classList.remove('active');
      tab.setAttribute('aria-selected', 'false');
    }
  }

  async function checkAccess() {
    const db = client();
    if (!db) return false;
    try {
      const [{ data: canView, error: viewError }, { data: isAdmin, error: adminError }] = await Promise.all([
        db.rpc('can_view_crm_daily_brief'),
        db.rpc('crm_daily_brief_is_admin'),
      ]);
      state.allowed = !viewError && canView === true;
      state.isAdmin = !adminError && isAdmin === true;
    } catch (_) {
      state.allowed = false;
      state.isAdmin = false;
    }
    const tab = document.getElementById(TAB_ID);
    if (tab) tab.hidden = !state.allowed;
    const generate = document.getElementById('crmBriefGenerateBtn');
    if (generate) generate.hidden = !state.isAdmin;
    return state.allowed;
  }

  async function apiRequest(method = 'GET', body = null) {
    const db = client();
    if (!db) throw new Error('Supabase is not available.');
    const sessionResult = await db.auth.getSession();
    const token = sessionResult?.data?.session?.access_token;
    if (!token) throw new Error('Please sign in again.');
    const response = await fetch(`${API_URL}${method === 'GET' ? '?limit=14' : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(clean(payload?.error) || `Request failed (${response.status}).`);
    return payload;
  }

  function selectedReport() {
    return state.reports.find(row => row.id === state.selectedId) || state.reports[0] || null;
  }

  function renderHistory() {
    const host = document.getElementById('crmBriefHistory');
    if (!host) return;
    if (!state.reports.length) {
      host.innerHTML = '<div class="muted">No saved reports yet.</div>';
      return;
    }
    host.innerHTML = state.reports.map(row => `
      <button type="button" class="crm-brief-history-btn${row.id === state.selectedId ? ' is-active' : ''}" data-crm-brief-id="${esc(row.id)}">
        <strong>${esc(row.report_date === todayLocal() ? 'Today' : formatDate(row.report_date))}</strong>
        <small>${esc(formatDateTime(row.generated_at))}${Number(row.generation_count || 1) > 1 ? ` · v${Number(row.generation_count)}` : ''}</small>
      </button>`).join('');
  }

  function itemMarkup(item = {}) {
    const priority = ['high','medium','low'].includes(clean(item.priority).toLowerCase()) ? clean(item.priority).toLowerCase() : 'low';
    const entityNumber = clean(item.entity_number);
    const entityType = clean(item.entity_type);
    return `<article class="crm-brief-item crm-brief-item--${esc(priority)}">
      <div class="crm-brief-item-top"><h4>${esc(item.title || 'CRM item')}</h4><span class="crm-brief-priority">${esc(priority)}</span></div>
      ${item.detail ? `<p>${esc(item.detail)}</p>` : ''}
      ${item.recommended_action ? `<p class="crm-brief-action">Next: ${esc(item.recommended_action)}</p>` : ''}
      ${item.evidence ? `<p class="crm-brief-evidence">Evidence: ${esc(item.evidence)}</p>` : ''}
      ${(entityNumber || (entityType && entityType !== 'none')) ? `<span class="crm-brief-entity">${esc(entityNumber || entityType.replace(/_/g, ' '))}</span>` : ''}
    </article>`;
  }

  function sectionMarkup(title, icon, items) {
    const list = Array.isArray(items) ? items : [];
    return `<section class="crm-brief-section"><h3><span aria-hidden="true">${icon}</span>${esc(title)}</h3>
      <div class="crm-brief-items">${list.length ? list.map(itemMarkup).join('') : '<div class="crm-brief-none">Nothing material in this section.</div>'}</div>
    </section>`;
  }

  function renderReport() {
    const host = document.getElementById('crmBriefReport');
    const status = document.getElementById('crmBriefStatus');
    const generate = document.getElementById('crmBriefGenerateBtn');
    if (!host) return;

    const row = selectedReport();
    if (!row) {
      host.innerHTML = `<div class="crm-brief-empty"><strong>No CRM brief generated yet.</strong><span>${state.isAdmin ? 'Click Generate Today\'s Brief to create the first shared report.' : 'Admin or GM can generate the first shared report.'}</span></div>`;
      if (status) status.textContent = 'No saved report';
      if (generate) generate.textContent = "Generate Today's Brief";
      return;
    }

    const report = row.report || {};
    const isToday = row.report_date === todayLocal();
    if (status) status.textContent = isToday ? 'Today’s shared report is ready' : `Latest saved: ${formatDate(row.report_date)}`;
    if (generate) generate.textContent = isToday ? "Regenerate Today's Brief" : "Generate Today's Brief";

    const metrics = Array.isArray(report.key_metrics) ? report.key_metrics : [];
    host.innerHTML = `
      ${!isToday ? `<div class="crm-brief-banner">No report has been generated for today yet. Showing the latest saved CRM brief.</div>` : ''}
      <div class="crm-brief-report-head">
        <div><div class="crm-brief-eyebrow">Shared CRM Brief</div><h2>${esc(formatDate(row.report_date))}</h2><div class="crm-brief-report-meta">Generated ${esc(formatDateTime(row.generated_at))}${row.generated_by_name ? ` by ${esc(row.generated_by_name)}` : ''} · ${esc(row.model || 'OpenAI')}</div></div>
        ${state.isAdmin ? `<span class="crm-brief-cost">Est. AI cost $${Number(row.estimated_cost_usd || 0).toFixed(4)}</span>` : ''}
      </div>
      <div class="crm-brief-summary">${esc(report.executive_summary || 'No executive summary was returned.')}</div>
      ${metrics.length ? `<div class="crm-brief-metrics">${metrics.slice(0,6).map(m => `<article class="crm-brief-metric"><span>${esc(m.label)}</span><strong>${esc(m.value)}</strong></article>`).join('')}</div>` : ''}
      ${sectionMarkup('Immediate Attention', '🔴', report.immediate_attention)}
      ${sectionMarkup('Follow-ups', '🟠', report.follow_ups)}
      ${sectionMarkup('Opportunities', '🟢', report.opportunities)}
      ${sectionMarkup('What Happened', '📌', report.recent_activity)}
      ${sectionMarkup('Upcoming', '📅', report.upcoming)}
    `;
  }

  function renderError() {
    const box = document.getElementById('crmBriefError');
    if (!box) return;
    box.hidden = !state.error;
    box.textContent = state.error;
  }

  async function loadReports() {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    const status = document.getElementById('crmBriefStatus');
    if (status) status.textContent = 'Loading saved brief…';
    try {
      const payload = await apiRequest('GET');
      state.isAdmin = payload.is_admin === true;
      state.reports = Array.isArray(payload.reports) ? payload.reports : [];
      const today = todayLocal();
      const preferred = state.reports.find(row => row.report_date === today)?.id || state.selectedId || state.reports[0]?.id || '';
      state.selectedId = state.reports.some(row => row.id === preferred) ? preferred : (state.reports[0]?.id || '');
      const generate = document.getElementById('crmBriefGenerateBtn');
      if (generate) generate.hidden = !state.isAdmin;
      renderHistory();
      renderReport();
    } catch (error) {
      state.error = clean(error?.message) || 'Unable to load the CRM Daily Brief.';
      renderError();
      if (status) status.textContent = 'Unable to load report';
    } finally {
      state.loading = false;
    }
  }

  async function generateToday() {
    if (state.generating || !state.isAdmin) return;
    state.generating = true;
    state.error = '';
    renderError();
    const button = document.getElementById('crmBriefGenerateBtn');
    const status = document.getElementById('crmBriefStatus');
    if (button) { button.disabled = true; button.textContent = 'Generating…'; }
    if (status) status.textContent = 'AI is preparing the shared report…';
    try {
      const payload = await apiRequest('POST', { report_date: todayLocal() });
      notify(payload?.report?.generation_count > 1 ? "Today's CRM brief regenerated and saved." : "Today's CRM brief generated and saved.");
      await loadReports();
    } catch (error) {
      state.error = clean(error?.message) || 'Unable to generate the CRM Daily Brief.';
      renderError();
      if (status) status.textContent = 'Generation failed';
    } finally {
      state.generating = false;
      if (button) { button.disabled = false; button.textContent = state.reports.some(row => row.report_date === todayLocal()) ? "Regenerate Today's Brief" : "Generate Today's Brief"; }
    }
  }

  function wireView() {
    document.getElementById('crmBriefGenerateBtn')?.addEventListener('click', () => void generateToday());
    document.getElementById('crmBriefRefreshBtn')?.addEventListener('click', () => void loadReports());
    document.getElementById('crmBriefHistory')?.addEventListener('click', event => {
      const id = event.target?.closest?.('[data-crm-brief-id]')?.getAttribute('data-crm-brief-id');
      if (!id) return;
      state.selectedId = id;
      renderHistory();
      renderReport();
    });
  }

  async function openView() {
    if (!ensureShell()) return;
    const allowed = await checkAccess();
    if (!allowed) {
      notify('You do not have permission to view the CRM Daily Brief.', 'error');
      return;
    }

    const coreSetActiveView = global.__crmDailyBriefCoreSetActiveView || global.setActiveView;
    if (typeof coreSetActiveView === 'function') {
      try { coreSetActiveView('leads'); } catch (_) {}
    }

    for (const id of ['leadsView','leadIntelligenceView']) {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('active'); el.style.display = 'none'; el.setAttribute('aria-hidden', 'true'); }
    }
    for (const id of ['leadsTab','leadIntelligenceTab']) {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); }
    }

    const view = document.getElementById(VIEW_ID);
    const tab = document.getElementById(TAB_ID);
    if (view) { view.style.display = ''; view.classList.add('active'); view.setAttribute('aria-hidden', 'false'); }
    if (tab) { tab.classList.add('active'); tab.setAttribute('aria-selected', 'true'); }
    await loadReports();
  }

  function installNavigationGuard() {
    if (global.__crmDailyBriefCoreSetActiveView || typeof global.setActiveView !== 'function') return;
    global.__crmDailyBriefCoreSetActiveView = global.setActiveView.bind(global);
    global.setActiveView = function crmDailyBriefAwareSetActiveView(view, ...args) {
      if (String(view) === 'crmDailyBrief') return openView();
      closeOwnView();
      return global.__crmDailyBriefCoreSetActiveView(view, ...args);
    };
  }

  function boot() {
    let attempts = 0;
    const tryInstall = async () => {
      if (!ensureShell()) {
        if (attempts++ < 60) setTimeout(tryInstall, 250);
        return;
      }
      installNavigationGuard();
      await checkAccess();
      if (!global.__crmDailyBriefAuthListenerInstalled) {
        const db = client();
        if (db?.auth?.onAuthStateChange) {
          db.auth.onAuthStateChange(() => { setTimeout(checkAccess, 60); });
          global.__crmDailyBriefAuthListenerInstalled = true;
        }
      }
    };
    tryInstall();
  }

  document.addEventListener('click', event => {
    const tab = event.target?.closest?.('.view-tab');
    if (tab && tab.id !== TAB_ID) closeOwnView();
  }, true);

  global.addEventListener('focus', () => { if (state.installed) checkAccess(); });
  global.InCheck360CrmDailyBrief = Object.freeze({ version: VERSION, open: openView, refresh: loadReports, state });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
