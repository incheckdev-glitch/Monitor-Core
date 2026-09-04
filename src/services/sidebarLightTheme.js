(function installInCheck360SidebarLightTheme() {
  if (document.getElementById('incheck360-sidebar-light-theme')) return;
  const style = document.createElement('style');
  style.id = 'incheck360-sidebar-light-theme';
  style.textContent = `
    body:not(.auth-locked) .view-menu.ic-modern-nav{
      background:#ffffff!important;
      color:#0f172a!important;
      border:1px solid #e2e8f0!important;
      box-shadow:0 10px 28px rgba(15,23,42,.08)!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-header{
      border-bottom:1px solid #eef2f7!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-title{
      color:#0f172a!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-subtitle{
      color:#64748b!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-title{
      color:#475569!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-title:hover{
      background:#f1f5f9!important;
      color:#0f172a!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group.is-expanded > .view-menu-group-title,
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group:has(.view-tab.active) > .view-menu-group-title{
      color:#0f172a!important;
      background:#f8fafc!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-chevron{
      color:#94a3b8!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-body{
      border-left:1px solid #dbe5f1!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab{
      color:#475569!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab:hover{
      background:#eff6ff!important;
      color:#155eef!important;
      transform:translateX(1px)!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab.active,
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab[aria-selected="true"]{
      background:#155eef!important;
      color:#fff!important;
      box-shadow:0 6px 14px rgba(21,94,239,.20)!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn{
      border:1px solid #e2e8f0!important;
      background:#f8fafc!important;
      color:#475569!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn:hover{
      background:#eff6ff!important;
      border-color:#bfdbfe!important;
      color:#155eef!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-icon{
      background:#eaf2ff!important;
      color:#155eef!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-tabs{
      scrollbar-color:#cbd5e1 transparent!important;
    }
    body:not(.auth-locked) .view-menu.ic-modern-nav .view-tabs::-webkit-scrollbar-thumb{
      background:#cbd5e1!important;
    }

    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav{
      background:#111827!important;
      color:#e5e7eb!important;
      border-color:#263244!important;
      box-shadow:0 14px 34px rgba(0,0,0,.24)!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-header,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-header{
      border-bottom-color:#263244!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-title,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-title{
      color:#f8fafc!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-subtitle,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-subtitle{
      color:#94a3b8!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-title,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-title,
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab{
      color:#cbd5e1!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-title:hover,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-title:hover{
      background:#1e293b!important;
      color:#fff!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group.is-expanded > .view-menu-group-title,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group.is-expanded > .view-menu-group-title,
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group:has(.view-tab.active) > .view-menu-group-title,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group:has(.view-tab.active) > .view-menu-group-title{
      color:#fff!important;
      background:#172033!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-body,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-menu-group-body{
      border-left-color:#334155!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab:hover,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab:hover{
      background:#1e3a5f!important;
      color:#bfdbfe!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab.active,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab.active,
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab[aria-selected="true"],
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .view-tab[aria-selected="true"]{
      background:#2563eb!important;
      color:#fff!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn{
      background:#172033!important;
      border-color:#334155!important;
      color:#cbd5e1!important;
    }
    :root[data-theme="dark"] body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn:hover,
    :root:not([data-theme="light"]) body:not(.auth-locked) .view-menu.ic-modern-nav .ic-nav-collapse-btn:hover{
      background:#1e293b!important;
      border-color:#475569!important;
      color:#fff!important;
    }
  `;
  document.head.appendChild(style);
})();
