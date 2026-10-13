-- -------------------------------------------------------------------------------------
-- Repair: create the costing tables that erp_costing_projects /
-- erp_project_costing_detail read but that were never created, so Project
-- Costing failed with: relation "public.product_costing" does not exist.
--
-- Column sets come from the hosted schema (vault types) plus the company_id
-- column the report functions filter on. No seed data: empty tables make the
-- reports return empty rows instead of erroring. Tables are tenant-secured
-- with the same per-operation module policies as every other business table.
-- Idempotent: safe to re-run.
-- -------------------------------------------------------------------------------------

create table if not exists public.product_costing (
  id           uuid        primary key default gen_random_uuid(),
  company_id   uuid        references public.companies (id),
  project_name text        not null default '',
  party_name   text        not null default '',
  part_name    text        not null default '',
  category     text        not null default '',
  quantity     numeric,
  total_cost   numeric,
  created_at   timestamptz not null default now()
);

create table if not exists public.process_costing (
  id           uuid        primary key default gen_random_uuid(),
  company_id   uuid        references public.companies (id),
  project_name text        not null default '',
  party_name   text        not null default '',
  part_name    text        not null default '',
  process_name text        not null default '',
  duration     numeric,
  quantity     numeric,
  process_cost numeric,
  total_cost   numeric,
  created_at   timestamptz not null default now()
);

create table if not exists public.planned_workings (
  id           uuid        primary key default gen_random_uuid(),
  company_id   uuid        references public.companies (id),
  project_name text,
  total_amount numeric     not null default 0,
  date         date,
  parts        jsonb       not null default '[]'::jsonb,
  category_id  text,
  party_id     text,
  created_at   timestamptz not null default now()
);

-- Tenant isolation + trigger + index (same helper every business table uses).
-- No default-company backfill: these tables start empty by definition.
select public.erp_secure_table('product_costing');
select public.erp_secure_table('process_costing');
select public.erp_secure_table('planned_workings');

-- Same per-operation module policies as the RBAC migration (which ran before
-- these tables existed, so they never received them).
do $$
declare
  t       text;
  modules text[];
begin
  foreach t in array array['product_costing', 'process_costing', 'planned_workings'] loop
    modules := array['project-costing', 'product-costing'];
    execute format('drop policy if exists erp_company_isolation on public.%I', t);
    execute format('drop policy if exists erp_module_select on public.%I', t);
    execute format('drop policy if exists erp_module_insert on public.%I', t);
    execute format('drop policy if exists erp_module_update on public.%I', t);
    execute format('drop policy if exists erp_module_delete on public.%I', t);
    execute format(
      'create policy erp_module_select on public.%I for select to authenticated
         using (company_id = any ((select public.erp_visible_company_ids())::uuid[])
                and public.erp_has_any_perm(%L, ''view''))', t, modules);
    execute format(
      'create policy erp_module_insert on public.%I for insert to authenticated
         with check (company_id = any ((select public.erp_visible_company_ids())::uuid[])
                     and public.erp_has_any_perm(%L, ''create''))', t, modules);
    execute format(
      'create policy erp_module_update on public.%I for update to authenticated
         using (company_id = any ((select public.erp_visible_company_ids())::uuid[])
                and public.erp_has_any_perm(%L, ''edit''))
         with check (company_id = any ((select public.erp_visible_company_ids())::uuid[])
                     and public.erp_has_any_perm(%L, ''edit''))', t, modules, modules);
    execute format(
      'create policy erp_module_delete on public.%I for delete to authenticated
         using (company_id = any ((select public.erp_visible_company_ids())::uuid[])
                and public.erp_has_any_perm(%L, ''delete''))', t, modules);
  end loop;
end;
$$;

-- Register the new tables in the module map (kept in sync with
-- src/config/permissions.ts and erp_table_modules).
create or replace function public.erp_table_modules(p_table text)
returns text[]
language sql immutable
as $fn$
  select case p_table
    when 'cnc_enquiries'              then array['enquiries']
    when 'cnc_quotations'             then array['quotations']
    when 'cnc_sales_orders'           then array['sales-orders']
    when 'cnc_customers'              then array['companies']
    when 'cnc_inwards'                then array['inward']
    when 'cnc_deliveries'             then array['delivery']
    when 'cnc_invoices'               then array['invoices']
    when 'cnc_invoice_items'          then array['invoices']
    when 'cnc_bank_transactions'      then array['bank-entry']
    when 'chart_of_accounts'          then array['ledger']
    when 'financial_years'            then array['ledger']
    when 'journal_entries'            then array['ledger']
    when 'journal_entry_lines'        then array['ledger']
    when 'cnc_costing_sheets'         then array['project-costing', 'product-costing']
    when 'product_costing'            then array['project-costing', 'product-costing']
    when 'process_costing'            then array['project-costing', 'product-costing']
    when 'planned_workings'           then array['project-costing', 'product-costing']
    when 'cnc_raw_materials'          then array['inventory']
    when 'cnc_stock_movements'        then array['inventory']
    when 'cnc_warehouses'             then array['inventory']
    when 'cnc_warehouse_zones'        then array['inventory']
    when 'cnc_warehouse_locations'    then array['inventory']
    when 'inventory_categories'       then array['inventory']
    when 'inventory_source_baselines' then array['inventory']
    when 'cnc_suppliers'              then array['suppliers']
    when 'cnc_purchase_orders'        then array['purchase-orders']
    when 'cnc_purchase_order_items'   then array['purchase-orders']
    when 'cnc_goods_receipts'         then array['grn']
    when 'cnc_goods_receipt_items'    then array['grn']
    when 'cnc_parts'                  then array['inventory', 'engineering', 'production']
    when 'cnc_work_orders'            then array['production', 'finished-goods', 'scheduling']
    when 'cnc_job_cards'              then array['production', 'scheduling', 'machine-log']
    when 'cnc_work_order_operations'  then array['production', 'scheduling', 'machine-log']
    when 'cnc_material_requests'      then array['production']
    when 'cnc_operation_plans'        then array['production']
    when 'cnc_part_routings'          then array['process-master']
    when 'cnc_part_routing_steps'     then array['process-master']
    when 'cnc_processes'              then array['process-master']
    when 'cnc_production_batches'     then array['finished-goods', 'rejected', 'production']
    when 'cnc_drawing_versions'       then array['engineering']
    when 'cnc_pipeline_comments'      then array['sales-pipeline']
    else array[]::text[]
  end;
$fn$;
revoke all on function public.erp_table_modules(text) from public, anon, authenticated;
