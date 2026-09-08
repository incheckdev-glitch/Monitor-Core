const UserProfile = (() => {
  const PRESETS = {
    person: '👤', business: '🧑‍💼', tech: '🧑‍💻', quality: '🧑‍🔬',
    operations: '🧑‍🏭', finance: '🧑‍💼', support: '🧑‍🎧', rocket: '🚀'
  };
  const state = { profile:null, pendingFile:null, previewUrl:'', signedUrl:'', signedPath:'', saving:false, mounted:false };
  const clean = v => String(v ?? '').trim();
  const esc = v => clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const db = () => { try { return window.SupabaseClient?.getClient?.() || null; } catch { return null; } };
  const userId = () => clean(window.Session?.state?.user_id || window.Session?.state?.id || window.Session?.state?.user?.id || window.Session?.state?.profile?.id);
  const roleLabel = v => clean(v || 'user').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const initials = name => clean(name || 'User').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'U';
  const toast = (message,type='success') => { try { if(window.UI?.toast) return window.UI.toast(message,type); if(window.showToast) return window.showToast(message,type); } catch{} console[type==='error'?'error':'log']('[UserProfile]',message); };

  async function fetchProfile(){
    const client=db(), id=userId(); if(!client||!id) throw new Error('No authenticated user profile.');
    const {data,error}=await client.from('profiles')
      .select('id,name,full_name,email,username,role_key,role,department,job_title,phone,is_active,avatar_kind,avatar_value,avatar_path,updated_at')
      .eq('id',id).single();
    if(error) throw error; state.profile=data; return data;
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
    const p=profile||{}; const kind=clean(p.avatar_kind||'initials');
    if(kind==='preset' && PRESETS[p.avatar_value]) return `<span class="user-profile-avatar-emoji">${PRESETS[p.avatar_value]}</span>`;
    if(kind==='upload' && p.avatar_path){ const url=await signedAvatar(p.avatar_path); if(url)return `<img src="${esc(url)}" alt="">`; }
    return `<span class="user-profile-avatar-initials">${esc(initials(name||p.full_name||p.name))}</span>`;
  }

  async function syncTopbarAvatar(){
    const node=document.getElementById('currentUserAvatar'); if(!node || document.body?.classList.contains('auth-locked'))return;
    try { if(!state.profile || state.profile.id!==userId()) await fetchProfile(); node.innerHTML=await avatarMarkup(state.profile,document.getElementById('currentUserChip')?.textContent); node.classList.add('has-user-profile-avatar'); } catch(err){ console.warn('[UserProfile] avatar sync failed',err); }
  }

  function ensureRoot(){
    let root=document.getElementById('userProfileRoot');
    if(!root){ root=document.createElement('div'); root.id='userProfileRoot'; root.className='user-profile-root'; root.hidden=true; document.body.appendChild(root); }
    state.mounted=true; return root;
  }

  async function previewMarkup(){
    if(state.pendingFile && state.previewUrl) return `<img src="${esc(state.previewUrl)}" alt="Profile preview">`;
    return avatarMarkup(state.profile,state.profile?.full_name||state.profile?.name);
  }

  async function render(){
    const root=ensureRoot(), p=state.profile||{}; const preview=await previewMarkup();
    root.hidden=false;
    root.innerHTML=`<div class="user-profile-backdrop" data-profile-close></div>
      <section class="user-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="userProfileTitle">
        <header class="user-profile-header">
          <div><span class="user-profile-eyebrow">My Account</span><h2 id="userProfileTitle">Profile</h2><p>Manage your personal information and how you appear in Monitor Core.</p></div>
          <button type="button" class="user-profile-close" data-profile-close aria-label="Close">×</button>
        </header>
        <form id="userProfileForm">
          <div class="user-profile-layout">
            <aside class="user-profile-identity-card">
              <div id="userProfilePreview" class="user-profile-preview">${preview}</div>
              <strong>${esc(p.full_name||p.name||'User')}</strong>
              <span>${esc(roleLabel(p.role_key||p.role))}</span>
              <small>${esc(p.email||'')}</small>
              <label class="user-profile-upload-btn"><input id="userProfileFile" type="file" accept="image/jpeg,image/png,image/webp" hidden><span>Upload photo</span></label>
              <button type="button" class="btn ghost user-profile-initials-btn" data-avatar-kind="initials">Use initials</button>
              <p class="user-profile-file-help">JPG, PNG or WebP · max 5 MB</p>
            </aside>
            <main class="user-profile-main">
              <section class="user-profile-section"><div class="user-profile-section-head"><div><h3>Personal details</h3><p>These fields are visible as your own account information.</p></div></div>
                <div class="user-profile-form-grid">
                  <label><span>Full name</span><input name="full_name" maxlength="120" required value="${esc(p.full_name||p.name||'')}"></label>
                  <label><span>Username</span><input name="username" maxlength="60" value="${esc(p.username||'')}"></label>
                  <label><span>Email</span><input value="${esc(p.email||'')}" disabled><small>Managed by your account administrator.</small></label>
                  <label><span>Phone</span><input name="phone" maxlength="40" value="${esc(p.phone||'')}"></label>
                  <label><span>Job title</span><input name="job_title" maxlength="120" value="${esc(p.job_title||'')}"></label>
                  <label><span>Department</span><input name="department" maxlength="100" value="${esc(p.department||'')}"></label>
                </div>
              </section>
              <section class="user-profile-section"><div class="user-profile-section-head"><div><h3>Choose an avatar</h3><p>Use a preset, your initials, or upload your own photo.</p></div></div>
                <div class="user-profile-avatar-grid">${Object.entries(PRESETS).map(([key,emoji])=>`<button type="button" class="user-profile-avatar-choice ${p.avatar_kind==='preset'&&p.avatar_value===key?'selected':''}" data-avatar-kind="preset" data-avatar-value="${key}" aria-label="${key}"><span>${emoji}</span><small>${key.replace(/\b\w/g,c=>c.toUpperCase())}</small></button>`).join('')}</div>
              </section>
              <section class="user-profile-section user-profile-account-section"><div><span>Role</span><strong>${esc(roleLabel(p.role_key||p.role))}</strong></div><div><span>Account status</span><strong>${p.is_active===false?'Inactive':'Active'}</strong></div><p>Role, permissions, email and account status can only be changed by an administrator.</p></section>
            </main>
          </div>
          <footer class="user-profile-footer"><button type="button" class="btn ghost" data-profile-close>Cancel</button><button id="userProfileSave" type="submit" class="btn primary">Save profile</button></footer>
        </form>
      </section>`;
    bind(root);
  }

  function close(){ const root=document.getElementById('userProfileRoot'); if(root)root.hidden=true; if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl='';} state.pendingFile=null; document.body?.classList.remove('user-profile-open'); }

  function setAvatarChoice(kind,value=''){
    state.pendingFile=null; if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl='';}
    state.profile={...(state.profile||{}),avatar_kind:kind,avatar_value:kind==='preset'?value:null,avatar_path:kind==='upload'?state.profile?.avatar_path:null};
    document.querySelectorAll('.user-profile-avatar-choice').forEach(b=>b.classList.toggle('selected',kind==='preset'&&b.dataset.avatarValue===value));
    void refreshPreview();
  }

  async function refreshPreview(){ const node=document.getElementById('userProfilePreview'); if(node)node.innerHTML=await previewMarkup(); }

  function bind(root){
    root.querySelectorAll('[data-profile-close]').forEach(x=>x.addEventListener('click',close));
    root.querySelectorAll('[data-avatar-kind]').forEach(x=>x.addEventListener('click',()=>setAvatarChoice(x.dataset.avatarKind,x.dataset.avatarValue||'')));
    root.querySelector('#userProfileFile')?.addEventListener('change',event=>{
      const file=event.target.files?.[0]; if(!file)return;
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast('Please choose a JPG, PNG or WebP image.','error');event.target.value='';return;}
      if(file.size>5*1024*1024){toast('Profile photo must be 5 MB or smaller.','error');event.target.value='';return;}
      if(state.previewUrl)URL.revokeObjectURL(state.previewUrl); state.pendingFile=file; state.previewUrl=URL.createObjectURL(file);
      state.profile={...(state.profile||{}),avatar_kind:'upload',avatar_value:null};
      root.querySelectorAll('.user-profile-avatar-choice').forEach(b=>b.classList.remove('selected')); void refreshPreview();
    });
    root.querySelector('#userProfileForm')?.addEventListener('submit',save);
    root.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  }

  async function uploadPending(){
    if(!state.pendingFile)return clean(state.profile?.avatar_path);
    const client=db(), uid=userId(); if(!client||!uid)throw new Error('No authenticated user.');
    const ext=state.pendingFile.type==='image/png'?'png':state.pendingFile.type==='image/webp'?'webp':'jpg';
    const path=`${uid}/avatar-${Date.now()}.${ext}`;
    const {error}=await client.storage.from('profile-avatars').upload(path,state.pendingFile,{contentType:state.pendingFile.type,upsert:false,cacheControl:'3600'});
    if(error)throw error; return path;
  }

  async function save(event){
    event.preventDefault(); if(state.saving)return; const form=event.currentTarget, button=document.getElementById('userProfileSave');
    state.saving=true; if(button){button.disabled=true;button.textContent='Saving…';}
    const oldPath=clean(state.profile?.avatar_path); let newUploadedPath='';
    try{
      let avatarPath=clean(state.profile?.avatar_path);
      if(state.profile?.avatar_kind==='upload' && state.pendingFile){avatarPath=await uploadPending();newUploadedPath=avatarPath;}
      const payload={
        p_full_name:clean(form.elements.full_name?.value),p_username:clean(form.elements.username?.value)||null,
        p_department:clean(form.elements.department?.value)||null,p_job_title:clean(form.elements.job_title?.value)||null,p_phone:clean(form.elements.phone?.value)||null,
        p_avatar_kind:clean(state.profile?.avatar_kind||'initials'),p_avatar_value:state.profile?.avatar_kind==='preset'?clean(state.profile?.avatar_value):null,
        p_avatar_path:state.profile?.avatar_kind==='upload'?avatarPath:null
      };
      const client=db(); const {data,error}=await client.rpc('update_my_profile',payload); if(error)throw error;
      const saved=Array.isArray(data)?data[0]:data; state.profile=saved||{...state.profile,...payload,avatar_path:avatarPath};
      state.signedPath='';state.signedUrl='';
      if(oldPath && oldPath!==avatarPath){ try{await client.storage.from('profile-avatars').remove([oldPath]);}catch{} }
      if(state.previewUrl){URL.revokeObjectURL(state.previewUrl);state.previewUrl='';} state.pendingFile=null;
      try{await window.Session?.revalidateProfile?.({reason:'self_profile_updated',force:true});}catch{}
      const nameNode=document.getElementById('currentUserChip'); if(nameNode)nameNode.textContent=clean(saved?.full_name||saved?.name||payload.p_full_name);
      await syncTopbarAvatar();
      window.InCheck360ModernTopbar?.refresh?.();
      toast('Profile updated successfully.'); close();
    }catch(err){ if(newUploadedPath){try{await db()?.storage.from('profile-avatars').remove([newUploadedPath]);}catch{}} console.error('[UserProfile] save failed',err);toast(err.message||'Unable to update profile.','error'); }
    finally{state.saving=false;if(button){button.disabled=false;button.textContent='Save profile';}}
  }

  async function open(){
    if(document.body?.classList.contains('auth-locked')||!userId())return;
    document.body?.classList.add('user-profile-open'); const root=ensureRoot(); root.hidden=false; root.innerHTML='<div class="user-profile-backdrop"></div><section class="user-profile-dialog user-profile-loading"><div class="user-profile-loading-card">Loading profile…</div></section>';
    try{await fetchProfile();await render();setTimeout(()=>document.querySelector('#userProfileForm input[name="full_name"]')?.focus(),0);}catch(err){console.error('[UserProfile] open failed',err);toast(err.message||'Unable to load profile.','error');close();}
  }

  function boot(){
    const sync=()=>{if(!document.body?.classList.contains('auth-locked')&&userId())void syncTopbarAvatar();};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync,{once:true}); else sync();
    window.addEventListener('incheck:open-profile',()=>void open());
    window.Session?.subscribe?.((_u,detail={})=>{if(detail.reason==='signed_out'){state.profile=null;state.signedUrl='';state.signedPath='';close();return;} setTimeout(sync,80);});
    setTimeout(sync,600);setTimeout(sync,1800);
  }

  return Object.freeze({open,close,boot,syncTopbarAvatar,refresh:async()=>{await fetchProfile();await syncTopbarAvatar();}});
})();

UserProfile.boot();
window.UserProfile=UserProfile;
