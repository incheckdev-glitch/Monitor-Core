const CrmJourneyGuide = (() => {
  const S = { bound:false, observer:null, timer:null };
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const norm = v => clean(v).toLowerCase().replace(/[\s-]+/g, '_');
  const esc = v => clean(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value = id => clean(document.getElementById(id)?.value || '');
  const visible = el => {
    if (!(el instanceof Element) || el.closest('[hidden],#loginSection,.workflow-guide-root,.workflow-guide-walkthrough')) return false;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };

  const STAGES = [
    { key:'company', label:'Company', view:'company', icon:'1' },
    { key:'contacts', label:'Contact', view:'contacts', icon:'2' },
    { key:'leads', label:'Lead', view:'leads', icon:'3' },
    { key:'deals', label:'Deal', view:'deals', icon:'4' },
    { key:'proposals', label:'Proposal', view:'proposals', icon:'5' }
  ];

  const GUIDANCE = {
    company: {
      title:'Start with the company',
      next:'After the company exists, add or link the correct contact.',
      rules:[
        'Search by company name or domain before creating a new record.',
        'Company Name is mandatory when saving a company.',
        'Keep legal, domain, country and verification information accurate because downstream CRM and commercial records reuse this company master.',
        'Do not create a duplicate company just to start a new lead.'
      ]
    },
    contacts: {
      title:'Link a real person to the company',
      next:'When there is a commercial opportunity, create a Lead using this company and contact.',
      rules:[
        'At least one Company is mandatory for every contact.',
        'At least First Name OR Last Name is mandatory.',
        'Search name, email and phone before creating another contact.',
        'Email and phone are not substitutes for linking the contact to the correct company.'
      ]
    },
    leads: {
      title:'Qualify the opportunity before converting it',
      next:'A Lead can convert to a Deal only when the conversion gates are satisfied.',
      rules:[
        'Company and Contact must be selected from the CRM lists before saving.',
        'Next Follow-up is mandatory for every lead change.',
        'A new Note is mandatory when creating or editing a lead.',
        'Before Convert to Deal: Lead status must be Qualified, Next Follow-up must exist, a fresh note must be saved, and the user must have conversion/deal-create permission.',
        'The same lead cannot be converted again after it is already linked to a deal.'
      ]
    },
    deals: {
      title:'Work the qualified opportunity toward proposal',
      next:'When the Deal is Qualified, use Create Proposal from the Deal so the CRM chain remains linked.',
      rules:[
        'For a direct Deal create, Company and Contact are mandatory. A deal converted from a Lead keeps those links from the source lead.',
        'Next Follow-up is mandatory for every deal change.',
        'A new Note is required by the current Deal save workflow.',
        'Before Create Proposal: Deal stage must be Qualified, Next Follow-up must exist, and the user must have proposal-create permission.',
        'Create the proposal from the Deal instead of creating an unrelated proposal.'
      ]
    },
    proposals: {
      title:'Continue the linked commercial lifecycle',
      next:'Complete the Proposal workflow, approvals and acceptance before continuing to Agreement.',
      rules:[
        'Confirm the linked Deal, Company and Contact before preparing commercial scope.',
        'Discount approval and hard-stop limits are controlled by the live Workflow rules.',
        'Keep the Proposal linked to its source Deal so the lifecycle remains traceable.'
      ]
    }
  };

  function currentModule(){
    return clean(document.querySelector('.view-tab.active,.view-tab[aria-selected="true"]')?.dataset?.view || '');
  }
  function stage(key=currentModule()){
    return STAGES.find(x => x.key === key) || null;
  }
  function tabFor(key){ return document.querySelector(`.view-tab[data-view="${CSS.escape(key)}"]`); }
  function canOpen(key){
    const tab = tabFor(key);
    if (!tab || tab.hidden || tab.getAttribute('aria-hidden') === 'true' || getComputedStyle(tab).display === 'none') return false;
    try { if (window.Permissions?.canAccessTab && !window.Permissions.canAccessTab(key)) return false; } catch {}
    return true;
  }
  function navigate(key){
    if (!canOpen(key)) return;
    const tab = tabFor(key);
    try { tab.click(); } catch {}
    setTimeout(() => window.WorkflowGuide?.refresh?.(), 80);
  }
  function openGuide(){
    if (window.WorkflowGuide?.open) return window.WorkflowGuide.open();
    document.querySelector('.workflow-guide-header-btn,.workflow-guide-floating-btn')?.click?.();
  }

  function journeyMarkup(activeKey){
    const g = GUIDANCE[activeKey] || GUIDANCE.company;
    return `<section class="crm-journey-card" data-crm-journey>
      <div class="crm-journey-head">
        <div><span class="crm-journey-kicker">Connected CRM Journey</span><strong>Company → Contact → Lead → Deal → Proposal</strong></div>
        <button type="button" class="btn ghost sm" data-crm-journey-guide>Guide this step</button>
      </div>
      <div class="crm-journey-rail" role="list" aria-label="CRM lifecycle">
        ${STAGES.map((s,i) => {
          const allowed = canOpen(s.key);
          const active = s.key === activeKey;
          return `<button type="button" role="listitem" class="crm-journey-stage ${active?'is-active':''}" data-crm-journey-nav="${esc(s.key)}" ${allowed?'':'disabled'}>
            <span>${s.icon}</span><b>${esc(s.label)}</b>${i < STAGES.length-1 ? '<i aria-hidden="true">›</i>' : ''}
          </button>`;
        }).join('')}
      </div>
      <div class="crm-journey-now"><span>Current step</span><strong>${esc(g.title)}</strong><p>${esc(g.next)}</p></div>
    </section>`;
  }

  function ensureJourney(view, key){
    if (!(view instanceof Element) || !GUIDANCE[key]) return;
    let card = view.querySelector(':scope > .crm-journey-card,[data-crm-journey]');
    if (!card) {
      const wrap = document.createElement('div');
      wrap.innerHTML = journeyMarkup(key);
      card = wrap.firstElementChild;
      const header = view.querySelector(':scope > .icds-page-header,:scope > .company-page-header,:scope > .contacts-page-shell > header,:scope > [class*="page-header"],:scope > header');
      if (header?.parentElement === view) header.insertAdjacentElement('afterend', card);
      else if (header && view.contains(header)) header.insertAdjacentElement('afterend', card);
      else view.prepend(card);
    } else {
      const replacement = document.createElement('div'); replacement.innerHTML = journeyMarkup(key);
      card.replaceWith(replacement.firstElementChild);
    }
  }

  function checklist(items){
    return `<ul class="crm-form-checklist">${items.map(x => `<li class="${x.ok?'is-ok':'is-pending'}"><span>${x.ok?'✓':'○'}</span><div><strong>${esc(x.label)}</strong>${x.note?`<p>${esc(x.note)}</p>`:''}</div></li>`).join('')}</ul>`;
  }
  function selectedCount(id){
    const el = document.getElementById(id);
    if (!el) return 0;
    if (el.tagName === 'SELECT' && el.multiple) return Array.from(el.selectedOptions || []).filter(o => clean(o.value)).length;
    return clean(el.value) ? 1 : 0;
  }
  function leadFollowUp(){ return value('leadNextFollowUpAtInput') || value('leadFormNextFollowupDate'); }
  function normalizedStatus(v){ return norm(v).replace(/^not_contacted_yet$/,'not_contacted_yet'); }

  function formContext(form){
    if (!form) return null;
    const id = clean(form.id || form.dataset.formGuideKey);
    if (id === 'companyForm') {
      const name = value('companyNameInput');
      return {
        step:'1 · Company', title:'Create / Edit Company',
        text:'The company is the CRM master record. Save it once, then reuse it for contacts, leads and deals.',
        items:[
          {label:'Company Name', ok:Boolean(name), note:'Mandatory to save the company.'},
          {label:'Duplicate check', ok:Boolean(name), note:'Search the CRM before creating a second record with the same company/domain.'},
          {label:'Next: Contact', ok:false, note:'After save, add or link the person you are working with.'}
        ]
      };
    }
    if (id === 'contactForm') {
      const companies = selectedCount('contactCompanyInput');
      const first = value('contactFirstNameInput'), last = value('contactLastNameInput');
      return {
        step:'2 · Contact', title:'Create / Edit Contact',
        text:'A contact must belong to at least one company and must have enough identity to avoid duplicate people.',
        items:[
          {label:'At least one Company', ok:companies > 0, note:'Mandatory.'},
          {label:'First Name OR Last Name', ok:Boolean(first || last), note:'At least one of the two is mandatory.'},
          {label:'Email / phone checked for duplicate', ok:Boolean(value('contactEmailInput') || value('contactPhoneInput') || value('contactMobileInput')), note:'Recommended before creating another person.'},
          {label:'Next: Lead', ok:false, note:'Create a Lead when this contact represents a real commercial opportunity.'}
        ]
      };
    }
    if (id === 'leadForm') {
      const company = value('leadFormCompanyName'), contact = value('leadFormContactName'), follow = leadFollowUp(), note = value('leadFormNotes');
      const status = normalizedStatus(value('leadFormStatus'));
      const qualified = status === 'qualified';
      const convertAfterSave = form.dataset.convertAfterSave === 'true';
      return {
        step:'3 · Lead', title: convertAfterSave ? 'Lead Conversion Readiness' : 'Create / Edit Lead',
        text: convertAfterSave ? 'This lead is being prepared for conversion. Save the required note/workflow fields first; the ERP will then continue the conversion flow.' : 'Keep the company/contact links intact and record the next action before saving.',
        items:[
          {label:'Company selected from CRM list', ok:Boolean(company), note:'Mandatory before save.'},
          {label:'Contact selected from CRM list', ok:Boolean(contact), note:'Mandatory before save.'},
          {label:'Next Follow-up', ok:Boolean(follow), note:'Mandatory for every lead change.'},
          {label:'New Note', ok:Boolean(note), note:'Mandatory on create/edit and before conversion.'},
          {label:'Qualified status for Deal conversion', ok:qualified, note:'Required only when converting to Deal.'}
        ]
      };
    }
    if (id === 'dealForm') {
      const lead = value('dealFormLeadId') || clean(document.getElementById('dealFormLeadId')?.dataset?.leadUuid || '');
      const directCreate = (form.dataset.mode || 'create') !== 'edit' && !lead;
      const company = value('dealFormCompanySelector') || value('dealFormCompanyId');
      const contact = value('dealFormContactSelector') || value('dealFormContactId');
      const stageValue = norm(value('dealFormStage'));
      const follow = value('dealNextFollowUpAtInput'), note = value('dealFormNotes');
      return {
        step:'4 · Deal', title:'Deal / Proposal Readiness',
        text: directCreate ? 'This is a direct Deal create, so Company and Contact must be selected explicitly.' : 'This Deal is linked to a source Lead. Keep those links intact while progressing the opportunity.',
        items:[
          {label: directCreate ? 'Company selected' : 'Company inherited / linked', ok:Boolean(company) || !directCreate, note:directCreate?'Mandatory for direct Deal creation.':'Do not break the source relationship.'},
          {label: directCreate ? 'Contact selected' : 'Contact inherited / linked', ok:Boolean(contact) || !directCreate, note:directCreate?'Mandatory for direct Deal creation.':'Do not break the source relationship.'},
          {label:'Next Follow-up', ok:Boolean(follow), note:'Mandatory for every deal change.'},
          {label:'New Note', ok:Boolean(note), note:'Required by the current Deal save workflow.'},
          {label:'Qualified stage for Proposal', ok:stageValue === 'qualified', note:'Required before Create Proposal.'}
        ]
      };
    }
    return null;
  }

  function ensureFormCard(form){
    const ctx = formContext(form);
    if (!ctx) return;
    let card = form.querySelector(':scope > .crm-form-journey-card');
    if (!card) {
      card = document.createElement('section');
      card.className = 'crm-form-journey-card';
      const formGuide = form.querySelector(':scope > .form-guide-summary');
      if (formGuide) formGuide.insertAdjacentElement('afterend', card); else form.prepend(card);
    }
    card.innerHTML = `<div class="crm-form-card-head"><div><span>${esc(ctx.step)}</span><strong>${esc(ctx.title)}</strong></div><button type="button" class="crm-form-help" data-crm-journey-guide>?</button></div><p>${esc(ctx.text)}</p>${checklist(ctx.items)}`;
  }

  function ensureWorkflowPanelCard(){
    const body = document.querySelector('.workflow-guide-root:not([hidden]) .workflow-guide-panel-body');
    const key = currentModule();
    if (!body) return;
    let card = body.querySelector('.crm-journey-workflow-card');
    if (!GUIDANCE[key]) { card?.remove(); return; }
    if (!card) { card = document.createElement('section'); card.className = 'workflow-guide-section crm-journey-workflow-card'; body.prepend(card); }
    const g = GUIDANCE[key], s = stage(key);
    card.innerHTML = `<div class="workflow-guide-section-head"><div><span class="workflow-guide-kicker">CRM Journey</span><h3>${esc(s?.label || key)} · Connected lifecycle</h3></div><span class="workflow-guide-count">${(STAGES.findIndex(x=>x.key===key)+1)}/${STAGES.length}</span></div><div class="crm-panel-rail">${STAGES.map(x=>`<span class="${x.key===key?'is-active':''}">${esc(x.label)}</span>`).join('<i>›</i>')}</div><p class="crm-panel-next"><strong>Next:</strong> ${esc(g.next)}</p><ul class="crm-panel-rules">${g.rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`;
  }

  function registerFormRules(){
    const fg = window.FormGuide;
    if (!fg?.registerRules) return false;
    fg.registerRules('companyForm', {
      required:['companyNameInput'],
      notes:{ companyNameInput:'Company Name is required by the Company save validation.' }
    });
    fg.registerRules('contactForm', {
      required:['contactCompanyInput'],
      notes:{
        contactCompanyInput:'At least one company is required by the Contact save validation.',
        contactFirstNameInput:'First Name or Last Name: at least one must be provided.',
        contactLastNameInput:'First Name or Last Name: at least one must be provided.'
      }
    });
    fg.registerRules('leadForm', {
      required:['leadFormCompanyName','leadFormContactName','leadFormNotes'],
      conditional:{
        leadNextFollowUpAtInput:{ when:()=>Boolean(document.getElementById('leadNextFollowUpAtInput')), reason:'Next Follow-up is required for every lead change.' },
        leadFormNextFollowupDate:{ when:()=>!document.getElementById('leadNextFollowUpAtInput') && Boolean(document.getElementById('leadFormNextFollowupDate')), reason:'Next Follow-up is required for every lead change.' }
      },
      notes:{
        leadFormCompanyName:'A company must be selected from the CRM list before saving.',
        leadFormContactName:'A contact must be selected from the CRM list before saving.',
        leadFormNotes:'A new note is required when creating/editing a lead and before conversion.'
      }
    });
    fg.registerRules('dealForm', {
      required:['dealNextFollowUpAtInput','dealFormNotes'],
      conditional:{
        dealFormCompanySelector:{
          when:({root})=> (root?.dataset?.mode || 'create') !== 'edit' && !clean(document.getElementById('dealFormLeadId')?.value || document.getElementById('dealFormLeadId')?.dataset?.leadUuid),
          reason:'Company is mandatory when creating a Deal directly without a source Lead.',
          optionalReason:'Company is inherited/linked for this Deal flow.'
        },
        dealFormContactSelector:{
          when:({root})=> (root?.dataset?.mode || 'create') !== 'edit' && !clean(document.getElementById('dealFormLeadId')?.value || document.getElementById('dealFormLeadId')?.dataset?.leadUuid),
          reason:'Contact is mandatory when creating a Deal directly without a source Lead.',
          optionalReason:'Contact is inherited/linked for this Deal flow.'
        }
      },
      notes:{
        dealNextFollowUpAtInput:'Next Follow-up is required for every deal change.',
        dealFormNotes:'A new note is required by the current Deal save workflow.'
      }
    });
    fg.refresh?.();
    return true;
  }

  function scan(){
    S.timer = null;
    if (document.body?.classList.contains('auth-locked')) return;
    registerFormRules();
    const key = currentModule();
    if (GUIDANCE[key]) {
      const tab = tabFor(key);
      const view = document.getElementById(tab?.getAttribute('aria-controls') || '') || document.querySelector('.view.active,[role="tabpanel"].active');
      if (view) ensureJourney(view, key);
    }
    ['companyForm','contactForm','leadForm','dealForm'].forEach(id => {
      const form = document.getElementById(id);
      if (form && visible(form)) ensureFormCard(form);
    });
    ensureWorkflowPanelCard();
  }
  function schedule(delay=70){ if (S.timer) clearTimeout(S.timer); S.timer=setTimeout(scan,delay); }

  function bind(){
    if (S.bound) return; S.bound=true;
    document.addEventListener('click', e => {
      const nav = e.target?.closest?.('[data-crm-journey-nav]');
      if (nav) { e.preventDefault(); navigate(nav.dataset.crmJourneyNav); return; }
      if (e.target?.closest?.('[data-crm-journey-guide]')) { e.preventDefault(); openGuide(); return; }
      schedule(90);
    }, true);
    document.addEventListener('input', e => { if (e.target?.matches?.('input,select,textarea')) schedule(30); }, true);
    document.addEventListener('change', e => { if (e.target?.matches?.('input,select,textarea')) schedule(25); }, true);
    window.addEventListener('hashchange',()=>schedule(60));
    window.addEventListener('incheck360:ui:ready',()=>schedule(30));
    document.addEventListener('workflow-guide:opened',()=>schedule(0));
    if (typeof MutationObserver !== 'undefined') {
      S.observer = new MutationObserver(records => {
        if (records.some(r => r.addedNodes?.length || r.type === 'attributes')) schedule(100);
      });
      S.observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','data-mode','data-convert-after-save']});
    }
    schedule(0);
  }
  function init(){ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',bind,{once:true}); else bind(); }
  init();

  return Object.freeze({ refresh:()=>schedule(0), navigate, openGuide, guidance:key=>GUIDANCE[key] || null, formContext });
})();
window.CrmJourneyGuide = CrmJourneyGuide;
