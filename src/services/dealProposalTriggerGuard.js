(function installDealProposalTriggerGuard(global) {
  'use strict';

  if (global.InCheck360DealProposalTriggerGuard) return;

  const VERSION = '20260911-dealproposal1';
  const TARGET_STAGE = 'Converted to Proposal';
  let patchedDeals = false;
  let patchedProposals = false;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');

  function canonicalStage(value) {
    const v = norm(value);
    if (v === 'converted to proposal' || v === 'proposal' || v === 'proposal sent' || v.includes('converted to proposal')) {
      return TARGET_STAGE;
    }
    return clean(value);
  }

  function hasLinkedProposal(row = {}) {
    return Boolean(clean(row.proposal_id || row.proposalId));
  }

  function getDealRow(id) {
    const target = clean(id);
    if (!target) return null;
    const rows = global.Deals?.state?.rows;
    return Array.isArray(rows)
      ? rows.find(row => [row?.id, row?.deal_id, row?.dealId].some(value => clean(value) === target)) || null
      : null;
  }

  function toast(message) {
    try {
      if (global.UI?.toast) return global.UI.toast(message);
      if (global.U?.toast) return global.U.toast(message);
    } catch (_) {}
    console.log('[Deal Proposal Trigger]', message);
  }

  function canShow(row = {}) {
    return canonicalStage(row.stage) === TARGET_STAGE
      && !hasLinkedProposal(row)
      && Boolean(global.Deals?.canCreateProposalFromDeal?.());
  }

  function patchDeals() {
    const Deals = global.Deals;
    if (!Deals) return false;
    if (Deals.__dealProposalTriggerGuardVersion === VERSION) {
      patchedDeals = true;
      return true;
    }

    Deals.canShowCreateProposalForDeal = function canShowCreateProposalForConvertedDeal(row = {}) {
      return canonicalStage(row?.stage) === TARGET_STAGE
        && !hasLinkedProposal(row)
        && this.canCreateProposalFromDeal();
    };

    Deals.__dealProposalTriggerGuardVersion = VERSION;
    patchedDeals = true;
    try { Deals.render?.(); } catch (_) {}
    return true;
  }

  function patchProposals() {
    const Proposals = global.Proposals;
    if (!Proposals) return false;
    if (Proposals.__dealProposalTriggerGuardVersion === VERSION) {
      patchedProposals = true;
      return true;
    }

    if (typeof Proposals.resolveDealForProposal === 'function' && !Proposals.__dealProposalResolveWrapped) {
      const originalResolveDealForProposal = Proposals.resolveDealForProposal;
      Proposals.resolveDealForProposal = async function resolveConvertedDealForProposal(dealId) {
        const deal = await originalResolveDealForProposal.call(this, dealId);
        if (!deal || canonicalStage(deal.stage) !== TARGET_STAGE || hasLinkedProposal(deal)) return deal;

        // The legacy proposal flow still validates against its previous "Qualified" stage.
        // Return a temporary compatibility copy so the conversion can proceed without
        // changing the persisted Deal stage. The real Deal remains "Converted to Proposal".
        return { ...deal, stage: 'Qualified' };
      };
      Proposals.__dealProposalResolveWrapped = true;
    }

    Proposals.__dealProposalTriggerGuardVersion = VERSION;
    patchedProposals = true;
    return true;
  }

  function runConvertedDealConversion(button, row, dealId) {
    const Deals = global.Deals;
    const Proposals = global.Proposals;
    if (!Deals || !Proposals?.createFromDealFlow) return;

    if (!clean(row?.next_follow_up_at || row?.nextFollowUpAt || row?.next_follow_up_date || row?.nextFollowUpDate)) {
      toast('Next follow-up is required for every deal change.');
      return;
    }
    if (!Deals.canCreateProposalFromDeal?.()) {
      toast('You do not have permission to create proposals from deals.');
      return;
    }

    const actionKey = `create-proposal:${dealId}`;
    const inFlight = Deals.state?.rowActionInFlight;
    if (inFlight?.has?.(actionKey)) return;
    inFlight?.add?.(actionKey);
    if (button && 'disabled' in button) button.disabled = true;

    Promise.resolve(Proposals.createFromDealFlow(dealId, { openAfterCreate: true }))
      .finally(() => {
        inFlight?.delete?.(actionKey);
        if (button && 'disabled' in button) button.disabled = false;
        try { Deals.render?.(); } catch (_) {}
      });
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-deal-create-proposal]');
    if (!button) return;

    const dealId = clean(button.getAttribute('data-deal-create-proposal'));
    const row = getDealRow(dealId);
    if (!row || canonicalStage(row.stage) !== TARGET_STAGE || hasLinkedProposal(row)) return;

    // Capture this click before the legacy Deals handler rejects non-Qualified stages.
    event.preventDefault();
    event.stopImmediatePropagation();
    runConvertedDealConversion(button, row, dealId);
  }, true);

  function boot() {
    let attempts = 0;
    const tryPatch = () => {
      patchDeals();
      patchProposals();
      if (patchedDeals && patchedProposals) return;
      if (attempts++ < 120) setTimeout(tryPatch, 250);
    };
    tryPatch();
  }

  global.InCheck360DealProposalTriggerGuard = Object.freeze({
    version: VERSION,
    targetStage: TARGET_STAGE,
    canShow,
    refresh() {
      patchDeals();
      patchProposals();
      try { global.Deals?.render?.(); } catch (_) {}
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
