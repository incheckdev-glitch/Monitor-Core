(() => {
  let installed=false;
  function install(){
    if(installed || document.body?.classList.contains('auth-locked'))return false;
    const menu=document.getElementById('topbarProfileMenu');
    if(!menu)return false;
    if(menu.querySelector('[data-user-profile-open]')){installed=true;return true;}
    const logout=menu.querySelector('.topbar-profile-menu-logout');
    const button=document.createElement('button');
    button.type='button';
    button.className='topbar-profile-menu-profile';
    button.setAttribute('role','menuitem');
    button.setAttribute('data-user-profile-open','true');
    button.innerHTML='<span aria-hidden="true">👤</span><span>Profile</span>';
    button.addEventListener('click',()=>{
      window.InCheck360ModernTopbar?.closeProfileMenu?.();
      if(window.UserProfile?.open) void window.UserProfile.open();
      else window.dispatchEvent(new CustomEvent('incheck:open-profile'));
    });
    if(logout)menu.insertBefore(button,logout);else menu.appendChild(button);
    installed=true;return true;
  }
  function start(){
    if(install())return;
    const observer=new MutationObserver(()=>{if(install())observer.disconnect();});
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    setTimeout(install,500);setTimeout(install,1500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
