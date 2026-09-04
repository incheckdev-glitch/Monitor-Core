(function installInCheck360ModernTopbar(global) {
  const STATE = { installed: false, quickButton: null, contextChip: null };

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function toast(message) {
    if (global.UI?.toast) global.UI.toast(message);
    else console.info('[topbar]', message);
  }

  function getGlobalCreateButton() {
    return document.getElementById('createTicketBtn');
  }

  function currentViewTab() {
    return document.querySelector('.view-tab.active, .view-tab[aria-selected="true"]');
  }

  function updateContextChip() {
    const chip = STATE.contextChip;
    if (!chip) return;
    const tab = currentViewTab();
    if (!tab) {
      chip.innerHTML = '<span>Workspace</span>';
      chip.title = 'Workspace';
      return;
    }

    const group = tab.closest('.view-menu-group');
    const groupName = text(
      group?.querySelector('.view-menu-group-label > span:last-child')?.textContent ||
      group?.getAttribute('aria-label') ||
      'Workspace'
    ).replace(/\s+modules$/i, '');
    const viewName = text(tab.textContent || tab.getAttribute('data-view') || '');
    chip.innerHTML = `<span>${groupName}</span><span aria-hidden="true"> / </span><strong>${viewName}</strong>`;
    chip.title = `${groupName} / ${viewName}`;
  }

  function updateQuickCreate() {
    const button = STATE.quickButton;
    if (!button) return;
    const target = getGlobalCreateButton();
    const hiddenByOwnStyle = target?.style?.display === 'none';
    const disabled = !target || hiddenByOwnStyle || target.disabled || target.getAttribute('aria-hidden') === 'true';
    button.disabled = Boolean(disabled);

    const targetLabel = text(target?.textContent || '').replace(/^\+?\s*/,'');
    const friendly = targetLabel || 'Create new record';
    button.title = disabled ? 'No create action is available in this workspace' : friendly;
    button.setAttribute('aria-label', disabled ? 'No create action available' : friendly);
  }

  function install() {
    if (STATE.installed) return;
    const header = document.getElementById('appHeader');
    const actions = header?.querySelector('.topbar-actions');
    const search = document.getElementById('searchInput');
    if (!header || !actions) return;

    STATE.installed = true;

    if (search) {
      search.placeholder = 'Search tickets, companies, contacts, invoices…';
      search.setAttribute('aria-label', 'Search across InCheck360 Operations Portal');
    }

    let contextChip = header.querySelector('.topbar-context-chip');
    if (!contextChip) {
      contextChip = document.createElement('div');
      contextChip.className = 'topbar-context-chip';
      contextChip.setAttribute('aria-live', 'polite');
      contextChip.setAttribute('aria-label', 'Current workspace');
      actions.before(contextChip);
    }
    STATE.contextChip = contextChip;

    let quickButton = document.getElementById('topbarQuickCreate');
    if (!quickButton) {
      quickButton = document.createElement('button');
      quickButton.id = 'topbarQuickCreate';
      quickButton.type = 'button';
      quickButton.className = 'topbar-quick-create';
      quickButton.innerHTML = '<span class="topbar-quick-create-plus" aria-hidden="true">＋</span><span class="topbar-quick-create-label">New</span>';
      const refresh = document.getElementById('refreshNow');
      actions.insertBefore(quickButton, refresh || actions.firstChild);
      quickButton.addEventListener('click', () => {
        const target = getGlobalCreateButton();
        if (!target || target.style.display === 'none' || target.disabled) {
          toast('No create action is available in this workspace.');
          return;
        }
        target.click();
      });
    }
    STATE.quickButton = quickButton;

    updateContextChip();
    updateQuickCreate();

    document.addEventListener('click', event => {
      if (event.target?.closest?.('.view-tab')) {
        global.setTimeout(() => {
          updateContextChip();
          updateQuickCreate();
        }, 40);
      }
    });

    global.addEventListener('hashchange', () => global.setTimeout(() => {
      updateContextChip();
      updateQuickCreate();
    }, 40));
    global.addEventListener('popstate', () => global.setTimeout(() => {
      updateContextChip();
      updateQuickCreate();
    }, 40));

    const nav = document.querySelector('.view-tabs');
    if (nav && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        updateContextChip();
        updateQuickCreate();
      }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
    }

    const createTarget = getGlobalCreateButton();
    if (createTarget && typeof MutationObserver !== 'undefined') {
      new MutationObserver(updateQuickCreate).observe(createTarget, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['style', 'disabled', 'aria-hidden']
      });
    }
  }

  function start() {
    install();
    if (!STATE.installed) global.setTimeout(install, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  global.InCheck360ModernTopbar = Object.freeze({
    refresh() {
      updateContextChip();
      updateQuickCreate();
    }
  });
})(window);
