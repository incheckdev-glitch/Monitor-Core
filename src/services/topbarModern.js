(function installInCheck360ModernTopbar(global) {
  const STATE = {
    installed: false,
    contextChip: null,
    profileMenu: null,
    profileButton: null,
    logoutButton: null
  };

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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

  function installProfileMenuStyles() {
    if (document.getElementById('incheck360-profile-menu-style')) return;
    const style = document.createElement('style');
    style.id = 'incheck360-profile-menu-style';
    style.textContent = `
      body:not(.auth-locked) #appHeader .topbar-language,
      body:not(.auth-locked) #appHeader .topbar-online,
      body:not(.auth-locked) #appHeader .topbar-logout,
      body:not(.auth-locked) #appHeader #topbarQuickCreate {
        display:none!important;
      }
      body:not(.auth-locked) #appHeader .topbar-actions {
        position:relative!important;
      }
      body:not(.auth-locked) #appHeader .topbar-profile {
        cursor:pointer!important;
      }
      body:not(.auth-locked) #appHeader .topbar-profile[aria-expanded="true"] {
        border-color:#bfd0ff!important;
        background:#f8faff!important;
        box-shadow:0 0 0 3px rgba(37,99,235,.08)!important;
      }
      body:not(.auth-locked) #appHeader .topbar-profile[aria-expanded="true"] .topbar-profile-arrow {
        transform:rotate(180deg);
      }
      body:not(.auth-locked) #appHeader .topbar-profile-arrow {
        transition:transform .16s ease!important;
      }
      body:not(.auth-locked) #appHeader .topbar-profile-menu {
        position:absolute;
        top:52px;
        right:0;
        z-index:1400;
        width:230px;
        padding:8px;
        border:1px solid #e2e8f0;
        border-radius:14px;
        background:#fff;
        color:#0f172a;
        box-shadow:0 16px 42px rgba(15,23,42,.16);
      }
      body:not(.auth-locked) #appHeader .topbar-profile-menu[hidden] {
        display:none!important;
      }
      body:not(.auth-locked) #appHeader .topbar-profile-menu-head {
        padding:9px 10px 10px;
        border-bottom:1px solid #eef2f7;
        margin-bottom:6px;
      }
      body:not(.auth-locked) #appHeader .topbar-profile-menu-head strong,
      body:not(.auth-locked) #appHeader .topbar-profile-menu-head span {
        display:block;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      body:not(.auth-locked) #appHeader .topbar-profile-menu-head strong {
        font-size:13px;
        font-weight:800;
        color:#0f172a;
      }
      body:not(.auth-locked) #appHeader .topbar-profile-menu-head span {
        margin-top:3px;
        font-size:11px;
        font-weight:700;
        color:#64748b;
      }
      body:not(.auth-locked) #appHeader .topbar-profile-menu-logout {
        width:100%;
        height:40px;
        padding:0 11px;
        display:flex;
        align-items:center;
        gap:9px;
        border:0;
        border-radius:10px;
        background:transparent;
        color:#b91c1c;
        font:inherit;
        font-size:13px;
        font-weight:800;
        text-align:left;
        cursor:pointer;
      }
      body:not(.auth-locked) #appHeader .topbar-profile-menu-logout:hover {
        background:#fef2f2;
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) #appHeader .topbar-profile-menu,
      :root[data-theme="dark"] body:not(.auth-locked) #appHeader .topbar-profile-menu {
        background:#111827;
        color:#e5e7eb;
        border-color:#2b3a50;
        box-shadow:0 18px 48px rgba(0,0,0,.34);
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) #appHeader .topbar-profile-menu-head,
      :root[data-theme="dark"] body:not(.auth-locked) #appHeader .topbar-profile-menu-head {
        border-bottom-color:#26354a;
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) #appHeader .topbar-profile-menu-head strong,
      :root[data-theme="dark"] body:not(.auth-locked) #appHeader .topbar-profile-menu-head strong {
        color:#e5e7eb;
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) #appHeader .topbar-profile-menu-head span,
      :root[data-theme="dark"] body:not(.auth-locked) #appHeader .topbar-profile-menu-head span {
        color:#94a3b8;
      }
      :root:not([data-theme="light"]) body:not(.auth-locked) #appHeader .topbar-profile-menu-logout:hover,
      :root[data-theme="dark"] body:not(.auth-locked) #appHeader .topbar-profile-menu-logout:hover {
        background:#291b1f;
      }
    `;
    document.head.appendChild(style);
  }

  function hideLegacyTopbarControls(actions) {
    const languageControl = actions.querySelector('.topbar-language');
    const onlineControl = actions.querySelector('.topbar-online');
    const logoutButton = document.getElementById('logoutBtn') || actions.querySelector('.topbar-logout');

    [languageControl, onlineControl, logoutButton].filter(Boolean).forEach(control => {
      control.style.setProperty('display', 'none', 'important');
      control.hidden = true;
      control.setAttribute('aria-hidden', 'true');
      control.setAttribute('tabindex', '-1');
    });

    STATE.logoutButton = logoutButton;
  }

  function syncProfileMenuIdentity() {
    const menu = STATE.profileMenu;
    if (!menu) return;
    const name = text(document.getElementById('currentUserChip')?.textContent || 'User');
    const role = text(document.getElementById('currentRoleChip')?.textContent || '');
    const nameTarget = menu.querySelector('[data-profile-menu-name]');
    const roleTarget = menu.querySelector('[data-profile-menu-role]');
    if (nameTarget) nameTarget.textContent = name || 'User';
    if (roleTarget) roleTarget.textContent = role || 'Signed in';
  }

  function closeProfileMenu({ focus = false } = {}) {
    const button = STATE.profileButton;
    const menu = STATE.profileMenu;
    if (!button || !menu) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  }

  function openProfileMenu() {
    const button = STATE.profileButton;
    const menu = STATE.profileMenu;
    if (!button || !menu) return;
    syncProfileMenuIdentity();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('.topbar-profile-menu-logout')?.focus();
  }

  function toggleProfileMenu() {
    if (!STATE.profileMenu || !STATE.profileButton) return;
    if (STATE.profileMenu.hidden) openProfileMenu();
    else closeProfileMenu();
  }

  function installProfileMenu(actions) {
    const profileButton = document.getElementById('profileMenuBtn');

    document.getElementById('topbarQuickCreate')?.remove();
    hideLegacyTopbarControls(actions);
    if (!profileButton) return;

    STATE.profileButton = profileButton;

    profileButton.setAttribute('aria-haspopup', 'menu');
    profileButton.setAttribute('aria-expanded', 'false');
    profileButton.title = 'Account menu';

    let menu = document.getElementById('topbarProfileMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'topbarProfileMenu';
      menu.className = 'topbar-profile-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'User account menu');
      menu.hidden = true;
      menu.innerHTML = `
        <div class="topbar-profile-menu-head">
          <strong data-profile-menu-name>User</strong>
          <span data-profile-menu-role>Signed in</span>
        </div>
        <button class="topbar-profile-menu-logout" type="button" role="menuitem">
          <span aria-hidden="true">⎋</span>
          <span>Log out</span>
        </button>
      `;
      actions.appendChild(menu);
    }
    STATE.profileMenu = menu;
    syncProfileMenuIdentity();

    profileButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggleProfileMenu();
    });

    menu.addEventListener('click', event => event.stopPropagation());
    menu.querySelector('.topbar-profile-menu-logout')?.addEventListener('click', () => {
      closeProfileMenu();
      STATE.logoutButton?.click();
    });

    document.addEventListener('click', event => {
      if (!menu.hidden && !menu.contains(event.target) && !profileButton.contains(event.target)) {
        closeProfileMenu();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        closeProfileMenu({ focus: true });
      }
    });

    const identityTargets = [
      document.getElementById('currentUserChip'),
      document.getElementById('currentRoleChip')
    ].filter(Boolean);
    if (identityTargets.length && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(syncProfileMenuIdentity);
      identityTargets.forEach(node => observer.observe(node, { childList: true, subtree: true, characterData: true }));
    }

    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => hideLegacyTopbarControls(actions)).observe(actions, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'hidden', 'class']
      });
    }
  }

  function install() {
    if (STATE.installed) return;
    const header = document.getElementById('appHeader');
    const actions = header?.querySelector('.topbar-actions');
    const search = document.getElementById('searchInput');
    if (!header || !actions) return;

    STATE.installed = true;
    installProfileMenuStyles();

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

    installProfileMenu(actions);
    updateContextChip();

    document.addEventListener('click', event => {
      if (event.target?.closest?.('.view-tab')) {
        global.setTimeout(updateContextChip, 40);
      }
    });

    global.addEventListener('hashchange', () => global.setTimeout(updateContextChip, 40));
    global.addEventListener('popstate', () => global.setTimeout(updateContextChip, 40));

    const nav = document.querySelector('.view-tabs');
    if (nav && typeof MutationObserver !== 'undefined') {
      new MutationObserver(updateContextChip).observe(nav, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-selected']
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
      syncProfileMenuIdentity();
    },
    closeProfileMenu
  });
})(window);
