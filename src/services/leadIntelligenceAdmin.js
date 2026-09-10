(function installLeadIntelligenceAdmin(global) {
  'use strict';

  if (global.InCheck360LeadIntelligenceAdmin) return;

  const VERSION = '20260910-li-admin1';
  const PANEL_ID = 'liAdminUsagePanel';
  const STYLE_ID = 'li-admin-usage-style';
  let loading = false;
  let installed = false;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function db() {
    return global.SupabaseClient?.getClient?.() || global.supabase || null;
  }

  function notify(message, type = '') {
    try {
      if (global.UI?.toast) return global.UI.toast(message, type || undefined);
      if (global.U?.toast) return global.U.toast(message, type || undefined);
    } catch (_) {}
    console[type === 'error' ? 'error' : 'log']('[Lead Intelligence Admin]', message);
  }

  function money(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '$0.00';
    if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  }

  function limitLabel(used, limit) {
    const u = Number(used || 0);
    return `${u} / ${limit == null ? '∞' : Number(limit)}`;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{margin-top:18px;color:inherit}
      #${PANEL_ID}[hidden]{display:none!important}
      .li-admin-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px;flex-wrap:wrap}
      .li-admin-head h2{margin:2px 0 4px;font-size:1.2rem}
      .li-admin-head p{margin:0;max-width:850px}
      .li-admin-summary{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;margin:12px 0 16px}
      .li-admin-summary article{border:1px solid rgba(127,127,127,.22);border-radius:12px;padding:12px 14px;background:rgba(127,127,127,.05)}
      .li-admin-summary span{display:block;font-size:.75rem;opacity:.7;margin-bottom:5px}
      .li-admin-summary strong{font-size:1.25rem}
      .li-admin-table-wrap{overflow:auto;border:1px solid rgba(127,127,127,.2);border-radius:12px}
      .li-admin-table{width:100%;border-collapse:collapse;min-width:1040px;background:transparent;color:inherit}
      .li-admin-table th,.li-admin-table td{padding:10px 9px;border-bottom:1px solid rgba(127,127,127,.17);text-align:left;vertical-align:middle;font-size:.84rem}
      .li-admin-table th{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;opacity:.75;white-space:nowrap;background:rgba(127,127,127,.06)}
      .li-admin-table tr:last-child td{border-bottom:0}
      .li-admin-user strong{display:block;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .li-admin-user small{display:block;opacity:.65;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .li-admin-role{display:inline-flex;padding:3px 7px;border-radius:999px;background:rgba(127,127,127,.12);font-size:.72rem;text-transform:uppercase}
      .li-admin-usage-cell strong{display:block;white-space:nowrap}.li-admin-usage-cell small{display:block;opacity:.65;margin-top:2px;white-space:nowrap}
      .li-admin-cost strong{display:block;white-space:nowrap}.li-admin-cost small{display:block;opacity:.65;white-space:nowrap}
      .li-admin-limit{width:76px!important;min-width:76px!important;padding:7px 8px!important}
      .li-admin-default{font-size:.68rem;opacity:.65;white-space:nowrap}
      .li-admin-save{white-space:nowrap}
      .li-admin-note{font-size:.76rem;opacity:.72;margin:10px 2px 0;line-height:1.45}
      .li-admin-warning{margin-top:10px;padding:9px 11px;border-radius:9px;background:rgba(225,145,0,.1);border:1px solid rgba(225,145,0,.25);font-size:.78rem}
      .li-admin-empty{padding:18px;text-align:center;opacity:.7}
      @media(max-width:900px){.li-admin-summary{grid-template-columns:repeat(2,minmax(120px,1fr))}}
      @media(max-width:520px){.li-admin-summary{grid-template-columns:1fr 1fr}.li-admin-head{display:block}.li-admin-head button{margin-top:10px}}
    `;
    document.head.appendChild(style);
  }

  function panelMarkup() {
    return `
      <div class="li-admin-head">
        <div>
          <span class="li-kicker">Admin / GM control</span>
          <h2>AI Usage & Limits</h2>
          <p class="muted">Lead Intelligence paid-request activity by user. Reused 24-hour searches do not create a new run and do not consume another request limit.</p>
        </div>
        <button id="liAdminRefresh" type="button" class="btn ghost sm">Refresh usage</button>
      </div>
      <div id="liAdminSummary" class="li-admin-summary">
        <article><span>Requests today</span><strong>—</strong></article>
        <article><span>Requests this week</span><strong>—</strong></article>
        <article><span>Requests this month</span><strong>—</strong></article>
        <article><span>Est. month cost</span><strong>—</strong></article>
      </div>
      <div class="li-admin-table-wrap">
        <table class="li-admin-table">
          <thead><tr>
            <th>User</th><th>Role</th><th>Today</th><th>Week</th><th>Month</th><th>Estimated cost</th>
            <th>Daily limit</th><th>Weekly limit</th><th>Monthly limit</th><th></th>
          </tr></thead>
          <tbody id="liAdminRows"><tr><td colspan="10" class="li-admin-empty">Loading usage…</td></tr></tbody>
        </table>
      </div>
      <div id="liAdminWarning" class="li-admin-warning" hidden></div>
      <p class="li-admin-note">Blank limit = unlimited. Default limits are 10/day, 50/week and 150/month until an Admin/GM saves a custom value. Limits are enforced server-side before a new research run can be created. Periods reset on UTC calendar boundaries. Cost is a conservative estimate from recorded model tokens plus the maximum configured web-search allowance; historical runs with missing usage are flagged.</p>`;
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) return true;
    const view = document.getElementById('leadIntelligenceView');
    if (!view) return false;
    installStyle();
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'li-panel li-admin-usage';
    panel.hidden = true;
    panel.innerHTML = panelMarkup();
    const stats = view.querySelector('.li-stats');
    if (stats?.parentNode) stats.parentNode.insertBefore(panel, stats.nextSibling);
    else view.appendChild(panel);
    wirePanel(panel);
    installed = true;
    return true;
  }

  function render(rows) {
    const body = document.getElementById('liAdminRows');
    const summary = document.getElementById('liAdminSummary');
    const warning = document.getElementById('liAdminWarning');
    if (!body || !summary) return;

    const list = Array.isArray(rows) ? rows : [];
    const totals = list.reduce((a, r) => {
      a.today += Number(r.today_requests || 0);
      a.week += Number(r.week_requests || 0);
      a.month += Number(r.month_requests || 0);
      a.cost += Number(r.month_cost_usd || 0);
      a.unpriced += Number(r.unpriced_month_requests || 0);
      return a;
    }, { today: 0, week: 0, month: 0, cost: 0, unpriced: 0 });

    summary.innerHTML = `
      <article><span>Requests today</span><strong>${totals.today}</strong></article>
      <article><span>Requests this week</span><strong>${totals.week}</strong></article>
      <article><span>Requests this month</span><strong>${totals.month}</strong></article>
      <article><span>Est. month cost</span><strong>${money(totals.cost)}</strong></article>`;

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="10" class="li-admin-empty">No active users found.</td></tr>';
    } else {
      body.innerHTML = list.map(r => {
        const id = esc(r.user_id);
        const defaults = r.uses_default_limits ? '<span class="li-admin-default">default</span>' : '';
        return `<tr data-li-admin-user="${id}">
          <td class="li-admin-user"><strong>${esc(r.user_name || 'User')}</strong><small>${esc(r.email || '')}</small></td>
          <td><span class="li-admin-role">${esc(r.role_key || 'user')}</span></td>
          <td class="li-admin-usage-cell"><strong>${esc(limitLabel(r.today_requests, r.daily_limit))}</strong><small>${Number(r.today_results || 0)} leads · ${Number(r.today_failed || 0)} failed</small></td>
          <td class="li-admin-usage-cell"><strong>${esc(limitLabel(r.week_requests, r.weekly_limit))}</strong><small>${Number(r.week_results || 0)} leads · ${Number(r.week_failed || 0)} failed</small></td>
          <td class="li-admin-usage-cell"><strong>${esc(limitLabel(r.month_requests, r.monthly_limit))}</strong><small>${Number(r.month_results || 0)} leads · ${Number(r.month_failed || 0)} failed</small></td>
          <td class="li-admin-cost"><strong>${money(r.month_cost_usd)}</strong><small>Today ${money(r.today_cost_usd)} · Week ${money(r.week_cost_usd)}</small></td>
          <td><input class="input li-admin-limit" data-limit="daily" type="number" min="0" max="100000" value="${r.daily_limit == null ? '' : Number(r.daily_limit)}" aria-label="Daily request limit for ${esc(r.user_name || 'user')}">${defaults}</td>
          <td><input class="input li-admin-limit" data-limit="weekly" type="number" min="0" max="100000" value="${r.weekly_limit == null ? '' : Number(r.weekly_limit)}" aria-label="Weekly request limit for ${esc(r.user_name || 'user')}"></td>
          <td><input class="input li-admin-limit" data-limit="monthly" type="number" min="0" max="100000" value="${r.monthly_limit == null ? '' : Number(r.monthly_limit)}" aria-label="Monthly request limit for ${esc(r.user_name || 'user')}"></td>
          <td><button type="button" class="btn primary sm li-admin-save" data-li-save-limit="${id}">Save</button></td>
        </tr>`;
      }).join('');
    }

    if (warning) {
      warning.hidden = totals.unpriced === 0;
      warning.textContent = totals.unpriced
        ? `${totals.unpriced} request${totals.unpriced === 1 ? '' : 's'} this month has incomplete historical usage data, so the displayed cost does not include its unknown token/search charges.`
        : '';
    }
  }

  async function load() {
    if (loading || !ensurePanel()) return;
    const supabase = db();
    if (!supabase) return;
    loading = true;
    const panel = document.getElementById(PANEL_ID);
    const refresh = document.getElementById('liAdminRefresh');
    if (refresh) { refresh.disabled = true; refresh.textContent = 'Refreshing…'; }
    try {
      const { data, error } = await supabase.rpc('lead_intelligence_admin_dashboard');
      if (error) {
        panel.hidden = true;
        if (!/Admin or GM access is required/i.test(clean(error.message))) console.warn('[Lead Intelligence Admin]', error);
        return;
      }
      panel.hidden = false;
      render(data || []);
    } catch (error) {
      if (panel) panel.hidden = true;
      console.warn('[Lead Intelligence Admin]', error);
    } finally {
      loading = false;
      if (refresh) { refresh.disabled = false; refresh.textContent = 'Refresh usage'; }
    }
  }

  function parseLimit(input) {
    const raw = clean(input?.value);
    if (raw === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error('Limits must be whole numbers from 0 to 100000, or blank for unlimited.');
    return n;
  }

  async function save(button) {
    const row = button?.closest?.('[data-li-admin-user]');
    const userId = clean(row?.getAttribute('data-li-admin-user'));
    if (!row || !userId) return;
    const supabase = db();
    if (!supabase) return;
    try {
      const daily = parseLimit(row.querySelector('[data-limit="daily"]'));
      const weekly = parseLimit(row.querySelector('[data-limit="weekly"]'));
      const monthly = parseLimit(row.querySelector('[data-limit="monthly"]'));
      button.disabled = true;
      button.textContent = 'Saving…';
      const { error } = await supabase.rpc('lead_intelligence_set_user_limits', {
        p_user_id: userId,
        p_daily_limit: daily,
        p_weekly_limit: weekly,
        p_monthly_limit: monthly,
      });
      if (error) throw error;
      notify('Lead Intelligence limits updated.');
      await load();
    } catch (error) {
      notify(clean(error?.message) || 'Unable to update limits.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Save';
    }
  }

  function wirePanel(panel) {
    panel.addEventListener('click', event => {
      const saveButton = event.target?.closest?.('[data-li-save-limit]');
      if (saveButton) return void save(saveButton);
      if (event.target?.closest?.('#liAdminRefresh')) return void load();
    });
  }

  function boot() {
    let attempts = 0;
    const tryInstall = () => {
      if (ensurePanel()) {
        void load();
        return;
      }
      if (attempts++ < 80) setTimeout(tryInstall, 250);
    };
    tryInstall();
  }

  document.addEventListener('click', event => {
    if (event.target?.closest?.('#leadIntelligenceTab')) setTimeout(() => void load(), 80);
    if (event.target?.closest?.('#liRefreshBtn')) setTimeout(() => void load(), 80);
  }, true);

  global.addEventListener('focus', () => {
    const panel = document.getElementById(PANEL_ID);
    if (installed && panel && !panel.hidden) void load();
  });

  global.InCheck360LeadIntelligenceAdmin = Object.freeze({ version: VERSION, refresh: load });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
