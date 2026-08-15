(function initNotificationTemplateHelpers(global) {
  function getRecordRef(record = {}, fallback = 'TEST-NOTIFICATION') {
    if (!record || typeof record !== 'object') return fallback;

    return String(
      record.record_ref ||
      record.record_reference ||
      record.reference ||
      record.ref ||
      record.ticket_number ||
      record.ticket_id ||
      record.event_number ||
      record.event_id ||
      record.lead_number ||
      record.lead_id ||
      record.deal_number ||
      record.deal_id ||
      record.proposal_number ||
      record.proposal_id ||
      record.agreement_number ||
      record.agreement_id ||
      record.invoice_number ||
      record.invoice_id ||
      record.receipt_number ||
      record.receipt_id ||
      record.credit_note_number ||
      record.credit_note_no ||
      record.credit_note_ref ||
      record.credit_note_id ||
      record.onboarding_number ||
      record.technical_request_number ||
      record.conversation_number ||
      fallback
    ).trim() || fallback;
  }

  function getRecordDeepLink(resourceOrConfig, record = {}) {
    const eventConfig = resourceOrConfig && typeof resourceOrConfig === 'object'
      ? resourceOrConfig
      : { resource: resourceOrConfig };
    const template = String(
      eventConfig?.deep_link_template ||
      eventConfig?.deepLinkTemplate ||
      eventConfig?.link_template ||
      eventConfig?.url_template ||
      eventConfig?.deep_link ||
      eventConfig?.link ||
      ''
    ).trim();
    const testPayload = record && typeof record === 'object' ? record : {};
    const payload = {
      ...testPayload,
      id: testPayload.id || testPayload.record_id || testPayload.entity_id || 'test',
      record_id: testPayload.record_id || testPayload.id || testPayload.entity_id || 'test',
      entity_id: testPayload.entity_id || testPayload.id || testPayload.record_id || 'test',
      biners_entry_id: testPayload.biners_entry_id || testPayload.entry_id || testPayload.id || 'test',
      entry_id: testPayload.entry_id || testPayload.biners_entry_id || testPayload.id || 'test',
      entry_number: testPayload.entry_number || 'BIN/TEST',
      client_name: testPayload.client_name || 'Test Client'
    };
    if (template) {
      return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
        const cleanKey = String(key).trim();
        return encodeURIComponent(payload[cleanKey] ?? '');
      });
    }
    const ref = encodeURIComponent(getRecordRef(payload, payload.record_id || '') || payload.record_id || '');
    const moduleKey = String(eventConfig?.module || eventConfig?.module_key || eventConfig?.resource || '').trim().toLowerCase();
    if (moduleKey === 'biners') return `/biners?entryId=${encodeURIComponent(payload.biners_entry_id)}`;
    const routes = {
      tickets: `#tickets?ticket_id=${ref}`,
      agreements: `#agreements?agreement_id=${ref}`,
      proposals: `#proposals?proposal_id=${ref}`,
      invoices: `#invoices?invoice_id=${ref}`,
      receipts: `#receipts?receipt_id=${ref}`,
      leads: `#leads?lead_id=${ref}`,
      deals: `#deals?deal_id=${ref}`,
      operations_onboarding: `#operations-onboarding?onboarding_id=${ref}`,
      technical_admin_requests: `#technical-admin-requests?request_id=${ref}`,
      events: `#events?event_id=${ref}`
    };
    return routes[moduleKey] || (moduleKey ? `#${moduleKey}?record_id=${ref}` : '/');
  }

  function renderNotificationTemplate(template = '', context = {}) {
    const safeContext = context && typeof context === 'object' ? context : {};
    const recordRef = getRecordRef(
      safeContext,
      String(safeContext.record_ref || safeContext.reference || safeContext.display_ref || '').trim()
    );
    const directMap = {
      record_ref: recordRef || '',
      reference: recordRef || safeContext.reference || '',
      display_ref: safeContext.display_ref || recordRef || '',
      ticket_number: safeContext.ticket_number || recordRef || '',
      agreement_number: safeContext.agreement_number || recordRef || '',
      invoice_number: safeContext.invoice_number || recordRef || '',
      receipt_number: safeContext.receipt_number || recordRef || '',
      lead_number: safeContext.lead_number || recordRef || '',
      deal_number: safeContext.deal_number || recordRef || '',
      request_number: safeContext.request_number || safeContext.technical_request_number || recordRef || ''
    };
    return String(template || '')
      .replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
        const cleanKey = String(key).trim();
        const value = directMap[cleanKey] ?? safeContext[cleanKey] ?? '';
        return String(value ?? '');
      })
      .replace(/\{([a-z0-9_]+)\}/gi, (_, key) => {
        const value = directMap[key] ?? safeContext[key] ?? '';
        return String(value ?? '');
      })
      .trim();
  }

  global.getRecordRef = global.getRecordRef || getRecordRef;
  global.getRecordDeepLink = global.getRecordDeepLink || getRecordDeepLink;
  global.renderNotificationTemplate = global.renderNotificationTemplate || renderNotificationTemplate;
  global.NotificationTemplateHelpers = global.NotificationTemplateHelpers || {};
  global.NotificationTemplateHelpers.getRecordRef = global.NotificationTemplateHelpers.getRecordRef || global.getRecordRef;
  global.NotificationTemplateHelpers.getRecordDeepLink = global.NotificationTemplateHelpers.getRecordDeepLink || global.getRecordDeepLink;
  global.NotificationTemplateHelpers.renderNotificationTemplate = global.NotificationTemplateHelpers.renderNotificationTemplate || global.renderNotificationTemplate;
})(window);
