const assert = require('assert');
const fs = require('fs');

const leads = fs.readFileSync('leads.js', 'utf8');
const deals = fs.readFileSync('deals.js', 'utf8');
const proposals = fs.readFileSync('proposals.js', 'utf8');
const proposalMigration = fs.readFileSync('database/bootstrap/12_gap_safe_business_id_allocation.sql', 'utf8');
const dealMigration = fs.readFileSync('database/bootstrap/18_friendly_deal_business_id.sql', 'utf8');

assert.ok(leads.includes("return `Lead#${String(maxDb + 1).padStart(5, '0')}`;"), 'Lead IDs must be friendly sequential IDs');
assert.ok(leads.includes('await this.allocateLeadId()'), 'Lead create must allocate against persisted state');
assert.ok(!leads.includes('return `LEAD-${yyyy}${mm}${dd}-${Date.now()}-${rand}`;'), 'timestamp Lead IDs must be removed');

assert.ok(deals.includes("return `Deal#${String(maxDb + 1).padStart(5, '0')}`;"), 'Deal IDs must be friendly sequential IDs');
assert.ok(deals.includes('await this.allocateDealId()'), 'Deal create must allocate against persisted state');
assert.ok(!deals.includes('return `DEAL-${yyyy}${mm}${dd}-${rand}`;'), 'timestamp Deal IDs must be removed');

assert.ok(proposals.includes("return `Proposal#${String(maxDb + 1).padStart(5, '0')}`;"), 'Proposal IDs must be friendly sequential IDs');
assert.ok(proposals.includes('const friendlyId = await this.allocateProposalId();'), 'Proposal create must allocate from persisted state at save time');
assert.ok(proposals.includes('proposal_id: friendlyId'), 'Proposal create must set the friendly ID');
assert.ok(proposals.includes('ref_number: friendlyId'), 'Proposal reference must match the friendly ID');
assert.ok(!proposals.includes('return `PR-${stamp}-${suffix}`;'), 'timestamp Proposal IDs must be removed');

assert.ok(dealMigration.includes("v_code := 'Deal#' || lpad(v_seq::text, 5, '0');"), 'latest Deal conversion migration must use Deal#NNNNN');
assert.ok(dealMigration.includes("pg_advisory_xact_lock(hashtext('incheck360:deal-business-id'))"), 'Deal numbering must use a global transaction lock');
assert.ok(proposalMigration.includes("v_id := 'Proposal#' || lpad(v_seq::text, 5, '0');"), 'Proposal conversion migration must use Proposal#NNNNN');

console.log('friendly commercial ID regressions passed');
