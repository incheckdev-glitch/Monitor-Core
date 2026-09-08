# Reseller Management

Monitor Core ERP reseller-channel workspace.

## Current access

The entire Reseller Management category is restricted to the `admin` role for now. Reseller-user access is intentionally not enabled yet.

## Modules

- Dashboard
- Resellers
- Reseller CRM: Companies, Contacts, Leads, Deals
- Market Check
- Activations
- Requests
- Renewals
- Settlements
- Statement of Account
- Reports

## Core flow

Market Check -> Prospect Registration -> Ownership Approval -> Reseller CRM -> Deal Won -> Activation -> Settlement -> Payment -> Renewal.

## Market Check privacy

Market Check returns status only. It can match existing direct CRM companies/contacts, clients, leads, deals and reseller records, but it must not expose the internal owner, other reseller identity, contact details, record IDs or confidential CRM fields.

Statuses:

- Available
- Pending Registration
- Already Engaged
- Existing Customer
- Inactive / Released

## Commercial models

- Per-location wholesale
- Fixed wholesale
- Revenue share

The reseller may invoice its own customer independently. Monitor Core tracks the amount owed by the reseller to InCheck 360 Holding rather than treating the reseller's customer invoice as an internal ERP invoice.

## Future reseller access

All reseller-owned records carry `reseller_id`. When reseller logins are introduced, RLS and UI permissions should be extended so each reseller sees only rows associated with its own `reseller_id`. Do not rely on sidebar hiding alone.
