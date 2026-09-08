const UserProfile = (() => {
  const THEMES = {
    blue:   { label:'Blue',   bg:'#e8f0ff', glow:'#b9d0ff', shirt:'#2563eb', detail:'#dbeafe', ink:'#1e3a8a' },
    navy:   { label:'Navy',   bg:'#e8edf7', glow:'#c3cee5', shirt:'#1e3a5f', detail:'#d8e2f2', ink:'#14253f' },
    teal:   { label:'Teal',   bg:'#e6f8f6', glow:'#b9ebe5', shirt:'#0f766e', detail:'#ccfbf1', ink:'#115e59' },
    green:  { label:'Green',  bg:'#edf8ea', glow:'#cdecc6', shirt:'#3f7d3a', detail:'#dcfce7', ink:'#285b28' },
    purple: { label:'Purple', bg:'#f2ecff', glow:'#dbcaff', shirt:'#7c3aed', detail:'#ede9fe', ink:'#5b21b6' },
    orange: { label:'Orange', bg:'#fff1e8', glow:'#ffd5ba', shirt:'#ea580c', detail:'#ffedd5', ink:'#9a3412' }
  };

  const ILLUSTRATED = [
    { key:'exec_male',          label:'Executive',        group:'Professional', skin:'#D9A06B', hair:'#2E241F', hairStyle:'crop',  beard:true,  glasses:false, outfit:'suit' },
    { key:'modern_beard',       label:'Modern Beard',     group:'Professional', skin:'#B9784E', hair:'#1F1A17', hairStyle:'wave',  beard:true,  glasses:false, outfit:'shirt' },
    { key:'tech_glasses',       label:'Tech Glasses',     group:'Professional', skin:'#E1B082', hair:'#5A3A28', hairStyle:'fade',  beard:false, glasses:true,  outfit:'tee' },
    { key:'clean_cut',          label:'Clean Cut',        group:'Professional', skin:'#C78B62', hair:'#241D1A', hairStyle:'short', beard:false, glasses:false, outfit:'shirt' },
    { key:'casual_male',        label:'Casual',           group:'Modern',       skin:'#E5B98C', hair:'#754A2C', hairStyle:'wave',  beard:false, glasses:false, outfit:'tee' },
    { key:'minimal_male',       label:'Minimal',          group:'Modern',       skin:'#A96845', hair:'#2A2320', hairStyle:'fade',  beard:true,  glasses:true,  outfit:'minimal' },
    { key:'professional_female',label:'Professional',     group:'Professional', skin:'#D99B70', hair:'#3B241D', hairStyle:'long',  beard:false, glasses:false, outfit:'blazer', earrings:true },
    { key:'female_glasses',     label:'Smart Glasses',    group:'Professional', skin:'#E6B78F', hair:'#2A211E', hairStyle:'bob',   beard:false, glasses:true,  outfit:'shirt', earrings:true },
    { key:'executive_female',   label:'Executive',        group:'Professional', skin:'#B87957', hair:'#1F1715', hairStyle:'bun',   beard:false, glasses:false, outfit:'suit', earrings:true },
    { key:'casual_female',      label:'Casual',           group:'Modern',       skin:'#E2AA80', hair:'#6B3D2A', hairStyle:'long',  beard:false, glasses:false, outfit:'tee' },
    { key:'minimal_female',     label:'Minimal',          group:'Modern',       skin:'#C88B68', hair:'#382823', hairStyle:'bob',   beard:false, glasses:false, outfit:'minimal' },
    { key:'creative_female',    label:'Creative',         group:'Modern',       skin:'#F0C09A', hair:'#8A5032', hairStyle:'bun',   beard:false, glasses:true,  outfit:'tee', earrings:true },
    { key:'neutral_modern_1',   label:'Modern One',       group:'Neutral',      skin:'#D8A27A', hair:'#39302C', hairStyle:'soft',  beard:false, glasses:false, outfit:'minimal' },
    { key:'neutral_modern_2',   label:'Modern Two',       group:'Neutral',      skin:'#A96F50', hair:'#231E1B', hairStyle:'soft',  beard:false, glasses:true,  outfit:'shirt' },
    { key:'creative_neutral',   label:'Creative',         group:'Neutral',      skin:'#E8B48B', hair:'#62432F', hairStyle:'curl',  beard:false, glasses:false, outfit:'tee' },
    { key:'minimal_neutral',    label:'Studio',           group:'Neutral',      skin:'#B77B59', hair:'#2F2825', hairStyle:'short', beard:false, glasses:false, outfit:'minimal' }
  ];

  const LEGACY_PRESET_MAP = {
    person:'neutral_modern_1',
    business:'exec_male',
    tech:'tech_glasses',
    quality:'professional_female',
    operations:'casual_male',
    finance:'executive_female',
    support:'creative_neutral',
    rocket:'neutral_modern_2'
  };

  const state = {
    profile:null,
    pendingFile:null,
    previewUrl:'',
    signedUrl:'',
    signedPath:'',
    originalAvatarPath:'',
    saving:false,
    mounted:false,
    activeAvatarPane:'illustrated'
  };

  const clean = v => String(v ?? '').trim();
  const esc = v => clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const db = () => { try { return window.SupabaseClient?.getClient?.() || null; } catch { return null; } };
  const userId = () => clean(window.Session?.state?.user_id || window.Session?.state?.id || window.Session?.state?.user?.id || window.Session?.state?.profile?.id);
  const roleLabel = v => clean(v || 'user').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const initials = name => clean(name || 'User').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'U';
  const toast = (message,type='success') => {
    try {
      if(window.UI?.toast) return window.UI.toast(message,type);
      if(window.showToast) return window.showToast(message,type);
    } catch {}
    console[type==='error'?'error':'log']('[UserProfile]',message);
  };

  const normalizePresetKey = key => {
    const value=clean(key);
    if(LEGACY_PRESET_MAP[value]) return LEGACY_PRESET_MAP[value];
    return ILLUSTRATED.some(item=>item.key===value) ? value : ILLUSTRATED[0].key;
  };
  const normalizeTheme = value => THEMES[clean(value)] ? clean(value) : 'blue';
  const illustratedByKey = key => ILLUSTRATED.find(item=>item.key===normalizePresetKey(key)) || ILLUSTRATED[0];

  function hairMarkup(spec){
    const hair=spec.hair;
    switch(spec.hairStyle){
      case 'long':
        return `<path d="M25 46c-1-18 7-30 23-30 17 0 25 12 23 31l-4 22H29z" fill="${hair}"/><path d="M27 41c2-16 10-23 22-23 11 0 20 7 22 22-8-6-13-15-15-15-7 8-15 12-29 16z" fill="${hair}"/>`;
      case 'bob':
        return `<path d="M25 45c0-19 9-29 23-29s24 11 23 29l-3 18c-5 6-10 8-14 8l2-17H39l2 17c-6-1-10-4-14-8z" fill="${hair}"/><path d="M27 39c3-15 10-21 21-21 12 0 20 7 22 21-10-4-15-11-18-17-5 8-12 13-25 17z" fill="${hair}"/>`;
      case 'bun':
        return `<circle cx="65" cy="19" r="10" fill="${hair}"/><path d="M27 42c1-17 9-25 22-25 12 0 20 8 21 24-9-4-14-10-18-18-6 9-13 14-25 19z" fill="${hair}"/>`;
      case 'curl':
        return `<g fill="${hair}"><circle cx="31" cy="31" r="8"/><circle cx="39" cy="24" r="9"/><circle cx="49" cy="22" r="9"/><circle cx="59" cy="25" r="9"/><circle cx="67" cy="33" r="8"/></g>`;
      case 'fade':
        return `<path d="M29 38c2-14 9-21 20-21 12 0 19 7 21 21-9-5-17-7-25-6-6 0-11 2-16 6z" fill="${hair}"/><path d="M27 38h5v15h-5zm37 0h5v15h-5z" fill="${hair}" opacity=".85"/>`;
      case 'wave':
        return `<path d="M27 39c1-15 9-23 21-23 13 0 21 8 22 23-7-2-11-6-14-11-5 4-8 7-13 9-5-3-9-3-16 2z" fill="${hair}"/>`;
      case 'soft':
        return `<path d="M28 39c2-14 9-22 21-22 11 0 19 7 21 21-7-4-12-7-15-12-7 7-15 11-27 13z" fill="${hair}"/>`;
      case 'short':
        return `<path d="M29 38c2-14 9-20 20-20 11 0 18 7 20 20-9-5-17-6-24-5-6 0-11 2-16 5z" fill="${hair}"/>`;
      case 'crop':
      default:
        return `<path d="M27 39c2-15 10-22 22-22 13 0 20 8 21 22-7-6-15-9-24-8-7 0-13 3-19 8z" fill="${hair}"/>`;
    }
  }

  function outfitMarkup(spec,theme,skin){
    const collar = spec.outfit==='suit' || spec.outfit==='blazer'
      ? `<path d="M38 70l10 9 10-9 6 25H32z" fill="#fff" opacity=".95"/><path d="M43 71l5 8-4 16h8l-4-16 5-8-5-4z" fill="${theme.ink}" opacity=".9"/>`
      : spec.outfit==='shirt'
        ? `<path d="M39 68l9 9 9-9 4 27H35z" fill="#fff" opacity=".85"/>`
        : `<path d="M36 72c5 3 9 5 12 5s7-2 12-5" fill="none" stroke="${theme.detail}" stroke-width="3" stroke-linecap="round"/>`;
    return `<path d="M16 96c2-19 13-30 32-30s30 11 32 30z" fill="${theme.shirt}"/>${collar}<rect x="43" y="58" width="10" height="13" rx="5" fill="${skin}"/>`;
  }

  function faceDetails(spec,skin){
    const glasses=spec.glasses
      ? `<g fill="none" stroke="#243244" stroke-width="2"><rect x="33" y="40" width="13" height="9" rx="4"/><rect x="50" y="40" width="13" height="9" rx="4"/><path d="M46 44h4"/></g>`
      : '';
    const beard=spec.beard
      ? `<path d="M34 51c2 10 7 16 14 16 8 0 13-6 15-16-4 5-9 7-15 7-5 0-10-2-14-7z" fill="${spec.hair}" opacity=".9"/>`
      : '';
    const earrings=spec.earrings
      ? `<circle cx="27" cy="48" r="2" fill="#f5c451"/><circle cx="69" cy="48" r="2" fill="#f5c451"/>`
      : '';
    return `${earrings}<circle cx="48" cy="43" r="21" fill="${skin}"/><circle cx="28" cy="46" r="4" fill="${skin}"/><circle cx="68" cy="46" r="4" fill="${skin}"/>${hairMarkup(spec)}<path d="M37 39c3-2 6-2 9 0M51 39c3-2 6-2 9 0" fill="none" stroke="#5c4035" stroke-width="1.6" stroke-linecap="round"/><circle cx="41" cy="44" r="1.6" fill="#2d2521"/><circle cx="56" cy="44" r="1.6" fill="#2d2521"/><path d="M48 46v5c0 1 1 2 3 2" fill="none" stroke="#b36f56" stroke-width="1.4" stroke-linecap="round"/><path d="M41 56c4 3 10 3 14 0" fill="none" stroke="#8d4a47" stroke-width="1.8" stroke-linecap="round"/>${glasses}${beard}`;
  }

  function illustratedSvg(key,color='blue'){
    const spec=illustratedByKey(key), theme=THEMES[normalizeTheme(color)], skin=spec.skin;
    return `<svg class="user-profile-avatar-svg" viewBox="0 0 96 96" role="img" aria-label="${esc(spec.label)} avatar" focusable="false">
      <rect width="96" height="96" rx="24" fill="${theme.bg}"/>
      <circle cx="79" cy="15" r="21" fill="${theme.glow}" opacity=".72"/>
      <circle cx="14" cy="85" r="19" fill="${theme.detail}" opacity=".78"/>
      ${outfitMarkup(spec,theme,skin)}
      ${faceDetails(spec,skin)}
    </svg>`;
  }

  async function fetchProfile(){
    const client=db(), id=userId();
    if(!client||!id) throw new Error('No authenticated user profile.');
    const {data,error}=await client.from('profiles')
      .select('id,name,full_name,email,username,role_key,role,department,job_title,phone,is_active,avatar_kind,avatar_value,avatar_color,avatar_path,updated_at')
      .eq('id',id).single();
    if(error) throw error;
    data.avatar_color=normalizeTheme(data.avatar_color);
    if(data.avatar_kind==='preset') data.avatar_value=normalizePresetKey(data.avatar_value);
    state.profile=data;
    state.originalAvatarPath=clean(data.avatar_path);
    state.activeAvatarPane=data.avatar_kind==='upload'?'photo':data.avatar_kind==='initials'?'initials':'illustrated';
    return data;
  }

  async function signedAvatar(path){
    const p=clean(path); if(!p)return '';
    if(state.signedPath===p && state.signedUrl)return state.signedUrl;
    const client=db(); if(!client)return '';
    const {data,error}=await client.storage.from('profile-avatars').createSignedUrl(p,3600);
    if(error)return '';
    state.signedPath=p; state.signedUrl=data?.signedUrl||''; return state.signedUrl;
  }

  async function avatarMarkup(profile=state.profile,name=''){
    const p=profile||{}, kind=clean(p.avatar_kind||'initials');
    if(kind==='preset') return illustratedSvg(normalizePresetKey(p.avatar_value),normalizeTheme(p.avatar_color));
    if(kind==='upload' && p.avatar_path){
      const url=await signedAvatar(p.avatar_path);
      if(url)return `<img src="${esc(url)}" alt="">`;
    }
    return `<span class="user-profile-avatar-initials">${esc(initials(name||p.full_name||p.name))}</span>`;
  }

  async function syncTopbarAvatar(){
    const node=document.getElementById('currentUserAvatar');
    if(!node || document.body?.classList.contains('auth-locked'))return;
    try{
      if(!state.profile || state.profile.id!==userId()) await fetchProfile();
      node.innerHTML=await avatarMarkup(state.profile,document.getElementById('currentUserChip')?.textContent);
      node.classList.add('has-user-profile-avatar');
    }catch(err){console.warn('[UserProfile] avatar sync failed',err);}
  }

  function ensureRoot(){
    let root=document.getElementById('userProfileRoot');
    if(!root){
      root=document.createElement('div');
      root.id='userProfileRoot';
      root.className='user-profile-root';
      root.hidden=true;
      document.body.appendChild(root);
    }
    state.mounted=true;
    return root;
  }

  async function previewMarkup(){
    if(state.pendingFile && state.previewUrl) return `<img src="${esc(state.previewUrl)}" alt="Profile preview">`;
    return avatarMarkup(state.profile,state.profile?.full_name||state.profile?.name);
  }

  function avatarGridMarkup(){
    const selected=state.profile?.avatar_kind==='preset' ? normalizePresetKey(state.profile?.avatar_value) : '';
    const theme=normalizeTheme(state.profile?.avatar_color);
    return ILLUSTRATED.map(item=>`<button type="button" class="user-profile-avatar-choice ${selected===item.key?'selected':''}" data-avatar-kind="preset" data-avatar-value="${item.key}" aria-label="${esc(item.label)}">
      <span class="user-profile-avatar-art">${illustratedSvg(item.key,theme)}</span>
      <small>${esc(item.label)}</small>
    </button>`).join('');
  }

  function themeMarkup(){
    const selected=normalizeTheme(state.profile?.avatar_color);
    return Object.entries(THEMES).map(([key,item])=>`<button type="button" class="user-profile-theme-choice ${selected===key?'selected':''}" data-avatar-theme="${key}" aria-label="${esc(item.label)} theme" title="${esc(item.label)}">
      <span style="--swatch:${item.shirt};--swatch-soft:${item.bg}"></span><small>${esc(item.label)}</small>
    </button>`).join('');
  }

  function avatarPaneMarkup(p){
    const active=state.activeAvatarPane;
    return `<div class="user-profile-avatar-tabs" role="tablist" aria-label="Avatar type">
      <button type="button" class="${active==='illustrated'?'active':''}" data-avatar-tab="illustrated" role="tab" aria-selected="${active==='illustrated'}">Illustrated</button>
      <button type="button" class="${active==='photo'?'active':''}" data-avatar-tab="photo" role="tab" aria-selected="${active==='photo'}">Photo</button>
      <button type="button" class="${active==='initials'?'active':''}" data-avatar-tab="initials" role="tab" aria-selected="${active==='initials'}">Initials</button>
    </div>
    <div class="user-profile-avatar-pane ${active==='illustrated'?'active':''}" data-avatar-pane="illustrated">
      <div class="user-profile-avatar-grid">${avatarGridMarkup()}</div>
      <div class="user-profile-theme-block">
        <div><strong>Accent theme</strong><span>Applies to your illustrated avatar everywhere in the ERP.</span></div>
        <div class="user-profile-theme-grid">${themeMarkup()}</div>
      </div>
    </div>
    <div class="user-profile-avatar-pane ${active==='photo'?'active':''}" data-avatar-pane="photo">
      <label class="user-profile-photo-drop" data-profile-photo-drop>
        <input id="userProfileFile" type="file" accept="image/jpeg,image/png,image/webp" hidden>
        <span class="user-profile-photo-drop-icon" aria-hidden="true">↑</span>
        <strong>Upload your photo</strong>
        <small>Drag & drop or click to browse · JPG, PNG or WebP · max 5 MB</small>
      </label>
      ${p.avatar_kind==='upload'||state.pendingFile?'<button type="button" class="btn ghost user-profile-remove-photo" data-avatar-kind="initials">Remove photo & use initials</button>':''}
    </div>
    <div class="user-profile-avatar-pane ${active==='initials'?'active':''}" data-avatar-pane="initials">
      <div class="user-profile-initials-option">
        <div class="user-profile-initials-sample">${esc(initials(p.full_name||p.name))}</div>
        <div><strong>Use your initials</strong><p>Simple, professional and always available as a fallback.</p></div>
        <button type="button" class="btn primary" data-avatar-kind="initials">Use initials</button>
      </div>
    </div>`;
  }

  async function render(){
    const root=ensureRoot(), p=state.profile||{}, preview=await previewMarkup();
    root.hidden=false;
    root.innerHTML=`<div class="user-profile-backdrop" data-profile-close></div>
      <section class="user-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="userProfileTitle">
        <header class="user-profile-header">
          <div><span class="user-profile-eyebrow">My Account</span><h2 id="userProfileTitle">Profile & Identity</h2><p>Manage your details and choose how you appear across Monitor Core.</p></div>
          <button type="button" class="user-profile-close" data-profile-close aria-label="Close">×</button>
        </header>
        <form id="userProfileForm">
          <div class="user-profile-layout">
            <aside class="user-profile-identity-card">
              <div id="userProfilePreview" class="user-profile-preview">${preview}</div>
              <strong data-profile-display-name>${esc(p.full_name||p.name||'User')}</strong>
              <span>${esc(roleLabel(p.role_key||p.role))}</span>
              <small>${esc(p.email||'')}</small>
              <div class="user-profile-identity-badge"><span class="user-profile-status-dot"></span>${p.is_active===false?'Inactive':'Active account'}</div>
              <p class="user-profile-identity-hint">Your avatar appears in the top bar and account menu.</p>
            </aside>
            <main class="user-profile-main">
              <section class="user-profile-section">
                <div class="user-profile-section-head"><div><h3>Personal details</h3><p>Update your own contact and profile information.</p></div></div>
                <div class="user-profile-form-grid">
                  <label><span>Full name</span><input name="full_name" maxlength="120" required value="${esc(p.full_name||p.name||'')}"></label>
                  <label><span>Username</span><input name="username" maxlength="60" value="${esc(p.username||'')}"></label>
                  <label><span>Email</span><input value="${esc(p.email||'')}" disabled><small>Managed by your account administrator.</small></label>
                  <label><span>Phone</span><input name="phone" maxlength="40" value="${esc(p.phone||'')}"></label>
                  <label><span>Job title</span><input name="job_title" maxlength="120" value="${esc(p.job_title||'')}"></label>
                  <label><span>Department</span><input name="department" maxlength="100" value="${esc(p.department||'')}"></label>
                </div>
              </section>
              <section class="user-profile-section user-profile-avatar-section">
                <div class="user-profile-section-head"><div><h3>Choose your identity</h3><p>Pick an original illustrated avatar, upload a photo, or keep your initials.</p></div></div>
                ${avatarPaneMarkup(p)}
              </section>
              <section class="user-profile-section user-profile-account-section">
                <div><span>Role</span><strong>${esc(roleLabel(p.role_key||p.role))}</strong></div>
                <div><span>Account status</span><strong>${p.is_active===false?'Inactive':'Active'}</strong></div>
                <p>Role, permissions, email and account status can only be changed by an administrator.</p>
              </section>
            </main>
          </div>
          <footer class="user-profile-footer"><button type="button" class="btn ghost" data-profile-close>Cancel</button><button id="userProfileSave" type="submit" class="btn primary">Save profile</button></footer>
        </form>
      </section>`;
    bind(root);
  }

  function close(){
    const root=document.getElementById('userProfileRoot');
    if(root)root.hidden=true;
    if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl='';}
    state.pendingFile=null;
    document.body?.classList.remove('user-profile-open');
  }

  function setAvatarPane(name){
    state.activeAvatarPane=name;
    document.querySelectorAll('[data-avatar-tab]').forEach(btn=>{
      const active=btn.dataset.avatarTab===name;
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-selected',String(active));
    });
    document.querySelectorAll('[data-avatar-pane]').forEach(pane=>pane.classList.toggle('active',pane.dataset.avatarPane===name));
  }

  function clearPendingFile(){
    state.pendingFile=null;
    if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl='';}
  }

  function setAvatarChoice(kind,value=''){
    clearPendingFile();
    const nextKind=kind==='preset'?'preset':'initials';
    state.profile={
      ...(state.profile||{}),
      avatar_kind:nextKind,
      avatar_value:nextKind==='preset'?normalizePresetKey(value):null,
      avatar_path:nextKind==='upload'?state.profile?.avatar_path:null,
      avatar_color:normalizeTheme(state.profile?.avatar_color)
    };
    if(nextKind==='preset') state.activeAvatarPane='illustrated';
    if(nextKind==='initials') state.activeAvatarPane='initials';
    document.querySelectorAll('.user-profile-avatar-choice').forEach(b=>b.classList.toggle('selected',nextKind==='preset'&&b.dataset.avatarValue===state.profile.avatar_value));
    setAvatarPane(state.activeAvatarPane);
    void refreshPreview();
  }

  function setTheme(color){
    const next=normalizeTheme(color);
    state.profile={...(state.profile||{}),avatar_color:next};
    document.querySelectorAll('[data-avatar-theme]').forEach(b=>b.classList.toggle('selected',b.dataset.avatarTheme===next));
    document.querySelectorAll('.user-profile-avatar-choice').forEach(button=>{
      const key=button.dataset.avatarValue;
      const art=button.querySelector('.user-profile-avatar-art');
      if(art&&key) art.innerHTML=illustratedSvg(key,next);
    });
    if(state.profile?.avatar_kind==='preset') void refreshPreview();
  }

  async function refreshPreview(){
    const node=document.getElementById('userProfilePreview');
    if(node)node.innerHTML=await previewMarkup();
  }

  function acceptPhoto(file,input=null){
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      toast('Please choose a JPG, PNG or WebP image.','error');
      if(input)input.value='';
      return;
    }
    if(file.size>5*1024*1024){
      toast('Profile photo must be 5 MB or smaller.','error');
      if(input)input.value='';
      return;
    }
    clearPendingFile();
    state.pendingFile=file;
    state.previewUrl=URL.createObjectURL(file);
    state.profile={...(state.profile||{}),avatar_kind:'upload',avatar_value:null};
    state.activeAvatarPane='photo';
    document.querySelectorAll('.user-profile-avatar-choice').forEach(b=>b.classList.remove('selected'));
    setAvatarPane('photo');
    void refreshPreview();
  }

  function bind(root){
    root.querySelectorAll('[data-profile-close]').forEach(x=>x.addEventListener('click',close));
    root.querySelectorAll('[data-avatar-kind]').forEach(x=>x.addEventListener('click',()=>setAvatarChoice(x.dataset.avatarKind,x.dataset.avatarValue||'')));
    root.querySelectorAll('[data-avatar-tab]').forEach(x=>x.addEventListener('click',()=>setAvatarPane(x.dataset.avatarTab)));
    root.querySelectorAll('[data-avatar-theme]').forEach(x=>x.addEventListener('click',()=>setTheme(x.dataset.avatarTheme)));

    const fileInput=root.querySelector('#userProfileFile');
    fileInput?.addEventListener('change',event=>acceptPhoto(event.target.files?.[0],event.target));
    const drop=root.querySelector('[data-profile-photo-drop]');
    if(drop){
      ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('is-dragging');}));
      ['dragleave','drop'].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('is-dragging');}));
      drop.addEventListener('drop',event=>acceptPhoto(event.dataTransfer?.files?.[0],fileInput));
    }

    const fullName=root.querySelector('input[name="full_name"]');
    fullName?.addEventListener('input',()=>{
      const value=clean(fullName.value)||'User';
      const label=root.querySelector('[data-profile-display-name]');
      if(label)label.textContent=value;
      const sample=root.querySelector('.user-profile-initials-sample');
      if(sample)sample.textContent=initials(value);
      if(state.profile?.avatar_kind==='initials'){
        state.profile={...(state.profile||{}),full_name:value,name:value};
        void refreshPreview();
      }
    });

    root.querySelector('#userProfileForm')?.addEventListener('submit',save);
    root.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  }

  async function uploadPending(){
    if(!state.pendingFile)return clean(state.profile?.avatar_path);
    const client=db(), uid=userId();
    if(!client||!uid)throw new Error('No authenticated user.');
    const ext=state.pendingFile.type==='image/png'?'png':state.pendingFile.type==='image/webp'?'webp':'jpg';
    const path=`${uid}/avatar-${Date.now()}.${ext}`;
    const {error}=await client.storage.from('profile-avatars').upload(path,state.pendingFile,{contentType:state.pendingFile.type,upsert:false,cacheControl:'3600'});
    if(error)throw error;
    return path;
  }

  async function save(event){
    event.preventDefault();
    if(state.saving)return;
    const form=event.currentTarget, button=document.getElementById('userProfileSave');
    state.saving=true;
    if(button){button.disabled=true;button.textContent='Saving…';}
    const oldPath=clean(state.originalAvatarPath);
    let newUploadedPath='';
    try{
      let avatarPath=clean(state.profile?.avatar_path);
      if(state.profile?.avatar_kind==='upload' && state.pendingFile){
        avatarPath=await uploadPending();
        newUploadedPath=avatarPath;
      }
      const payload={
        p_full_name:clean(form.elements.full_name?.value),
        p_username:clean(form.elements.username?.value)||null,
        p_department:clean(form.elements.department?.value)||null,
        p_job_title:clean(form.elements.job_title?.value)||null,
        p_phone:clean(form.elements.phone?.value)||null,
        p_avatar_kind:clean(state.profile?.avatar_kind||'initials'),
        p_avatar_value:state.profile?.avatar_kind==='preset'?normalizePresetKey(state.profile?.avatar_value):null,
        p_avatar_color:normalizeTheme(state.profile?.avatar_color),
        p_avatar_path:state.profile?.avatar_kind==='upload'?avatarPath:null
      };
      const client=db();
      const {data,error}=await client.rpc('update_my_profile_v2',payload);
      if(error)throw error;
      const saved=Array.isArray(data)?data[0]:data;
      state.profile=saved||{
        ...state.profile,
        full_name:payload.p_full_name,
        username:payload.p_username,
        department:payload.p_department,
        job_title:payload.p_job_title,
        phone:payload.p_phone,
        avatar_kind:payload.p_avatar_kind,
        avatar_value:payload.p_avatar_value,
        avatar_color:payload.p_avatar_color,
        avatar_path:payload.p_avatar_path
      };
      state.originalAvatarPath=clean(state.profile?.avatar_path);
      state.signedPath='';
      state.signedUrl='';
      if(oldPath && oldPath!==clean(state.profile?.avatar_path)){
        try{await client.storage.from('profile-avatars').remove([oldPath]);}catch{}
      }
      clearPendingFile();
      try{await window.Session?.revalidateProfile?.({reason:'self_profile_updated',force:true});}catch{}
      const nameNode=document.getElementById('currentUserChip');
      if(nameNode)nameNode.textContent=clean(saved?.full_name||saved?.name||payload.p_full_name);
      await syncTopbarAvatar();
      window.InCheck360ModernTopbar?.refresh?.();
      toast('Profile updated successfully.');
      close();
    }catch(err){
      if(newUploadedPath){try{await db()?.storage.from('profile-avatars').remove([newUploadedPath]);}catch{}}
      console.error('[UserProfile] save failed',err);
      toast(err.message||'Unable to update profile.','error');
    }finally{
      state.saving=false;
      if(button){button.disabled=false;button.textContent='Save profile';}
    }
  }

  async function open(){
    if(document.body?.classList.contains('auth-locked')||!userId())return;
    document.body?.classList.add('user-profile-open');
    const root=ensureRoot();
    root.hidden=false;
    root.innerHTML='<div class="user-profile-backdrop"></div><section class="user-profile-dialog user-profile-loading"><div class="user-profile-loading-card">Loading profile…</div></section>';
    try{
      await fetchProfile();
      await render();
      setTimeout(()=>document.querySelector('#userProfileForm input[name="full_name"]')?.focus(),0);
    }catch(err){
      console.error('[UserProfile] open failed',err);
      toast(err.message||'Unable to load profile.','error');
      close();
    }
  }

  function boot(){
    const sync=()=>{if(!document.body?.classList.contains('auth-locked')&&userId())void syncTopbarAvatar();};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync,{once:true}); else sync();
    window.addEventListener('incheck:open-profile',()=>void open());
    window.Session?.subscribe?.((_u,detail={})=>{
      if(detail.reason==='signed_out'){
        state.profile=null;
        state.signedUrl='';
        state.signedPath='';
        state.originalAvatarPath='';
        close();
        return;
      }
      setTimeout(sync,80);
    });
    setTimeout(sync,600);
    setTimeout(sync,1800);
  }

  return Object.freeze({
    open,
    close,
    boot,
    syncTopbarAvatar,
    avatarSvg:illustratedSvg,
    refresh:async()=>{await fetchProfile();await syncTopbarAvatar();}
  });
})();

UserProfile.boot();
window.UserProfile=UserProfile;
