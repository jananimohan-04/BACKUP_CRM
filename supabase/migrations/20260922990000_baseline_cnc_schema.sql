-- Baseline schema for the core `cnc_*` ERP tables.
--
-- WHY THIS EXISTS
-- These tables were originally created directly in the hosted Supabase project
-- and were never captured as migrations, so a fresh local database cannot apply
-- the migration chain (20260923000000_multi_company_auth.sql fails on
-- `relation "public.cnc_enquiries" does not exist`).
--
-- This migration reconstructs them so `supabase migration up` can run end to end
-- on a clean local database.
--
-- DESIGN NOTES
-- * `company_id` is deliberately ABSENT. It is added later by
--   public.erp_secure_table(), which also sets it NOT NULL, adds the company
--   index, enables RLS and installs the aa_erp_company_id trigger. Declaring it
--   here would skip that richer setup (the ALTER is `add column if not exists`).
-- * Columns that later migrations ADD (cnc_raw_materials.category_id/
--   specification/reorder_qty/image_url/updated_at, the cnc_deliveries challan
--   columns, the cnc_invoices tax/pipeline columns, cnc_stock_movements ledger
--   columns, cnc_warehouses.is_default, cnc_quotations.unit_discount) are
--   likewise omitted so those migrations apply them authoritatively.
-- * Primary keys are `text`, not `uuid`. inventory.sql documents that "live ids
--   are text or uuid" and every query compares via `id::text`; the app also
--   stores human ids such as 'enq-2001', 'CUST-001' and 'SUP-001' that a uuid
--   column would reject. Foreign keys between these baseline tables match.
-- * Columns pointing at tables created by other migrations (portal_profiles)
--   keep their real uuid type.

-- ---------------------------------------------------------------------------
-- Sales pipeline
-- ---------------------------------------------------------------------------

create table if not exists public.cnc_enquiries (
  id              text primary key,
  lead_no         text,
  enquiry_no      text,
  customer        text,
  contact_person  text,
  phone           text,
  email           text,
  city            text,
  gst             text,
  remarks         text,
  part_name       text,
  part_no         text,
  material        text,
  description     text,
  enquiring_for   text,
  quantity        numeric,
  estimated_value numeric,
  source          text,
  status          text,
  pipeline_stage  text,
  expected_date   date,
  received_date   date,
  portal_profile_id uuid references public.portal_profiles (id),
  created_at      timestamptz not null default now()
);

create table if not exists public.cnc_customers (
  id            text primary key,
  name          text not null,
  industry      text,
  contact       text,
  email         text,
  phone         text,
  city          text,
  gst           text,
  source        text,
  lead_id       text references public.cnc_enquiries (id),
  total_orders  integer default 0,
  total_value   numeric default 0,
  outstanding   numeric default 0,
  rating        integer default 3,
  status        text default 'Active',
  created_at    timestamptz default now()
);

create table if not exists public.cnc_quotations (
  id               text primary key,
  quote_no         text,
  lead_id          text references public.cnc_enquiries (id),
  customer         text,
  customer_id      text references public.cnc_customers (id),
  contact_person   text,
  phone            text,
  email            text,
  enquiry_no       text,
  part_name        text,
  part_number      text,
  quantity         numeric,
  unit_price       numeric,
  total_value      numeric,
  discount_percent numeric,
  gst_percent      numeric,
  payment_terms    text,
  delivery_terms   text,
  salesperson      text,
  remarks          text,
  description      text,
  date             date,
  valid_till       date,
  status           text,
  created_at       timestamptz not null default now()
);

create table if not exists public.cnc_sales_orders (
  id                  text primary key,
  order_no            text,
  quotation_id        text references public.cnc_quotations (id),
  quote_no            text,
  lead_no             text,
  customer            text,
  customer_id         text references public.cnc_customers (id),
  contact_person      text,
  phone               text,
  email               text,
  part_name           text,
  part_no             text,
  part_number         text,
  quantity            numeric,
  delivered           numeric,
  value               numeric,
  total_value         numeric,
  items               jsonb,
  order_date          date,
  delivery_date       date,
  customer_po_no      text,
  customer_po_date    date,
  payment_terms       text,
  billing_address     text,
  delivery_address    text,
  shipping_contact    text,
  shipping_phone      text,
  special_instructions text,
  internal_remarks    text,
  status              text,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Warehousing
-- ---------------------------------------------------------------------------

create table if not exists public.cnc_warehouses (
  id          text primary key,
  code        text,
  name        text,
  type        text,
  description text,
  status      text default 'Active',
  created_at  timestamptz not null default now()
);

create table if not exists public.cnc_warehouse_zones (
  id           text primary key,
  warehouse_id text references public.cnc_warehouses (id),
  code         text,
  name         text,
  created_at   timestamptz not null default now()
);

create table if not exists public.cnc_warehouse_locations (
  id      text primary key,
  zone_id text references public.cnc_warehouse_zones (id),
  code    text,
  name    text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Purchasing / suppliers
-- ---------------------------------------------------------------------------

create table if not exists public.cnc_suppliers (
  id             text primary key,
  code           text,
  name           text not null,
  category       text,
  contact_person text,
  phone          text,
  email          text,
  website        text,
  address        text,
  city           text,
  state          text,
  country        text,
  pincode        text,
  gst_number     text,
  pan            text,
  payment_terms  text,
  status         text default 'Active',
  created_at     timestamptz not null default now()
);

create table if not exists public.cnc_parts (
  id                    text primary key,
  part_no               text,
  part_name             text,
  drawing_no            text,
  revision              text,
  material              text,
  surface_finish        text,
  tolerance             text,
  category              text,
  hsn                   text,
  weight                numeric,
  unit                  text,
  stock_qty             numeric,
  unit_price            numeric,
  preferred_supplier_id text references public.cnc_suppliers (id),
  location_id           text references public.cnc_warehouse_locations (id),
  status                text default 'Active',
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Production
-- ---------------------------------------------------------------------------

-- `sales_order` holds the human order number (cnc_sales_orders.order_no), not a
-- foreign key, matching the portal RLS policy that compares it as text.
-- `updated_at` / `notes` deliberately absent: ProductionOrdersTab.tsx documents
-- that cnc_work_orders has neither column.
create table if not exists public.cnc_work_orders (
  id                text primary key,
  wo_no             text,
  sales_order       text,
  customer          text,
  part_name         text,
  part_no           text,
  quantity          numeric,
  completed         numeric,
  rejected          numeric,
  status            text,
  priority          text,
  start_date        date,
  due_date          date,
  drawing_revision  text,
  description       text,
  created_at        timestamptz not null default now()
);

-- `created_at` doubles as the scheduled start: cnc_job_cards has no
-- schedule-start column (see SchedulingPage.tsx).
create table if not exists public.cnc_job_cards (
  id            text primary key,
  job_no        text,
  work_order    text,
  op_no         integer,
  part_name     text,
  operation     text,
  machine       text,
  operator      text,
  tool_no       text,
  qty_planned   numeric,
  qty_completed numeric,
  qty_rejected  numeric,
  cycle_time    numeric,
  setup_time    numeric,
  status        text,
  created_at    timestamptz not null default now()
);

create table if not exists public.cnc_material_requests (
  id             text primary key,
  request_no     text,
  request_date   date,
  required_date  date,
  work_order_id  text references public.cnc_work_orders (id),
  work_order_no  text,
  part_name      text,
  production_qty numeric,
  requested_by   text,
  priority       text,
  remarks        text,
  status         text default 'Pending',
  created_at     timestamptz not null default now()
);

create table if not exists public.cnc_purchase_orders (
  id                   text primary key,
  po_number            text,
  supplier_id          text references public.cnc_suppliers (id),
  purchase_requisition_id text,
  order_date           date,
  expected_date        date,
  status               text,
  payment_terms        text,
  billing_address      text,
  delivery_address     text,
  subtotal             numeric,
  tax                  numeric,
  grand_total          numeric,
  notes                text,
  created_at           timestamptz not null default now()
);

create table if not exists public.cnc_purchase_order_items (
  id                text primary key,
  purchase_order_id text references public.cnc_purchase_orders (id),
  raw_material_id   text,
  part_id           text references public.cnc_parts (id),
  material_code     text,
  material_name     text,
  quantity          numeric,
  unit              text,
  unit_price        numeric,
  tax_amount        numeric,
  total_amount      numeric,
  required_date     date,
  created_at        timestamptz not null default now()
);

create table if not exists public.cnc_raw_materials (
  id                    text primary key,
  material_code         text,
  name                  text,
  grade                 text,
  form                  text,
  uom                   text,
  stock_qty             numeric,
  min_stock             numeric,
  unit_price            numeric,
  preferred_supplier_id text references public.cnc_suppliers (id),
  location              text,
  location_id           text references public.cnc_warehouse_locations (id),
  status                text,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Inward / delivery / invoicing
-- ---------------------------------------------------------------------------

create table if not exists public.cnc_inwards (
  id               text primary key,
  inward_no        text,
  category         text,
  project_name     text,
  contact_person   text,
  phone            text,
  email            text,
  sales_order_ref  text,
  reference_no     text,
  inward_date      date,
  party_name       text,
  remarks          text,
  part_name        text,
  part_number      text,
  quantity         numeric,
  price            numeric,
  discount_percent numeric,
  gst_percent      numeric,
  total_amount     numeric,
  status           text,
  created_at       timestamptz not null default now()
);

create table if not exists public.cnc_deliveries (
  id               text primary key,
  delivery_no      text,
  customer_name    text,
  customer_id      text references public.cnc_customers (id),
  sales_order_id   text references public.cnc_sales_orders (id),
  sales_order_no   text,
  part_name        text,
  quantity         numeric,
  dispatch_qty     numeric,
  delivery_date    date,
  delivery_address text,
  transport        text,
  driver_contact   text,
  remarks          text,
  status           text,
  created_at       timestamptz not null default now()
);

create table if not exists public.cnc_invoices (
  id            text primary key,
  invoice_no    text,
  invoice_date  date,
  customer_name text,
  customer_id   text references public.cnc_customers (id),
  sales_order_id text references public.cnc_sales_orders (id),
  delivery_id   text references public.cnc_deliveries (id),
  quotation_id  text references public.cnc_quotations (id),
  part_name     text,
  quantity      numeric,
  amount        numeric,
  status        text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Goods receipts / stock
-- ---------------------------------------------------------------------------

create table if not exists public.cnc_goods_receipts (
  id                  text primary key,
  grn_number          text,
  purchase_order_id   text references public.cnc_purchase_orders (id),
  supplier_id         text references public.cnc_suppliers (id),
  warehouse_id        text references public.cnc_warehouses (id),
  receipt_date        date,
  supplier_challan_no text,
  supplier_invoice_no text,
  supplier_invoice_date date,
  status              text default 'Draft',
  remarks             text,
  created_by          text,
  created_at          timestamptz not null default now()
);

create table if not exists public.cnc_goods_receipt_items (
  id                    text primary key,
  goods_receipt_id      text references public.cnc_goods_receipts (id),
  purchase_order_item_id text references public.cnc_purchase_order_items (id),
  raw_material_id       text,
  part_id               text references public.cnc_parts (id),
  material_code         text,
  material_name         text,
  ordered_qty           numeric,
  received_qty          numeric,
  unit                  text,
  location_id           text references public.cnc_warehouse_locations (id),
  condition             text,
  created_at            timestamptz not null default now()
);

create table if not exists public.cnc_stock_movements (
  id         text primary key,
  date       date,
  type       text,
  material   text,
  qty        numeric,
  uom        text,
  "from"     text,
  "to"       text,
  reference  text,
  "user"     text,
  created_at timestamptz not null default now()
);
