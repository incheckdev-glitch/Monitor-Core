(function installCrmDailyBrief(global) {
  'use strict';

  if (global.InCheck360CrmDailyBrief) return;

  const VERSION = '20260911-crm-daily-brief3';
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
          <div class="crm-brief-hero-copy">
            <div class="crm-brief-eyebrow">CRM · Shared Management Intelligence</div>
            <h1>AI CRM Daily Brief</h1>
            <p>One richer daily report shared with the CRM team, generated from structured ERP facts only.</p>
            <p class="crm-brief-source-note">Salesperson notes, free-text notes, private chats and ChatGPT history are excluded from the AI source.</p>
          </div>
          <div class="crm-brief-hero-actions">
            <span id="crmBriefStatus" class="crm-brief-status">Loading saved brief…</span>
            <button id="crmBriefGenerateBtn" class="btn primary" type="button" hidden>Generate Today's Brief</button>
            <button id="crmBriefExportBtn" class="btn ghost crm-brief-export-btn" type="button" hidden>Export PDF</button>
            <button id="crmBriefRefreshBtn" class="btn ghost" type="button">Refresh</button>
          </div>
        </section>
        <div id="crmBriefError" class="crm-brief-error" hidden></div>
        <section class="crm-brief-layout">
          <aside class="crm-brief-history">
            <div class="crm-brief-history-head">
              <div>
                <span class="crm-brief-history-kicker">Archive</span>
                <h2>Previous Reports</h2>
              </div>
            </div>
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
        <span class="crm-brief-history-date">${esc(row.report_date === todayLocal() ? 'Today' : formatDate(row.report_date))}</span>
        <small>${esc(formatDateTime(row.generated_at))}${Number(row.generation_count || 1) > 1 ? ` · v${Number(row.generation_count)}` : ''}</small>
      </button>`).join('');
  }

  function itemMarkup(item = {}) {
    const priority = ['high','medium','low'].includes(clean(item.priority).toLowerCase()) ? clean(item.priority).toLowerCase() : 'low';
    const entityNumber = clean(item.entity_number);
    const entityType = clean(item.entity_type);
    return `<article class="crm-brief-item crm-brief-item--${esc(priority)}">
      <div class="crm-brief-item-top">
        <h4>${esc(item.title || 'CRM item')}</h4>
        <span class="crm-brief-priority crm-brief-priority--${esc(priority)}">${esc(priority)}</span>
      </div>
      ${item.detail ? `<p class="crm-brief-detail">${esc(item.detail)}</p>` : ''}
      ${item.recommended_action ? `<div class="crm-brief-action"><span>Recommended action</span><strong>${esc(item.recommended_action)}</strong></div>` : ''}
      ${item.evidence ? `<div class="crm-brief-evidence"><span>Evidence</span><p>${esc(item.evidence)}</p></div>` : ''}
      ${(entityNumber || (entityType && entityType !== 'none')) ? `<span class="crm-brief-entity">${esc(entityNumber || entityType.replace(/_/g, ' '))}</span>` : ''}
    </article>`;
  }

  function sectionMarkup(title, icon, items, tone = '') {
    const list = Array.isArray(items) ? items : [];
    return `<section class="crm-brief-section crm-brief-section--${esc(tone || 'default')}">
      <div class="crm-brief-section-head">
        <h3><span class="crm-brief-section-icon" aria-hidden="true">${icon}</span>${esc(title)}</h3>
        <span class="crm-brief-section-count">${list.length}</span>
      </div>
      <div class="crm-brief-items">${list.length ? list.map(itemMarkup).join('') : '<div class="crm-brief-none">Nothing material in this section.</div>'}</div>
    </section>`;
  }

  function renderReport() {
    const host = document.getElementById('crmBriefReport');
    const status = document.getElementById('crmBriefStatus');
    const generate = document.getElementById('crmBriefGenerateBtn');
    const exportBtn = document.getElementById('crmBriefExportBtn');
    if (!host) return;

    const row = selectedReport();
    if (!row) {
      host.innerHTML = `<div class="crm-brief-empty"><strong>No CRM brief generated yet.</strong><span>${state.isAdmin ? "Click Generate Today's Brief to create the first shared report." : 'Admin or GM can generate the first shared report.'}</span></div>`;
      if (status) status.textContent = 'No saved report';
      if (generate) generate.textContent = "Generate Today's Brief";
      if (exportBtn) exportBtn.hidden = true;
      return;
    }

    const report = row.report || {};
    const isToday = row.report_date === todayLocal();
    if (status) status.textContent = isToday ? 'Today’s shared report is ready' : `Viewing ${formatDate(row.report_date)}`;
    if (generate) generate.textContent = isToday ? "Regenerate Today's Brief" : "Generate Today's Brief";
    if (exportBtn) exportBtn.hidden = false;

    const metrics = Array.isArray(report.key_metrics) ? report.key_metrics : [];
    host.innerHTML = `
      ${!isToday ? `<div class="crm-brief-banner crm-brief-banner--notice">No report has been generated for today yet. Showing a previous saved CRM brief.</div>` : ''}
      <div class="crm-brief-report-cover">
        <div class="crm-brief-report-head">
          <div>
            <div class="crm-brief-eyebrow">Structured CRM Intelligence</div>
            <h2>${esc(formatDate(row.report_date))}</h2>
            <div class="crm-brief-report-meta">Generated ${esc(formatDateTime(row.generated_at))}${row.generated_by_name ? ` by ${esc(row.generated_by_name)}` : ''} · ${esc(row.model || 'OpenAI')}</div>
          </div>
          <div class="crm-brief-report-badges">
            <span class="crm-brief-shared-badge">Shared daily report</span>
            ${state.isAdmin ? `<span class="crm-brief-cost">Est. AI cost $${Number(row.estimated_cost_usd || 0).toFixed(4)}</span>` : ''}
          </div>
        </div>
        <div class="crm-brief-source-strip">
          <strong>Source policy</strong>
          <span>Structured ERP data only</span>
          <span>Salesperson notes excluded</span>
          <span>Private/chat history excluded</span>
        </div>
        <section class="crm-brief-executive">
          <div class="crm-brief-executive-label">Executive summary</div>
          <div class="crm-brief-summary">${esc(report.executive_summary || 'No executive summary was returned.')}</div>
        </section>
        ${metrics.length ? `<div class="crm-brief-metrics">${metrics.slice(0,8).map(m => `<article class="crm-brief-metric"><span>${esc(m.label)}</span><strong>${esc(m.value)}</strong>${m.context ? `<small>${esc(m.context)}</small>` : ''}</article>`).join('')}</div>` : ''}
      </div>

      <div class="crm-brief-section-grid crm-brief-section-grid--lead">
        ${sectionMarkup('Management Takeaways', '🎯', report.management_takeaways, 'takeaways')}
        ${sectionMarkup('Pipeline Health', '📊', report.pipeline_health, 'pipeline')}
      </div>

      <div class="crm-brief-section-grid">
        ${sectionMarkup('Immediate Attention', '🔴', report.immediate_attention, 'attention')}
        ${sectionMarkup('Follow-ups', '🟠', report.follow_ups, 'followups')}
        ${sectionMarkup('Opportunities', '🟢', report.opportunities, 'opportunities')}
        ${sectionMarkup('Proposal Watch', '📄', report.proposal_watch, 'proposals')}
        ${sectionMarkup('Team Execution', '👥', report.team_execution, 'team')}
        ${sectionMarkup('Data Quality', '🧹', report.data_quality, 'quality')}
        ${sectionMarkup('What Changed', '📌', report.recent_activity, 'activity')}
        ${sectionMarkup('Upcoming 7 Days', '📅', report.upcoming, 'upcoming')}
      </div>
    `;
  }

  function pdfItemMarkup(item = {}) {
    const priority = ['high','medium','low'].includes(clean(item.priority).toLowerCase()) ? clean(item.priority).toLowerCase() : 'low';
    const entityNumber = clean(item.entity_number);
    const entityType = clean(item.entity_type);
    const entity = entityNumber || (entityType && entityType !== 'none' ? entityType.replace(/_/g, ' ') : '');
    return `<div class="pdf-item pdf-item-${esc(priority)}">
      <div class="pdf-item-head">
        <strong>${esc(item.title || 'CRM item')}</strong>
        <span class="pdf-priority">${esc(priority.toUpperCase())}</span>
      </div>
      ${item.detail ? `<p>${esc(item.detail)}</p>` : ''}
      ${item.recommended_action ? `<div class="pdf-callout"><b>Recommended action:</b> ${esc(item.recommended_action)}</div>` : ''}
      ${item.evidence ? `<div class="pdf-evidence"><b>Evidence:</b> ${esc(item.evidence)}</div>` : ''}
      ${entity ? `<div class="pdf-entity">${esc(entity)}</div>` : ''}
    </div>`;
  }

  function pdfSection(title, items) {
    const list = Array.isArray(items) ? items : [];
    return `<section class="pdf-section">
      <div class="pdf-section-title"><h2>${esc(title)}</h2><span>${list.length}</span></div>
      ${list.length ? list.map(pdfItemMarkup).join('') : '<div class="pdf-empty">Nothing material in this section.</div>'}
    </section>`;
  }

  function buildPdfDocument(row) {
    const report = row?.report || {};
    const metrics = Array.isArray(report.key_metrics) ? report.key_metrics.slice(0, 8) : [];
    const titleDate = formatDate(row?.report_date);
    const generated = formatDateTime(row?.generated_at);
    const generatedBy = row?.generated_by_name ? ` by ${esc(row.generated_by_name)}` : '';
    const cost = state.isAdmin ? `<span>Estimated AI cost: $${Number(row?.estimated_cost_usd || 0).toFixed(4)}</span>` : '';
    const sections = [
      ['Management Takeaways', report.management_takeaways],
      ['Pipeline Health', report.pipeline_health],
      ['Immediate Attention', report.immediate_attention],
      ['Follow-ups', report.follow_ups],
      ['Opportunities', report.opportunities],
      ['Proposal Watch', report.proposal_watch],
      ['Team Execution', report.team_execution],
      ['Data Quality', report.data_quality],
      ['What Changed', report.recent_activity],
      ['Upcoming 7 Days', report.upcoming],
    ];

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CRM-Daily-Brief-${esc(row?.report_date || todayLocal())}</title>
<style>
  @page{size:A4;margin:12mm 11mm 14mm}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#172033;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-size:10.5px;line-height:1.45}
  .pdf-wrap{max-width:188mm;margin:0 auto}
  .pdf-header{border:1px solid #dbe4f0;border-radius:12px;padding:14px 16px;background:#f7f9fc;margin-bottom:10px}
  .pdf-brand{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#335eea;font-weight:700}
  h1{font-size:23px;line-height:1.1;margin:4px 0 4px;color:#10213d}
  .pdf-date{font-size:12px;font-weight:700;color:#334155}
  .pdf-meta{margin-top:5px;color:#64748b;font-size:8.5px}
  .pdf-meta span{margin-right:12px}
  .pdf-policy{margin-top:9px;padding-top:8px;border-top:1px solid #dbe4f0;color:#64748b;font-size:8.4px}
  .pdf-summary{margin:10px 0;padding:12px 14px;border:1px solid #cfdcff;border-left:4px solid #335eea;border-radius:10px;background:#f6f8ff}
  .pdf-summary-label{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#335eea;font-weight:700;margin-bottom:4px}
  .pdf-summary p{margin:0;font-size:11px;line-height:1.5}
  .pdf-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0 12px}
  .pdf-metric{border:1px solid #dbe4f0;border-radius:9px;padding:8px;min-height:50px;break-inside:avoid}
  .pdf-metric span{display:block;color:#64748b;font-size:7.5px;text-transform:uppercase;letter-spacing:.04em}
  .pdf-metric strong{display:block;font-size:15px;color:#10213d;margin:2px 0}
  .pdf-metric small{display:block;font-size:7.5px;color:#718096;line-height:1.3}
  .pdf-section{margin:11px 0;break-inside:auto}
  .pdf-section-title{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e7edf5;padding-bottom:4px;margin-bottom:6px}
  .pdf-section-title h2{font-size:12px;margin:0;color:#10213d}
  .pdf-section-title span{font-size:8px;font-weight:700;color:#64748b;border:1px solid #dbe4f0;border-radius:999px;padding:1px 6px}
  .pdf-item{border:1px solid #dbe4f0;border-left:3px solid #94a3b8;border-radius:8px;padding:7px 9px;margin:5px 0;break-inside:avoid;page-break-inside:avoid}
  .pdf-item-high{border-left-color:#c62828}.pdf-item-medium{border-left-color:#b86b00}.pdf-item-low{border-left-color:#1d7a46}
  .pdf-item-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
  .pdf-item-head strong{font-size:9.5px;color:#172033}
  .pdf-priority{font-size:6.7px;font-weight:700;letter-spacing:.05em;color:#64748b;white-space:nowrap}
  .pdf-item p{margin:3px 0;color:#334155}
  .pdf-callout{margin-top:5px;padding:5px 7px;background:#f6f8fb;border-radius:6px;color:#24354d}
  .pdf-evidence{margin-top:4px;color:#64748b;font-size:8px}
  .pdf-entity{display:inline-block;margin-top:5px;padding:2px 6px;background:#eef2f7;border-radius:999px;color:#475569;font-size:7.5px;font-weight:700}
  .pdf-empty{color:#94a3b8;font-style:italic;padding:4px 0}
  .pdf-footer{margin-top:14px;padding-top:7px;border-top:1px solid #dbe4f0;color:#8793a5;font-size:7.5px;text-align:center}
  @media print{.pdf-wrap{max-width:none}.pdf-section{orphans:2;widows:2}}
</style>
</head>
<body>
<div class="pdf-wrap">
  <header class="pdf-header">
    <div class="pdf-brand">Monitor Core - Internal Management Report</div>
    <h1>AI CRM Daily Brief</h1>
    <div class="pdf-date">${esc(titleDate)}</div>
    <div class="pdf-meta">
      <span>Generated ${esc(generated)}${generatedBy}</span>
      <span>Model: ${esc(row?.model || 'OpenAI')}</span>
      ${cost}
    </div>
    <div class="pdf-policy">Source policy: structured ERP facts only. Salesperson notes, free-text notes, private chats and ChatGPT history are excluded.</div>
  </header>

  <section class="pdf-summary">
    <div class="pdf-summary-label">Executive summary</div>
    <p>${esc(report.executive_summary || 'No executive summary was returned.')}</p>
  </section>

  ${metrics.length ? `<div class="pdf-metrics">${metrics.map(metric => `<div class="pdf-metric"><span>${esc(metric.label)}</span><strong>${esc(metric.value)}</strong>${metric.context ? `<small>${esc(metric.context)}</small>` : ''}</div>`).join('')}</div>` : ''}

  ${sections.map(([title, items]) => pdfSection(title, items)).join('')}

  <footer class="pdf-footer">Shared CRM Daily Brief - generated from the saved ERP report. Exporting does not trigger a new AI generation.</footer>
</div>
</body>
</html>`;
  }

  function printPdfDocument(html) {
    const printWindow = global.open('', '_blank', 'width=1024,height=900');
    if (printWindow && printWindow.document) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      const printNow = () => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (error) {
          console.error('[CRM Daily Brief] PDF print failed', error);
        }
      };
      setTimeout(printNow, 300);
      return true;
    }

    try {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.position = 'fixed';
      frame.style.right = '0';
      frame.style.bottom = '0';
      frame.style.width = '1px';
      frame.style.height = '1px';
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      document.body.appendChild(frame);
      const frameDoc = frame.contentDocument || frame.contentWindow?.document;
      if (!frameDoc || !frame.contentWindow) throw new Error('Print frame unavailable');
      frameDoc.open();
      frameDoc.write(html);
      frameDoc.close();
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
          notify('Print dialog opened. Choose Save as PDF to export the report.');
        } finally {
          setTimeout(() => frame.remove(), 1500);
        }
      }, 350);
      return true;
    } catch (error) {
      console.error('[CRM Daily Brief] PDF export fallback failed', error);
      return false;
    }
  }

  function exportSelectedPdf() {
    const row = selectedReport();
    if (!row) {
      notify('No saved CRM brief is available to export.', 'error');
      return;
    }
    const ok = printPdfDocument(buildPdfDocument(row));
    if (ok) notify('PDF export opened. Choose Save as PDF in the print dialog.');
    else notify('Unable to open the PDF export. Please allow pop-ups and try again.', 'error');
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
    if (button) { button.disabled = true; button.textContent = 'Generating richer brief…'; }
    if (status) status.textContent = 'AI is analyzing structured CRM signals…';
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
    document.getElementById('crmBriefExportBtn')?.addEventListener('click', exportSelectedPdf);
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
  global.InCheck360CrmDailyBrief = Object.freeze({
    version: VERSION,
    open: openView,
    refresh: loadReports,
    exportPdf: exportSelectedPdf,
    state,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
