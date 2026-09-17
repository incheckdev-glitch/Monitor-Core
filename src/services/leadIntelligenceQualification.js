(function installLeadIntelligenceQualification(global) {
  'use strict';

  if (global.InCheck360LeadIntelligenceQualification) return;

  const API = '/api/lead-intelligence-qualify';
  const VERSION = '20260917-li-qualification1';
  const CACHE_DAYS = 30;
  const active = new Set();
  let decorateQueued = false;
  let refreshTimer = null;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function safeUrl(value = '') {
    try {
      const url = new URL(clean(value));
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch { return ''; }
  }

  function db() {
    return global.SupabaseClient?.getClient?.() || global.supabase || null;
  }

  async function auth() {
    const supabase = db();
    if (!supabase) throw new Error('Supabase is not available.');
    const result = await supabase.auth.getSession();
    if (result.error || !result.data?.session?.access_token) throw new Error('Please sign in again.');
    return result.data.session;
  }

  function notify(message, type = '') {
    try {
      if (global.UI?.toast) return global.UI.toast(message, type || undefined);
      if (global.U?.toast) return global.U.toast(message, type || undefined);
    } catch (_) {}
    console[type === 'error' ? 'error' : 'log']('[Lead Qualification]', message);
  }

  async function call(body) {
    const session = await auth();
    const response = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(clean(payload?.error) || `Qualification failed (${response.status}).`);
    return payload;
  }

  function installStyle() {
    if (document.getElementById('li-qualification-style')) return;
    const style = document.createElement('style');
    style.id = 'li-qualification-style';
    style.textContent = `
      .li-qual-box{margin:12px 0 2px;padding:12px;border:1px solid rgba(127,127,127,.22);border-radius:12px;background:rgba(127,127,127,.045)}
      .li-qual-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
      .li-qual-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.li-qual-title strong{font-size:.86rem}.li-qual-meta{font-size:.7rem;opacity:.64}
      .li-qual-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;background:rgba(127,127,127,.12)}
      .li-qual-badge[data-tone="good"]{background:rgba(34,197,94,.13)}.li-qual-badge[data-tone="warn"]{background:rgba(245,158,11,.14)}.li-qual-badge[data-tone="low"]{background:rgba(239,68,68,.12)}
      .li-qual-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}
      .li-qual-stat{padding:8px 9px;border-radius:9px;background:rgba(127,127,127,.065);min-width:0}.li-qual-stat span{display:block;font-size:.64rem;text-transform:uppercase;letter-spacing:.04em;opacity:.62;margin-bottom:3px}.li-qual-stat strong{display:block;font-size:.86rem;overflow-wrap:anywhere}
      .li-qual-breakdown{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.li-qual-breakdown span{font-size:.68rem;padding:4px 7px;border-radius:999px;background:rgba(127,127,127,.08)}
      .li-qual-note{margin:8px 0 0;font-size:.76rem;line-height:1.45}.li-qual-note strong{font-weight:700}
      .li-qual-conflicts{margin:7px 0 0;padding-left:18px;font-size:.75rem}.li-qual-conflicts li+li{margin-top:3px}
      .li-qual-messages{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.li-qual-message{position:relative;padding:9px 10px;border-radius:9px;background:rgba(127,127,127,.06);min-width:0}.li-qual-message>span{display:block;font-size:.65rem;text-transform:uppercase;letter-spacing:.04em;opacity:.62;margin-bottom:5px;padding-right:48px}.li-qual-message p{font-size:.78rem;line-height:1.46;margin:0;white-space:pre-wrap}.li-qual-message button{position:absolute;top:7px;right:7px;border:0;background:transparent;font-size:.7rem;cursor:pointer;opacity:.72}
      .li-qual-sources{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:9px;font-size:.7rem}.li-qual-sources>span{opacity:.62}.li-qual-sources a{text-decoration:none}
      .li-qual-cost{font-size:.69rem;opacity:.62;margin-top:8px}.li-qual-action-note{font-size:.68rem;opacity:.58;margin-left:2px}
      @media(max-width:900px){.li-qual-grid{grid-template-columns:1fr 1fr}.li-qual-messages{grid-template-columns:1fr}}
      @media(max-width:560px){.li-qual-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function rowFor(id) {
    const rows = global.InCheck360LeadIntelligence?.state?.suggestions;
    return Array.isArray(rows) ? rows.find(row => String(row.id) === String(id)) : null;
  }

  function ageDays(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return Infinity;
    return (Date.now() - date.getTime()) / 86400000;
  }

  function potentialWebCap(row = {}) {
    const score = Number(row.fit_score || 0);
    const locations = Number.isInteger(row.estimated_locations) ? row.estimated_locations : null;
    const title = clean(row.job_title).toLowerCase();
    const senior = /(head|director|chief|vp|vice president|regional|group|general manager|operations manager|quality manager|qhse|compliance)/i.test(title);
    if (score >= 90 && (senior || locations === null || locations >= 3)) return 2;
    if (score >= 80) return 1;
    return 0;
  }

  function pretty(value = '') {
    return clean(value).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()) || 'Unknown';
  }

  function actionTone(action) {
    if (action === 'pursue_now') return 'good';
    if (action === 'low_priority') return 'low';
    return 'warn';
  }

  function locationLabel(row) {
    const status = clean(row.location_verification || 'unknown');
    const count = Number.isInteger(row.verified_locations) ? row.verified_locations : (Number.isInteger(row.estimated_locations) ? row.estimated_locations : null);
    if (count === null) return pretty(status);
    return `${count} · ${pretty(status)}`;
  }

  function sourceMarkup(row) {
    const sources = Array.isArray(row.qualification_sources) ? row.qualification_sources : [];
    const links = sources.map(source => {
      const url = safeUrl(source?.url);
      if (!url) return '';
      let label = clean(source?.title);
      if (!label) {
        try { label = new URL(url).hostname; } catch { label = 'Source'; }
      }
      return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(source?.supports || '')}">${esc(label)}</a>`;
    }).filter(Boolean).slice(0, 4).join('');
    return links ? `<div class="li-qual-sources"><span>Qualification sources</span>${links}</div>` : '';
  }

  function messageBox(label, key, value, id) {
    if (!clean(value)) return '';
    return `<div class="li-qual-message"><span>${esc(label)}</span><p>${esc(value)}</p><button type="button" data-li-qual-copy="${esc(key)}" data-id="${esc(id)}">Copy</button></div>`;
  }

  function qualificationMarkup(row) {
    if (clean(row.qualification_status) !== 'completed') return '';
    const breakdown = row.qualification_fit_breakdown && typeof row.qualification_fit_breakdown === 'object' ? row.qualification_fit_breakdown : {};
    const breakdownLabels = [
      ['Role', 'role_seniority', 25], ['Multi-site', 'multi_location', 25], ['Pain fit', 'operational_pain', 20],
      ['Industry', 'industry', 15], ['Authority', 'decision_authority', 10], ['Evidence', 'evidence_quality', 5]
    ];
    const action = clean(row.sales_action || 'nurture');
    const conflicts = Array.isArray(row.data_conflicts) ? row.data_conflicts.filter(Boolean) : [];
    const cost = Number(row.qualification_estimated_cost_usd || 0);
    const searches = Number(row.qualification_web_searches || 0);
    const fit = Number.isFinite(Number(row.refined_fit_score)) ? Number(row.refined_fit_score) : Number(row.fit_score || 0);
    const when = row.qualified_at ? new Date(row.qualified_at).toLocaleString() : '';
    const trigger = row.why_now_verified && clean(row.why_now)
      ? `<p class="li-qual-note"><strong>Why now:</strong> ${esc(row.why_now)}</p>`
      : '<p class="li-qual-note"><strong>Why now:</strong> No verified recent trigger. Outreach will not invent one.</p>';

    return `<div class="li-qual-box" data-li-qualification-box>
      <div class="li-qual-head">
        <div class="li-qual-title"><strong>Sales qualification</strong><span class="li-qual-badge" data-tone="${esc(actionTone(action))}">${esc(pretty(action))}</span></div>
        <span class="li-qual-meta">${when ? `Qualified ${esc(when)}` : 'Qualified'} · selective research</span>
      </div>
      <div class="li-qual-grid">
        <div class="li-qual-stat"><span>Refined fit</span><strong>${esc(fit)}/100</strong></div>
        <div class="li-qual-stat"><span>Decision authority</span><strong>${esc(pretty(row.decision_authority))}</strong></div>
        <div class="li-qual-stat"><span>Current role</span><strong>${esc(pretty(row.role_verification))}</strong></div>
        <div class="li-qual-stat"><span>Locations</span><strong>${esc(locationLabel(row))}</strong></div>
      </div>
      <div class="li-qual-breakdown">${breakdownLabels.map(([label, key, max]) => `<span>${esc(label)} ${esc(Number(breakdown[key] || 0))}/${max}</span>`).join('')}</div>
      ${trigger}
      ${conflicts.length ? `<p class="li-qual-note"><strong>Data conflicts detected</strong></p><ul class="li-qual-conflicts">${conflicts.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
      <div class="li-qual-messages">
        ${messageBox('Connection note', 'connection', row.linkedin_connection_note, row.id)}
        ${messageBox('After connection accepted', 'accepted', row.linkedin_after_acceptance, row.id)}
        ${messageBox('No-reply follow-up', 'noreply', row.linkedin_no_reply_followup, row.id)}
        ${messageBox('Meeting request', 'meeting', row.linkedin_meeting_request, row.id)}
      </div>
      ${sourceMarkup(row)}
      <div class="li-qual-cost">AI research cost: ${cost > 0 ? `$${cost.toFixed(4)}` : '$0.0000'} · ${searches} web search${searches === 1 ? '' : 'es'} used · cached for ${CACHE_DAYS} days</div>
    </div>`;
  }

  function buttonLabel(row) {
    const status = clean(row.qualification_status || 'not_requested');
    if (active.has(String(row.id))) return 'Qualifying…';
    if (status === 'running') return 'Resume Qualification';
    if (status === 'failed') return 'Retry Qualification';
    if (status === 'completed') return ageDays(row.qualified_at) >= CACHE_DAYS ? 'Requalify Lead' : 'View Qualification';
    return 'Qualify + Improve LinkedIn';
  }

  function syncQualificationBox(card, row) {
    const existing = card.querySelector('[data-li-qualification-box]');
    const markup = qualificationMarkup(row);
    if (!markup) {
      existing?.remove();
      return;
    }
    if (existing) {
      if (existing.outerHTML !== markup) existing.outerHTML = markup;
      return;
    }
    const actions = card.querySelector('.li-card-actions');
    actions?.insertAdjacentHTML('beforebegin', markup);
  }

  function decorateCard(card) {
    const id = clean(card?.getAttribute('data-li-card'));
    if (!id) return;
    const row = rowFor(id);
    if (!row) return;
    const actions = card.querySelector('.li-card-actions');
    if (!actions) return;

    syncQualificationBox(card, row);

    let button = actions.querySelector(`[data-li-qualify="${CSS.escape(id)}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost sm';
      button.setAttribute('data-li-qualify', id);
      actions.insertBefore(button, actions.firstChild);
    }

    const status = clean(row.qualification_status || 'not_requested');
    const fresh = status === 'completed' && ageDays(row.qualified_at) < CACHE_DAYS;
    button.textContent = buttonLabel(row);
    button.disabled = active.has(id);
    button.setAttribute('aria-disabled', active.has(id) ? 'true' : 'false');
    button.title = fresh
      ? 'Open the cached sales qualification and LinkedIn messages. No new OpenAI usage.'
      : 'Second-stage qualification. Strong leads get selective verification; weaker leads do not spend on web search.';

    let note = actions.querySelector('[data-li-qualify-note]');
    if (!note) {
      note = document.createElement('span');
      note.className = 'li-qual-action-note';
      note.setAttribute('data-li-qualify-note', '1');
      actions.appendChild(note);
    }
    const cap = potentialWebCap(row);
    note.textContent = fresh
      ? `$${Number(row.qualification_estimated_cost_usd || 0).toFixed(4)} saved result · $0 new usage`
      : cap === 0
        ? 'AI scoring + message upgrade · no web search'
        : `Selective verification · max ${cap} web search${cap === 1 ? '' : 'es'}`;
  }

  function decorateAll() {
    document.querySelectorAll('#liResults .li-card[data-li-card]').forEach(decorateCard);
  }

  function queueDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      decorateAll();
    });
  }

  function decorateBurst() {
    [0, 80, 220, 500, 1000].forEach(delay => setTimeout(queueDecorate, delay));
  }

  async function refreshUi() {
    try { await global.InCheck360LeadIntelligence?.refresh?.(); } catch (_) {}
    decorateBurst();
  }

  async function poll(qualificationId, suggestionId, resumed) {
    let wait = 2500;
    const started = Date.now();
    if (resumed) notify('Existing qualification resumed. No duplicate OpenAI request was created.');

    while (active.has(suggestionId)) {
      const payload = await call({ action: 'status', qualification_id: qualificationId });
      const status = clean(payload.status).toLowerCase();
      if (status === 'completed') {
        active.delete(suggestionId);
        await refreshUi();
        const result = payload.result || {};
        notify(`Lead qualified at ${Number(result.refined_fit_score || 0)}/100. LinkedIn messages updated.`);
        setTimeout(() => document.querySelector(`[data-li-card="${CSS.escape(suggestionId)}"] [data-li-qualification-box]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }), 120);
        return;
      }
      if (Date.now() - started > 8 * 60 * 1000) {
        active.delete(suggestionId);
        await refreshUi();
        notify('Qualification is still running in the background. Click Resume Qualification later.');
        return;
      }
      await sleep(wait);
      wait = Math.min(8000, Math.round(wait * 1.35));
    }
  }

  async function startQualification(suggestionId) {
    const id = clean(suggestionId);
    if (!id || active.has(id)) return;
    const row = rowFor(id);
    if (!row) {
      notify('Suggested lead data is still loading. Please try again.', 'error');
      decorateBurst();
      return;
    }

    const fresh = clean(row.qualification_status) === 'completed' && ageDays(row.qualified_at) < CACHE_DAYS;
    if (fresh) {
      document.querySelector(`[data-li-card="${CSS.escape(id)}"] [data-li-qualification-box]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    active.add(id);
    queueDecorate();
    try {
      const payload = await call({ action: 'start', suggestion_id: id });
      if (!payload.qualification_id) throw new Error('Qualification did not return a job ID.');
      if (payload.cached) {
        active.delete(id);
        await refreshUi();
        notify('Saved qualification reused. $0 new OpenAI usage.');
        return;
      }
      await poll(payload.qualification_id, id, Boolean(payload.resumed));
    } catch (error) {
      active.delete(id);
      await refreshUi();
      notify(clean(error?.message) || 'Unable to qualify this lead.', 'error');
    }
  }

  async function copyMessage(key, id) {
    const row = rowFor(id);
    if (!row) return;
    const values = {
      connection: row.linkedin_connection_note,
      accepted: row.linkedin_after_acceptance,
      noreply: row.linkedin_no_reply_followup,
      meeting: row.linkedin_meeting_request,
    };
    const text = clean(values[key]);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify('LinkedIn message copied.');
    } catch {
      notify('Could not copy the message automatically.', 'error');
    }
  }

  function attach() {
    const host = document.getElementById('liResults');
    if (!host) return false;
    installStyle();
    decorateBurst();
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        const view = document.getElementById('leadIntelligenceView');
        if (view && view.style.display !== 'none' && !view.hidden) queueDecorate();
      }, 1200);
    }
    return true;
  }

  function boot() {
    let attempts = 0;
    const tryAttach = () => {
      if (attach()) return;
      if (attempts++ < 80) setTimeout(tryAttach, 250);
    };
    tryAttach();
  }

  document.addEventListener('click', event => {
    const copy = event.target?.closest?.('[data-li-qual-copy]');
    if (copy) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void copyMessage(copy.getAttribute('data-li-qual-copy'), copy.getAttribute('data-id'));
      return;
    }
    const button = event.target?.closest?.('[data-li-qualify]');
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void startQualification(button.getAttribute('data-li-qualify'));
      return;
    }
    if (event.target?.closest?.('#leadIntelligenceTab,[data-li-run],[data-li-filter],#liRefreshBtn,#liGenerateBtn')) decorateBurst();
  }, true);

  global.addEventListener('focus', decorateBurst);

  global.InCheck360LeadIntelligenceQualification = Object.freeze({
    version: VERSION,
    start: startQualification,
    refresh: decorateBurst,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
