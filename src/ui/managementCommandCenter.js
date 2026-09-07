const MANAGEMENT_ROLES = new Set(['admin','gm','hoo','head_of_sales','sfc','accounting','csm','dev']);

const state = {
  loading: false,
  loadedAt: 0,
  data: null,
  error: ''
};

function normalizeRole(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function currentRole() {
  const profile = window.Session?.authContext?.()?.profile || window.Session?.user?.() || {};
  return normalizeRole(profile.role_key || profile.role || window.Session?.role?.() || '');
}

function canUseCommandCenter() {
  return !document.body?.classList.contains('auth-locked') && MANAGEMENT_ROLES.has(currentRole());
}

function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
}

function tabForRoute(route = '') {
  const map = {
    invoices: 'invoicesTab',
    workflow: 'workflowTab',
    issues: 'issuesTab',
    clientSuccess: 'clientSuccessTab',
    renewalForecast: 'renewalForecastTab',
    deals: 'dealsTab'
  };
  return map[route] || '';
}

function openRoute(route = '') {
  const id = tabForRoute(route);
  const tab = id ? document.getElementById(id) : null;
  if (tab) tab.click();
}

function ensureRoot() {
  if (!canUseCommandCenter()) return null;
  const issuesView = document.getElementById('issuesView');
  if (!issuesView) return null;
  let root = document.getElementById('managementCommandCenter');
  if (!root) {
    root = document.createElement('section');
    root.id = 'managementCommandCenter';
    root.className = 'management-command-center';
    root.setAttribute('aria-label', 'Management command center');
    issuesView.prepend(root);
  }
  return root;
}

function renderLoading() {
  const root = ensureRoot();
  if (!root) return;
  root.innerHTML = `
    <div class="mcc-header">
      <div><span class="mcc-eyebrow">Management · Today</span><h2>Needs Attention</h2><p>Loading operational priorities…</p></div>
    </div>
    <div class="mcc-grid">${Array.from({ length: 6 }, () => '<div class="mcc-card mcc-skeleton"></div>').join('')}</div>`;
}

function card({ label, value, detail, route, tone = 'neutral' }) {
  return `<button type="button" class="mcc-card mcc-${tone}" data-mcc-route="${esc(route)}">
    <span class="mcc-label">${esc(label)}</span>
    <strong class="mcc-value">${esc(value)}</strong>
    <span class="mcc-detail">${esc(detail)}</span>
  </button>`;
}

function renderData(data) {
  const root = ensureRoot();
  if (!root) return;
  const visibility = data?.visibility || {};
  const metrics = data?.metrics || {};
  const cards = [];

  if (visibility.finance) {
    cards.push(card({
      label: 'Overdue invoices',
      value: String(metrics.overdue_invoices?.count || 0),
      detail: `${formatMoney(metrics.overdue_invoices?.amount || 0)} outstanding`,
      route: 'invoices',
      tone: Number(metrics.overdue_invoices?.count || 0) > 0 ? 'critical' : 'good'
    }));
  }
  if (visibility.renewals) {
    cards.push(card({ label: 'Renewals ≤ 30 days', value: String(metrics.renewals_30d?.count || 0), detail: 'Upcoming service expiries', route: 'renewalForecast', tone: Number(metrics.renewals_30d?.count || 0) > 0 ? 'medium' : 'good' }));
  }
  if (visibility.tickets) {
    cards.push(card({ label: 'High-priority tickets', value: String(metrics.high_priority_tickets?.count || 0), detail: 'Open critical / high issues', route: 'issues', tone: Number(metrics.high_priority_tickets?.count || 0) > 0 ? 'high' : 'good' }));
  }
  if (visibility.sales) {
    cards.push(card({ label: 'Stale deals', value: String(metrics.stale_deals?.count || 0), detail: 'No activity for 7+ days', route: 'deals', tone: Number(metrics.stale_deals?.count || 0) > 0 ? 'medium' : 'good' }));
  }
  if (visibility.onboarding) {
    cards.push(card({ label: 'Delayed onboarding', value: String(metrics.delayed_onboarding?.count || 0), detail: 'Go-live target has passed', route: 'clientSuccess', tone: Number(metrics.delayed_onboarding?.count || 0) > 0 ? 'high' : 'good' }));
  }
  if (visibility.approvals) {
    cards.push(card({ label: 'Pending approvals', value: String(metrics.pending_approvals?.count || 0), detail: 'Management action required', route: 'workflow', tone: Number(metrics.pending_approvals?.count || 0) > 0 ? 'high' : 'good' }));
  }

  const attention = Array.isArray(data?.attention) ? [...data.attention].sort((a,b) => Number(a.rank || 99) - Number(b.rank || 99)) : [];
  const generated = data?.generated_at ? new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';

  root.innerHTML = `
    <div class="mcc-header">
      <div>
        <span class="mcc-eyebrow">Management · Today</span>
        <h2>Needs Attention</h2>
        <p>Operational exceptions that may need action today. Updated ${esc(generated)}.</p>
      </div>
      <button type="button" class="btn ghost sm" data-mcc-refresh>Refresh</button>
    </div>
    <div class="mcc-grid">${cards.join('') || '<div class="mcc-empty">No management metrics are available for this role.</div>'}</div>
    <div class="mcc-attention">
      <div class="mcc-attention-head"><strong>Priority queue</strong><span>${attention.length ? `${attention.length} area${attention.length === 1 ? '' : 's'} need attention` : 'No exceptions detected'}</span></div>
      ${attention.length ? attention.map(item => `
        <button type="button" class="mcc-attention-row mcc-${esc(item.tone || 'neutral')}" data-mcc-route="${esc(item.route || '')}">
          <span class="mcc-attention-count">${esc(item.count || 0)}</span>
          <span class="mcc-attention-copy"><strong>${esc(item.title || '')}</strong><small>${esc(item.detail || '')}</small></span>
          <span class="mcc-open">Open →</span>
        </button>`).join('') : '<div class="mcc-all-clear"><strong>All clear.</strong> No current management exceptions in the monitored areas.</div>'}
    </div>`;
}

function renderError(message) {
  const root = ensureRoot();
  if (!root) return;
  root.innerHTML = `
    <div class="mcc-header"><div><span class="mcc-eyebrow">Management · Today</span><h2>Needs Attention</h2><p>Unable to load the management summary.</p></div><button type="button" class="btn ghost sm" data-mcc-refresh>Retry</button></div>
    <div class="mcc-error">${esc(message || 'Management summary unavailable.')}</div>`;
}

async function load({ force = false } = {}) {
  if (!canUseCommandCenter()) return;
  const root = ensureRoot();
  if (!root || state.loading) return;
  const age = Date.now() - state.loadedAt;
  if (!force && state.data && age < 120000) {
    renderData(state.data);
    return;
  }

  state.loading = true;
  state.error = '';
  renderLoading();
  try {
    const sb = window.SupabaseClient?.getClient?.();
    if (!sb?.rpc) throw new Error('Supabase client is unavailable.');
    const { data, error } = await sb.rpc('get_management_attention_summary');
    if (error) throw error;
    state.data = data || {};
    state.loadedAt = Date.now();
    renderData(state.data);
  } catch (error) {
    state.error = String(error?.message || error || 'Unable to load management summary.');
    renderError(state.error);
  } finally {
    state.loading = false;
  }
}

function activate({ force = false } = {}) {
  if (!canUseCommandCenter()) return;
  window.setTimeout(() => {
    if (!ensureRoot()) return;
    load({ force });
  }, 0);
}

window.addEventListener('incheck360:auth-ready', () => activate({ force: true }));

document.addEventListener('click', event => {
  const refresh = event.target?.closest?.('[data-mcc-refresh]');
  if (refresh) {
    event.preventDefault();
    load({ force: true });
    return;
  }
  const route = event.target?.closest?.('[data-mcc-route]')?.dataset?.mccRoute;
  if (route) {
    event.preventDefault();
    openRoute(route);
    return;
  }
  if (event.target?.closest?.('#issuesTab')) activate();
}, true);

export const ManagementCommandCenter = Object.freeze({ load, activate });
