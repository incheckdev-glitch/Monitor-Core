(function installCrmDailyBriefClosingSummary(global) {
  'use strict';

  if (global.__crmDailyBriefClosingSummaryInstalled) return;
  global.__crmDailyBriefClosingSummaryInstalled = true;

  const STYLE_ID = 'crm-daily-brief-closing-summary-style';
  const SUMMARY_ID = 'crmBriefClosingSummary';

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
    console[type === 'error' ? 'error' : 'log']('[CRM Daily Brief Summary]', message);
  }

  function apiState() {
    return global.InCheck360CrmDailyBrief?.state || null;
  }

  function selectedReport() {
    const state = apiState();
    const reports = Array.isArray(state?.reports) ? state.reports : [];
    if (!reports.length) return null;
    return reports.find(row => row?.id === state?.selectedId) || reports[0] || null;
  }

  function array(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function firstWithAction(groups) {
    for (const group of groups) {
      const item = array(group).find(row => clean(row?.recommended_action));
      if (item) return item;
    }
    return null;
  }

  function firstHighOrFirst(group) {
    const rows = array(group);
    return rows.find(row => clean(row?.priority).toLowerCase() === 'high') || rows[0] || null;
  }

  function trimSentence(value, max = 210) {
    const text = clean(value);
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(1, max - 1)).trim()}…`;
  }

  function buildClosingSummary(report = {}) {
    const actNow = firstHighOrFirst(report.immediate_attention)
      || firstHighOrFirst(report.management_takeaways)
      || firstHighOrFirst(report.follow_ups);

    const actionItem = firstWithAction([
      report.immediate_attention,
      report.follow_ups,
      report.proposal_watch,
      report.opportunities,
      report.team_execution,
      report.management_takeaways,
    ]);

    const watchNext = array(report.upcoming)[0]
      || array(report.opportunities)[0]
      || array(report.pipeline_health)[0]
      || array(report.proposal_watch)[0]
      || null;

    const actTitle = clean(actNow?.title) || 'No immediate exception highlighted';
    const actDetail = trimSentence(actNow?.detail || actNow?.evidence || 'The saved brief does not identify a single urgent exception that dominates today.');

    const nextTitle = clean(actionItem?.recommended_action) || 'Continue the scheduled CRM follow-up plan';
    const nextDetail = trimSentence(actionItem?.title ? `Driven by: ${actionItem.title}` : 'Use the priorities and follow-up sections above as the execution queue.');

    const watchTitle = clean(watchNext?.title) || 'Monitor the next scheduled CRM movement';
    const watchDetail = trimSentence(watchNext?.detail || watchNext?.evidence || 'Watch upcoming activity, proposal timing and pipeline movement in the next review.');

    const sentenceParts = [];
    if (actNow?.title) sentenceParts.push(`Immediate focus: ${clean(actNow.title)}.`);
    if (actionItem?.recommended_action) sentenceParts.push(`Next action: ${clean(actionItem.recommended_action)}.`);
    if (watchNext?.title) sentenceParts.push(`Watch next: ${clean(watchNext.title)}.`);

    return {
      sentence: sentenceParts.join(' ') || 'No single exception dominates this saved brief; management should continue executing the prioritized follow-ups and monitor the next scheduled CRM movement.',
      cards: [
        { label: 'Act now', title: actTitle, detail: actDetail },
        { label: 'Next action', title: nextTitle, detail: nextDetail },
        { label: 'Watch next', title: watchTitle, detail: watchDetail },
      ],
    };
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .crm-brief-final-summary{position:relative;overflow:hidden;margin-top:16px;padding:18px;border:1px solid rgba(36,87,255,.2);border-radius:16px;background:linear-gradient(135deg,rgba(36,87,255,.085),rgba(14,165,233,.035) 52%,rgba(22,163,74,.035));box-shadow:0 8px 24px rgba(15,23,42,.035)}
      .crm-brief-final-summary:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#2457ff,#0ea5e9)}
      .crm-brief-final-kicker{font-size:.64rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase;color:#2457ff;margin-bottom:3px}
      .crm-brief-final-summary h3{margin:0 0 7px;font-size:1.05rem;letter-spacing:-.01em}
      .crm-brief-final-sentence{margin:0 0 13px;font-size:.86rem;line-height:1.55;color:inherit}
      .crm-brief-final-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
      .crm-brief-final-card{padding:11px 12px;border:1px solid rgba(69,92,130,.15);border-radius:11px;background:rgba(255,255,255,.5);min-width:0}
      .crm-brief-final-card span{display:block;margin-bottom:4px;font-size:.61rem;font-weight:850;letter-spacing:.07em;text-transform:uppercase;color:#64748b}
      .crm-brief-final-card strong{display:block;font-size:.82rem;line-height:1.38}
      .crm-brief-final-card p{margin:5px 0 0;font-size:.71rem;line-height:1.42;opacity:.68}
      body[data-theme='dark'] .crm-brief-final-summary,html[data-theme='dark'] .crm-brief-final-summary{background:linear-gradient(135deg,rgba(36,87,255,.14),rgba(15,23,42,.32) 52%,rgba(22,163,74,.055))}
      body[data-theme='dark'] .crm-brief-final-card,html[data-theme='dark'] .crm-brief-final-card{background:rgba(15,23,42,.45)}
      @media(max-width:900px){.crm-brief-final-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function summaryMarkup(summary) {
    return `<section id="${SUMMARY_ID}" class="crm-brief-final-summary" aria-label="Management summary">
      <div class="crm-brief-final-kicker">Bottom line</div>
      <h3>Management Summary</h3>
      <p class="crm-brief-final-sentence">${esc(summary.sentence)}</p>
      <div class="crm-brief-final-grid">
        ${summary.cards.map(card => `<article class="crm-brief-final-card"><span>${esc(card.label)}</span><strong>${esc(card.title)}</strong><p>${esc(card.detail)}</p></article>`).join('')}
      </div>
    </section>`;
  }

  function renderClosingSummary() {
    installStyle();
    const host = document.getElementById('crmBriefReport');
    const row = selectedReport();
    document.getElementById(SUMMARY_ID)?.remove();
    if (!host || !row?.report || !host.isConnected) return false;
    const summary = buildClosingSummary(row.report);
    host.insertAdjacentHTML('beforeend', summaryMarkup(summary));
    return true;
  }

  function scheduleRender(delays = [80, 350, 900, 1800]) {
    for (const delay of delays) setTimeout(renderClosingSummary, delay);
  }

  function buildPrintDocument() {
    renderClosingSummary();
    const host = document.getElementById('crmBriefReport');
    const row = selectedReport();
    if (!host || !row) return '';
    const reportHtml = host.innerHTML;
    const date = esc(row.report_date || 'report');
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CRM-Daily-Brief-${date}</title>
<style>
  @page{size:A4;margin:11mm 10mm 13mm}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#172033;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-size:10px;line-height:1.45}
  .crm-brief-report{max-width:188mm;margin:0 auto;border:0!important;box-shadow:none!important;padding:0!important;background:#fff!important}
  .crm-brief-banner{padding:7px 9px;border:1px solid #ead5a8;border-radius:7px;background:#fff9eb;margin-bottom:8px}
  .crm-brief-report-cover{padding:13px;border:1px solid #dbe4f0;border-radius:11px;background:#f8faff;margin-bottom:9px}
  .crm-brief-report-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px}
  .crm-brief-eyebrow,.crm-brief-executive-label,.crm-brief-final-kicker{font-size:7px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#335eea}
  .crm-brief-report-head h2{font-size:19px;margin:2px 0 3px;color:#10213d}
  .crm-brief-report-meta{font-size:7.5px;color:#64748b}
  .crm-brief-report-badges{display:flex;gap:5px;flex-wrap:wrap}.crm-brief-shared-badge,.crm-brief-cost{font-size:7px;padding:3px 6px;border:1px solid #dbe4f0;border-radius:999px}
  .crm-brief-source-strip{display:flex;gap:5px;flex-wrap:wrap;padding:6px 7px;border:1px solid #e5eaf1;border-radius:7px;color:#64748b;font-size:7px;margin-bottom:9px}.crm-brief-source-strip span{padding:2px 5px;background:#f1f4f8;border-radius:999px}
  .crm-brief-summary{margin-top:4px;padding:9px 10px;border:1px solid #cfdcff;border-left:3px solid #335eea;border-radius:7px;background:#f7f9ff;font-size:9.5px;line-height:1.5}
  .crm-brief-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:8px}.crm-brief-metric{padding:7px;border:1px solid #dbe4f0;border-radius:7px;break-inside:avoid}.crm-brief-metric span{display:block;font-size:6.5px;color:#64748b}.crm-brief-metric strong{display:block;font-size:12px;margin:1px 0}.crm-brief-metric small{display:block;font-size:6.5px;color:#718096}
  .crm-brief-section-grid{display:block!important;margin:0!important}.crm-brief-section{margin:8px 0;padding:9px;border:1px solid #dbe4f0;border-radius:9px;break-inside:auto}.crm-brief-section-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e7edf5;padding-bottom:4px;margin-bottom:5px}.crm-brief-section h3{font-size:10.5px;margin:0}.crm-brief-section-count{font-size:7px;padding:1px 5px;border:1px solid #dbe4f0;border-radius:999px}
  .crm-brief-items{display:block}.crm-brief-item{margin:5px 0;padding:7px 8px;border:1px solid #dbe4f0;border-left:3px solid #94a3b8;border-radius:7px;break-inside:avoid;page-break-inside:avoid}.crm-brief-item--high{border-left-color:#c62828}.crm-brief-item--medium{border-left-color:#b86b00}.crm-brief-item--low{border-left-color:#1d7a46}.crm-brief-item-top{display:flex;justify-content:space-between;gap:7px}.crm-brief-item h4{font-size:9px;margin:0}.crm-brief-priority{font-size:6px;font-weight:700}.crm-brief-detail{font-size:8px!important;margin:3px 0!important}.crm-brief-action{margin-top:4px;padding:5px 6px;background:#f6f8fb;border-radius:5px}.crm-brief-action span,.crm-brief-evidence span{display:block;font-size:6px;text-transform:uppercase;color:#64748b}.crm-brief-action strong{font-size:7.5px}.crm-brief-evidence{margin-top:4px;padding-top:4px;border-top:1px dashed #dbe4f0}.crm-brief-evidence p{font-size:7px!important;margin:0!important;color:#64748b}.crm-brief-entity{display:inline-block;margin-top:4px;padding:2px 5px;background:#eef2f7;border-radius:999px;font-size:6.5px}
  .crm-brief-final-summary{margin-top:10px;padding:12px;border:1px solid #cfdcff;border-left:4px solid #335eea;border-radius:10px;background:#f7f9ff;break-inside:avoid}.crm-brief-final-summary h3{font-size:12px;margin:2px 0 5px}.crm-brief-final-sentence{font-size:8.5px;margin:0 0 7px}.crm-brief-final-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.crm-brief-final-card{padding:7px;border:1px solid #dbe4f0;border-radius:7px;background:#fff}.crm-brief-final-card span{display:block;font-size:6px;text-transform:uppercase;color:#64748b}.crm-brief-final-card strong{display:block;font-size:8px;line-height:1.35;margin-top:2px}.crm-brief-final-card p{font-size:6.7px;line-height:1.35;color:#64748b;margin:3px 0 0}
  .crm-brief-empty,.crm-brief-none{color:#94a3b8;font-style:italic}
  @media print{.crm-brief-report{max-width:none}.crm-brief-section{orphans:2;widows:2}}
</style>
</head>
<body><main id="crmBriefReport" class="crm-brief-report">${reportHtml}</main></body>
</html>`;
  }

  function exportPdfWithClosingSummary() {
    const html = buildPrintDocument();
    if (!html) {
      notify('No saved CRM brief is available to export.', 'error');
      return;
    }
    const printWindow = global.open('', '_blank', 'width=1024,height=900');
    if (printWindow?.document) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (error) {
          console.error('[CRM Daily Brief Summary] PDF print failed', error);
        }
      }, 300);
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
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
          notify('Print dialog opened. Choose Save as PDF to export the report.');
        } finally {
          setTimeout(() => frame.remove(), 1500);
        }
      }, 350);
    } catch (error) {
      console.error('[CRM Daily Brief Summary] PDF export fallback failed', error);
      notify('Unable to open the PDF export. Please allow pop-ups and try again.', 'error');
    }
  }

  document.addEventListener('click', event => {
    const exportButton = event.target?.closest?.('#crmBriefExportBtn');
    if (exportButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      exportPdfWithClosingSummary();
      return;
    }

    const target = event.target?.closest?.('#crmDailyBriefTab,#crmBriefRefreshBtn,#crmBriefGenerateBtn,#crmBriefHistory [data-crm-brief-id]');
    if (!target) return;
    if (target.id === 'crmBriefGenerateBtn') scheduleRender([150, 700, 1800, 5000, 15000, 30000, 50000]);
    else scheduleRender();
  }, true);

  global.addEventListener('focus', () => scheduleRender([80, 350]));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRender([80, 350]);
  });

  installStyle();
  scheduleRender([100, 500, 1200, 2500]);
})(window);
