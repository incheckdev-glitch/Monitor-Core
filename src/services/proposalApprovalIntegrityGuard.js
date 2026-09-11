(function installProposalApprovalIntegrityGuard(global) {
  'use strict';

  const VERSION = '20260911-proposal-approval-integrity1';
  const norm = value => String(value == null ? '' : value).trim().toLowerCase();

  function patchWorkflowEngine() {
    const engine = global.WorkflowEngine;
    if (!engine || typeof engine.createWorkflowApprovalFromDecision !== 'function') return false;
    if (engine.__proposalApprovalIntegrityVersion === VERSION) return true;

    const original = engine.createWorkflowApprovalFromDecision;
    engine.createWorkflowApprovalFromDecision = async function guardedCreateWorkflowApproval(...args) {
      const result = await original.apply(this, args);
      if (!result || result.approvalCreated !== true) return result;

      const approvalId = String(result.approvalId || result.approval_id || '').trim();
      if (approvalId) return result;

      console.warn('[proposal approval integrity] Approval was reported as created without an approval record id. Keeping proposal out of Pending Approval.');
      return {
        ...result,
        approvalCreated: false,
        approvalId: '',
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

        // Pending Approval is system-managed. A stale form must never write it back
        // after the database has already moved the proposal to another status.
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
