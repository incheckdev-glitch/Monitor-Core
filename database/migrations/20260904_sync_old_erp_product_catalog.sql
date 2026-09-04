-- Sync the old ERP Proposal Catalog into Monitor Core without duplicating existing items.
-- Existing Monitor Core rows win by normalized item name or catalog_item_id.
-- Source: old AttendanceSummary ERP proposal_catalog_items (18 records on 2026-09-04).

with source(catalog_item_id,is_active,section,category,item_name,default_location_name,unit_price,discount_percent,quantity,capability_name,capability_value,notes,sort_order) as (
  values
    ('CAT-20260904-6CC4DDD6', false, 'one_time_fee', 'Service', 'Account Setup', '', 200.00::numeric, 0.00::numeric, 0.00::numeric, '', '', '', 0),
    ('Catalog#00004', true, 'annual_saas', 'Service', 'additional 5 checklists', '', 111.00, 0.00, 0.00, null, null, '', 0),
    ('Catalog#00002', true, 'one_time_fee', 'Service', 'CS hour', '', 25.00, 0.00, 0.00, null, null, '', 0),
    ('Catalog#00013', true, 'hardware', 'Hardware', 'Detector LHT65N-004', '', 88.00, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00011', true, 'annual_saas', 'Service', 'Detectors Module', '', 450.00, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00014', true, 'hardware', 'Hardware', 'Gateway LPS8N-GT001', '', 250.00, 0.00, 1.00, null, null, '', 0),
    ('CAT-LEGACY-INCheck-BASIC', true, 'annual_saas', 'Service', 'InCheck Basic', '', 825.00, 0.00, 0.00, '', '', '', 0),
    ('Catalog#00012', true, 'annual_saas', 'Service', 'InCheck Basic + Detectors', '', 1275.00, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00001', true, 'annual_saas', 'Service', 'InCheck Lite', '', 300.00, 0.00, 0.00, null, null, E'4 App Users\n12 Checklists per Location\nUnlimited Web App Access (Backend, Reporting, etc.)', 0),
    ('Catalog#00015', true, 'annual_saas', 'Service', 'InCheck Lite + Detectors Module and full customer support', '', 950.00, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00007', false, 'annual_saas', 'Service', 'InCheck Lite/ Unlimited Customer Success', '', 500.00, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00010', false, 'hardware', 'Gateway', 'Indoor Gateway', '', 340.00, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00005', true, 'annual_saas', 'Service', 'journal', '', 96.00, 0.00, 0.00, null, null, '', 0),
    ('Catalog#00016', true, 'hardware', 'Hardware', 'LHT65N-BAT', '', 8.15, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00006', true, 'one_time_fee', 'Service', 'Lite Account Setup', '', 75.00, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00009', false, 'hardware', 'Sensors', 'LoRaWAN Temperature & Humidity Sensor', '', 115.00, 0.00, 1.00, null, null, '', 0),
    ('CAT-LEGACY-SETUP-SUPPORT', true, 'one_time_fee', 'Service', 'Setup + Training & Unlimited Support', '', 200.00, 0.00, 1.00, null, null, '', 0),
    ('Catalog#00003', true, 'annual_saas', 'Service', 'User(s)', '', 96.00, 0.00, 0.00, null, null, '', 0)
)
insert into public.proposal_catalog_items (
  catalog_item_id,is_active,section,category,item_name,default_location_name,
  unit_price,discount_percent,quantity,capability_name,capability_value,notes,sort_order,
  created_by,updated_by,created_at,updated_at,deactivated_at,deactivated_by
)
select
  s.catalog_item_id,s.is_active,s.section,s.category,s.item_name,s.default_location_name,
  s.unit_price,s.discount_percent,s.quantity,s.capability_name,s.capability_value,s.notes,s.sort_order,
  null,null,now(),now(),null,null
from source s
where not exists (
  select 1
  from public.proposal_catalog_items n
  where lower(regexp_replace(btrim(n.item_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(s.item_name), '\s+', ' ', 'g'))
     or n.catalog_item_id = s.catalog_item_id
);
