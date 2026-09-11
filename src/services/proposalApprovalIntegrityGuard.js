(function installProposalApprovalIntegrityGuard(global) {
  'use strict';

  const VERSION = '20260911-proposal-approval-integrity2';
  const norm = value => String(value == null ? '' : value).trim().toLowerCase();
  const policyCache = { value: null, checkedAt: 0 };

  function isActiveProposalRule(rule = {}) {
    const resource = norm(rule.resource);
    const active = rule.is_active !== false && norm(rule.is_active) !== 'false';
    return active && (resource === 'proposal' || resource === 'proposals');
  }

  function extractRows(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.rows)) return response.rows;
    if (Array.isArray(response?.rules)) return response.rules;
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.rows)) return response.data.rows;
    if (Array.isArray(response?.data?.rules)) return response.data.rules;
    return [];
  }

  async function hasConfiguredProposalPolicy() {
    const stateRules = global.Workflow?.state?.rules;
    if (Array.isArray(stateRules) && stateRules.some(isActiveProposalRule)) {
      policyCache.value = true;
      policyCache.checkedAt = Date.now();
      return true;
    }

    const now = Date.now();
    if (policyCache.value !== null && now - policyCache.checkedAt < 5000) return policyCache.value;

    if (!global.Api || typeof global.Api.listWorkflowRules !== 'function') return null;

    try {
      const response = await global.Api.listWorkflowRules({});
      const hasPolicy = extractRows(response).some(isActiveProposalRule);
      policyCache.value = hasPolicy;
      policyCache.checkedAt = Date.now();
      return hasPolicy;
    } catch (error) {
      console.warn('[proposal approval integrity] Unable to verify proposal policy; preserving normal workflow behavior.', error);
      return null;
    }
  }

  function noPolicyResult() {
    return {
      ok: true,
      allowed: true,
      skipped: true,
      noPolicy: true,
      pendingApproval: false,
      approvalCreated: false,
      approvalId: '',
      reason: ''
    };
  }

  function patchWorkflowEngine() {
    const engine = global.WorkflowEngine;
    if (!engine || typeof engine.enforceBeforeSave !== 'function' || typeof engine.createWorkflowApprovalFromDecision !== 'function') return false;
    if (engine.__proposalApprovalIntegrityVersion === VERSION) return true;

    const originalEnforceBeforeSave = engine.enforceBeforeSave;
    engine.enforceBeforeSave = async function guardedEnforceBeforeSave(resource, ...args) {
      const normalizedResource = norm(resource);
      if (normalizedResource === 'proposal' || normalizedResource === 'proposals') {
        const hasPolicy = await hasConfiguredProposalPolicy();
        if (hasPolicy === false) {
          console.debug('[proposal approval integrity] No active proposal policy configured; approval workflow skipped.');
          return noPolicyResult();
        }
      }
      return originalEnforceBeforeSave.call(this, resource, ...args);
    };

    const originalCreateApproval = engine.createWorkflowApprovalFromDecision;
    engine.createWorkflowApprovalFromDecision = async function guardedCreateWorkflowApproval(resource, ...args) {
      const normalizedResource = norm(resource);
      if (normalizedResource === 'proposal' || normalizedResource === 'proposals') {
        const hasPolicy = await hasConfiguredProposalPolicy();
        if (hasPolicy === false) return noPolicyResult();
      }

      const result = await originalCreateApproval.call(this, resource, ...args);
      if (!result || result.approvalCreated !== true) return result;

      const approvalId = String(result.approvalId || result.approval_id || '').trim();
      if (approvalId) return result;

      console.warn('[proposal approval integrity] Approval was reported as created without an approval record id. Keeping proposal out of Pending Approval.');
      return {
        ...result,
        approvalCreated: false,
        approvalId: '',
        pendingApproval: false,
        reason: 'Approval is required, but no approval request record was created. Please retry.'
      };
    };

    engine.__proposalApprovalIntegrityVersion = VERSION;
    return true;
  }

  function patchProposalSubmit() {
    const Proposals = global.Proposals;
    if (!Proposals || typeof Proposals.submitForm !== 'function') return false;
    if (Proposals.__proposalApprovalIntegrityVersion === VERSION) return true;

    const original = Proposals.submitForm;
    Proposals.submitForm = async function guardedProposalSubmit(...args) {
      try {
        const form = document.getElementById('proposalForm');
        const statusEl = document.getElementById('proposalFormStatus');
        const isEdit = form?.dataset?.mode === 'edit';
        const proposalId = String(form?.dataset?.id || this.state?.currentProposalId || '').trim();
        const requestedStatus = norm(statusEl?.value);

        if (isEdit && proposalId && requestedStatus === 'pending_approval' && typeof this.getProposal === 'function') {
          const latestResponse = await this.getProposal(proposalId);
          const latest = typeof this.extractProposalAndItems === 'function'
            ? this.extractProposalAndItems(latestResponse, proposalId)
            : null;
          const latestProposal = latest?.proposal || latestResponse?.proposal || latestResponse?.data?.proposal || latestResponse;
          const liveStatus = norm(latestProposal?.status);

          if (liveStatus && liveStatus !== 'pending_approval') {
            if (statusEl) statusEl.value = latestProposal.status;
            if (this.state) {
              this.state.currentProposal = {
                ...(this.state.currentProposal || {}),
                ...(latestProposal && typeof latestProposal === 'object' ? latestProposal : {}),
                status: latestProposal.status
              };
            }
            global.UI?.toast?.(`Proposal status refreshed to ${String(latestProposal.status || '').replace(/_/g, ' ')}. Pending Approval is set only after a real approval request is created.`);
          }
        }
      } catch (error) {
        console.warn('[proposal approval integrity] Unable to refresh proposal status before save.', error);
      }

      return original.apply(this, args);
    };

    Proposals.__proposalApprovalIntegrityVersion = VERSION;
    return true;
  }

  function install() {
    const workflowReady = patchWorkflowEngine();
    const proposalReady = patchProposalSubmit();
    return workflowReady && proposalReady;
  }

  if (!install()) {
    [100, 350, 900, 1800].forEach(delay => setTimeout(install, delay));
  }
})(window);
