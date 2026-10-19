-- ============================================================================
-- Migration: 20261020000000_retail_store_sync.sql
-- ERP Inventory ↔ Retail Store Synchronization:
-- 1. Warehouse designation column (is_retail_store)
-- 2. Persistent synchronization logs table (cnc_retail_sync_logs)
-- 3. Stored procedures for warehouse designation, sync tracking, and order deductions
-- ============================================================================

-- 1. Add is_retail_store column to cnc_warehouses
alter table public.cnc_warehouses
  add column if not exists is_retail_store boolean not null default false;

-- 2. Persistent synchronization logs table
create table if not exists public.cnc_retail_sync_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  item_kind text not null check (item_kind in ('RAW', 'PART', 'FG')),
  item_id text not null,
  item_code text not null,
  item_name text not null,
  warehouse_id text,
  warehouse_name text,
  erp_stock numeric not null default 0,
  retail_stock numeric default null,
  sync_status text not null check (sync_status in ('synced', 'pending', 'failed', 'updated', 'removed')),
  last_sync_at timestamptz not null default now(),
  error_message text,
  retry_count integer not null default 0,
  idempotency_key text,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_retail_sync_company_item on public.cnc_retail_sync_logs(company_id, item_kind, item_id);
create index if not exists idx_retail_sync_company_status on public.cnc_retail_sync_logs(company_id, sync_status);
create index if not exists idx_retail_sync_idempotency on public.cnc_retail_sync_logs(company_id, idempotency_key);

-- Enable RLS on sync logs
alter table public.cnc_retail_sync_logs enable row level security;

drop policy if exists cnc_retail_sync_logs_company on public.cnc_retail_sync_logs;
create policy cnc_retail_sync_logs_company on public.cnc_retail_sync_logs
  for all using (company_id = public.erp_report_company())
  with check (company_id = public.erp_report_company());

-- 3. Function to designate the Retail Store warehouse per company
create or replace function public.erp_designate_retail_warehouse(p_warehouse_id text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_company uuid := public.erp_report_company();
  v_wh public.cnc_warehouses;
begin
  if me.role not in ('SUPER_ADMIN', 'COMPANY_ADMIN') then
    raise exception 'Only administrators can designate the Retail Store warehouse' using errcode = '42501';
  end if;

  select * into v_wh from public.cnc_warehouses where id = p_warehouse_id and company_id = v_company;
  if v_wh.id is null then
    raise exception 'Warehouse not found';
  end if;

  -- Clear previous retail designation in this company
  update public.cnc_warehouses
  set is_retail_store = false
  where company_id = v_company and is_retail_store = true;

  -- Set new retail warehouse
  update public.cnc_warehouses
  set is_retail_store = true
  where id = p_warehouse_id and company_id = v_company;

  return jsonb_build_object('success', true, 'warehouse_id', p_warehouse_id, 'name', v_wh.name, 'code', v_wh.code);
end;
$$;

-- 4. Function to get designated retail warehouse (with heuristic fallback)
create or replace function public.erp_get_retail_warehouse()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_report_company();
  v_wh record;
begin
  -- First check explicit is_retail_store flag
  select id, code, name, type, status, is_default, is_retail_store
  into v_wh
  from public.cnc_warehouses
  where company_id = v_company and is_retail_store = true and status = 'Active'
  limit 1;

  -- Fallback: check warehouse with 'retail' in name or code
  if v_wh.id is null then
    select id, code, name, type, status, is_default, is_retail_store
    into v_wh
    from public.cnc_warehouses
    where company_id = v_company and (lower(name) like '%retail%' or lower(code) like '%retail%') and status = 'Active'
    order by is_default desc, created_at asc
    limit 1;
  end if;

  if v_wh.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_wh.id,
    'code', v_wh.code,
    'name', v_wh.name,
    'type', v_wh.type,
    'status', v_wh.status,
    'is_retail_store', coalesce(v_wh.is_retail_store, false)
  );
end;
$$;

-- 5. Record / update sync log entry
create or replace function public.erp_record_retail_sync(p_entry jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_report_company();
  v_kind text := coalesce(p_entry ->> 'item_kind', 'PART');
  v_item_id text := coalesce(p_entry ->> 'item_id', '');
  v_item_code text := coalesce(p_entry ->> 'item_code', '');
  v_item_name text := coalesce(p_entry ->> 'item_name', '');
  v_status text := coalesce(p_entry ->> 'sync_status', 'synced');
  v_stock numeric := coalesce((p_entry ->> 'erp_stock')::numeric, 0);
  v_retail_stock numeric := (p_entry ->> 'retail_stock')::numeric;
  v_error text := p_entry ->> 'error_message';
  v_wh_id text := p_entry ->> 'warehouse_id';
  v_wh_name text := p_entry ->> 'warehouse_name';
  v_idem text := p_entry ->> 'idempotency_key';
  v_payload jsonb := p_entry -> 'payload';
  v_log_id uuid;
begin
  if v_item_id = '' or v_item_code = '' then
    raise exception 'item_id and item_code are required';
  end if;

  -- Update existing row for this item if one exists
  update public.cnc_retail_sync_logs
  set
    sync_status = v_status,
    erp_stock = v_stock,
    retail_stock = coalesce(v_retail_stock, retail_stock),
    warehouse_id = coalesce(v_wh_id, warehouse_id),
    warehouse_name = coalesce(v_wh_name, warehouse_name),
    last_sync_at = now(),
    error_message = v_error,
    retry_count = case when v_status = 'failed' then retry_count + 1 else retry_count end,
    idempotency_key = coalesce(v_idem, idempotency_key),
    payload = coalesce(v_payload, payload),
    updated_at = now()
  where company_id = v_company and item_kind = v_kind and item_id = v_item_id
  returning id into v_log_id;

  if v_log_id is null then
    insert into public.cnc_retail_sync_logs (
      company_id, item_kind, item_id, item_code, item_name,
      warehouse_id, warehouse_name, erp_stock, retail_stock,
      sync_status, last_sync_at, error_message, retry_count,
      idempotency_key, payload, updated_at
    ) values (
      v_company, v_kind, v_item_id, v_item_code, v_item_name,
      v_wh_id, v_wh_name, v_stock, v_retail_stock,
      v_status, now(), v_error, case when v_status = 'failed' then 1 else 0 end,
      v_idem, v_payload, now()
    ) returning id into v_log_id;
  end if;

  return jsonb_build_object('success', true, 'log_id', v_log_id, 'status', v_status);
end;
$$;

-- 6. Query sync summary
create or replace function public.erp_get_retail_sync_summary()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_report_company();
  v_synced bigint;
  v_pending bigint;
  v_failed bigint;
  v_updated bigint;
  v_removed bigint;
  v_total bigint;
begin
  select
    count(*) filter (where sync_status = 'synced'),
    count(*) filter (where sync_status = 'pending'),
    count(*) filter (where sync_status = 'failed'),
    count(*) filter (where sync_status = 'updated'),
    count(*) filter (where sync_status = 'removed'),
    count(*)
  into v_synced, v_pending, v_failed, v_updated, v_removed, v_total
  from public.cnc_retail_sync_logs
  where company_id = v_company;

  return jsonb_build_object(
    'synced', coalesce(v_synced, 0),
    'pending', coalesce(v_pending, 0),
    'failed', coalesce(v_failed, 0),
    'updated', coalesce(v_updated, 0),
    'removed', coalesce(v_removed, 0),
    'total', coalesce(v_total, 0)
  );
end;
$$;

-- 7. Deduct stock for Retail Store Sales Order
create or replace function public.erp_retail_deduct_core(p_company uuid, p_deduction jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_company uuid := p_company;
  v_order_id text := coalesce(p_deduction ->> 'order_id', '');
  v_idem text := coalesce(p_deduction ->> 'idempotency_key', '');
  v_customer text := coalesce(p_deduction ->> 'customer', 'Retail Customer');
  v_items jsonb := p_deduction -> 'items';
  v_item record;
  v_curr_stock numeric;
  v_qty numeric;
  v_item_id text;
  v_kind text;
  v_movements jsonb := '[]'::jsonb;
  v_mov_id text;
  v_retail_wh text;
begin
  if v_order_id = '' then
    raise exception 'order_id is required';
  end if;

  select id::text into v_retail_wh from public.cnc_warehouses where company_id = v_company and is_retail_store = true limit 1;

  -- 1. Idempotency check: see if this order was already processed
  if exists (
    select 1 from public.cnc_stock_movements
    where company_id = v_company and reference_type = 'retail_order' and reference_no = v_order_id
  ) then
    return jsonb_build_object('success', true, 'duplicate', true, 'order_id', v_order_id, 'message', 'Already processed');
  end if;

  -- 2. Revalidate stock for ALL items before deducting to prevent negative stock
  for v_item in select * from jsonb_to_recordset(v_items) as x(pid text, erp_item_id text, sku text, qty numeric, price numeric) loop
    v_qty := coalesce(v_item.qty, 0);
    if v_qty <= 0 then
      raise exception 'Invalid quantity % for item %', v_qty, v_item.sku;
    end if;

    v_curr_stock := null;
    v_kind := 'PART';
    v_item_id := v_item.erp_item_id;

    if v_item_id is not null and v_item_id <> '' then
      select stock_qty into v_curr_stock from public.cnc_parts where id::text = v_item_id and company_id = v_company;
      if v_curr_stock is null then
        select stock_qty into v_curr_stock from public.cnc_raw_materials where id::text = v_item_id and company_id = v_company;
        v_kind := 'RAW';
      end if;
    end if;

    if v_curr_stock is null and v_item.sku is not null then
      select id::text, stock_qty into v_item_id, v_curr_stock from public.cnc_parts where lower(part_no) = lower(v_item.sku) and company_id = v_company limit 1;
      if v_curr_stock is null then
        select id::text, stock_qty into v_item_id, v_curr_stock from public.cnc_raw_materials where lower(material_code) = lower(v_item.sku) and company_id = v_company limit 1;
        v_kind := 'RAW';
      end if;
    end if;

    if v_curr_stock is null then
      raise exception 'Item % not found in ERP inventory', coalesce(v_item.sku, v_item.erp_item_id);
    end if;

    if v_qty > v_curr_stock then
      raise exception 'Insufficient ERP stock for %: requested %, available %', v_item.sku, v_qty, v_curr_stock;
    end if;
  end loop;

  -- 3. All items validated: perform atomic deductions
  for v_item in select * from jsonb_to_recordset(v_items) as x(pid text, erp_item_id text, sku text, qty numeric, price numeric) loop
    v_qty := coalesce(v_item.qty, 0);
    v_kind := 'PART';
    v_item_id := v_item.erp_item_id;

    if v_item_id is not null and v_item_id <> '' then
      if not exists (select 1 from public.cnc_parts where id::text = v_item_id and company_id = v_company) then
        v_kind := 'RAW';
      end if;
    else
      select id::text into v_item_id from public.cnc_parts where lower(part_no) = lower(v_item.sku) and company_id = v_company limit 1;
      if v_item_id is null then
        select id::text into v_item_id from public.cnc_raw_materials where lower(material_code) = lower(v_item.sku) and company_id = v_company limit 1;
        v_kind := 'RAW';
      end if;
    end if;

    -- Record 'OUT' movement
    v_mov_id := public.erp_insert_movement(
      v_company,
      v_kind,
      v_item_id,
      'Retail Order',
      'OUT',
      -v_qty,
      v_item.price,
      'retail_order',
      v_order_id,
      v_order_id,
      'Retail Store Order ' || v_order_id || ' (' || v_customer || ')',
      public.erp_today(),
      'Retail Store Integration',
      v_retail_wh   -- the movement is tagged to the Retail Store warehouse (null = the item's own warehouse)
    );

    v_movements := v_movements || jsonb_build_object('item_id', v_item_id, 'sku', v_item.sku, 'movement_id', v_mov_id, 'qty', v_qty);
  end loop;

  return jsonb_build_object('success', true, 'duplicate', false, 'order_id', v_order_id, 'movements', v_movements);
end;
$$;
revoke all on function public.erp_retail_deduct_core(uuid, jsonb) from public, anon, authenticated;

-- A signed-in ERP user deducting for their own company.
create or replace function public.erp_retail_deduct_stock(p_deduction jsonb)
returns jsonb
language sql volatile security definer set search_path = ''
as $$ select public.erp_retail_deduct_core(public.erp_report_company(), p_deduction) $$;

-- The retail store's order webhook runs on the server (no signed-in user): it uses the service-role key and names the company.
create or replace function public.erp_retail_deduct_stock_service(p_company uuid, p_deduction jsonb)
returns jsonb
language sql volatile security definer set search_path = ''
as $$ select public.erp_retail_deduct_core(p_company, p_deduction) $$;
revoke all on function public.erp_retail_deduct_stock_service(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.erp_retail_deduct_stock_service(uuid, jsonb) to service_role;
