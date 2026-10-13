-- -------------------------------------------------------------------------------------
-- User module permissions (RBAC): one centrally managed permission system for
-- sidebar, top KPI menu, Kanban/list/calendar views, routes and row-level data.
--
-- Design (smallest compatible extension):
--   * roles stay exactly as they are (SUPER_ADMIN | COMPANY_ADMIN | USER);
--   * one new table (user_module_permissions) holds per-user module/action grants;
--   * SUPER_ADMIN and COMPANY_ADMIN keep effective full access in code (no rows needed);
--   * existing USER accounts are seeded with full grants (behaviour unchanged);
--   * new users get no rows (secure default: dashboard only) until an admin assigns access;
--   * writes go ONLY through erp_save_permissions (authority-checked RPC);
--   * the shared company-isolation policy is split per operation and additionally
--     requires the mapped module permission (company scope itself is untouched).
-- Idempotent: safe to re-run (CREATE IF NOT EXISTS / CREATE OR REPLACE / upserts).
-- -------------------------------------------------------------------------------------

create table if not exists public.user_module_permissions (
  user_id     uuid        not null references public.company_users (id) on delete cascade,
  module_key  text        not null,
  can_view    boolean     not null default false,
  can_create  boolean     not null default false,
  can_edit    boolean     not null default false,
  can_delete  boolean     not null default false,
  can_approve boolean     not null default false,
  can_export  boolean     not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, module_key)
);

create index if not exists user_module_permissions_user_idx on public.user_module_permissions (user_id);

alter table public.user_module_permissions enable row level security;

-- Reads through RLS (admins see managed users, users see their own row set);
-- writes ONLY through erp_save_permissions below.
drop policy if exists user_module_permissions_read on public.user_module_permissions;
create policy user_module_permissions_read on public.user_module_permissions for select to authenticated
  using (
    exists (
      select 1 from public.company_users cu
      where cu.id = user_module_permissions.user_id
        and public.erp_can_see_user(cu.company_id, cu.id)
    )
  );

revoke all on public.user_module_permissions from anon, authenticated;
grant select on public.user_module_permissions to authenticated;

-- -------------------------------------------------------------------------------------
-- Module registry (database side). Keys match src/config/permissions.ts MODULE_CATALOG.
-- Tables shared by two modules list both (access to either one is sufficient).
-- Unknown tables return an empty array: company isolation still applies, no
-- module restriction (preserves portal tables and future tables).
-- -------------------------------------------------------------------------------------
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

-- Effective permission check for the session user. Admins always pass (their
-- authority comes from the role, exactly as before); members need an explicit
-- grant row. Returns false when there is no ERP session (e.g. portal users).
create or replace function public.erp_has_perm(p_module text, p_action text)
returns boolean
language sql stable security definer
set search_path = public
as $fn$
  select case
    when public.erp_is_super_admin() then true
    when (select (public.erp_current_user()).role) = 'COMPANY_ADMIN' then true
    else coalesce((
      select bool_or(
        case p_action
          when 'view'    then p.can_view
          when 'create'  then p.can_create
          when 'edit'    then p.can_edit
          when 'delete'  then p.can_delete
          when 'approve' then p.can_approve
          when 'export'  then p.can_export
          else false
        end)
      from public.user_module_permissions p
      where p.user_id = (select (public.erp_current_user()).id)
        and p.module_key = p_module
    ), false)
  end;
$fn$;
revoke all on function public.erp_has_perm(text, text) from public, anon, authenticated;
-- authenticated MUST keep EXECUTE: row policies evaluate this function for every
-- row (same pattern as erp_visible_company_ids). It is read-only and safe.
grant execute on function public.erp_has_perm(text, text) to authenticated;

-- Any-of helper for tables shared by several modules. Empty module list means
-- "no module restriction" (company isolation alone, as before).
create or replace function public.erp_has_any_perm(p_modules text[], p_action text)
returns boolean
language sql stable security definer
set search_path = public
as $fn$
  select coalesce(p_modules, array[]::text[]) = array[]::text[]
    or exists (select 1 from unnest(p_modules) m where public.erp_has_perm(m, p_action));
$fn$;
revoke all on function public.erp_has_any_perm(text[], text) from public, anon, authenticated;
-- Same as above: required for row-policy evaluation.
grant execute on function public.erp_has_any_perm(text[], text) to authenticated;

-- -------------------------------------------------------------------------------------
-- Replace the shared FOR ALL company-isolation policy with per-operation
-- policies that additionally require the mapped module permission.
-- Portal policies on individual tables are separate policies (OR-ed) and stay
-- untouched, so portal customers keep exactly the access they had.
-- -------------------------------------------------------------------------------------
do $$
declare
  t       text;
  modules text[];
begin
  for t in
    select distinct tablename
    from pg_policies
    where schemaname = 'public' and policyname = 'erp_company_isolation'
    order by 1
  loop
    modules := public.erp_table_modules(t);
    execute format('drop policy erp_company_isolation on public.%I', t);
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

-- Admin-area reads: module-gated, with a self/own-company exception so members
-- keep exactly the access they had (own profile row, own company row).
drop policy if exists company_users_read on public.company_users;
create policy company_users_read on public.company_users for select to authenticated
  using (
    public.erp_can_see_user(company_id, id)
    and (
      public.erp_has_perm('admin-users', 'view')
      or id = (select (public.erp_current_user()).id)
    )
  );

drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to authenticated
  using (
    (public.erp_is_super_admin() or id = (select (public.erp_current_user()).company_id))
    and (
      public.erp_has_perm('admin-companies', 'view')
      or id = (select (public.erp_current_user()).company_id)
    )
  );

-- -------------------------------------------------------------------------------------
-- Reads: own effective matrix (frontend builds sidebar/KPIs/routes from this).
-- -------------------------------------------------------------------------------------
create or replace function public.erp_get_permissions()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $fn$
declare
  me record;
begin
  me := public.erp_current_user();
  if me is null or me.id is null then
    raise exception 'Not authorized';
  end if;
  return jsonb_build_object(
    'role', me.role,
    'is_admin', (me.role in ('SUPER_ADMIN', 'COMPANY_ADMIN')),
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module_key', p.module_key, 'can_view', p.can_view, 'can_create', p.can_create,
        'can_edit', p.can_edit, 'can_delete', p.can_delete,
        'can_approve', p.can_approve, 'can_export', p.can_export))
      from public.user_module_permissions p where p.user_id = me.id
    ), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.erp_get_permissions() from public, anon, authenticated;
grant execute on function public.erp_get_permissions() to authenticated;

-- Manager read: rows of one visible user (authority-checked).
create or replace function public.erp_get_user_permissions(p_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $fn$
declare
  me     record;
  target record;
begin
  me := public.erp_current_user();
  if me is null or me.id is null then raise exception 'Not authorized'; end if;
  select * into target from public.company_users where id = p_user_id;
  if target is null then raise exception 'User not found'; end if;
  if not public.erp_can_see_user(target.company_id, target.id) then
    raise exception 'Not authorized to view this user';
  end if;
  return jsonb_build_object(
    'role', target.role,
    'company_id', target.company_id,
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module_key', p.module_key, 'can_view', p.can_view, 'can_create', p.can_create,
        'can_edit', p.can_edit, 'can_delete', p.can_delete,
        'can_approve', p.can_approve, 'can_export', p.can_export))
      from public.user_module_permissions p where p.user_id = target.id
    ), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.erp_get_user_permissions(uuid) from public, anon, authenticated;
grant execute on function public.erp_get_user_permissions(uuid) to authenticated;

-- -------------------------------------------------------------------------------------
-- Write: replace one user's matrix (authority-checked). p_permissions maps
-- module_key -> {view,create,edit,delete,approve,export} booleans.
-- Rules: caller must be SUPER_ADMIN or COMPANY_ADMIN; nobody edits their own
-- rows (prevents lock-outs); COMPANY_ADMIN targets own-company non-super-admins
-- only and can never grant admin-companies / admin-access / settings / audit-logs.
-- -------------------------------------------------------------------------------------
create or replace function public.erp_save_permissions(p_user_id uuid, p_permissions jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $fn$
declare
  me            record;
  target        record;
  mod           text;
  flags         jsonb;
  reserved      text[] := array['admin-companies', 'admin-access', 'settings', 'audit-logs'];
  reserved_seen text[] := array[]::text[];
begin
  me := public.erp_current_user();
  if me is null or me.id is null then raise exception 'Not authorized'; end if;
  if me.role not in ('SUPER_ADMIN', 'COMPANY_ADMIN') then
    raise exception 'Only administrators can manage permissions';
  end if;
  if p_user_id = me.id then
    raise exception 'You cannot edit your own permissions — ask another administrator';
  end if;
  select * into target from public.company_users where id = p_user_id;
  if target is null then raise exception 'User not found'; end if;
  if not public.erp_can_see_user(target.company_id, target.id) then
    raise exception 'Not authorized to manage this user';
  end if;
  if me.role = 'COMPANY_ADMIN' then
    if target.role = 'SUPER_ADMIN' then raise exception 'Only a Super Admin can manage Super Admin accounts'; end if;
    if target.company_id is distinct from me.company_id then
      raise exception 'Company Admins can only manage users of their own company';
    end if;
    for mod in select jsonb_object_keys(coalesce(p_permissions, '{}'::jsonb)) loop
      if mod = any (reserved) then reserved_seen := reserved_seen || mod; end if;
    end loop;
    if reserved_seen <> array[]::text[] then
      raise exception 'Company Admins cannot grant % — reserved for Super Admin', array_to_string(reserved_seen, ', ');
    end if;
    if target.role = 'COMPANY_ADMIN' and (p_permissions ? 'admin-users') then
      -- Company Admins keep user management (their job); nothing to strip.
      null;
    end if;
  end if;

  delete from public.user_module_permissions where user_id = target.id;
  for mod, flags in select key, value from jsonb_each(coalesce(p_permissions, '{}'::jsonb)) loop
    insert into public.user_module_permissions
      (user_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    values (
      target.id, mod,
      coalesce((flags ->> 'view')::boolean, false),
      coalesce((flags ->> 'create')::boolean, false),
      coalesce((flags ->> 'edit')::boolean, false),
      coalesce((flags ->> 'delete')::boolean, false),
      coalesce((flags ->> 'approve')::boolean, false),
      coalesce((flags ->> 'export')::boolean, false)
    );
  end loop;
  return jsonb_build_object('ok', true, 'user_id', target.id);
end;
$fn$;
revoke all on function public.erp_save_permissions(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.erp_save_permissions(uuid, jsonb) to authenticated;

-- -------------------------------------------------------------------------------------
-- Seed: preserve current behaviour for everyone who already exists.
-- Admins get the full matrix; existing members keep full access to everything
-- (they had it via role-only checks). New users get no rows (secure default).
-- -------------------------------------------------------------------------------------
do $$
declare
  modules text[] := array[
    'dashboard', 'reports', 'sales-pipeline', 'enquiries', 'quotations', 'sales-orders',
    'companies', 'engineering', 'production', 'scheduling', 'machine-log', 'process-master',
    'finished-goods', 'rejected', 'inward', 'delivery', 'invoices', 'bank-entry', 'ledger',
    'petty-cash', 'project-costing', 'product-costing', 'inventory', 'suppliers',
    'purchase-requisitions', 'purchase-orders', 'grn', 'quality', 'maintenance',
    'admin-users', 'admin-companies', 'admin-access', 'settings', 'audit-logs'];
  u record;
  m text;
begin
  for u in select id, role from public.company_users loop
    foreach m in array modules loop
      insert into public.user_module_permissions
        (user_id, module_key, can_view, can_create, can_edit, can_delete, can_approve, can_export)
      values (u.id, m, true, true, true, true, true, true)
      on conflict (user_id, module_key) do nothing;
    end loop;
  end loop;
end;
$$;
