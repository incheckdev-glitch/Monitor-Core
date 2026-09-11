(function installLeadIntelligenceContactEnrichment(global) {
  'use strict';

  if (global.InCheck360LeadIntelligenceContactEnrichment) return;

  const API = '/api/lead-intelligence-enrich';
  const VERSION = '20260911-li-contact2';
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
      const u = new URL(clean(value));
      return ['http:', 'https:'].includes(u.protocol) ? u.toString() : '';
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
    console[type === 'error' ? 'error' : 'log']('[Lead Contact Enrichment]', message);
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
    if (!response.ok || payload?.ok === false) {
      throw new Error(clean(payload?.error) || `Contact lookup failed (${response.status}).`);
    }
    return payload;
  }

  function installStyle() {
    if (document.getElementById('li-contact-enrichment-style')) return;
    const style = document.createElement('style');
    style.id = 'li-contact-enrichment-style';
    style.textContent = `
      .li-contact-box{margin:12px 0 2px;padding:11px 12px;border:1px solid rgba(127,127,127,.2);border-radius:10px;background:rgba(127,127,127,.045)}
      .li-contact-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap}
      .li-contact-head strong{font-size:.8rem}.li-contact-head small{font-size:.7rem;opacity:.68}
      .li-contact-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .li-contact-item{min-width:0;padding:8px 9px;border-radius:8px;background:rgba(127,127,127,.06)}
      .li-contact-item span{display:block;font-size:.67rem;text-transform:uppercase;letter-spacing:.04em;opacity:.62;margin-bottom:3px}
      .li-contact-item a,.li-contact-item strong{display:block;font-size:.82rem;overflow-wrap:anywhere;color:inherit}
      .li-contact-item em{font-style:normal;font-size:.78rem;opacity:.62}
      .li-contact-sources{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:.72rem}
      .li-contact-sources>span{opacity:.62}.li-contact-sources a{text-decoration:none}
      .li-contact-note{margin:7px 0 0;font-size:.73rem;opacity:.72}
      .li-contact-paid-note{font-size:.68rem;opacity:.58;margin-left:2px}
      @media(max-width:720px){.li-contact-grid{grid-template-columns:1fr}}
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

  function telHref(value) {
    const cleanPhone = clean(value).replace(/[^+\d]/g, '');
    return cleanPhone ? `tel:${cleanPhone}` : '';
  }

  function contactMarkup(row) {
    const status = clean(row.contact_enrichment_status || 'not_requested');
    const email = clean(row.person_email);
    const personPhone = clean(row.person_phone);
    const companyPhone = clean(row.company_phone);
    const sources = Array.isArray(row.contact_enrichment_sources) ? row.contact_enrichment_sources : [];
    const enriched = status === 'completed';
    const hasAny = Boolean(email || personPhone || companyPhone);

    if (!enriched && !email) return '';

    const sourceLinks = sources
      .map(source => {
        const url = safeUrl(source?.url);
        if (!url) return '';
        return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(source?.supports || '')}">${esc(source?.title || new URL(url).hostname)}</a>`;
      })
      .filter(Boolean)
      .slice(0, 3)
      .join('');

    const when = row.contact_enriched_at ? new Date(row.contact_enriched_at).toLocaleString() : '';
    const directTel = telHref(personPhone);
    const companyTel = telHref(companyPhone);

    return `<div class="li-contact-box" data-li-contact-box>
      <div class="li-contact-head">
        <strong>${enriched ? 'Verified public contact' : 'Public contact already found'}</strong>
        <small>${enriched && when ? `Checked ${esc(when)}` : 'From prospect research'}</small>
      </div>
      <div class="li-contact-grid">
        <div class="li-contact-item"><span>Email</span>${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : '<em>Not publicly found</em>'}</div>
        <div class="li-contact-item"><span>Direct phone</span>${personPhone ? `<a href="${esc(directTel)}">${esc(personPhone)}</a>` : '<em>Not publicly found</em>'}</div>
        <div class="li-contact-item"><span>Company phone</span>${companyPhone ? `<a href="${esc(companyTel)}">${esc(companyPhone)}</a>` : '<em>Not publicly found</em>'}</div>
      </div>
      ${sourceLinks ? `<div class="li-contact-sources"><span>Verification sources</span>${sourceLinks}</div>` : ''}
      ${enriched && !hasAny ? '<p class="li-contact-note">No publicly verifiable email or phone was found within the low-cost search limit.</p>' : ''}
      ${row.contact_enrichment_note ? `<p class="li-contact-note">${esc(row.contact_enrichment_note)}</p>` : ''}
    </div>`;
  }

  function buttonLabel(row) {
    const status = clean(row.contact_enrichment_status || 'not_requested');
    if (active.has(String(row.id))) return 'Finding Contact…';
    if (status === 'running') return 'Resume Contact Search';
    if (status === 'failed') return 'Retry Phone & Email';
    if (status === 'completed') {
      return ageDays(row.contact_enriched_at) >= CACHE_DAYS ? 'Recheck Phone & Email' : 'View Phone & Email';
    }
    return 'Find Phone & Email';
  }

  function syncContactBox(card, row) {
    const existing = card.querySelector('[data-li-contact-box]');
    const markup = contactMarkup(row);
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

    syncContactBox(card, row);

    let button = actions.querySelector(`[data-li-enrich-contact="${CSS.escape(id)}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost sm';
      button.setAttribute('data-li-enrich-contact', id);
      actions.insertBefore(button, actions.firstChild);
    }

    const status = clean(row.contact_enrichment_status || 'not_requested');
    const freshCompleted = status === 'completed' && ageDays(row.contact_enriched_at) < CACHE_DAYS;
    const label = buttonLabel(row);
    if (button.textContent !== label) button.textContent = label;
    button.disabled = active.has(id);
    button.setAttribute('aria-disabled', active.has(id) ? 'true' : 'false');
    button.title = freshCompleted
      ? `Open the saved contact result. The ${CACHE_DAYS}-day cache prevents a new OpenAI request.`
      : 'Runs a low-cost public contact lookup for this lead only. No bulk enrichment.';

    let note = actions.querySelector('[data-li-contact-paid-note]');
    if (!note) {
      note = document.createElement('span');
      note.className = 'li-contact-paid-note';
      note.setAttribute('data-li-contact-paid-note', '1');
      actions.appendChild(note);
    }
    const noteText = freshCompleted ? '$0 to view cached result' : 'Selective lookup · max 2 web searches';
    if (note.textContent !== noteText) note.textContent = noteText;
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
    try { await global.InCheck360LeadIntelligenceAdmin?.refresh?.(); } catch (_) {}
  }

  async function poll(enrichmentId, suggestionId, resumed) {
    let wait = 2500;
    const started = Date.now();
    if (resumed) notify('Existing contact lookup resumed. No duplicate OpenAI request was created.');

    while (active.has(suggestionId)) {
      const payload = await call({ action: 'status', enrichment_id: enrichmentId });
      const status = clean(payload.status).toLowerCase();
      if (status === 'completed') {
        active.delete(suggestionId);
        await refreshUi();
        const result = payload.result || {};
        const found = [result.email, result.person_phone, result.company_phone].filter(Boolean).length;
        notify(found ? `Contact lookup completed. ${found} public contact detail${found === 1 ? '' : 's'} found.` : 'Contact lookup completed. No publicly verifiable phone or email was found.');
        return;
      }

      if (Date.now() - started > 8 * 60 * 1000) {
        active.delete(suggestionId);
        await refreshUi();
        notify('Contact lookup is still running in the background. Click Resume Contact Search later.');
        return;
      }

      await sleep(wait);
      wait = Math.min(8000, Math.round(wait * 1.35));
    }
  }

  async function startLookup(suggestionId) {
    const id = clean(suggestionId);
    if (!id || active.has(id)) return;
    const row = rowFor(id);
    if (!row) {
      notify('Suggested lead data is still loading. Please try again.', 'error');
      decorateBurst();
      return;
    }

    active.add(id);
    queueDecorate();

    try {
      const payload = await call({ action: 'start', suggestion_id: id });
      if (!payload.enrichment_id) throw new Error('Contact lookup did not return a job ID.');

      if (payload.cached) {
        active.delete(id);
        await refreshUi();
        notify('Saved contact lookup reused. $0 new OpenAI usage.');
        return;
      }

      await poll(payload.enrichment_id, id, Boolean(payload.resumed));
    } catch (error) {
      active.delete(id);
      await refreshUi();
      notify(clean(error?.message) || 'Unable to find contact details.', 'error');
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
    const button = event.target?.closest?.('[data-li-enrich-contact]');
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void startLookup(button.getAttribute('data-li-enrich-contact'));
      return;
    }
    if (event.target?.closest?.('#leadIntelligenceTab,[data-li-run],[data-li-filter],#liRefreshBtn,#liGenerateBtn')) {
      decorateBurst();
    }
  }, true);

  global.addEventListener('focus', decorateBurst);

  global.InCheck360LeadIntelligenceContactEnrichment = Object.freeze({
    version: VERSION,
    start: startLookup,
    refresh: decorateBurst,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
