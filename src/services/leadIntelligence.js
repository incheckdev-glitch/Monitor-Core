(function installLeadIntelligence(global) {
  'use strict';

  if (global.InCheck360LeadIntelligence) return;

  const VERSION = '20260910-leadintel1';
  const API_URL = '/api/lead-intelligence';
  const TAB_ID = 'leadIntelligenceTab';
  const VIEW_ID = 'leadIntelligenceView';
  const CSS_ID = 'lead-intelligence-css';
  const state = {
    installed: false,
    allowed: false,
    configLoaded: false,
    configured: false,
    model: '',
    loading: false,
    runs: [],
    suggestions: [],
    selectedRunId: '',
    filter: 'all',
    lastError: '',
  };

  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const list = value => clean(value).split(',').map(clean).filter(Boolean);

  function safeUrl(value = '') {
    try {
      const u = new URL(clean(value));
      return ['http:', 'https:'].includes(u.protocol) ? u.toString() : '';
    } catch { return ''; }
  }

  function client() {
    return global.SupabaseClient?.getClient?.() || global.supabase || null;
  }

  async function authContext() {
    const supabase = client();
    if (!supabase) throw new Error('Supabase is not available.');
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error('Please sign in again.');
    return { supabase, session: data.session, user: data.session.user };
  }

  function notify(message, type = '') {
    if (global.UI?.toast) global.UI.toast(message, type || undefined);
    else console[type === 'error' ? 'error' : 'log']('[Lead Intelligence]', message);
  }

  function installCss() {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = `/src/ui/lead-intelligence.css?v=${VERSION}`;
    document.head.appendChild(link);
  }

  function viewMarkup() {
    return `
      <div class="li-shell">
        <section class="li-hero">
          <div>
            <div class="li-eyebrow">CRM · AI Prospecting</div>
            <h1>Lead Intelligence</h1>
            <p>Research verifiable public prospects, score their fit for InCheck 360, and add approved prospects into the CRM without scraping LinkedIn or exposing internal CRM data to the model.</p>
          </div>
          <div class="li-hero-actions">
            <span id="liOpenAiStatus" class="li-status li-status--pending">Checking OpenAI…</span>
            <button id="liRefreshBtn" class="btn ghost" type="button">Refresh</button>
          </div>
        </section>

        <section class="li-layout">
          <aside class="li-panel li-search-panel">
            <div class="li-panel-title-row">
              <div><span class="li-kicker">Prospect criteria</span><h2>Generate suggestions</h2></div>
              <span class="li-private-badge">CRM data stays private</span>
            </div>
            <form id="liCriteriaForm" class="li-form">
              <label>Countries
                <input id="liCountries" class="input" value="UAE, Lebanon" placeholder="UAE, Lebanon, Saudi Arabia" />
              </label>
              <label>Industries
                <input id="liIndustries" class="input" value="Food & Beverage, Hospitality" placeholder="F&B, Hospitality, Manufacturing" />
              </label>
              <label class="li-span-2">Target roles
                <input id="liRoles" class="input" value="Head of Operations, Operations Director, Quality Manager, QHSE Manager" placeholder="Head of Operations, Quality Manager" />
              </label>
              <label>Minimum locations / sites
                <input id="liMinLocations" class="input" type="number" min="1" max="5000" value="3" />
              </label>
              <label>Number of suggestions
                <select id="liCount" class="select"><option>5</option><option selected>8</option><option>10</option><option>12</option></select>
              </label>
              <label class="li-span-2">Company profile
                <textarea id="liCompanyProfile" class="input" rows="3">Multi-location operator with recurring quality, safety, compliance, maintenance, inspection or corrective-action workflows.</textarea>
              </label>
              <label class="li-span-2">Additional keywords
                <input id="liKeywords" class="input" placeholder="food safety, audits, facilities, multi-site" />
              </label>
              <label class="li-span-2">Exclude
                <input id="liExclusions" class="input" placeholder="recruiters, consultants, students" />
              </label>
              <div class="li-form-actions li-span-2">
                <button id="liGenerateBtn" class="btn primary" type="submit">Generate Suggested Leads</button>
                <span id="liGenerateHint" class="muted">Only public web evidence is used. Nothing is sent to LinkedIn.</span>
              </div>
            </form>
          </aside>

          <section class="li-panel li-history-panel">
            <div class="li-panel-title-row"><div><span class="li-kicker">Workspace</span><h2>Research history</h2></div></div>
            <div id="liRunList" class="li-run-list"><div class="muted">No searches yet.</div></div>
          </section>
        </section>

        <section class="li-stats" aria-label="Lead Intelligence summary">
          <article><span>Suggestions</span><strong id="liStatTotal">0</strong></article>
          <article><span>Ready to review</span><strong id="liStatNew">0</strong></article>
          <article><span>Added to CRM</span><strong id="liStatAdded">0</strong></article>
          <article><span>Average fit</span><strong id="liStatFit">—</strong></article>
        </section>

        <section class="li-panel li-results-panel">
          <div class="li-results-header">
            <div><span class="li-kicker">AI recommendations</span><h2>Suggested Leads</h2><p id="liResultsMeta" class="muted">Generate a search to see recommendations.</p></div>
            <div class="li-filter-pills" role="group" aria-label="Suggestion status filter">
              <button type="button" class="li-filter is-active" data-li-filter="all">All</button>
              <button type="button" class="li-filter" data-li-filter="new">New</button>
              <button type="button" class="li-filter" data-li-filter="added">Added</button>
              <button type="button" class="li-filter" data-li-filter="dismissed">Dismissed</button>
            </div>
          </div>
          <div id="liError" class="li-error" hidden></div>
          <div id="liResults" class="li-results"><div class="li-empty"><strong>No suggested leads yet.</strong><span>Set your criteria and run a verified public-web search.</span></div></div>
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
      tab.dataset.view = 'leadIntelligence';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-controls', VIEW_ID);
      tab.innerHTML = '<span class="icon" aria-hidden="true">✨</span> Suggested Leads';
      tab.hidden = true;
      leadsTab.parentElement?.insertBefore(tab, leadsTab);
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
      view.className = 'view li-view';
      view.setAttribute('role', 'tabpanel');
      view.setAttribute('aria-labelledby', TAB_ID);
      view.style.display = 'none';
      view.innerHTML = viewMarkup();
      leadsView.parentElement?.insertBefore(view, leadsView);
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

  async function openView() {
    if (!ensureShell()) return;
    const allowed = await checkAccess();
    if (!allowed) {
      notify('You do not have permission to use Lead Intelligence.', 'error');
      return;
    }

    const coreSetActiveView = global.__leadIntelligenceCoreSetActiveView || global.setActiveView;
    if (typeof coreSetActiveView === 'function') {
      try { coreSetActiveView('leads'); } catch (_) {}
    }

    const leadsView = document.getElementById('leadsView');
    const leadsTab = document.getElementById('leadsTab');
    if (leadsView) { leadsView.classList.remove('active'); leadsView.style.display = 'none'; }
    if (leadsTab) { leadsTab.classList.remove('active'); leadsTab.setAttribute('aria-selected', 'false'); }

    const view = document.getElementById(VIEW_ID);
    const tab = document.getElementById(TAB_ID);
    if (view) {
      view.style.display = '';
      view.classList.add('active');
      view.setAttribute('aria-hidden', 'false');
    }
    if (tab) {
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
    }
    await Promise.all([loadConfig(), loadHistory()]);
  }

  async function checkAccess() {
    try {
      const { supabase } = await authContext();
      const { data, error } = await supabase.rpc('can_use_lead_intelligence');
      state.allowed = !error && data === true;
    } catch {
      state.allowed = false;
    }
    const tab = document.getElementById(TAB_ID);
    if (tab) tab.hidden = !state.allowed;
    return state.allowed;
  }

  async function apiRequest(path = '', options = {}) {
    const { session } = await authContext();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${session.access_token}`,
        ...(options.headers || {}),
      },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(clean(payload?.error) || `Request failed (${response.status}).`);
    return payload;
  }

  async function loadConfig() {
    const status = document.getElementById('liOpenAiStatus');
    try {
      const data = await apiRequest('', { method: 'GET' });
      state.configLoaded = true;
      state.configured = data.configured === true;
      state.model = clean(data.model);
      if (status) {
        status.className = `li-status ${state.configured ? 'li-status--ready' : 'li-status--warning'}`;
        status.textContent = state.configured ? `OpenAI ready · ${state.model || 'configured'}` : 'OpenAI key required';
      }
    } catch (error) {
      state.configLoaded = true;
      state.configured = false;
      if (status) {
        status.className = 'li-status li-status--warning';
        status.textContent = 'OpenAI unavailable';
        status.title = error.message;
      }
    }
    updateGenerateButton();
  }

  function criteriaFromForm() {
    return {
      countries: list(document.getElementById('liCountries')?.value),
      industries: list(document.getElementById('liIndustries')?.value),
      target_roles: list(document.getElementById('liRoles')?.value),
      min_locations: Number(document.getElementById('liMinLocations')?.value || 3),
      count: Number(document.getElementById('liCount')?.value || 8),
      company_profile: clean(document.getElementById('liCompanyProfile')?.value),
      keywords: list(document.getElementById('liKeywords')?.value),
      exclusions: list(document.getElementById('liExclusions')?.value),
    };
  }

  function updateGenerateButton() {
    const button = document.getElementById('liGenerateBtn');
    const hint = document.getElementById('liGenerateHint');
    if (!button) return;
    button.disabled = state.loading || !state.configured;
    button.textContent = state.loading ? 'Researching public sources…' : 'Generate Suggested Leads';
    if (hint) {
      hint.textContent = !state.configured
        ? 'Add OPENAI_API_KEY to Vercel. The key is never exposed to the browser.'
        : 'Only public web evidence is used. Nothing is sent to LinkedIn.';
    }
  }

  async function createRun(criteria) {
    const { supabase, user } = await authContext();
    const { data, error } = await supabase.from('lead_intelligence_runs').insert({
      created_by: user.id,
      criteria,
      status: 'running',
      started_at: new Date().toISOString(),
    }).select('*').single();
    if (error) throw error;
    return data;
  }

  async function finalizeRun(runId, patch) {
    const { supabase } = await authContext();
    const { error } = await supabase.from('lead_intelligence_runs').update({ ...patch, completed_at: new Date().toISOString() }).eq('id', runId);
    if (error) throw error;
  }

  async function saveSuggestions(run, payload) {
    const { supabase, user } = await authContext();
    const rows = (payload.suggestions || []).map(item => ({
      run_id: run.id,
      created_by: user.id,
      fingerprint: item.fingerprint,
      status: 'new',
      person_name: item.person_name,
      job_title: item.job_title || null,
      person_email: item.person_email || null,
      company_name: item.company_name,
      company_website: item.company_website || null,
      linkedin_url: item.linkedin_url || null,
      country: item.country || null,
      city: item.city || null,
      industry: item.industry || null,
      company_size: item.company_size || null,
      estimated_locations: item.estimated_locations,
      fit_score: item.fit_score,
      confidence: item.confidence,
      why_fit: item.why_fit || null,
      likely_pain_points: item.likely_pain_points || [],
      public_evidence: item.public_evidence || [],
      source_urls: item.source_urls || [],
      suggested_connection_note: item.suggested_connection_note || null,
      suggested_follow_up: item.suggested_follow_up || null,
      raw_payload: item,
    }));
    if (!rows.length) return [];
    const { data, error } = await supabase.from('lead_intelligence_suggestions').upsert(rows, { onConflict: 'run_id,fingerprint', ignoreDuplicates: true }).select('*');
    if (error) throw error;
    return data || [];
  }

  async function generate() {
    if (state.loading) return;
    if (!state.configured) {
      notify('OpenAI is not configured yet. Add OPENAI_API_KEY to Vercel first.', 'error');
      return;
    }
    const criteria = criteriaFromForm();
    if (!criteria.countries.length && !criteria.industries.length && !criteria.target_roles.length && !criteria.company_profile) {
      notify('Add at least one country, industry, target role or company profile.', 'error');
      return;
    }

    state.loading = true;
    state.lastError = '';
    renderError();
    updateGenerateButton();
    let run = null;
    try {
      run = await createRun(criteria);
      const payload = await apiRequest('', { method: 'POST', body: JSON.stringify(criteria) });
      await saveSuggestions(run, payload);
      await finalizeRun(run.id, {
        status: 'completed',
        model: payload.model || null,
        openai_response_id: payload.response_id || null,
        result_count: Array.isArray(payload.suggestions) ? payload.suggestions.length : 0,
        usage: payload.usage || {},
        error_message: null,
      });
      state.selectedRunId = run.id;
      notify(`${payload.suggestions?.length || 0} suggested leads generated.`);
      await loadHistory(run.id);
    } catch (error) {
      state.lastError = clean(error?.message) || 'Lead research failed.';
      renderError();
      if (run?.id) {
        try { await finalizeRun(run.id, { status: 'failed', result_count: 0, error_message: state.lastError }); } catch (_) {}
      }
      notify(state.lastError, 'error');
      await loadHistory(run?.id || '');
    } finally {
      state.loading = false;
      updateGenerateButton();
    }
  }

  async function loadHistory(preferredRunId = '') {
    try {
      const { supabase } = await authContext();
      const { data, error } = await supabase.from('lead_intelligence_runs').select('*').order('created_at', { ascending: false }).limit(25);
      if (error) throw error;
      state.runs = Array.isArray(data) ? data : [];
      const target = preferredRunId || state.selectedRunId || state.runs[0]?.id || '';
      state.selectedRunId = state.runs.some(row => row.id === target) ? target : (state.runs[0]?.id || '');
      renderRuns();
      await loadSuggestions();
    } catch (error) {
      state.lastError = clean(error?.message) || 'Unable to load Lead Intelligence history.';
      renderError();
    }
  }

  async function loadSuggestions() {
    if (!state.selectedRunId) {
      state.suggestions = [];
      renderSuggestions();
      return;
    }
    const { supabase } = await authContext();
    const { data, error } = await supabase.from('lead_intelligence_suggestions').select('*').eq('run_id', state.selectedRunId).order('fit_score', { ascending: false }).order('created_at', { ascending: true });
    if (error) throw error;
    state.suggestions = Array.isArray(data) ? data : [];
    renderSuggestions();
  }

  function formatRunLabel(run = {}) {
    const criteria = run.criteria || {};
    const date = run.created_at ? new Date(run.created_at) : null;
    const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Unknown time';
    const geo = Array.isArray(criteria.countries) ? criteria.countries.slice(0, 2).join(', ') : '';
    const industries = Array.isArray(criteria.industries) ? criteria.industries.slice(0, 2).join(', ') : '';
    return { when, summary: [geo, industries].filter(Boolean).join(' · ') || 'Custom search' };
  }

  function renderRuns() {
    const host = document.getElementById('liRunList');
    if (!host) return;
    if (!state.runs.length) {
      host.innerHTML = '<div class="li-empty-small">No research history yet.</div>';
      return;
    }
    host.innerHTML = state.runs.map(run => {
      const label = formatRunLabel(run);
      const selected = run.id === state.selectedRunId;
      return `<button type="button" class="li-run${selected ? ' is-active' : ''}" data-li-run="${esc(run.id)}">
        <span><strong>${esc(label.summary)}</strong><small>${esc(label.when)}</small></span>
        <em class="li-run-status li-run-status--${esc(run.status || 'completed')}">${esc(run.status || 'completed')}</em>
      </button>`;
    }).join('');
  }

  function sourceLinks(row = {}) {
    const sources = Array.isArray(row.source_urls) ? row.source_urls : [];
    const links = sources.map(item => {
      const url = safeUrl(item?.url);
      if (!url) return '';
      return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(item?.supports || '')}">${esc(item?.title || new URL(url).hostname)}</a>`;
    }).filter(Boolean).slice(0, 4);
    return links.length ? `<div class="li-sources"><span>Sources</span>${links.join('')}</div>` : '<div class="li-sources"><span>Sources</span><em>No direct URL returned</em></div>';
  }

  function statusLabel(status = '') {
    const labels = { new: 'Ready to review', added: 'Added to CRM', duplicate: 'Existing lead', dismissed: 'Dismissed' };
    return labels[status] || status || 'Ready to review';
  }

  function suggestionCard(row = {}) {
    const linkedin = safeUrl(row.linkedin_url);
    const website = safeUrl(row.company_website);
    const pains = Array.isArray(row.likely_pain_points) ? row.likely_pain_points : [];
    const evidence = Array.isArray(row.public_evidence) ? row.public_evidence : [];
    const canAdd = row.status === 'new';
    const canRestore = row.status === 'dismissed';
    const crmLabel = row.status === 'duplicate' ? 'Open Existing Lead' : row.status === 'added' ? 'Open CRM Lead' : 'Add to CRM';
    return `<article class="li-card" data-li-card="${esc(row.id)}">
      <div class="li-card-top">
        <div class="li-score" aria-label="Fit score ${Number(row.fit_score || 0)} out of 100"><strong>${Number(row.fit_score || 0)}</strong><span>FIT</span></div>
        <div class="li-person">
          <div class="li-person-heading"><h3>${esc(row.person_name)}</h3><span class="li-confidence li-confidence--${esc(row.confidence || 'low')}">${esc(row.confidence || 'low')} confidence</span></div>
          <p>${esc(row.job_title || 'Role not stated')} · <strong>${esc(row.company_name)}</strong></p>
          <div class="li-meta">
            ${row.country ? `<span>📍 ${esc([row.city, row.country].filter(Boolean).join(', '))}</span>` : ''}
            ${row.industry ? `<span>🏢 ${esc(row.industry)}</span>` : ''}
            ${row.estimated_locations != null ? `<span>📌 ~${esc(row.estimated_locations)} sites</span>` : row.company_size ? `<span>📌 ${esc(row.company_size)}</span>` : ''}
          </div>
        </div>
        <span class="li-card-status li-card-status--${esc(row.status)}">${esc(statusLabel(row.status))}</span>
      </div>

      <div class="li-card-grid">
        <section><span class="li-section-label">Why this prospect fits</span><p>${esc(row.why_fit || 'No fit rationale returned.')}</p></section>
        <section><span class="li-section-label">Likely operational pain</span>${pains.length ? `<ul>${pains.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">No likely pain points returned.</p>'}</section>
        <section class="li-span-2"><span class="li-section-label">Public evidence</span>${evidence.length ? `<ul class="li-evidence">${evidence.slice(0, 5).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">No evidence summary returned.</p>'}${sourceLinks(row)}</section>
        <section><span class="li-section-label">Suggested connection note</span><div class="li-copy-box"><p>${esc(row.suggested_connection_note || 'No connection note generated.')}</p>${row.suggested_connection_note ? `<button type="button" data-li-copy="connection" data-id="${esc(row.id)}">Copy</button>` : ''}</div></section>
        <section><span class="li-section-label">Suggested follow-up</span><div class="li-copy-box"><p>${esc(row.suggested_follow_up || 'No follow-up generated.')}</p>${row.suggested_follow_up ? `<button type="button" data-li-copy="followup" data-id="${esc(row.id)}">Copy</button>` : ''}</div></section>
      </div>

      <div class="li-card-actions">
        ${linkedin ? `<a class="btn ghost sm" href="${esc(linkedin)}" target="_blank" rel="noopener noreferrer">Open LinkedIn</a>` : ''}
        ${website ? `<a class="btn ghost sm" href="${esc(website)}" target="_blank" rel="noopener noreferrer">Company Website</a>` : ''}
        ${canAdd ? `<button class="btn primary sm" type="button" data-li-add="${esc(row.id)}">Add to CRM</button><button class="btn ghost sm" type="button" data-li-dismiss="${esc(row.id)}">Dismiss</button>` : ''}
        ${canRestore ? `<button class="btn ghost sm" type="button" data-li-restore="${esc(row.id)}">Restore</button>` : ''}
        ${row.matched_lead_id ? `<button class="btn ghost sm" type="button" data-li-open-lead="${esc(row.matched_lead_id)}">${esc(crmLabel)}</button>` : ''}
      </div>
    </article>`;
  }

  function renderSuggestions() {
    const host = document.getElementById('liResults');
    if (!host) return;
    const filtered = state.filter === 'all' ? state.suggestions : state.suggestions.filter(row => row.status === state.filter || (state.filter === 'added' && row.status === 'duplicate'));
    if (!filtered.length) {
      host.innerHTML = `<div class="li-empty"><strong>${state.suggestions.length ? 'No suggestions in this filter.' : 'No suggested leads yet.'}</strong><span>${state.suggestions.length ? 'Choose another status filter.' : 'Set your criteria and run a verified public-web search.'}</span></div>`;
    } else {
      host.innerHTML = filtered.map(suggestionCard).join('');
    }
    const total = state.suggestions.length;
    const newCount = state.suggestions.filter(x => x.status === 'new').length;
    const added = state.suggestions.filter(x => ['added','duplicate'].includes(x.status)).length;
    const avg = total ? Math.round(state.suggestions.reduce((sum, x) => sum + Number(x.fit_score || 0), 0) / total) : null;
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('liStatTotal', String(total)); set('liStatNew', String(newCount)); set('liStatAdded', String(added)); set('liStatFit', avg == null ? '—' : `${avg}/100`);
    const run = state.runs.find(x => x.id === state.selectedRunId);
    const meta = document.getElementById('liResultsMeta');
    if (meta) meta.textContent = run ? `${formatRunLabel(run).summary} · ${run.result_count || total} result${Number(run.result_count || total) === 1 ? '' : 's'} · ${run.model || 'OpenAI'}` : 'Generate a search to see recommendations.';
  }

  function renderError() {
    const box = document.getElementById('liError');
    if (!box) return;
    box.hidden = !state.lastError;
    box.textContent = state.lastError;
  }

  async function setSuggestionStatus(id, status) {
    const { supabase } = await authContext();
    const patch = { status, updated_at: new Date().toISOString() };
    if (status === 'dismissed') patch.dismissed_at = new Date().toISOString();
    if (status === 'new') patch.dismissed_at = null;
    const { error } = await supabase.from('lead_intelligence_suggestions').update(patch).eq('id', id);
    if (error) throw error;
    await loadSuggestions();
  }

  async function addToCrm(id) {
    const button = document.querySelector(`[data-li-add="${CSS.escape(id)}"]`);
    if (button) { button.disabled = true; button.textContent = 'Adding…'; }
    try {
      const { supabase } = await authContext();
      const { data, error } = await supabase.rpc('lead_intelligence_accept_suggestion', { p_suggestion_id: id });
      if (error) throw error;
      notify(data?.existing ? `Existing lead ${data?.lead_code || ''} matched. No duplicate created.` : `Created ${data?.lead_code || 'new CRM lead'}.`);
      await loadSuggestions();
      try { global.Leads?.loadAndRefresh?.({ force: true }); } catch (_) {}
    } catch (error) {
      notify(clean(error?.message) || 'Unable to add suggested lead to CRM.', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Add to CRM'; }
    }
  }

  async function openLead(id) {
    closeOwnView();
    try { global.setActiveView?.('leads'); } catch (_) { document.getElementById('leadsTab')?.click?.(); }
    try {
      await global.Leads?.loadAndRefresh?.({ force: true });
      const row = global.Leads?.findLeadById?.(id);
      if (row) global.Leads?.openDetails?.(row);
    } catch (_) {}
  }

  async function copySuggestion(id, field) {
    const row = state.suggestions.find(x => x.id === id);
    const value = field === 'followup' ? row?.suggested_follow_up : row?.suggested_connection_note;
    if (!value) return;
    try { await navigator.clipboard.writeText(value); notify('Copied to clipboard.'); }
    catch { notify('Unable to copy automatically.', 'error'); }
  }

  function wireView() {
    document.getElementById('liCriteriaForm')?.addEventListener('submit', event => { event.preventDefault(); generate(); });
    document.getElementById('liRefreshBtn')?.addEventListener('click', () => Promise.all([loadConfig(), loadHistory()]));
    document.getElementById('liRunList')?.addEventListener('click', event => {
      const id = event.target?.closest?.('[data-li-run]')?.getAttribute('data-li-run');
      if (!id) return;
      state.selectedRunId = id;
      renderRuns();
      loadSuggestions().catch(error => notify(error.message, 'error'));
    });
    document.querySelector('.li-filter-pills')?.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-li-filter]');
      if (!button) return;
      state.filter = button.getAttribute('data-li-filter') || 'all';
      document.querySelectorAll('.li-filter').forEach(el => el.classList.toggle('is-active', el === button));
      renderSuggestions();
    });
    document.getElementById('liResults')?.addEventListener('click', event => {
      const add = event.target?.closest?.('[data-li-add]');
      if (add) return void addToCrm(add.getAttribute('data-li-add'));
      const dismiss = event.target?.closest?.('[data-li-dismiss]');
      if (dismiss) return void setSuggestionStatus(dismiss.getAttribute('data-li-dismiss'), 'dismissed').catch(error => notify(error.message, 'error'));
      const restore = event.target?.closest?.('[data-li-restore]');
      if (restore) return void setSuggestionStatus(restore.getAttribute('data-li-restore'), 'new').catch(error => notify(error.message, 'error'));
      const open = event.target?.closest?.('[data-li-open-lead]');
      if (open) return void openLead(open.getAttribute('data-li-open-lead'));
      const copy = event.target?.closest?.('[data-li-copy]');
      if (copy) return void copySuggestion(copy.getAttribute('data-id'), copy.getAttribute('data-li-copy'));
    });
  }

  function installNavigationGuard() {
    if (global.__leadIntelligenceCoreSetActiveView || typeof global.setActiveView !== 'function') return;
    global.__leadIntelligenceCoreSetActiveView = global.setActiveView.bind(global);
    global.setActiveView = function leadIntelligenceAwareSetActiveView(view, ...args) {
      if (String(view) === 'leadIntelligence') return openView();
      closeOwnView();
      return global.__leadIntelligenceCoreSetActiveView(view, ...args);
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
      if (!global.__leadIntelligenceAuthListenerInstalled) {
        const supabase = client();
        if (supabase?.auth?.onAuthStateChange) {
          supabase.auth.onAuthStateChange(() => { setTimeout(checkAccess, 50); });
          global.__leadIntelligenceAuthListenerInstalled = true;
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
  global.InCheck360LeadIntelligence = Object.freeze({
    version: VERSION,
    open: openView,
    refresh: () => Promise.all([loadConfig(), loadHistory()]),
    state,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
