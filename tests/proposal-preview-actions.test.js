const assert = require('assert');
const fs = require('fs');

const proposals = fs.readFileSync('proposals.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert.match(proposals, /closePreviewModal\(\)\s*\{[\s\S]*proposalPreviewModal\.style\.display\s*=\s*['"]none['"]/, 'proposal preview must implement a working close method');
assert.match(proposals, /proposalPreviewFrame\.srcdoc\s*=\s*['"]['"]/, 'closing preview must clear iframe content');
assert.match(proposals, /exportPreviewPdf\(\)\s*\{[\s\S]*frame\.contentWindow[\s\S]*frameWindow\.print\(\)/, 'proposal preview must implement PDF extraction through the iframe print dialog');
assert.match(proposals, /proposalPreviewCloseBtn\.addEventListener\(['"]click['"][\s\S]*closePreviewModal\(\)/, 'proposal close button must remain wired to closePreviewModal');
assert.match(proposals, /proposalPreviewExportPdfBtn\.addEventListener\(['"]click['"][\s\S]*exportPreviewPdf\(\)/, 'proposal PDF button must remain wired to exportPreviewPdf');
assert.match(proposals, /isProposalProviderLoginIdentity\(/, 'proposal signatory must identify username/email-like saved values');
assert.match(proposals, /if \(savedName && !this\.isProposalProviderLoginIdentity\(savedName, proposal, creator\)\) return savedName;/, 'human saved signatory names must remain authoritative');
assert.match(proposals, /if \(creatorName\) return creatorName;/, 'stale login identities must fall back to the resolved creator profile name');

const creatorNameBody = proposals.match(/getProposalCreatorDisplayName\(creator = \{\}\) \{([\s\S]*?)\n\s*\},\n\s*getProposalCreatorTitle/)?.[1] || '';
assert.ok(creatorNameBody, 'creator display-name helper must be present');
const candidateBody = creatorNameBody.match(/const candidate = String\(([\s\S]*?)\)\.trim\(\);/)?.[1] || '';
assert.doesNotMatch(candidateBody, /creator\.email/, 'email must not be used as a provider signatory display-name candidate');
assert.match(creatorNameBody, /emailLocal[\s\S]*lower === emailLocal/, 'email-local usernames must be rejected as human signatory names');

assert(index.includes('/proposals.js?v=20260817-proposal-preview-actions-v1'), 'proposal script cache key must be bumped');
assert(index.includes('id="proposalPreviewCloseBtn" type="button"'), 'proposal preview close button must be an explicit button');

console.log('Proposal preview action and provider signatory checks passed.');
