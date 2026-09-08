(function installClientLifecycleResilience(global){
  'use strict';

  let lastClientId='';
  let reopening=false;
  let refreshTimer=null;

  const clean=v=>String(v??'').trim();
  const view=()=>document.getElementById('clientLifecycleView');
  const drawer=()=>document.getElementById('clientLifecycleDrawer');
  const isModuleActive=()=>document.body?.classList.contains('client-lifecycle-active') && document.getElementById('clientLifecycleTab')?.classList.contains('active');

  function rememberFrom(target){
    const open=target?.closest?.('[data-cl-open]');
    if(open?.dataset?.clOpen) lastClientId=clean(open.dataset.clOpen);
  }

  function scheduleOverviewRefresh(){
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>{
      if(!isModuleActive())return;
      try{global.ClientLifecycleOperations?.refresh?.();}catch{}
    },120);
  }

  function reopenIfNeeded(){
    if(reopening || !lastClientId || !isModuleActive() || !document.body?.classList.contains('cl-drawer-open'))return;
    const root=drawer();
    const hasLiveDrawer=!!root && !root.hidden && !!root.querySelector('.cl-drawer');
    if(hasLiveDrawer)return;

    const button=[...document.querySelectorAll('[data-cl-open]')].find(el=>clean(el.dataset.clOpen)===lastClientId);
    if(!button)return;
    reopening=true;
    try{button.click();}finally{setTimeout(()=>{reopening=false;},250);}
  }

  document.addEventListener('click',event=>{
    rememberFrom(event.target);
    const close=event.target?.closest?.('[data-cl-close]');
    if(close){
      lastClientId='';
      scheduleOverviewRefresh();
    }
    const otherTab=event.target?.closest?.('.view-tab');
    if(otherTab && otherTab.id!=='clientLifecycleTab') lastClientId='';
  },true);

  if(typeof MutationObserver!=='undefined'){
    const observer=new MutationObserver(()=>{
      if(!view())return;
      queueMicrotask(reopenIfNeeded);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});
  }

  global.ClientLifecycleResilience=Object.freeze({
    refresh(){reopenIfNeeded();},
    clear(){lastClientId='';}
  });
})(window);
