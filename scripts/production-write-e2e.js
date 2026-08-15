const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  root,
  env,
  mask,
  result,
  printResults,
  writeJson,
  nowIso,
} = require('./test-utils');

const results = [];
const cleanupErrors = [];
const created = {
  company: null,
  companyDocument: null,
  contact: null,
  lead: null,
  deal: null,
  proposal: null,
  agreement: null,
  invoice: null,
  onboarding: null,
  receipt: null,
  client: null,
};
const storageFiles = [];

const supabaseUrl = env('TEST_SUPABASE_URL', 'SUPABASE_URL').replace(/\/+$/, '');
const anonKey = env('TEST_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const serviceKey = env('TEST_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const testEmail = env('TEST_USER_EMAIL');
const testPassword = env('TEST_USER_PASSWORD');
const appUrl = env('TEST_APP_URL', 'APP_BASE_URL', 'PUBLIC_APP_URL').replace(/\/+$/, '');
const confirmation = env('E2E_WRITE_CONFIRM');
const marker = `IC360-E2E-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const slug = marker.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const reportPath = path.join(root, 'test-results', 'production-write-e2e.json');

function pass(name, details = '') {
  results.push(result('PASS', name, details));
}

function fail(name, error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  results.push(result('FAIL', name, message));
}

function asRow(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  if (Array.isArray(value.rows)) return value.rows[0] || null;
  if (value.data && typeof value.data === 'object') return asRow(value.data);
  return typeof value === 'object' ? value : null;
}

function isoDate(daysFromNow = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

async function singleBy(table, filters = {}, order = 'created_at') {
  let query = userClient.from(table).select('*');
  for (const [column, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    query = query.eq(column, value);
  }
  if (order) query = query.order(order, { ascending: false });
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function dispatch(resource, action, payload = {}) {
  const response = await global.SupabaseData.dispatch({ ...payload, resource, action });
  if (!response?.handled) throw new Error(`SupabaseData did not handle ${resource}:${action}`);
  return response.data;
}

async function uploadTextFile(client, bucket, objectPath, text) {
  const bytes = Buffer.from(String(text), 'utf8');
  const { error } = await client.storage.from(bucket).upload(objectPath, bytes, {
    contentType: 'text/plain',
    cacheControl: '60',
    upsert: false,
  });
  if (error) throw error;
  storageFiles.push({ bucket, path: objectPath });
}

async function safeDelete(table, column, value) {
  if (!value) return;
  const { error } = await serviceClient.from(table).delete().eq(column, value);
  if (error && !['42P01', '42703'].includes(String(error.code || ''))) throw error;
}

async function cleanupNotifications() {
  const refs = [
    created.lead?.id, created.lead?.lead_id,
    created.deal?.id, created.deal?.deal_id,
    created.proposal?.id, created.proposal?.proposal_id,
    created.agreement?.id, created.agreement?.agreement_id, created.agreement?.agreement_number,
    created.invoice?.id, created.invoice?.invoice_id, created.invoice?.invoice_number,
    created.onboarding?.id, created.onboarding?.onboarding_id,
    created.receipt?.id, created.receipt?.receipt_id, created.receipt?.receipt_number,
  ].map(value => String(value || '').trim()).filter(Boolean);
  if (!refs.length) return;

  let notifications = [];
  const selectResponse = await serviceClient
    .from('notifications')
    .select('notification_id,record_id')
    .in('record_id', refs);
  if (!selectResponse.error && Array.isArray(selectResponse.data)) notifications = selectResponse.data;
  const notificationIds = notifications.map(row => row.notification_id).filter(Boolean);
  if (notificationIds.length) {
    const queueDelete = await serviceClient.from('notification_delivery_queue').delete().in('notification_id', notificationIds);
    if (queueDelete.error && !['42P01', '42703'].includes(String(queueDelete.error.code || ''))) throw queueDelete.error;
    const notificationDelete = await serviceClient.from('notifications').delete().in('notification_id', notificationIds);
    if (notificationDelete.error) throw notificationDelete.error;
  }
}

async function cleanup() {
  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (error) {
      cleanupErrors.push(`${label}: ${error?.message || error}`);
    }
  };

  await attempt('notification rows', cleanupNotifications);

  if (created.receipt?.id) {
    await attempt('receipt_items', () => safeDelete('receipt_items', 'receipt_id', created.receipt.id));
    await attempt('receipt', () => safeDelete('receipts', 'id', created.receipt.id));
  }

  if (created.client?.id) {
    await attempt('client', () => safeDelete('clients', 'id', created.client.id));
  }

  if (created.onboarding?.id) {
    await attempt('operations_onboarding', () => safeDelete('operations_onboarding', 'id', created.onboarding.id));
  }

  if (created.invoice?.id) {
    await attempt('invoice_payment_schedule', () => safeDelete('invoice_payment_schedule', 'invoice_id', created.invoice.id));
    await attempt('invoice_items', () => safeDelete('invoice_items', 'invoice_id', created.invoice.id));
    await attempt('invoice', () => safeDelete('invoices', 'id', created.invoice.id));
  }

  if (created.agreement?.id) {
    await attempt('agreement_items', () => safeDelete('agreement_items', 'agreement_id', created.agreement.id));
    await attempt('agreement', () => safeDelete('agreements', 'id', created.agreement.id));
  }

  if (created.proposal?.id) {
    await attempt('proposal_items', () => safeDelete('proposal_items', 'proposal_id', created.proposal.id));
    await attempt('proposal', () => safeDelete('proposals', 'id', created.proposal.id));
  }

  if (created.deal?.id) await attempt('deal', () => safeDelete('deals', 'id', created.deal.id));
  if (created.lead?.id) await attempt('lead', () => safeDelete('leads', 'id', created.lead.id));

  if (created.contact?.id && created.company?.id) {
    await attempt('crm_contact_company_links', async () => {
      const { error } = await serviceClient
        .from('crm_contact_company_links')
        .delete()
        .eq('contact_id', created.contact.id)
        .eq('company_id', created.company.id);
      if (error && !['42P01', '42703'].includes(String(error.code || ''))) throw error;
    });
  }
  if (created.contact?.id) await attempt('contact', () => safeDelete('contacts', 'id', created.contact.id));

  if (created.companyDocument?.id) {
    await attempt('company document row', () => safeDelete('company_documents', 'id', created.companyDocument.id));
  }

  for (const file of [...storageFiles].reverse()) {
    await attempt(`storage ${file.bucket}/${file.path}`, async () => {
      const { error } = await serviceClient.storage.from(file.bucket).remove([file.path]);
      if (error) throw error;
    });
  }

  if (created.company?.id) await attempt('company', () => safeDelete('companies', 'id', created.company.id));

  const lifecycleRefs = [
    created.company?.id,
    created.lead?.id,
    created.deal?.id,
    created.proposal?.id,
    created.agreement?.id,
    created.invoice?.id,
    created.onboarding?.id,
    created.client?.id,
  ].filter(Boolean);
  if (lifecycleRefs.length) {
    await attempt('lifecycle_status_logs', async () => {
      const candidates = ['record_id', 'entity_id'];
      for (const column of candidates) {
        const { error } = await serviceClient.from('lifecycle_status_logs').delete().in(column, lifecycleRefs);
        if (!error) return;
        if (!['42P01', '42703'].includes(String(error.code || ''))) throw error;
      }
    });
  }
}

let userClient;
let serviceClient;

async function main() {
  if (confirmation !== 'RUN') throw new Error('Production write E2E is locked. Set E2E_WRITE_CONFIRM=RUN only in the dedicated workflow.');
  if (!supabaseUrl || !anonKey || !serviceKey || !testEmail || !testPassword) {
    throw new Error('TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY, TEST_USER_EMAIL and TEST_USER_PASSWORD are required.');
  }

  process.stdout.write(`\nProduction write E2E marker: ${marker}\n`);
  process.stdout.write(`Supabase: ${supabaseUrl} | anon=${mask(anonKey)} | service=${mask(serviceKey)}\n`);

  userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: auth, error: authError } = await userClient.auth.signInWithPassword({ email: testEmail, password: testPassword });
  if (authError || !auth?.user || !auth?.session) throw authError || new Error('Test-user login failed.');
  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('id,email,role_key,is_active')
    .eq('id', auth.user.id)
    .single();
  if (profileError) throw profileError;
  if (!profile?.role_key || profile.is_active === false) throw new Error('Test user does not have an active role profile.');
  if (String(profile.role_key).toLowerCase() !== 'admin') throw new Error(`Write E2E currently requires the configured test account to be admin; received ${profile.role_key}.`);
  pass('Authenticate production test user', `${mask(profile.email || testEmail)} → ${profile.role_key}`);

  global.window = global;
  global.location = { hostname: 'github-actions', origin: appUrl || '' };
  global.navigator = { userAgent: 'github-actions' };
  global.RUNTIME_CONFIG = { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: anonKey, APP_BASE_URL: appUrl };
  global.SupabaseClient = { getClient: () => userClient };
  global.Session = {
    role: () => profile.role_key,
    userId: () => auth.user.id,
    authContext: () => ({ role: profile.role_key, user: auth.user, profile, session: auth.session }),
  };
  global.AdminOverride = { canOverride: () => String(profile.role_key).toLowerCase() === 'admin' };
  global.AppPermissions = {
    baseMatrix: {},
    canPerformAction: (_resource, _action, role) => String(role || '').toLowerCase() === 'admin',
  };

  delete require.cache[require.resolve('../supabase-data.js')];
  require('../supabase-data.js');
  if (!global.SupabaseData?.dispatch) throw new Error('Unable to load SupabaseData business dispatcher.');
  pass('Load production business dispatcher', 'supabase-data.js');

  created.company = asRow(await dispatch('companies', 'create', {
    company_name: marker,
    legal_name: `${marker} Legal`,
    company_type: 'sme',
    industry: 'technology',
    main_email: `e2e+${slug}@example.invalid`,
    main_phone: '+96100000000',
    country: 'Lebanon',
    city: 'Beirut',
    address: 'Production E2E automated test record',
    authorized_signatory_full_name: 'E2E Authorized Signatory',
    authorized_signatory_title: 'Test Director',
    registration_number: marker,
    company_status: 'Prospect',
    notes: marker,
  }));
  if (!created.company?.id || !created.company?.company_id) throw new Error('Company create did not return internal and business IDs.');
  pass('Create Company', `${created.company.company_id}`);

  const companyDocPath = `${created.company.id}/${Date.now()}_${slug}.txt`;
  await uploadTextFile(userClient, 'company-documents', companyDocPath, `Automated E2E verification document ${marker}\n`);
  const companyDocInsert = await userClient.from('company_documents').insert({
    company_uuid: created.company.id,
    company_id: created.company.company_id,
    company_name: created.company.company_name,
    document_title: 'Automated E2E verification document',
    file_name: `${slug}.txt`,
    file_path: companyDocPath,
    file_mime_type: 'text/plain',
    file_size_bytes: Buffer.byteLength(marker),
  }).select('*').single();
  if (companyDocInsert.error) throw companyDocInsert.error;
  created.companyDocument = companyDocInsert.data;
  pass('Upload Company verification document', 'company-documents');

  const verifiedAt = new Date().toISOString();
  created.company = asRow(await dispatch('companies', 'verify', {
    id: created.company.id,
    updates: {
      documents_verified: true,
      documents_verification_status: 'verified',
      documents_verified_at: verifiedAt,
      documents_verified_by: auth.user.id,
      documents_verification_notes: marker,
      documents_verified_snapshot: {
        company_id: created.company.company_id,
        company_name: created.company.company_name,
        legal_name: created.company.legal_name,
        registration_number: created.company.registration_number,
        authorized_signatory_full_name: 'E2E Authorized Signatory',
        authorized_signatory_title: 'Test Director',
        country: 'Lebanon',
        city: 'Beirut',
      },
      is_verified: true,
      verified: true,
      company_verified: true,
      authorized_signatory_verified: true,
      verification_status: 'verified',
      authorized_signatory_name: 'E2E Authorized Signatory',
      authorized_signatory_title: 'Test Director',
    },
  })) || created.company;
  pass('Verify Company', created.company.verification_status || created.company.documents_verification_status || 'verified');

  const fkResponse = await userClient.rpc('crm_company_contact_fk_value', { p_company_id: created.company.id });
  if (fkResponse.error) throw fkResponse.error;
  const contactCompanyFk = String(fkResponse.data || created.company.id);
  created.contact = asRow(await dispatch('contacts', 'create', {
    contact: {
      company_id: contactCompanyFk,
      company_name: created.company.company_name,
      company_ids: [contactCompanyFk],
      company_names: created.company.company_name,
      first_name: 'E2E',
      last_name: 'Contact',
      full_name: 'E2E Contact',
      job_title: 'Test Contact',
      department: 'Testing',
      email: `contact+${slug}@example.invalid`,
      mobile: '+96100000001',
      decision_role: 'Decision Maker',
      is_primary_contact: true,
      contact_status: 'Active',
      notes: marker,
    },
  }));
  if (!created.contact?.id) throw new Error('Contact create did not return an internal ID.');
  pass('Create Contact linked to Company', created.contact.contact_id || created.contact.id);

  created.lead = asRow(await dispatch('leads', 'create', {
    lead: {
      lead_id: `LEAD-${slug}`.slice(0, 60),
      full_name: 'E2E Contact',
      company_name: created.company.company_name,
      company_uuid: created.company.id,
      company_id: created.company.company_id,
      contact_id: created.contact.id,
      contact_uuid: created.contact.id,
      contact_name: 'E2E Contact',
      contact_email: created.contact.email,
      phone: '+96100000001',
      email: created.contact.email,
      country: 'Lebanon',
      lead_source: 'E2E Automated Test',
      service_interest: 'InCheck360',
      status: 'Qualified',
      priority: 'Medium',
      estimated_value: 12,
      currency: 'USD',
      next_follow_up_at: new Date(Date.now() + 86400000).toISOString(),
      notes: marker,
    },
  }));
  if (!created.lead?.id) throw new Error('Lead create did not return an internal ID.');
  pass('Create Lead', created.lead.lead_id || created.lead.id);

  created.deal = asRow(await dispatch('leads', 'convert_to_deal', {
    id: created.lead.id,
    lead_id: created.lead.lead_id,
  }));
  if (!created.deal?.id) created.deal = await singleBy('deals', { company_id: created.company.company_id });
  if (!created.deal?.id) throw new Error('Lead conversion did not create a deal.');
  pass('Convert Lead → Deal', created.deal.deal_id || created.deal.id);

  created.proposal = asRow(await dispatch('proposals', 'create_from_deal', {
    id: created.deal.id,
    deal_uuid: created.deal.id,
    deal_id: created.deal.deal_id,
  }));
  if (!created.proposal?.id) created.proposal = await singleBy('proposals', { company_id: created.company.company_id });
  if (!created.proposal?.id) throw new Error('Deal conversion did not create a proposal.');
  pass('Create Proposal from Deal', created.proposal.proposal_id || created.proposal.id);

  const proposalItem = {
    section: 'annual_saas',
    line_no: 1,
    location_name: 'E2E Location',
    item_name: 'InCheck360 E2E License',
    unit_price: 1,
    discount_percent: 0,
    discounted_unit_price: 1,
    quantity: 12,
    license_quantity: 1,
    line_total: 12,
    service_start_date: isoDate(1),
    service_end_date: isoDate(366),
    notes: marker,
  };
  created.proposal = asRow(await dispatch('proposals', 'update', {
    id: created.proposal.id,
    updates: {
      proposal_title: `${marker} Proposal`,
      customer_name: created.company.company_name,
      customer_legal_name: created.company.legal_name,
      company_id: created.company.company_id,
      company_name: created.company.company_name,
      contact_id: created.contact.id,
      contact_name: 'E2E Contact',
      contact_email: created.contact.email,
      customer_contact_name: 'E2E Contact',
      customer_contact_email: created.contact.email,
      customer_address: 'Production E2E automated test record',
      customer_signatory_name: 'E2E Authorized Signatory',
      customer_signatory_title: 'Test Director',
      currency: 'USD',
      saas_total: 12,
      one_time_total: 0,
      grand_total: 12,
      billing_frequency: 'Annual',
      payment_term: 'Net 30',
      service_start_date: isoDate(1),
      contract_term: '12 Months',
      status: 'Draft',
      internal_notes: marker,
    },
    items: [proposalItem],
  })) || created.proposal;
  pass('Save Proposal commercial terms/items', '1 Annual SaaS item');

  created.proposal = asRow(await dispatch('proposals', 'update', {
    id: created.proposal.id,
    updates: { status: 'Sent' },
  })) || created.proposal;
  pass('Move Proposal → Sent', 'Sent');

  created.proposal = asRow(await dispatch('proposals', 'update', {
    id: created.proposal.id,
    updates: {
      status: 'Accepted',
      accepted_at: new Date().toISOString(),
      accepted_by: auth.user.id,
      accepted_by_name: 'E2E Test User',
      accepted_by_email: profile.email,
      customer_sign_date: isoDate(0),
    },
  })) || created.proposal;
  pass('Move Proposal → Accepted', 'Accepted');

  const proposalDocPath = `${created.proposal.id}/${Date.now()}_${slug}.txt`;
  await uploadTextFile(userClient, 'proposal-signed-documents', proposalDocPath, `Automated accepted proposal ${marker}\n`);
  created.proposal = asRow(await dispatch('proposals', 'update', {
    id: created.proposal.id,
    updates: {
      signed_document_path: proposalDocPath,
      signed_document_name: `${slug}.txt`,
      signed_document_uploaded_at: new Date().toISOString(),
      signed_document_uploaded_by: auth.user.id,
    },
  })) || created.proposal;
  pass('Upload accepted signed Proposal', 'proposal-signed-documents');

  created.agreement = asRow(await dispatch('agreements', 'create_from_proposal', {
    proposal_uuid: created.proposal.id,
    proposal_id: created.proposal.proposal_id,
  }));
  if (!created.agreement?.id) created.agreement = await singleBy('agreements', { company_id: created.company.company_id });
  if (!created.agreement?.id) throw new Error('Proposal conversion did not create an agreement.');
  pass('Convert Proposal → Agreement', created.agreement.agreement_id || created.agreement.agreement_number || created.agreement.id);

  const agreementDocPath = `${created.agreement.id}/${Date.now()}_${slug}.txt`;
  await uploadTextFile(userClient, 'agreement-signed-documents', agreementDocPath, `Automated signed agreement ${marker}\n`);
  created.agreement = asRow(await dispatch('agreements', 'update', {
    id: created.agreement.id,
    updates: {
      status: 'Signed',
      signed_date: isoDate(0),
      customer_official_signatory_name: 'E2E Authorized Signatory',
      customer_official_signatory_title: 'Test Director',
      customer_official_sign_date: isoDate(0),
      provider_official_signatory_1_name: 'InCheck360 E2E Provider',
      provider_official_signatory_1_title: 'Provider',
      provider_official_signatory_1_sign_date: isoDate(0),
      signed_document_path: agreementDocPath,
      signed_document_name: `${slug}.txt`,
      signed_document_uploaded_at: new Date().toISOString(),
      signed_document_uploaded_by: auth.user.id,
    },
  })) || created.agreement;
  pass('Sign Agreement', 'Signed');

  created.invoice = asRow(await dispatch('invoices', 'create_from_agreement', {
    agreement_uuid: created.agreement.id,
    agreement_id: created.agreement.agreement_id,
  }));
  if (!created.invoice?.id) created.invoice = await singleBy('invoices', { agreement_id: created.agreement.id });
  if (!created.invoice?.id) throw new Error('Agreement did not create an invoice.');
  pass('Create Invoice from Agreement', created.invoice.invoice_number || created.invoice.invoice_id || created.invoice.id);

  if (!String(created.invoice.status || '').toLowerCase().includes('issued')) {
    try {
      created.invoice = asRow(await dispatch('invoices', 'update', {
        id: created.invoice.id,
        updates: { status: 'Issued', issue_date: isoDate(0), due_date: isoDate(30) },
      })) || created.invoice;
    } catch (error) {
      process.stdout.write(`Invoice issue transition note: ${error?.message || error}\n`);
    }
  }

  created.onboarding = asRow(await dispatch('invoices', 'create_operations_onboarding', {
    operations_onboarding: {
      agreement_id: created.agreement.id,
      source_agreement_id: created.agreement.id,
      agreement_number: created.agreement.agreement_id || created.agreement.agreement_number,
      invoice_id: created.invoice.id,
      source_invoice_id: created.invoice.id,
      invoice_number: created.invoice.invoice_number || created.invoice.invoice_id,
      source_invoice_number: created.invoice.invoice_number || created.invoice.invoice_id,
      source_type: 'invoice',
      source_id: created.invoice.id,
      company_id: created.company.company_id,
      company_name: created.company.company_name,
      client_name: created.company.company_name,
      onboarding_status: 'Pending',
      status: 'Pending',
      notes: marker,
    },
  }));
  if (!created.onboarding?.id) {
    const onboardingQuery = await userClient.from('operations_onboarding').select('*').eq('invoice_id', created.invoice.id).limit(1).maybeSingle();
    if (onboardingQuery.error) throw onboardingQuery.error;
    created.onboarding = onboardingQuery.data;
  }
  if (!created.onboarding?.id) throw new Error('Invoice did not create Operations Onboarding.');
  pass('Create Operations Onboarding from Invoice', created.onboarding.onboarding_id || created.onboarding.id);

  created.receipt = asRow(await dispatch('receipts', 'create_from_invoice', {
    invoice_uuid: created.invoice.id,
    invoice_id: created.invoice.invoice_id,
    amount: Number(created.invoice.grand_total || created.invoice.invoice_total || created.invoice.total_amount || 12) || 12,
    payment_method: 'Bank Transfer',
    payment_reference: marker,
    receipt_date: isoDate(0),
    notes: marker,
    silent: true,
    suppress_notifications: true,
  }));
  if (!created.receipt?.id) created.receipt = await singleBy('receipts', { invoice_id: created.invoice.id });
  if (!created.receipt?.id) throw new Error('Invoice payment did not create a receipt.');
  pass('Create Receipt from Invoice', created.receipt.receipt_number || created.receipt.receipt_id || created.receipt.id);

  created.client = asRow(await dispatch('clients', 'create', {
    client: {
      client_id: `CLIENT-${slug}`.slice(0, 60),
      client_name: created.company.company_name,
      company_name: created.company.company_name,
      primary_email: created.contact.email,
      primary_phone: '+96100000001',
      billing_frequency: 'Annual',
      payment_term: 'Net 30',
      status: 'Active',
      source_agreement_id: created.agreement.id,
      total_agreements: 1,
      total_locations: 1,
      total_value: Number(created.invoice.grand_total || 12) || 12,
      total_paid: Number(created.invoice.grand_total || 12) || 12,
      total_due: 0,
    },
  }));
  if (!created.client?.id) created.client = await singleBy('clients', { company_name: created.company.company_name });
  if (!created.client?.id) throw new Error('Active client record was not created.');
  pass('Create Active Client', created.client.client_id || created.client.id);

  const relationshipCheck = await userClient
    .from('crm_contact_company_links')
    .select('contact_id,company_id')
    .eq('contact_id', created.contact.id)
    .eq('company_id', created.company.id)
    .limit(1);
  if (relationshipCheck.error) throw relationshipCheck.error;
  if (!Array.isArray(relationshipCheck.data) || !relationshipCheck.data.length) throw new Error('Contact-company relationship bridge was not created.');
  pass('Verify Contact ↔ Company relationship', 'crm_contact_company_links');

  const verificationChecks = [
    ['Company', 'companies', created.company.id],
    ['Contact', 'contacts', created.contact.id],
    ['Lead', 'leads', created.lead.id],
    ['Deal', 'deals', created.deal.id],
    ['Proposal', 'proposals', created.proposal.id],
    ['Agreement', 'agreements', created.agreement.id],
    ['Invoice', 'invoices', created.invoice.id],
    ['Onboarding', 'operations_onboarding', created.onboarding.id],
    ['Receipt', 'receipts', created.receipt.id],
    ['Client', 'clients', created.client.id],
  ];
  for (const [label, table, id] of verificationChecks) {
    const { data, error } = await userClient.from(table).select('id').eq('id', id).maybeSingle();
    if (error || !data?.id) throw error || new Error(`${label} is not readable after creation.`);
  }
  pass('Verify complete production write chain', 'Company → Contact → Lead → Deal → Proposal → Agreement → Invoice → Onboarding → Receipt → Client');
}

(async () => {
  let mainError = null;
  try {
    await main();
  } catch (error) {
    mainError = error;
    fail('Production write E2E', error);
  } finally {
    if (serviceClient) await cleanup();
    if (cleanupErrors.length) {
      fail('Cleanup production E2E data', cleanupErrors.join(' | '));
    } else if (serviceClient) {
      pass('Cleanup production E2E data', 'all created records and storage objects removed');
    }

    const counts = printResults('InCheck360 Production Write E2E', results);
    writeJson(reportPath, {
      generated_at: nowIso(),
      marker,
      app_url: appUrl,
      supabase_url: supabaseUrl,
      results,
      cleanup_errors: cleanupErrors,
      created_ids: Object.fromEntries(Object.entries(created).map(([key, row]) => [key, row?.id || null])),
    });

    if (mainError || counts.FAIL) process.exitCode = 1;
  }
})();
