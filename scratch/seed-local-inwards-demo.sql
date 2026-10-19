-- LOCAL DEV ONLY. Demo rows so the Inwards / Expenses columns can be click-tested
-- against the local Supabase stack. Nothing here syncs to Lovable.
-- Remove with:  DELETE FROM cnc_inwards WHERE reference_no = 'LOCAL-DEMO';

-- 9 inwards across 4 sales orders (1 / 2 / 1 / 5) + 5 expenses grouped under 3 sales orders.
INSERT INTO cnc_inwards
  (id, inward_no, category, project_name, sales_order_ref, reference_no, inward_date,
   party_name, part_name, part_number, quantity, price, discount_percent, gst_percent,
   total_amount, status, product_name, company_id, created_at)
VALUES
  -- SO 2253 : 1 inward
  ('demo-in-2253-1', 'INW-2026-10011', 'GOODS PURCHASE', '2253', 'SO-2026-2253', 'LOCAL-DEMO', '2026-09-01',
   'Bharat Forge Ltd', 'Housing Body', 'HB-2253', 10, 1250, 0, 18, 14750.00, 'Received', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '12 days'),
  -- SO 2001 : 2 inwards
  ('demo-in-2001-1', 'INW-2026-10012', 'GOODS PURCHASE', '2001', 'SO-2026-2001', 'LOCAL-DEMO', '2026-09-05',
   'Kirloskar Pneumatic', 'Spindle Shaft', 'SS-2001', 25, 880, 5, 18, 24662.00, 'Received', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '9 days'),
  ('demo-in-2001-2', 'INW-2026-10013', 'GOODS PURCHASE', '2001', 'SO-2026-2001', 'LOCAL-DEMO', '2026-09-06',
   'Kirloskar Pneumatic', 'Bearing Cap', 'BC-2001', 25, 320, 5, 18, 8968.00, 'Received', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '8 days'),
  -- SO 2048 : 1 inward
  ('demo-in-2048-1', 'INW-2026-10014', 'GOODS PURCHASE', '2048', 'SO-2026-2048', 'LOCAL-DEMO', '2026-09-10',
   'Tata Motors', 'Flange Plate', 'FP-2048', 8, 2100, 0, 18, 19944.00, 'Pending', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '4 days'),
  -- SO 1001 : 5 inwards
  ('demo-in-1001-1', 'INW-2026-10015', 'GOODS PURCHASE', '1001', 'SO-2026-1001', 'LOCAL-DEMO', '2026-09-11',
   'Bharat Forge Ltd', 'Gear Blank', 'GB-1001', 50, 460, 2, 18, 26597.20, 'Received', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '3 days'),
  ('demo-in-1001-2', 'INW-2026-10016', 'GOODS PURCHASE', '1001', 'SO-2026-1001', 'LOCAL-DEMO', '2026-09-11',
   'Bharat Forge Ltd', 'Keyway Ring', 'KR-1001', 50, 145, 2, 18, 8383.90, 'Received', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '3 days'),
  ('demo-in-1001-3', 'INW-2026-10017', 'GOODS PURCHASE', '1001', 'SO-2026-1001', 'LOCAL-DEMO', '2026-09-12',
   'Bharat Forge Ltd', 'Lock Collar', 'LC-1001', 40, 210, 0, 18, 9912.00, 'Received', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '2 days'),
  ('demo-in-1001-4', 'INW-2026-10018', 'GOODS PURCHASE', '1001', 'SO-2026-1001', 'LOCAL-DEMO', '2026-09-12',
   'Bharat Forge Ltd', 'Coupling Hub', 'CH-1001', 30, 640, 0, 18, 22656.00, 'Pending', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '2 days'),
  ('demo-in-1001-5', 'INW-2026-10019', 'GOODS PURCHASE', '1001', 'SO-2026-1001', 'LOCAL-DEMO', '2026-09-13',
   'Bharat Forge Ltd', 'Retainer Plate', 'RP-1001', 20, 375, 0, 18, 8850.00, 'Received', NULL,
   'ebe48045-23ae-41b9-a261-6bc5af47d034', now() - interval '1 day'),
  -- Expenses: one party holding several orders (the party header total is what matters),
  -- plus a same-transaction pair that shares created_at and so groups as 2 expenses.
  ('demo-ex-1001-1', 'INW-2026-9986', 'EXPENSES', '1001', 'BUNNY WEST', 'LOCAL-DEMO', '2026-09-11',
   'SURIYA TOOLS & HARDWARE', 'BUNNY WEST', NULL, 1, 60, 0, 0, 60.00, 'Pending', 'BUNNY WEST',
   'ebe48045-23ae-41b9-a261-6bc5af47d034', '2026-10-12 10:00:00+05:30'),
  ('demo-ex-1001-2', 'INW-2026-4271', 'EXPENSES', '1001', 'SCREW', 'LOCAL-DEMO', '2026-09-12',
   'SURIYA TOOLS & HARDWARE', 'SCREW', NULL, 5, 45, 0, 0, 45.00, 'Pending', 'SCREW',
   'ebe48045-23ae-41b9-a261-6bc5af47d034', '2026-10-12 10:00:00+05:30'),
  ('demo-ex-1001-3', 'INW-2026-8261', 'EXPENSES', '1001', 'SCREW', 'LOCAL-DEMO', '2026-09-12',
   'SURIYA TOOLS & HARDWARE', 'SCREW', NULL, 1, 60, 0, 0, 60.00, 'Pending', 'SCREW',
   'ebe48045-23ae-41b9-a261-6bc5af47d034', '2026-10-12 10:00:00+05:30'),
  ('demo-ex-2001-1', 'INW-2026-1003', 'EXPENSES', '2001', 'NOEL WEST', 'LOCAL-DEMO', '2026-09-14',
   'SURIYA TOOLS & HARDWARE', 'NOEL WEST', NULL, 1, 50, 0, 0, 50.00, 'Pending', 'NOEL WEST',
   'ebe48045-23ae-41b9-a261-6bc5af47d034', '2026-10-13 11:30:00+05:30'),
  ('demo-ex-2253-1', 'INW-2026-6160', 'EXPENSES', '2253', 'EB BILL', 'LOCAL-DEMO', '2026-09-14',
   'KRISHNASWAMY', 'EB BILL', NULL, 1, 8081, 0, 0, 8081.00, 'Pending', 'EB BILL',
   'ebe48045-23ae-41b9-a261-6bc5af47d034', '2026-10-11 16:45:00+05:30'),
  ('demo-ex-2048-1', 'INW-2026-2643', 'EXPENSES', '2048', 'TOW WHEELER PUNCTURE', 'LOCAL-DEMO', '2026-09-10',
   'ARGUS TECHNOLOGIES', 'TOW WHEELER PUNCTURE', NULL, 1, 750, 0, 0, 750.00, 'Pending', 'TOW WHEELER PUNCTURE',
   'ebe48045-23ae-41b9-a261-6bc5af47d034', '2026-10-10 09:15:00+05:30')
ON CONFLICT (id) DO NOTHING;
