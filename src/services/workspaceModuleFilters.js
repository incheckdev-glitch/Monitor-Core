(function installInCheck360WorkspaceModuleFilters(global) {
  let retryTimer = null;
  let installed = false;

  const EVENT_FILTERS = [
    ['eventFilterDeployment', 'Deployment'],
    ['eventFilterMaintenance', 'Maintenance'],
    ['eventFilterRelease', 'Release'],
    ['eventFilterOther', 'Other']
  ];

  function installStyles() {
    if (document.getElementById('incheck360-workspace-module-filters-style')) return;
    const style = document.createElement('style');
    style.id = 'incheck360-workspace-module-filters-style';
    style.textContent = `
      body:not(.auth-locked) #sidebar{display:none!important;}
      body:not(.auth-locked) #drawerBtn{display:none!important;}

      body:not(.auth-locked) .ic-module-filter-slot{
        width:100%;
        margin:10px 0 14px;
        position:relative;
        z-index:2;
        pointer-events:auto;
      }

      body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card{
        width:100%;
        margin:0!important;
        padding:16px!important;
        border:1px solid #dfe6f1!important;
        border-radius:14px!important;
        background:#fff!important;
        box-shadow:0 7px 22px rgba(15,23,42,.06)!important;
        pointer-events:auto!important;
      }

      body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card > h3{
        margin:0 0 14px!important;
        color:#0f172a!important;
        font-size:14px!important;
        font-weight:800!important;
      }

      body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card .filter-group{
        display:grid!important;
        grid-template-columns:repeat(4,minmax(150px,1fr))!important;
        gap:12px!important;
        align-items:end!important;
      }

      body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card .filter-row{
        min-width:0!important;
      }

      body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card .divider{
        margin:14px 0!important;
      }

      body:not(.auth-locked) .ic-events-filter-toggle-row{
        display:flex;
        align-items:center;
        justify-content:flex-start;
        margin:8px 0 12px;
      }

      body:not(.auth-locked) .ic-events-filter-toggle{
        min-height:40px;
        padding:0 15px;
        display:inline-flex;
        align-items:center;
        gap:8px;
        border:1px solid #1546e8;
        border-radius:10px;
        background:#1546e8;
        color:#fff;
        font:inherit;
        font-size:13px;
        font-weight:800;
        cursor:pointer;
        box-shadow:0 4px 12px rgba(21,70,232,.18);
      }

      body:not(.auth-locked) .ic-events-filter-toggle:hover{background:#123ccd;border-color:#123ccd;}
      body:not(.auth-locked) .ic-events-filter-toggle:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(21,70,232,.2);}
      body:not(.auth-locked) .ic-events-filter-toggle-arrow{transition:transform .16s ease;}
      body:not(.auth-locked) .ic-events-filter-toggle[aria-expanded="true"] .ic-events-filter-toggle-arrow{transform:rotate(180deg);}
      body:not(.auth-locked) .ic-events-filter-count{
        display:none;
        min-width:19px;
        height:19px;
        padding:0 6px;
        align-items:center;
        justify-content:center;
        border-radius:999px;
        background:#fff;
        color:#1546e8;
        font-size:10px;
        font-weight:900;
      }
      body:not(.auth-locked) .ic-events-filter-count.is-visible{display:inline-flex;}

      body:not(.auth-locked) .ic-events-filter-card{
        padding:15px 16px;
        border:1px solid #dfe6f1;
        border-radius:14px;
        background:#fff;
        box-shadow:0 7px 22px rgba(15,23,42,.06);
      }
      body:not(.auth-locked) .ic-events-filter-card[hidden]{display:none!important;}
      body:not(.auth-locked) .ic-events-filter-title{
        margin:0 0 12px;
        color:#0f172a;
        font-size:14px;
        font-weight:800;
      }
      body:not(.auth-locked) .ic-events-filter-options{
        display:flex;
        align-items:center;
        gap:10px;
        flex-wrap:wrap;
      }
      body:not(.auth-locked) .ic-events-filter-chip{
        display:inline-flex;
        align-items:center;
        gap:8px;
        min-height:38px;
        padding:0 12px;
        border:1px solid #dbe3ef;
        border-radius:10px;
        background:#f8fafc;
        color:#334155;
        font-size:12px;
        font-weight:700;
        cursor:pointer;
        user-select:none;
      }
      body:not(.auth-locked) .ic-events-filter-chip:hover{border-color:#a9bdf4;background:#f4f7ff;}
      body:not(.auth-locked) .ic-events-filter-chip input{accent-color:#1546e8;}
      body:not(.auth-locked) .ic-event-filter-source-hidden{display:none!important;}

      :root:not([data-theme="light"]) body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card,
      :root[data-theme="dark"] body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card,
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-events-filter-card,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-events-filter-card{
        background:#111827!important;
        border-color:#334155!important;
        color:#dbe4f0!important;
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card > h3,
      :root[data-theme="dark"] body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card > h3,
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-events-filter-title,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-events-filter-title{color:#f8fafc!important;}
      :root:not([data-theme="light"]) body:not(.auth-locked) .ic-events-filter-chip,
      :root[data-theme="dark"] body:not(.auth-locked) .ic-events-filter-chip{
        background:#172033;
        border-color:#334155;
        color:#dbe4f0;
      }

      @media(max-width:1100px){
        body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card .filter-group{
          grid-template-columns:repeat(2,minmax(160px,1fr))!important;
        }
      }
      @media(max-width:700px){
        body:not(.auth-locked) #mainFiltersPanel.tickets-filter-card .filter-group{
          grid-template-columns:minmax(0,1fr)!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function placeSlot(view, slot, selectors = []) {
    if (!view || !slot || slot.parentElement === view) return;
    const anchor = selectors.map(selector => view.querySelector(selector)).find(Boolean);
    if (anchor && anchor.parentElement === view) anchor.insertAdjacentElement('afterend', slot);
    else view.prepend(slot);
  }

  function installTicketFilters() {
    const view = document.getElementById('issuesView');
    const panel = document.getElementById('mainFiltersPanel');
    if (!view || !panel) return false;

    let slot = document.getElementById('ticketsModuleFilterSlot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'ticketsModuleFilterSlot';
      slot.className = 'ic-module-filter-slot';
    }

    placeSlot(view, slot, ['.issues-header', '.page-header', '.section-head', '.kpi-grid', '.summary-grid']);
    if (panel.parentElement !== slot) slot.appendChild(panel);
    panel.classList.add('tickets-filter-card');
    panel.setAttribute('aria-label', 'Ticket filters');

    const title = panel.querySelector(':scope > h3');
    if (title) title.textContent = 'Ticket Filters';

    global.InCheck360CollapsibleFilters?.refresh?.();
    return true;
  }

  function getOriginalEventFilter(id) {
    return document.getElementById(id);
  }

  function hideOriginalEventFilter(original) {
    if (!original) return;
    const source = original.closest('label') || original.parentElement;
    if (source && !source.closest('#eventsModuleFilterCard')) source.classList.add('ic-event-filter-source-hidden');
  }

  function syncEventFilterBadge(card) {
    if (!card) return;
    const proxies = Array.from(card.querySelectorAll('[data-event-filter-proxy]'));
    const restricted = proxies.filter(input => !input.checked).length;
    const badge = card.parentElement?.querySelector('.ic-events-filter-count');
    if (badge) {
      badge.textContent = String(restricted);
      badge.classList.toggle('is-visible', restricted > 0);
    }
  }

  function installEventFilters() {
    const view = document.getElementById('calendarView');
    if (!view) return false;

    const originals = EVENT_FILTERS.map(([id, label]) => [getOriginalEventFilter(id), label, id]).filter(([el]) => el);
    if (!originals.length) return false;

    let slot = document.getElementById('eventsModuleFilterSlot');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'eventsModuleFilterSlot';
      slot.className = 'ic-module-filter-slot';
      slot.innerHTML = `
        <div class="ic-events-filter-toggle-row">
          <button id="eventsModuleFilterToggle" class="ic-events-filter-toggle" type="button" aria-expanded="false" aria-controls="eventsModuleFilterCard">
            <span aria-hidden="true">⌁</span>
            <span>Filters</span>
            <span class="ic-events-filter-count">0</span>
            <span class="ic-events-filter-toggle-arrow" aria-hidden="true">▾</span>
          </button>
        </div>
        <section id="eventsModuleFilterCard" class="ic-events-filter-card" aria-label="Event filters" hidden>
          <h3 class="ic-events-filter-title">Event Filters</h3>
          <div class="ic-events-filter-options"></div>
        </section>`;
    }

    placeSlot(view, slot, ['.calendar-header', '.page-header', '.section-head', '.calendar-toolbar']);

    const card = slot.querySelector('#eventsModuleFilterCard');
    const options = card?.querySelector('.ic-events-filter-options');
    if (!card || !options) return false;

    originals.forEach(([original, label, sourceId]) => {
      hideOriginalEventFilter(original);
      let proxy = options.querySelector(`[data-event-filter-source="${sourceId}"]`);
      if (!proxy) {
        const chip = document.createElement('label');
        chip.className = 'ic-events-filter-chip';
        chip.innerHTML = `<input type="checkbox" data-event-filter-proxy data-event-filter-source="${sourceId}"><span>${label}</span>`;
        options.appendChild(chip);
        proxy = chip.querySelector('input');
        proxy.addEventListener('change', () => {
          original.checked = proxy.checked;
          original.dispatchEvent(new Event('change', { bubbles: true }));
          syncEventFilterBadge(card);
        });
        original.addEventListener('change', () => {
          proxy.checked = original.checked;
          syncEventFilterBadge(card);
        });
      }
      proxy.checked = original.checked;
    });

    const toggle = slot.querySelector('#eventsModuleFilterToggle');
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = 'true';
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        card.hidden = expanded;
      });
    }

    syncEventFilterBadge(card);
    return true;
  }

  function hideLegacyGlobalFilterShell() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.setAttribute('aria-hidden', 'true');
      sidebar.style.display = 'none';
    }
  }

  function install() {
    if (!document.body || document.body.classList.contains('auth-locked')) return false;
    installStyles();
    hideLegacyGlobalFilterShell();
    const ticketReady = installTicketFilters();
    const eventReady = installEventFilters();
    installed = ticketReady && eventReady;
    return installed;
  }

  function schedule(delay = 40) {
    if (retryTimer) global.clearTimeout(retryTimer);
    retryTimer = global.setTimeout(() => {
      retryTimer = null;
      install();
    }, delay);
  }

  function start() {
    installStyles();
    schedule(0);

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(records => {
        if (document.body.classList.contains('auth-locked')) return;
        if (!installed || records.some(record => record.addedNodes && record.addedNodes.length)) schedule(80);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const authObserver = new MutationObserver(() => {
        if (!document.body.classList.contains('auth-locked')) schedule(20);
      });
      authObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
