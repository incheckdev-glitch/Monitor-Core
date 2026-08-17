from pathlib import Path
import re

path = Path('proposals.js')
text = path.read_text()

creator_pattern = re.compile(r"  getProposalCreatorDisplayName\(creator = \{\}\) \{.*?\n  \},\n  getProposalCreatorTitle", re.S)
creator_replacement = """  getProposalCreatorDisplayName(creator = {}) {
    if (!creator || typeof creator !== 'object') return '';
    const candidate = String(
      creator.full_name ||
      creator.fullName ||
      creator.name ||
      creator.display_name ||
      creator.displayName ||
      creator.user_metadata?.full_name ||
      creator.user_metadata?.name ||
      ''
    ).trim();
    if (!candidate) return '';
    const lower = candidate.toLowerCase();
    const email = String(creator.email || '').trim().toLowerCase();
    const emailLocal = email.includes('@') ? email.split('@')[0] : email;
    const username = String(creator.username || creator.user_name || creator.userName || '').trim().toLowerCase();
    if (lower.includes('@') || (username && lower === username) || (emailLocal && lower === emailLocal)) return '';
    return candidate;
  },
  getProposalCreatorTitle"""
text, count = creator_pattern.subn(creator_replacement, text, count=1)
if count != 1:
    raise SystemExit('Unable to patch getProposalCreatorDisplayName')

provider_pattern = re.compile(r"  getProposalProviderSignatoryName\(proposal = \{\}\) \{.*?\n  \},\n  getProposalProviderSignatoryTitle", re.S)
provider_replacement = """  isProposalProviderLoginIdentity(value, proposal = {}, creator = null) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return false;
    const sessionApi = window.Session || {};
    const sessionState = sessionApi.state || {};
    const sessionUser = typeof sessionApi.user === 'function' ? (sessionApi.user() || {}) : {};
    const profile = sessionUser.profile || sessionState.profile || {};
    const authUser = sessionUser.user || sessionState.user || {};
    const identities = [
      creator?.username,
      creator?.user_name,
      creator?.userName,
      creator?.email,
      profile.username,
      profile.email,
      sessionState.username,
      sessionState.email,
      authUser.email,
      authUser.user_metadata?.username,
      proposal.generated_by,
      proposal.generatedBy
    ];
    const normalized = new Set();
    identities.forEach(identity => {
      const raw = String(identity || '').trim().toLowerCase();
      if (!raw) return;
      normalized.add(raw);
      if (raw.includes('@')) normalized.add(raw.split('@')[0]);
    });
    return text.includes('@') || normalized.has(text);
  },
  getProposalProviderSignatoryName(proposal = {}) {
    const creator = this.getProviderSignatoryCreator(proposal);
    const creatorName = this.getProposalCreatorDisplayName(creator);
    const savedName = this.getCleanProviderSignatoryValue(
      this.getProposalValue(proposal, 'provider_signatory_name', 'providerSignatoryName'),
      proposal
    );
    if (savedName && !this.isProposalProviderLoginIdentity(savedName, proposal, creator)) return savedName;
    if (creatorName) return creatorName;
    const sessionProvider = this.getSignedInUserForProposal();
    const sessionName = this.getProposalCreatorDisplayName(sessionProvider);
    return sessionName && !this.isProposalProviderLoginIdentity(sessionName, proposal, sessionProvider) ? sessionName : '';
  },
  getProposalProviderSignatoryTitle"""
text, count = provider_pattern.subn(provider_replacement, text, count=1)
if count != 1:
    raise SystemExit('Unable to patch getProposalProviderSignatoryName')

old_creator = "const creatorName = this.getProposalCreatorDisplayName(creator) || provider.name || provider.email?.split('@')?.[0] || '';"
new_creator = "const creatorName = this.getProposalCreatorDisplayName(creator) || this.getProposalCreatorDisplayName(provider) || '';"
if old_creator not in text:
    raise SystemExit('Unable to patch proposal provider creator fallback')
text = text.replace(old_creator, new_creator, 1)

old_provider_user = "const providerUserName = provider.name || provider.email?.split('@')?.[0] || '';"
new_provider_user = "const providerUserName = this.getProposalCreatorDisplayName(provider);"
if old_provider_user not in text:
    raise SystemExit('Unable to patch proposal form provider fallback')
text = text.replace(old_provider_user, new_provider_user, 1)

marker = "  async previewProposalHtml(proposalId) {"
if marker not in text:
    raise SystemExit('Unable to locate proposal preview method marker')
methods = """  closePreviewModal() {
    if (!E.proposalPreviewModal) return;
    E.proposalPreviewModal.style.display = 'none';
    E.proposalPreviewModal.classList.remove('open');
    E.proposalPreviewModal.setAttribute('aria-hidden', 'true');
    if (E.proposalPreviewFrame) E.proposalPreviewFrame.srcdoc = '';
  },
  exportPreviewPdf() {
    const frame = E.proposalPreviewFrame;
    const previewTitle = String(E.proposalPreviewTitle?.textContent || 'Proposal Preview').trim();
    if (!frame || !String(frame.srcdoc || '').trim()) {
      UI.toast('Open proposal preview first to extract PDF.');
      return;
    }
    const frameWindow = frame.contentWindow;
    if (!frameWindow) {
      UI.toast('Unable to access proposal preview content.');
      return;
    }
    frameWindow.focus();
    frameWindow.print();
    UI.toast(`Print dialog opened for ${previewTitle}. Choose \"Save as PDF\" to extract.`);
  },
"""
text = text.replace(marker, methods + marker, 1)
path.write_text(text)

index = Path('index.html')
html = index.read_text()
old_script = '/proposals.js?v=20260817-friendly-commercial-ids-v1'
new_script = '/proposals.js?v=20260817-proposal-preview-actions-v1'
if old_script not in html:
    raise SystemExit('Unable to locate proposal script cache key')
html = html.replace(old_script, new_script, 1)
old_close = '<button class="modal-close" id="proposalPreviewCloseBtn" aria-label="Close proposal preview">✕</button>'
new_close = '<button class="modal-close" id="proposalPreviewCloseBtn" type="button" aria-label="Close proposal preview">✕</button>'
if old_close not in html:
    raise SystemExit('Unable to locate proposal preview close button')
html = html.replace(old_close, new_close, 1)
index.write_text(html)

test = Path('tests/proposal-preview-actions.test.js')
test.write_text("""const assert = require('assert');
const fs = require('fs');

const proposals = fs.readFileSync('proposals.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert.match(proposals, /closePreviewModal\\(\\)\\s*\\{[\\s\\S]*proposalPreviewModal\\.style\\.display\\s*=\\s*['\"]none['\"]/, 'proposal preview must implement a working close method');
assert.match(proposals, /proposalPreviewFrame\\.srcdoc\\s*=\\s*['\"]['\"]/, 'closing preview must clear iframe content');
assert.match(proposals, /exportPreviewPdf\\(\\)\\s*\\{[\\s\\S]*frame\\.contentWindow[\\s\\S]*frameWindow\\.print\\(\\)/, 'proposal preview must implement PDF extraction through the iframe print dialog');
assert.match(proposals, /proposalPreviewCloseBtn\\.addEventListener\\(['\"]click['\"][\\s\\S]*closePreviewModal\\(\\)/, 'proposal close button must remain wired to closePreviewModal');
assert.match(proposals, /proposalPreviewExportPdfBtn\\.addEventListener\\(['\"]click['\"][\\s\\S]*exportPreviewPdf\\(\\)/, 'proposal PDF button must remain wired to exportPreviewPdf');
assert.match(proposals, /isProposalProviderLoginIdentity\\(/, 'proposal signatory must identify username/email-like saved values');
assert.match(proposals, /if \\(savedName && !this\\.isProposalProviderLoginIdentity\\(savedName, proposal, creator\\)\\) return savedName;/, 'human saved signatory names must remain authoritative');
assert.match(proposals, /if \\(creatorName\\) return creatorName;/, 'stale login identities must fall back to the resolved creator profile name');

const creatorNameBody = proposals.match(/getProposalCreatorDisplayName\\(creator = \\{\\}\\) \\{([\\s\\S]*?)\\n\\s*\\},\\n\\s*getProposalCreatorTitle/)?.[1] || '';
assert.ok(creatorNameBody, 'creator display-name helper must be present');
assert.doesNotMatch(creatorNameBody, /creator\\.email\\s*\\|\\|/, 'email must not be used as a provider signatory display-name fallback');
assert.match(creatorNameBody, /emailLocal[\\s\\S]*lower === emailLocal/, 'email-local usernames must be rejected as human signatory names');

assert(index.includes('/proposals.js?v=20260817-proposal-preview-actions-v1'), 'proposal script cache key must be bumped');
assert(index.includes('id=\"proposalPreviewCloseBtn\" type=\"button\"'), 'proposal preview close button must be an explicit button');

console.log('Proposal preview action and provider signatory checks passed.');
""")
