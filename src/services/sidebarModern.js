(function installInCheck360ModernSidebar(global) {
  const STORAGE_KEY = 'incheck360OperationsPortal.menuCollapsed';
  let installed = false;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function installStyles() {
    if (document.getElementById('incheck360-modern-sidebar-style')) return;
    const style = document.createElement('style');
    style.id = 'incheck360-modern-sidebar-style';
    style.textContent = `
      body:not(.auth-locked) .content-layout.ic-modern-nav-layout{
        grid-template-columns:264px minmax(0,1fr)!important;
        gap:18px!important;
        align-items:start!important;
        transition:grid-template-columns .18s ease!important;
      }

      body:not(.auth-locked) .content-layout.ic-modern-nav-layout.ic-nav-collapsed{
        grid-template-columns:76px minmax(0,1fr)!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav{
        position:sticky!important;
        top:78px!important;
        z-index:45!important;
        width:100%!important;
        min-width:0!important;
        max-height:calc(100vh - 94px)!important;
        display:flex!important;
        flex-direction:column!important;
        overflow:visible!important;
        padding:12px!important;
        border:1px solid rgba(127,164,205,.12)!important;
        border-radius:16px!important;
        background:linear-gradient(180deg,#081f3b 0%,#06172d 100%)!important;
        color:#eaf2ff!important;
        box-shadow:0 14px 34px rgba(6,23,45,.16)!important;
        transition:width .18s ease,box-shadow .18s ease,padding .18s ease!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-header{
        flex:0 0 auto!important;
        padding:7px 9px 12px!important;
        margin:0 0 4px!important;
        border-bottom:1px solid rgba(148,180,218,.12)!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-title{
        color:#f8fbff!important;
        font-size:14px!important;
        line-height:1.2!important;
        font-weight:800!important;
        letter-spacing:.01em!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-subtitle{
        margin-top:4px!important;
        color:#7f9ab8!important;
        font-size:10.5px!important;
        line-height:1.35!important;
        font-weight:600!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tabs{
        flex:1 1 auto!important;
        min-height:0!important;
        display:flex!important;
        flex-direction:column!important;
        gap:3px!important;
        overflow-y:auto!important;
        overflow-x:hidden!important;
        padding:4px 2px 8px!important;
        margin:0!important;
        scrollbar-width:thin!important;
        scrollbar-color:rgba(139,177,220,.32) transparent!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tabs::-webkit-scrollbar{width:5px!important;}
      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tabs::-webkit-scrollbar-track{background:transparent!important;}
      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tabs::-webkit-scrollbar-thumb{
        background:rgba(139,177,220,.28)!important;
        border-radius:999px!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group{
        width:100%!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:11px!important;
        background:transparent!important;
        box-shadow:none!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-title{
        width:100%!important;
        min-height:42px!important;
        display:flex!important;
        align-items:center!important;
        justify-content:space-between!important;
        gap:9px!important;
        padding:0 10px!important;
        border:0!important;
        border-radius:10px!important;
        background:transparent!important;
        color:#b7c7da!important;
        font:inherit!important;
        font-size:12.5px!important;
        font-weight:750!important;
        text-align:left!important;
        cursor:pointer!important;
        transition:background .14s ease,color .14s ease,transform .14s ease!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-title:hover{
        background:rgba(73,126,190,.16)!important;
        color:#fff!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group.is-expanded > .view-menu-group-title,
      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group:has(.view-tab.active) > .view-menu-group-title{
        color:#f4f8ff!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-label{
        min-width:0!important;
        display:flex!important;
        align-items:center!important;
        gap:10px!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-label > span:last-child{
        overflow:hidden!important;
        text-overflow:ellipsis!important;
        white-space:nowrap!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-icon,
      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab .icon{
        flex:0 0 22px!important;
        width:22px!important;
        height:22px!important;
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        font-size:14px!important;
        line-height:1!important;
        filter:saturate(.9)!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-chevron{
        flex:0 0 auto!important;
        color:#7793b2!important;
        font-size:10px!important;
        transition:transform .16s ease!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-body{
        margin:2px 0 6px 10px!important;
        padding:2px 0 4px 9px!important;
        border-left:1px solid rgba(123,161,204,.18)!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group.is-collapsed .view-menu-group-body{
        display:none!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab{
        width:100%!important;
        min-height:39px!important;
        margin:2px 0!important;
        padding:0 10px!important;
        display:flex!important;
        align-items:center!important;
        justify-content:flex-start!important;
        gap:9px!important;
        border:0!important;
        border-radius:9px!important;
        background:transparent!important;
        color:#aebfd2!important;
        font:inherit!important;
        font-size:12px!important;
        font-weight:650!important;
        line-height:1.25!important;
        text-align:left!important;
        white-space:normal!important;
        cursor:pointer!important;
        box-shadow:none!important;
        transition:background .14s ease,color .14s ease,transform .14s ease,box-shadow .14s ease!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab:hover{
        background:rgba(39,100,170,.22)!important;
        color:#f7fbff!important;
        transform:translateX(1px)!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab.active,
      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab[aria-selected="true"]{
        background:linear-gradient(135deg,#1269f2 0%,#2387ff 100%)!important;
        color:#fff!important;
        box-shadow:0 7px 17px rgba(18,105,242,.28)!important;
        font-weight:800!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab.active .icon,
      body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab[aria-selected="true"] .icon{
        filter:none!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn{
        flex:0 0 auto!important;
        width:100%!important;
        min-height:42px!important;
        margin:6px 0 0!important;
        padding:0 10px!important;
        display:flex!important;
        align-items:center!important;
        justify-content:flex-start!important;
        gap:10px!important;
        border:1px solid rgba(123,161,204,.2)!important;
        border-radius:10px!important;
        background:rgba(27,66,108,.42)!important;
        color:#aebfd2!important;
        font:inherit!important;
        font-size:11.5px!important;
        font-weight:750!important;
        cursor:pointer!important;
        transition:background .14s ease,color .14s ease,border-color .14s ease!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn:hover{
        background:rgba(35,92,153,.52)!important;
        border-color:rgba(117,167,225,.35)!important;
        color:#fff!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-icon{
        flex:0 0 22px!important;
        width:22px!important;
        height:22px!important;
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        border-radius:7px!important;
        background:rgba(255,255,255,.06)!important;
        font-size:12px!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed{
        width:76px!important;
        padding:10px 8px!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-header{
        display:none!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-group-title{
        justify-content:center!important;
        padding:0!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-group-label > span:last-child,
      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-group-chevron,
      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-group-body,
      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .ic-nav-collapse-label{
        display:none!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .ic-nav-collapse-btn{
        justify-content:center!important;
        padding:0!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:hover{
        width:264px!important;
        padding:12px!important;
        box-shadow:0 18px 46px rgba(5,20,38,.28)!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:hover .view-menu-header{
        display:block!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:hover .view-menu-group-title{
        justify-content:space-between!important;
        padding:0 10px!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:hover .view-menu-group-label > span:last-child,
      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:hover .view-menu-group-chevron,
      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:hover .ic-nav-collapse-label{
        display:inline!important;
      }

      body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:hover .view-menu-group.is-expanded .view-menu-group-body{
        display:block!important;
      }

      @media (max-width:980px){
        body:not(.auth-locked) .content-layout.ic-modern-nav-layout,
        body:not(.auth-locked) .content-layout.ic-modern-nav-layout.ic-nav-collapsed{
          grid-template-columns:minmax(0,1fr)!important;
          gap:12px!important;
        }
        body:not(.auth-locked) .view-menu.ic-modern-nav,
        body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed,
        body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:hover{
          position:relative!important;
          top:auto!important;
          z-index:auto!important;
          width:100%!important;
          max-height:none!important;
          padding:10px!important;
          border-radius:14px!important;
        }
        body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-header{
          display:block!important;
        }
        body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-group-title{
          justify-content:space-between!important;
          padding:0 10px!important;
        }
        body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-group-label > span:last-child,
        body:not(.auth-locked) .view-menu.ic-modern-nav.ic-nav-collapsed:not(:hover) .view-menu-group-chevron{
          display:inline!important;
        }
        body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn{
          display:none!important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function readCollapsedPreference() {
    try {
      return global.localStorage?.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function saveCollapsedPreference(value) {
    try {
      global.localStorage?.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch (_) {}
  }

  function syncCollapseButton(menu, collapsed) {
    const button = menu.querySelector('#incheckNavCollapseBtn');
    if (!button) return;
    const icon = button.querySelector('.ic-nav-collapse-icon');
    const label = button.querySelector('.ic-nav-collapse-label');
    if (icon) icon.textContent = collapsed ? '»' : '«';
    if (label) label.textContent = collapsed ? 'Expand Menu' : 'Collapse Menu';
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.title = collapsed ? 'Expand menu' : 'Collapse menu';
  }

  function setCollapsed(menu, layout, collapsed, persist = true) {
    menu.classList.toggle('ic-nav-collapsed', collapsed);
    layout.classList.toggle('ic-nav-collapsed', collapsed);
    syncCollapseButton(menu, collapsed);
    if (persist) saveCollapsedPreference(collapsed);
  }

  function addTooltips(menu) {
    menu.querySelectorAll('.view-menu-group-title').forEach(button => {
      const label = cleanText(button.querySelector('.view-menu-group-label > span:last-child')?.textContent);
      if (label) button.title = label;
    });
    menu.querySelectorAll('.view-tab').forEach(button => {
      const label = cleanText(button.textContent);
      if (label) button.title = label;
    });
  }

  function install() {
    if (installed || !document.body || document.body.classList.contains('auth-locked')) return;
    const menu = document.querySelector('.content-layout > .view-menu, .view-menu');
    const layout = menu?.closest('.content-layout');
    if (!menu || !layout) return;

    installed = true;
    installStyles();
    menu.classList.add('ic-modern-nav');
    layout.classList.add('ic-modern-nav-layout');

    const title = menu.querySelector('.view-menu-title');
    const subtitle = menu.querySelector('.view-menu-subtitle');
    if (title) title.textContent = 'Operations Menu';
    if (subtitle) subtitle.textContent = 'Modules & workspaces';

    addTooltips(menu);

    let collapseButton = menu.querySelector('#incheckNavCollapseBtn');
    if (!collapseButton) {
      collapseButton = document.createElement('button');
      collapseButton.id = 'incheckNavCollapseBtn';
      collapseButton.className = 'ic-nav-collapse-btn';
      collapseButton.type = 'button';
      collapseButton.innerHTML = `
        <span class="ic-nav-collapse-icon" aria-hidden="true">«</span>
        <span class="ic-nav-collapse-label">Collapse Menu</span>
      `;
      menu.appendChild(collapseButton);
    }

    setCollapsed(menu, layout, readCollapsedPreference(), false);

    collapseButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setCollapsed(menu, layout, !menu.classList.contains('ic-nav-collapsed'));
    });

    menu.addEventListener('click', event => {
      const tab = event.target?.closest?.('.view-tab');
      if (!tab) return;
      const group = tab.closest('.view-menu-group');
      const toggle = group?.querySelector(':scope > .view-menu-group-title');
      if (group && toggle) {
        group.classList.add('is-expanded');
        group.classList.remove('is-collapsed');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
  }

  function start() {
    installStyles();
    install();
    if (!installed && document.body && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        if (!document.body.classList.contains('auth-locked')) {
          install();
          if (installed) observer.disconnect();
        }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  global.InCheck360ModernSidebar = Object.freeze({
    refresh: install
  });
})(window);
