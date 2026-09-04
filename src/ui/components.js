const STATUS_GROUPS = {
  success: new Set(['active','active client','paid','completed','complete','accepted','signed','approved','resolved','verified','success','successful','settled','received','renewed']),
  warning: new Set(['pending','due','awaiting','awaiting approval','under review','review','partially paid','partial','scheduled','upcoming','warning','on hold']),
  danger: new Set(['overdue','rejected','critical','failed','failure','cancelled','canceled','expired','declined','blocked','error','past due']),
  info: new Set(['draft','in progress','in-progress','prospect','sent','open','new','lead','proposal','agreement','processing','working']),
  neutral: new Set(['archived','inactive','void','closed','disabled','unknown','not verified','unverified'])
};

export function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

export function normalize(value) {
  return clean(value).toLowerCase();
}

export function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function statusTone(value) {
  const text = normalize(value);
  for (const [tone, values] of Object.entries(STATUS_GROUPS)) {
    if (values.has(text)) return tone;
  }
  return 'neutral';
}

function mountTarget(target) {
  if (target instanceof Element) return target;
  if (typeof target === 'string') return document.querySelector(target);
  return null;
}

export const AppShell = {
  adopt() {
    const app = document.getElementById('app') || document.querySelector('main')?.parentElement || document.body;
    if (app) app.classList.add('icds-app-shell');
    return app;
  }
};

export const PageLayout = {
  adopt(view) {
    if (!(view instanceof Element)) return null;
    view.classList.add('icds-page');
    return view;
  }
};

export const PageHeader = {
  render(target, { group = 'Workspace', title = 'Module', subtitle = '', actions = [] } = {}) {
    const host = mountTarget(target);
    if (!host) return null;
    const header = document.createElement('section');
    header.className = 'icds-page-header';
    header.dataset.icdsComponent = 'page-header';
    header.innerHTML = `
      <div class="icds-breadcrumb"><span>${escapeHtml(group)}</span><span aria-hidden="true">/</span><strong>${escapeHtml(title)}</strong></div>
      <div class="icds-toolbar">
        <div>
          <h2 style="margin:0">${escapeHtml(title)}</h2>
          ${subtitle ? `<p style="margin:4px 0 0;color:var(--icds-muted);font-size:12px">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <div data-icds-header-actions></div>
      </div>
    `;
    const actionHost = header.querySelector('[data-icds-header-actions]');
    actions.filter(Boolean).forEach(action => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action.className || 'btn primary';
      btn.textContent = action.label || 'Action';
      if (typeof action.onClick === 'function') btn.addEventListener('click', action.onClick);
      actionHost.appendChild(btn);
    });
    host.appendChild(header);
    return header;
  },

  adopt(header, { group = 'Workspace', title = '' } = {}) {
    if (!(header instanceof Element)) return null;
    header.classList.add('icds-page-header');
    header.dataset.icdsComponent = 'page-header';
    if (!header.querySelector('.icds-breadcrumb')) {
      const crumb = document.createElement('div');
      crumb.className = 'icds-breadcrumb';
      crumb.innerHTML = `<span>${escapeHtml(group)}</span><span aria-hidden="true">/</span><strong>${escapeHtml(title || group)}</strong>`;
      header.prepend(crumb);
    }
    return header;
  }
};

export const ActionBar = {
  adopt(element) {
    if (!(element instanceof Element)) return null;
    element.classList.add('icds-toolbar');
    element.dataset.icdsComponent = 'action-bar';
    return element;
  }
};

export const FilterPanel = {
  render(target, { id = '', title = 'Filters', filters = [], values = {}, onChange = null, collapsed = true } = {}) {
    const host = mountTarget(target);
    if (!host) return null;
    const key = id || `icdsFilter${Date.now().toString(36)}`;
    const wrapper = document.createElement('section');
    wrapper.dataset.icdsComponent = 'filter-panel';
    wrapper.innerHTML = `
      <div class="ic-filter-toggle-row">
        <button type="button" data-icds-filter-toggle aria-expanded="${collapsed ? 'false' : 'true'}" aria-controls="${escapeHtml(key)}">
          <span aria-hidden="true">⌁</span><span>Filters</span><span aria-hidden="true">▾</span>
        </button>
      </div>
      <div id="${escapeHtml(key)}" class="icds-filter-panel" ${collapsed ? 'hidden' : ''}>
        <h3 style="margin:0 0 12px">${escapeHtml(title)}</h3>
        <div data-icds-filter-fields style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px"></div>
      </div>
    `;
    const fieldsHost = wrapper.querySelector('[data-icds-filter-fields]');
    const panel = wrapper.querySelector('.icds-filter-panel');
    const toggle = wrapper.querySelector('[data-icds-filter-toggle]');

    filters.forEach(filter => {
      const label = document.createElement('label');
      label.style.display = 'grid';
      label.style.gap = '5px';
      label.innerHTML = `<span style="font-size:11px;font-weight:750;color:var(--icds-muted)">${escapeHtml(filter.label || filter.key || 'Filter')}</span>`;
      let control;
      if (filter.type === 'select') {
        control = document.createElement('select');
        (filter.options || []).forEach(option => {
          const value = typeof option === 'object' ? option.value : option;
          const text = typeof option === 'object' ? option.label : option;
          const node = document.createElement('option');
          node.value = value ?? '';
          node.textContent = text ?? '';
          control.appendChild(node);
        });
      } else {
        control = document.createElement('input');
        control.type = filter.type || 'text';
        if (filter.placeholder) control.placeholder = filter.placeholder;
      }
      control.dataset.filterKey = filter.key || '';
      if (values[filter.key] != null) control.value = values[filter.key];
      if (typeof onChange === 'function') {
        const eventName = control.tagName === 'SELECT' ? 'change' : 'input';
        control.addEventListener(eventName, () => onChange(filter.key, control.value, control));
      }
      label.appendChild(control);
      fieldsHost.appendChild(label);
    });

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      panel.hidden = expanded;
    });

    host.appendChild(wrapper);
    return wrapper;
  },

  adopt(panel) {
    if (!(panel instanceof Element)) return null;
    panel.classList.add('icds-filter-panel');
    panel.dataset.icdsComponent = 'filter-panel';
    return panel;
  }
};

export const StatusBadge = {
  render(value, tone = statusTone(value)) {
    const span = document.createElement('span');
    span.dataset.icdsStatus = tone;
    span.textContent = clean(value) || '—';
    return span;
  },

  adopt(element, value = element?.textContent) {
    if (!(element instanceof Element)) return null;
    element.dataset.icdsStatus = statusTone(value);
    element.dataset.icdsComponent = 'status-badge';
    return element;
  }
};

export const DataTable = {
  render(target, { columns = [], rows = [], actions = [], emptyMessage = 'No records found.' } = {}) {
    const host = mountTarget(target);
    if (!host) return null;
    host.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'icds-table-shell';
    shell.dataset.icdsComponent = 'data-table';
    const table = document.createElement('table');
    table.className = 'icds-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>${columns.map(col => `<th>${escapeHtml(col.label || col.key)}</th>`).join('')}${actions.length ? '<th>Actions</th>' : ''}</tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach(col => {
        const td = document.createElement('td');
        const value = typeof col.render === 'function' ? col.render(row[col.key], row, td) : row[col.key];
        if (value instanceof Node) td.appendChild(value);
        else if (col.type === 'status') td.appendChild(StatusBadge.render(value));
        else td.textContent = value == null || value === '' ? '—' : String(value);
        tr.appendChild(td);
      });
      if (actions.length) {
        const td = document.createElement('td');
        actions.filter(Boolean).forEach(action => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = action.className || 'btn ghost sm';
          btn.textContent = action.label || 'Action';
          btn.addEventListener('click', () => action.onClick?.(row));
          td.appendChild(btn);
        });
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    shell.appendChild(table);
    host.appendChild(shell);

    if (!rows.length) EmptyState.render(host, emptyMessage);
    return { shell, table };
  },

  adopt(table) {
    if (!(table instanceof HTMLTableElement)) return null;
    table.classList.add('icds-table');
    table.dataset.icdsComponent = 'data-table';
    const shell = table.closest('.table-wrap,.table-wrapper,.table-responsive,.table-container,.data-table-wrap,[class*="table-wrap"],[class*="table-container"]') || table.parentElement;
    if (shell && shell !== document.body) shell.classList.add('icds-table-shell');
    return { table, shell };
  }
};

export const KpiCard = {
  render(target, { label = '', value = '', hint = '', onClick = null } = {}) {
    const host = mountTarget(target);
    if (!host) return null;
    const card = document.createElement(onClick ? 'button' : 'div');
    if (onClick) card.type = 'button';
    card.className = 'icds-kpi-card';
    card.dataset.icdsComponent = 'kpi-card';
    card.innerHTML = `
      <div style="padding:14px">
        <div style="font-size:11px;font-weight:750;color:var(--icds-muted)">${escapeHtml(label)}</div>
        <div style="margin-top:5px;font-size:22px;font-weight:850;color:var(--icds-text)">${escapeHtml(value)}</div>
        ${hint ? `<div style="margin-top:4px;font-size:10.5px;color:var(--icds-muted)">${escapeHtml(hint)}</div>` : ''}
      </div>`;
    if (onClick) card.addEventListener('click', onClick);
    host.appendChild(card);
    return card;
  },

  adopt(card) {
    if (!(card instanceof Element)) return null;
    card.classList.add('icds-kpi-card');
    card.dataset.icdsComponent = 'kpi-card';
    return card;
  }
};

export const KpiGrid = {
  adopt(grid) {
    if (!(grid instanceof Element)) return null;
    grid.classList.add('icds-kpi-grid');
    grid.dataset.icdsComponent = 'kpi-grid';
    return grid;
  }
};

export const FormSection = {
  adopt(form) {
    if (!(form instanceof Element)) return null;
    form.classList.add('icds-form');
    form.dataset.icdsComponent = 'form';
    return form;
  }
};

export const Drawer = {
  adopt(modal) {
    if (!(modal instanceof Element)) return null;
    modal.classList.add('icds-drawer');
    modal.dataset.icdsComponent = 'drawer';
    return modal;
  }
};

export const EmptyState = {
  render(target, message = 'No records found.') {
    const host = mountTarget(target);
    if (!host) return null;
    const el = document.createElement('div');
    el.className = 'icds-empty';
    el.dataset.icdsComponent = 'empty-state';
    el.textContent = message;
    host.appendChild(el);
    return el;
  }
};

export const Pagination = {
  adopt(element) {
    if (!(element instanceof Element)) return null;
    element.classList.add('icds-pagination');
    element.dataset.icdsComponent = 'pagination';
    return element;
  }
};

export const DropdownMenu = {
  adopt(element) {
    if (!(element instanceof Element)) return null;
    element.classList.add('icds-dropdown');
    element.dataset.icdsComponent = 'dropdown-menu';
    return element;
  }
};

export const UIComponents = Object.freeze({
  AppShell,
  PageLayout,
  PageHeader,
  ActionBar,
  FilterPanel,
  DataTable,
  StatusBadge,
  KpiCard,
  KpiGrid,
  FormSection,
  Drawer,
  EmptyState,
  Pagination,
  DropdownMenu,
  statusTone,
  clean,
  normalize
});
