(function installCrmDailyBriefExecutiveLayout(global) {
  'use strict';

  if (global.__crmDailyBriefExecutiveLayoutInstalled) return;
  global.__crmDailyBriefExecutiveLayoutInstalled = true;

  const STYLE_ID = 'crm-daily-brief-executive-layout-style';
  const RENDER_CLASS = 'crm-brief-exec-dashboard';

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function notify(message, type = '') {
    try {
      if (global.UI?.toast) return global.UI.toast(message, type || undefined);
      if (global.U?.toast) return global.U.toast(message, type || undefined);
    } catch (_) {}
    console[type === 'error' ? 'error' : 'log']('[CRM Daily Brief Executive]', message);
  }

  function state() {
    return global.InCheck360CrmDailyBrief?.state || null;
  }

  function selectedReport() {
    const current = state();
    const reports = Array.isArray(current?.reports) ? current.reports : [];
    return reports.find(row => row?.id === current?.selectedId) || reports[0] || null;
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function normalizePriority(value) {
    const priority = clean(value).toLowerCase();
    return ['high', 'medium', 'low'].includes(priority) ? priority : 'low';
  }

  function stripTerminalPunctuation(value) {
    return clean(value).replace(/[.!?]+$/g, '');
  }

  function sentence(value) {
    const text = stripTerminalPunctuation(value);
    return text ? `${text}.` : '';
  }

  function trimText(value, max = 220) {
    const text = clean(value);
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(1, max - 1)).trim()}…`;
  }

  function formatDate(value) {
    if (!value) return 'Unknown date';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    if (Number.isNaN(date.getTime())) return clean(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return clean(value);
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function localizeUtcText(value) {
    const source = String(value ?? '');
    if (!source) return '';
    return source.replace(
      /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*UTC\b/g,
      (match, datePart, hour, minute, second = '00') => {
        const date = new Date(`${datePart}T${hour}:${minute}:${second}Z`);
        if (Number.isNaN(date.getTime())) return match;
        try {
          return new Intl.DateTimeFormat(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
          }).format(date);
        } catch (_) {
          return date.toLocaleString();
        }
      }
    );
  }

  function display(value) {
    return localizeUtcText(clean(value));
  }

  function firstHighOrFirst(items) {
    const rows = list(items);
    return rows.find(row => normalizePriority(row?.priority) === 'high') || rows[0] || null;
  }

  function firstWithAction(groups) {
    for (const group of groups) {
      const item = list(group).find(row => clean(row?.recommended_action));
      if (item) return item;
    }
    return null;
  }

  function fingerprint(item = {}) {
    return [clean(item.entity_type), clean(item.entity_id), clean(item.entity_number), clean(item.title).toLowerCase()].join('|');
  }

  function buildDecisionSummary(report = {}) {
    const actNow = firstHighOrFirst(report.immediate_attention)
      || firstHighOrFirst(report.management_takeaways)
      || firstHighOrFirst(report.follow_ups);

    const actionItem = (actNow && clean(actNow.recommended_action) ? actNow : null)
      || firstWithAction([
        report.immediate_attention,
        report.follow_ups,
        report.proposal_watch,
        report.opportunities,
        report.team_execution,
        report.management_takeaways,
      ]);

    const watchNext = list(report.upcoming)[0]
      || list(report.opportunities)[0]
      || list(report.pipeline_health)[0]
      || list(report.proposal_watch)[0]
      || null;

    const parts = [];
    if (actNow?.title) parts.push(`Immediate focus: ${sentence(display(actNow.title))}`);
    if (actionItem?.recommended_action) parts.push(`Next action: ${sentence(display(actionItem.recommended_action))}`);
    if (watchNext?.title) parts.push(`Watch next: ${sentence(display(watchNext.title))}`);

    return {
      actNow,
      actionItem,
      watchNext,
      closingSentence: parts.join(' ') || 'No single exception dominates today; continue the prioritized CRM execution plan and monitor the next scheduled movement.',
      cards: [
        {
          label: 'Act now',
          title: display(actNow?.title) || 'No immediate exception highlighted',
          detail: display(actNow?.detail || actNow?.evidence) || 'No single urgent exception dominates the saved report.',
        },
        {
          label: 'Next action',
          title: display(actionItem?.recommended_action) || 'Continue the prioritized CRM follow-up plan',
          detail: actionItem?.title ? `Driven by: ${display(actionItem.title)}` : 'Use the detailed intelligence below as the execution queue.',
        },
        {
          label: 'Watch next',
          title: display(watchNext?.title) || 'Monitor the next scheduled CRM movement',
          detail: display(watchNext?.detail || watchNext?.evidence) || 'Watch upcoming activity, proposal timing and pipeline movement.',
        },
      ],
    };
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${RENDER_CLASS}{display:flex;flex-direction:column;gap:15px}
      .crm-brief-exec-cover{padding:18px;border:1px solid rgba(36,87,255,.16);border-radius:16px;background:linear-gradient(180deg,rgba(36,87,255,.055),rgba(36,87,255,.012) 42%,transparent)}
      .crm-brief-exec-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:12px}
      .crm-brief-exec-head h2{margin:3px 0 4px;font-size:1.45rem;letter-spacing:-.025em}.crm-brief-exec-meta{font-size:.73rem;opacity:.67;line-height:1.5}
      .crm-brief-exec-badges{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.crm-brief-exec-badge{padding:5px 8px;border:1px solid rgba(127,127,127,.15);border-radius:999px;font-size:.68rem;font-weight:700;background:rgba(255,255,255,.45)}
      .crm-brief-exec-source{display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;margin-bottom:12px;border:1px solid rgba(100,116,139,.12);border-radius:9px;background:rgba(100,116,139,.05);font-size:.68rem;opacity:.75}.crm-brief-exec-source span{padding:2px 6px;border-radius:999px;background:rgba(127,127,127,.07)}
      .crm-brief-exec-label{font-size:.64rem;font-weight:850;letter-spacing:.09em;text-transform:uppercase;color:#2457ff;margin-bottom:5px}
      .crm-brief-exec-summary{padding:13px 14px;border:1px solid rgba(36,87,255,.16);border-left:4px solid #2457ff;border-radius:11px;background:rgba(36,87,255,.055);font-size:.9rem;line-height:1.55}
      .crm-brief-exec-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:11px}.crm-brief-exec-metric{padding:10px 11px;border:1px solid rgba(69,92,130,.15);border-radius:10px;background:rgba(255,255,255,.48);min-height:72px}.crm-brief-exec-metric span{display:block;font-size:.65rem;opacity:.62}.crm-brief-exec-metric strong{display:block;margin:2px 0;font-size:1.08rem}.crm-brief-exec-metric small{display:block;font-size:.65rem;opacity:.62;line-height:1.3}
      .crm-brief-decision-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:11px}.crm-brief-decision{padding:10px 11px;border:1px solid rgba(69,92,130,.15);border-radius:10px;background:var(--surface,#fff)}.crm-brief-decision span{display:block;font-size:.6rem;font-weight:850;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin-bottom:3px}.crm-brief-decision strong{display:block;font-size:.8rem;line-height:1.35}.crm-brief-decision p{margin:4px 0 0;font-size:.68rem;line-height:1.38;opacity:.68}
      .crm-brief-exec-takeaways{margin-top:12px}.crm-brief-exec-takeaway-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.crm-brief-exec-takeaway{padding:10px 11px;border:1px solid rgba(69,92,130,.14);border-radius:10px;background:rgba(127,127,127,.025)}.crm-brief-exec-takeaway strong{display:block;font-size:.78rem;line-height:1.35}.crm-brief-exec-takeaway p{margin:4px 0 0;font-size:.68rem;line-height:1.38;opacity:.72}.crm-brief-exec-takeaway .next{margin-top:5px;padding-top:5px;border-top:1px dashed rgba(127,127,127,.18);font-weight:700;opacity:.9}
      .crm-brief-detail-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:3px 2px}.crm-brief-detail-heading h3{margin:0;font-size:1.05rem}.crm-brief-detail-heading p{margin:2px 0 0;font-size:.72rem;opacity:.62}
      .crm-brief-exec-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}.crm-brief-exec-detail-grid .crm-brief-section{margin:0}
      .crm-brief-final-line{padding:12px 14px;border:1px solid rgba(36,87,255,.18);border-left:4px solid #2457ff;border-radius:11px;background:rgba(36,87,255,.045)}.crm-brief-final-line strong{display:block;margin-bottom:3px;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:#2457ff}.crm-brief-final-line p{margin:0;font-size:.82rem;line-height:1.5}
      body[data-theme='dark'] .crm-brief-exec-cover,html[data-theme='dark'] .crm-brief-exec-cover{background:linear-gradient(180deg,rgba(36,87,255,.1),rgba(15,23,42,.2) 44%,rgba(15,23,42,.05))}
      body[data-theme='dark'] .crm-brief-exec-metric,body[data-theme='dark'] .crm-brief-decision,body[data-theme='dark'] .crm-brief-exec-takeaway,html[data-theme='dark'] .crm-brief-exec-metric,html[data-theme='dark'] .crm-brief-decision,html[data-theme='dark'] .crm-brief-exec-takeaway{background:rgba(15,23,42,.38)}
      @media(max-width:1120px){.crm-brief-exec-detail-grid{grid-template-columns:1fr}.crm-brief-exec-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:760px){.crm-brief-exec-head{flex-direction:column}.crm-brief-exec-badges{justify-content:flex-start}.crm-brief-decision-strip,.crm-brief-exec-takeaway-grid{grid-template-columns:1fr}.crm-brief-exec-metrics{grid-template-columns:1fr 1fr}}
      @media(max-width:480px){.crm-brief-exec-metrics{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function itemMarkup(item = {}) {
    const priority = normalizePriority(item.priority);
    const entityNumber = clean(item.entity_number);
    const entityType = clean(item.entity_type);
    return `<article class="crm-brief-item crm-brief-item--${priority}">
      <div class="crm-brief-item-top"><h4>${esc(display(item.title) || 'CRM item')}</h4><span class="crm-brief-priority crm-brief-priority--${priority}">${priority}</span></div>
      ${item.detail ? `<p class="crm-brief-detail">${esc(display(item.detail))}</p>` : ''}
      ${item.recommended_action ? `<div class="crm-brief-action"><span>Recommended action</span><strong>${esc(display(item.recommended_action))}</strong></div>` : ''}
      ${item.evidence ? `<div class="crm-brief-evidence"><span>Evidence</span><p>${esc(display(item.evidence))}</p></div>` : ''}
      ${(entityNumber || (entityType && entityType !== 'none')) ? `<span class="crm-brief-entity">${esc(entityNumber || entityType.replace(/_/g, ' '))}</span>` : ''}
    </article>`;
  }

  function sectionMarkup(title, icon, items, tone = '') {
    const rows = list(items);
    return `<section class="crm-brief-section crm-brief-section--${esc(tone || 'default')}">
      <div class="crm-brief-section-head"><h3><span class="crm-brief-section-icon" aria-hidden="true">${icon}</span>${esc(title)}</h3><span class="crm-brief-section-count">${rows.length}</span></div>
      <div class="crm-brief-items">${rows.length ? rows.map(itemMarkup).join('') : '<div class="crm-brief-none">Nothing material in this section.</div>'}</div>
    </section>`;
  }

  function topTakeawaysMarkup(report) {
    const rows = list(report.management_takeaways).slice(0, 3);
    if (!rows.length) return '';
    return `<section class="crm-brief-exec-takeaways">
      <div class="crm-brief-exec-label">Top management takeaways</div>
      <div class="crm-brief-exec-takeaway-grid">${rows.map(item => `<article class="crm-brief-exec-takeaway"><strong>${esc(display(item.title))}</strong>${item.detail ? `<p>${esc(display(item.detail))}</p>` : ''}${item.recommended_action ? `<p class="next">Next: ${esc(display(item.recommended_action))}</p>` : ''}</article>`).join('')}</div>
    </section>`;
  }

  function renderExecutiveLayout() {
    installStyle();
    const host = document.getElementById('crmBriefReport');
    const row = selectedReport();
    if (!host || !row?.report || !host.isConnected) return false;

    const key = `${row.id || ''}:${row.generation_count || 0}:${row.generated_at || ''}`;
    if (host.querySelector(`.${RENDER_CLASS}`)?.dataset?.reportKey === key) return true;

    const report = row.report || {};
    const decision = buildDecisionSummary(report);
    const actFingerprint = decision.actNow ? fingerprint(decision.actNow) : '';
    const immediateDetail = list(report.immediate_attention).filter(item => !actFingerprint || fingerprint(item) !== actFingerprint);
    const metrics = list(report.key_metrics).slice(0, 6);
    const current = state();
    const cost = current?.isAdmin === true ? `<span class="crm-brief-exec-badge">Est. AI cost $${Number(row.estimated_cost_usd || 0).toFixed(4)}</span>` : '';

    const details = [
      ['Pipeline Health', '📊', report.pipeline_health, 'pipeline'],
      ['Immediate Attention', '🔴', immediateDetail, 'attention'],
      ['Follow-ups', '🟠', report.follow_ups, 'followups'],
      ['Opportunities', '🟢', report.opportunities, 'opportunities'],
      ['Proposal Watch', '📄', report.proposal_watch, 'proposals'],
      ['Team Execution', '👥', report.team_execution, 'team'],
      ['Data Quality', '🧹', report.data_quality, 'quality'],
      ['What Changed', '📌', report.recent_activity, 'activity'],
      ['Upcoming 7 Days', '📅', report.upcoming, 'upcoming'],
    ];

    host.innerHTML = `<div class="${RENDER_CLASS}" data-report-key="${esc(key)}">
      <section class="crm-brief-exec-cover">
        <div class="crm-brief-exec-head">
          <div><div class="crm-brief-eyebrow">Executive CRM Dashboard</div><h2>${esc(formatDate(row.report_date))}</h2><div class="crm-brief-exec-meta">Generated ${esc(formatDateTime(row.generated_at))}${row.generated_by_name ? ` by ${esc(row.generated_by_name)}` : ''} · ${esc(row.model || 'OpenAI')}</div></div>
          <div class="crm-brief-exec-badges"><span class="crm-brief-exec-badge">Shared daily report</span>${cost}</div>
        </div>
        <div class="crm-brief-exec-source"><strong>Source policy</strong><span>Structured ERP data only</span><span>Salesperson notes excluded</span><span>Private/chat history excluded</span></div>
        <div class="crm-brief-exec-label">Executive summary</div>
        <div class="crm-brief-exec-summary">${esc(display(report.executive_summary) || 'No executive summary was returned.')}</div>
        ${metrics.length ? `<div class="crm-brief-exec-metrics">${metrics.map(metric => `<article class="crm-brief-exec-metric"><span>${esc(display(metric.label))}</span><strong>${esc(display(metric.value))}</strong>${metric.context ? `<small>${esc(display(metric.context))}</small>` : ''}</article>`).join('')}</div>` : ''}
        <div class="crm-brief-decision-strip">${decision.cards.map(card => `<article class="crm-brief-decision"><span>${esc(card.label)}</span><strong>${esc(trimText(card.title, 145))}</strong><p>${esc(trimText(card.detail, 185))}</p></article>`).join('')}</div>
        ${topTakeawaysMarkup(report)}
      </section>

      <div class="crm-brief-detail-heading"><div><h3>Detailed Intelligence</h3><p>Evidence and execution detail behind the executive dashboard.</p></div></div>
      <div class="crm-brief-exec-detail-grid">${details.map(([title, icon, items, tone]) => sectionMarkup(title, icon, items, tone)).join('')}</div>
      <section class="crm-brief-final-line"><strong>Management summary</strong><p>${esc(decision.closingSentence)}</p></section>
    </div>`;
    return true;
  }

  function pdfItemMarkup(item = {}) {
    const priority = normalizePriority(item.priority);
    const entityNumber = clean(item.entity_number);
    const entityType = clean(item.entity_type);
    const entity = entityNumber || (entityType && entityType !== 'none' ? entityType.replace(/_/g, ' ') : '');
    return `<article class="pdf-item pdf-item-${priority}"><div class="pdf-item-head"><strong>${esc(display(item.title) || 'CRM item')}</strong><span>${priority.toUpperCase()}</span></div>${item.detail ? `<p>${esc(display(item.detail))}</p>` : ''}${item.recommended_action ? `<div class="pdf-next"><b>Next:</b> ${esc(display(item.recommended_action))}</div>` : ''}${item.evidence ? `<div class="pdf-evidence"><b>Evidence:</b> ${esc(display(item.evidence))}</div>` : ''}${entity ? `<div class="pdf-entity">${esc(entity)}</div>` : ''}</article>`;
  }

  function pdfSection(title, items) {
    const rows = list(items);
    return `<section class="pdf-section"><div class="pdf-section-head"><h2>${esc(title)}</h2><span>${rows.length}</span></div>${rows.length ? rows.map(pdfItemMarkup).join('') : '<p class="pdf-empty">Nothing material in this section.</p>'}</section>`;
  }

  function pdfDetailPage(pageNumber, title, sections, closing = '') {
    return `<section class="pdf-page pdf-detail-page"><div class="pdf-page-kicker">Detailed Intelligence · Page ${pageNumber}</div><h1>${esc(title)}</h1>${sections.map(([name, items]) => pdfSection(name, items)).join('')}${closing ? `<div class="pdf-closing"><b>Management summary</b><p>${esc(closing)}</p></div>` : ''}</section>`;
  }

  function buildPrintDocument() {
    const row = selectedReport();
    if (!row?.report) return '';
    const report = row.report || {};
    const decision = buildDecisionSummary(report);
    const actFingerprint = decision.actNow ? fingerprint(decision.actNow) : '';
    const immediateDetail = list(report.immediate_attention).filter(item => !actFingerprint || fingerprint(item) !== actFingerprint);
    const metrics = list(report.key_metrics).slice(0, 6);
    const topTakeaways = list(report.management_takeaways).slice(0, 3);
    const current = state();
    const cost = current?.isAdmin === true ? `<span>Est. AI cost $${Number(row.estimated_cost_usd || 0).toFixed(4)}</span>` : '';
    const date = clean(row.report_date || 'report');

    const page1 = `<section class="pdf-page pdf-executive-page">
      <div class="pdf-head"><div><div class="pdf-brand">Monitor Core · Internal Management Report</div><h1>AI CRM Daily Brief</h1><div class="pdf-date">${esc(formatDate(row.report_date))}</div><div class="pdf-meta">Generated ${esc(formatDateTime(row.generated_at))}${row.generated_by_name ? ` by ${esc(row.generated_by_name)}` : ''} · ${esc(row.model || 'OpenAI')}</div></div><div class="pdf-badges"><span>Shared daily report</span>${cost}</div></div>
      <div class="pdf-policy">Structured ERP data only · Salesperson notes excluded · Private/chat history excluded</div>
      <div class="pdf-label">Executive summary</div><div class="pdf-summary">${esc(display(report.executive_summary) || 'No executive summary was returned.')}</div>
      ${metrics.length ? `<div class="pdf-metrics">${metrics.map(metric => `<article><span>${esc(display(metric.label))}</span><strong>${esc(display(metric.value))}</strong>${metric.context ? `<small>${esc(display(metric.context))}</small>` : ''}</article>`).join('')}</div>` : ''}
      <div class="pdf-label">Decision strip</div><div class="pdf-decisions">${decision.cards.map(card => `<article><span>${esc(card.label)}</span><strong>${esc(trimText(card.title, 120))}</strong><p>${esc(trimText(card.detail, 150))}</p></article>`).join('')}</div>
      ${topTakeaways.length ? `<div class="pdf-label">Top 3 management takeaways</div><div class="pdf-takeaways">${topTakeaways.map(item => `<article><strong>${esc(display(item.title))}</strong>${item.detail ? `<p>${esc(trimText(display(item.detail), 170))}</p>` : ''}${item.recommended_action ? `<div><b>Next:</b> ${esc(trimText(display(item.recommended_action), 150))}</div>` : ''}</article>`).join('')}</div>` : ''}
      <div class="pdf-bottom-line"><b>Bottom line</b><p>${esc(decision.closingSentence)}</p></div>
    </section>`;

    const page2 = pdfDetailPage(2, 'Pipeline & Immediate Execution', [
      ['Pipeline Health', report.pipeline_health],
      ['Immediate Attention', immediateDetail],
      ['Follow-ups', report.follow_ups],
    ]);
    const page3 = pdfDetailPage(3, 'Commercial Progress & Team Execution', [
      ['Opportunities', report.opportunities],
      ['Proposal Watch', report.proposal_watch],
      ['Team Execution', report.team_execution],
    ]);
    const page4 = pdfDetailPage(4, 'Data Quality, Changes & Upcoming', [
      ['Data Quality', report.data_quality],
      ['What Changed', report.recent_activity],
      ['Upcoming 7 Days', report.upcoming],
    ], decision.closingSentence);

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRM-Daily-Brief-${esc(date)}</title><style>
      @page{size:A4;margin:0}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;background:#fff;color:#172033;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .pdf-page{width:210mm;min-height:297mm;padding:10mm 11mm 9mm;margin:0 auto;background:#fff;page-break-after:always;break-after:page;overflow:hidden}.pdf-page:last-child{page-break-after:auto;break-after:auto}
      .pdf-brand,.pdf-page-kicker,.pdf-label{font-size:7px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#335eea}.pdf-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.pdf-head h1{margin:3px 0 2px;font-size:22px;color:#10213d}.pdf-date{font-size:12px;font-weight:700}.pdf-meta{font-size:7.4px;color:#64748b;margin-top:3px}.pdf-badges{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.pdf-badges span{font-size:6.8px;padding:3px 6px;border:1px solid #dbe4f0;border-radius:999px}.pdf-policy{margin:7px 0;padding:6px 8px;border:1px solid #e5eaf1;border-radius:7px;background:#f8fafc;color:#64748b;font-size:7px}.pdf-label{margin:7px 0 4px}.pdf-summary{padding:8px 9px;border:1px solid #cfdcff;border-left:3px solid #335eea;border-radius:7px;background:#f7f9ff;font-size:9px;line-height:1.42}.pdf-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:6px}.pdf-metrics article{padding:6px 7px;border:1px solid #dbe4f0;border-radius:7px;min-height:43px}.pdf-metrics span{display:block;font-size:6.2px;color:#64748b}.pdf-metrics strong{display:block;font-size:11px;margin:1px 0}.pdf-metrics small{display:block;font-size:6px;color:#718096;line-height:1.25}.pdf-decisions{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.pdf-decisions article{padding:7px;border:1px solid #dbe4f0;border-radius:7px;background:#fafbfc}.pdf-decisions span{display:block;font-size:5.8px;font-weight:800;text-transform:uppercase;color:#64748b}.pdf-decisions strong{display:block;font-size:7.8px;line-height:1.25;margin-top:2px}.pdf-decisions p{font-size:6.4px;line-height:1.25;color:#64748b;margin:3px 0 0}.pdf-takeaways{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.pdf-takeaways article{padding:7px;border:1px solid #dbe4f0;border-radius:7px}.pdf-takeaways strong{font-size:7.7px;line-height:1.25}.pdf-takeaways p,.pdf-takeaways div{font-size:6.3px;line-height:1.25;margin:3px 0 0;color:#475569}.pdf-bottom-line,.pdf-closing{margin-top:7px;padding:7px 8px;border:1px solid #cfdcff;border-left:3px solid #335eea;border-radius:7px;background:#f7f9ff}.pdf-bottom-line b,.pdf-closing b{font-size:7px;text-transform:uppercase;letter-spacing:.06em;color:#335eea}.pdf-bottom-line p,.pdf-closing p{font-size:7px;line-height:1.3;margin:2px 0 0}
      .pdf-page-kicker{margin-bottom:2px}.pdf-detail-page>h1{font-size:16px;margin:0 0 6px;color:#10213d}.pdf-section{margin:6px 0}.pdf-section-head{display:flex;justify-content:space-between;align-items:center;padding-bottom:3px;margin-bottom:4px;border-bottom:1.5px solid #e7edf5}.pdf-section-head h2{font-size:10px;margin:0}.pdf-section-head span{font-size:6px;padding:1px 5px;border:1px solid #dbe4f0;border-radius:999px}.pdf-item{padding:5px 6px;margin:3px 0;border:1px solid #dbe4f0;border-left:3px solid #94a3b8;border-radius:6px;break-inside:avoid;page-break-inside:avoid}.pdf-item-high{border-left-color:#c62828}.pdf-item-medium{border-left-color:#b86b00}.pdf-item-low{border-left-color:#1d7a46}.pdf-item-head{display:flex;justify-content:space-between;gap:6px}.pdf-item-head strong{font-size:7.7px;line-height:1.2}.pdf-item-head span{font-size:5.5px;font-weight:800;color:#64748b}.pdf-item p{font-size:6.5px;line-height:1.23;margin:2px 0;color:#334155}.pdf-next{font-size:6.2px;line-height:1.23;padding:3px 4px;margin-top:2px;background:#f6f8fb;border-radius:4px}.pdf-evidence{font-size:5.9px;line-height:1.2;color:#64748b;margin-top:2px}.pdf-entity{display:inline-block;margin-top:2px;padding:1px 4px;background:#eef2f7;border-radius:999px;font-size:5.6px}.pdf-empty{font-size:6.5px;color:#94a3b8;font-style:italic}
      @media print{html,body{width:210mm}.pdf-page{margin:0}}
    </style></head><body>${page1}${page2}${page3}${page4}</body></html>`;
  }

  function exportPdf() {
    const html = buildPrintDocument();
    const row = selectedReport();
    if (!html || !row) {
      notify('No saved CRM brief is available to export.', 'error');
      return;
    }

    const printWindow = global.open('', '_blank', 'width=1024,height=900');
    if (printWindow?.document) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      try {
        printWindow.history.replaceState({}, '', `/crm-daily-brief/${encodeURIComponent(row.report_date || 'report')}`);
      } catch (_) {}
      setTimeout(() => {
        try { printWindow.focus(); printWindow.print(); }
        catch (error) { console.error('[CRM Daily Brief Executive] PDF print failed', error); }
      }, 350);
      notify('PDF export opened. Choose Save as PDF in the print dialog.');
      return;
    }

    try {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(frame);
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (!doc || !frame.contentWindow) throw new Error('Print frame unavailable');
      doc.open(); doc.write(html); doc.close();
      setTimeout(() => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); }
        finally { setTimeout(() => frame.remove(), 1500); }
      }, 400);
    } catch (error) {
      console.error('[CRM Daily Brief Executive] PDF fallback failed', error);
      notify('Unable to open the PDF export. Please allow pop-ups and try again.', 'error');
    }
  }

  function scheduleRender(delays = [150, 500, 1100, 2000]) {
    for (const delay of delays) setTimeout(renderExecutiveLayout, delay);
  }

  document.addEventListener('click', event => {
    const exportButton = event.target?.closest?.('#crmBriefExportBtn');
    if (exportButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      exportPdf();
      return;
    }

    const target = event.target?.closest?.('#crmDailyBriefTab,#crmBriefRefreshBtn,#crmBriefGenerateBtn,#crmBriefHistory [data-crm-brief-id]');
    if (!target) return;
    if (target.id === 'crmBriefGenerateBtn') scheduleRender([250, 900, 2200, 5500, 15500, 30500, 50500]);
    else scheduleRender();
  }, true);

  global.addEventListener('focus', () => scheduleRender([120, 500]));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRender([120, 500]);
  });

  installStyle();
  scheduleRender([150, 650, 1400, 2700]);
})(window);