-- =====================================================================================
-- Opening Balances & Opening Stock
--
-- Lets a company enter what it already had when it started using the ERP:
--   * BANK      balance of each bank / cash account
--   * CUSTOMER  amounts customers owed (receivable) or had paid in advance (credit balance)
--   * SUPPLIER  amounts owed to suppliers (payable) or advances paid (debit balance)
--   * STOCK     quantity and cost of stock already in the warehouse
--
-- Nothing new is invented for the books. Posting reuses what the ERP already has:
--   * the journal engine  (erp_post_system_journal, voucher type 'Opening', offset = Opening Balance Equity 3300)
--       BANK      Dr / Cr  the bank or cash account        <->  Opening Balance Equity
--       CUSTOMER  Dr  Trade Receivables (party = customer) <->  Cr Opening Balance Equity   (credit balance reverses it)
--       SUPPLIER  Cr  Trade Payables   (party = supplier)  <->  Dr Opening Balance Equity   (debit balance reverses it)
--   * the stock ledger    (erp_insert_movement, type 'Opening'): the existing trigger posts
--       Dr Inventory / Cr Opening Balance Equity, updates the item's stock and warehouse.
--     The item's rate becomes the moving weighted average of existing stock and the opening stock.
--
-- Workflow: Draft -> Validate -> Preview -> Post (atomic, idempotent) -> View in ledger / stock.
-- A posted entry is never edited or deleted: it is Reversed (a reversing journal / stock movement is written, the
-- original stays for the audit trail) and a corrected entry can then be entered.
--
-- Duplicates: one live (Draft or Posted) entry per company + type + subject
--   (bank account | customer + invoice ref | supplier + invoice ref | item + warehouse). A Reversed entry frees its subject.
--
-- Safe to re-run. Nothing here drops, empties or rewrites existing data.
-- =====================================================================================
begin;

-- -------------------------------------------------------------------------------------
-- 1. Table
-- -------------------------------------------------------------------------------------
create table if not exists public.cnc_opening_entries (
  id                   uuid primary key default gen_random_uuid(),
  entry_no             text not null,
  entry_type           text not null check (entry_type in ('BANK', 'CUSTOMER', 'SUPPLIER', 'STOCK')),
  opening_date         date not null,
  status               text not null default 'Draft' check (status in ('Draft', 'Posted', 'Reversed')),
  -- bank
  account_id           uuid references public.chart_of_accounts (id),
  -- customer / supplier
  party_id             text,
  party_name           text,
  party_code           text,
  balance_type         text,        -- Bank: Debit | Overdraft   Customer: Receivable | Credit Balance   Supplier: Payable | Debit Balance
  side                 text check (side in ('DR', 'CR')),
  invoice_ref          text,
  due_date             date,
  -- stock
  item_kind            text check (item_kind in ('RAW', 'PART')),
  item_id              text,
  item_code            text,
  item_name            text,
  unit                 text,
  warehouse_id         text,
  qty                  numeric(18, 3),
  unit_cost            numeric(18, 4),
  -- common
  amount               numeric(18, 2) not null default 0 check (amount >= 0),   -- stock: qty x unit cost
  currency             text not null default 'INR',
  remarks              text,
  subject_key          text not null,
  -- posting results
  journal_entry_id     uuid references public.journal_entries (id) on delete set null,
  movement_id          text,
  reversal_journal_id  uuid references public.journal_entries (id) on delete set null,
  reversal_movement_id text,
  -- audit
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_by           text,
  updated_at           timestamptz not null default now(),
  posted_by            text,
  posted_at            timestamptz,
  reversed_by          text,
  reversed_at          timestamptz,
  reverse_reason       text
);

select public.erp_secure_table('cnc_opening_entries');

create unique index if not exists cnc_opening_entries_no_key      on public.cnc_opening_entries (company_id, entry_no);
create unique index if not exists cnc_opening_entries_subject_key on public.cnc_opening_entries (company_id, subject_key) where status in ('Draft', 'Posted');
create index if not exists cnc_opening_entries_type_date_idx      on public.cnc_opening_entries (company_id, entry_type, opening_date);
create index if not exists cnc_opening_entries_account_idx        on public.cnc_opening_entries (company_id, account_id) where account_id is not null;
create index if not exists cnc_opening_entries_party_idx          on public.cnc_opening_entries (company_id, entry_type, lower(party_name)) where party_name is not null;
create index if not exists cnc_opening_entries_item_idx           on public.cnc_opening_entries (company_id, item_kind, item_id) where item_id is not null;
create index if not exists cnc_opening_entries_warehouse_idx      on public.cnc_opening_entries (company_id, warehouse_id) where warehouse_id is not null;

-- Written only by the functions below (they check the role); the browser can read its own company's rows.
revoke insert, update, delete on public.cnc_opening_entries from authenticated;

drop trigger if exists zz_erp_same_company_account_id on public.cnc_opening_entries;
create trigger zz_erp_same_company_account_id before insert or update on public.cnc_opening_entries
  for each row execute function public.erp_check_same_company('account_id', 'chart_of_accounts');

-- -------------------------------------------------------------------------------------
-- 2. Internal helpers
-- -------------------------------------------------------------------------------------

-- Who may do what. Administrators always pass; members need the 'opening-balances' module grant.
-- Posting and reversing are administrator-only.
create or replace function public.erp_opening_guard(p_action text, p_admin_only boolean default false)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare me public.company_users := public.erp_current_user();
begin
  if me.id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_admin_only and me.role not in ('SUPER_ADMIN', 'COMPANY_ADMIN') then
    raise exception 'Only administrators can % opening entries', p_action using errcode = '42501';
  end if;
  if not public.erp_has_perm('opening-balances', case p_action when 'view' then 'view' when 'create' then 'create' when 'delete' then 'delete' else 'edit' end) then
    raise exception 'You do not have permission to % opening balances', p_action using errcode = '42501';
  end if;
  return public.erp_report_company();
end;
$$;

-- The two sides of an entry as journal lines (account_id, debit, credit, party). Used for the preview and the posting.
create or replace function public.erp_opening_lines(r public.cnc_opening_entries)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_eq uuid := public.erp_account_id(r.company_id, 'OPENING_EQUITY');
  v_main uuid;
  v_dr boolean := r.side = 'DR';
begin
  v_main := case r.entry_type
    when 'BANK' then r.account_id
    when 'CUSTOMER' then public.erp_account_id(r.company_id, 'TRADE_RECEIVABLES')
    when 'SUPPLIER' then public.erp_account_id(r.company_id, 'TRADE_PAYABLES')
    else public.erp_account_id(r.company_id, case when r.item_kind = 'PART' then 'INV_FG' else 'INV_RAW' end)
  end;
  if v_eq is null or v_main is null then
    raise exception 'The chart of accounts is missing Opening Balance Equity or the control account for this entry';
  end if;
  return jsonb_build_array(
    jsonb_build_object('account_id', v_main,
      'debit', case when v_dr then r.amount else 0 end, 'credit', case when v_dr then 0 else r.amount end,
      'party', case when r.entry_type in ('CUSTOMER', 'SUPPLIER') then r.party_name end),
    jsonb_build_object('account_id', v_eq,
      'debit', case when v_dr then 0 else r.amount end, 'credit', case when v_dr then r.amount else 0 end));
end;
$$;

-- Everything that would stop an entry from being posted (empty = fine). Volatile: it may create the financial year of the date.
create or replace function public.erp_opening_issues(r public.cnc_opening_entries)
returns text[]
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v text[] := '{}';
  v_today date := public.erp_today(r.company_id);
  v_fy public.financial_years;
begin
  if r.opening_date is null then
    v := array_append(v, 'Opening date is required');
  else
    if r.opening_date > v_today then v := array_append(v, 'Opening date cannot be in the future'); end if;
    v_fy := public.erp_ensure_financial_year(r.company_id, r.opening_date);
    if v_fy.status = 'Closed' then v := array_append(v, (v_fy.name || ' is closed; open it or choose another date')); end if;
  end if;

  if r.entry_type = 'BANK' then
    if r.account_id is null or not exists (select 1 from public.chart_of_accounts a
         where a.id = r.account_id and a.company_id = r.company_id and not a.is_group and a.status = 'Active') then
      v := array_append(v, 'Choose a valid bank or cash account');
    end if;
    if coalesce(r.amount, 0) <= 0 then v := array_append(v, 'Opening balance must be greater than zero'); end if;

  elsif r.entry_type = 'CUSTOMER' then
    if coalesce(btrim(r.party_name), '') = '' or not exists (select 1 from public.cnc_customers c
         where c.company_id = r.company_id and (c.id::text = r.party_id or lower(btrim(c.name)) = lower(btrim(r.party_name)))) then
      v := array_append(v, 'Choose an existing customer');
    end if;
    if coalesce(r.amount, 0) <= 0 then v := array_append(v, 'Opening balance must be greater than zero'); end if;

  elsif r.entry_type = 'SUPPLIER' then
    if coalesce(btrim(r.party_name), '') = '' or not exists (select 1 from public.cnc_suppliers s
         where s.company_id = r.company_id and (s.id::text = r.party_id or lower(btrim(s.name)) = lower(btrim(r.party_name)))) then
      v := array_append(v, 'Choose an existing supplier');
    end if;
    if coalesce(r.amount, 0) <= 0 then v := array_append(v, 'Opening balance must be greater than zero'); end if;

  elsif r.entry_type = 'STOCK' then
    if r.item_kind is null or r.item_id is null or not exists (
         select 1 from public.erp_item_info(r.company_id, r.item_kind, r.item_id) i where i.code is not null) then
      v := array_append(v, 'Choose a product from the inventory master');
    end if;
    if coalesce(r.qty, 0) <= 0 then v := array_append(v, 'Opening quantity must be greater than zero'); end if;
    if r.unit_cost is null or r.unit_cost < 0 then v := array_append(v, 'Unit cost must be zero or more'); end if;
    if r.warehouse_id is not null and not exists (
         select 1 from public.cnc_warehouses w where w.company_id = r.company_id and w.id::text = r.warehouse_id) then
      v := array_append(v, 'Choose a valid warehouse');
    end if;
  end if;
  return v;
end;
$$;

-- Non-blocking remarks shown in the preview.
create or replace function public.erp_opening_warnings(r public.cnc_opening_entries)
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare v text[] := '{}'; v_stock numeric;
begin
  if r.entry_type = 'STOCK' and r.item_kind is not null and r.item_id is not null then
    select i.stock into v_stock from public.erp_item_info(r.company_id, r.item_kind, r.item_id) i;
    if coalesce(v_stock, 0) > 0 then
      v := array_append(v, ('This item already has ' || v_stock::text || ' in stock; the opening quantity is added to it and the rate is averaged'));
    end if;
  end if;
  if r.entry_type = 'BANK' and r.side = 'CR' then
    v := array_append(v, 'Overdraft: the account will start with a credit (negative) balance');
  end if;
  return v;
end;
$$;

revoke all on function public.erp_opening_guard(text, boolean) from public, anon, authenticated;
revoke all on function public.erp_opening_lines(public.cnc_opening_entries) from public, anon, authenticated;
revoke all on function public.erp_opening_issues(public.cnc_opening_entries) from public, anon, authenticated;
revoke all on function public.erp_opening_warnings(public.cnc_opening_entries) from public, anon, authenticated;

-- -------------------------------------------------------------------------------------
-- 3. Draft: save (create / edit) and delete
-- -------------------------------------------------------------------------------------
create or replace function public.erp_opening_save(p_entry jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_company uuid;
  v_id uuid := nullif(p_entry ->> 'id', '')::uuid;
  v_type text := upper(btrim(coalesce(p_entry ->> 'entry_type', '')));
  v_date date := nullif(p_entry ->> 'opening_date', '')::date;
  v_btype text := btrim(coalesce(p_entry ->> 'balance_type', ''));
  v_amount numeric := round(coalesce(nullif(p_entry ->> 'amount', '')::numeric, 0), 2);
  v_qty numeric := round(coalesce(nullif(p_entry ->> 'qty', '')::numeric, 0), 3);
  v_cost numeric := round(coalesce(nullif(p_entry ->> 'unit_cost', '')::numeric, 0), 4);
  v_side text := 'DR';
  v_party_id text := nullif(btrim(coalesce(p_entry ->> 'party_id', '')), '');
  v_party text := nullif(btrim(coalesce(p_entry ->> 'party_name', '')), '');
  v_code text := nullif(btrim(coalesce(p_entry ->> 'party_code', '')), '');
  v_ref text := nullif(btrim(coalesce(p_entry ->> 'invoice_ref', '')), '');
  v_item_kind text := nullif(upper(btrim(coalesce(p_entry ->> 'item_kind', ''))), '');
  v_item_id text := nullif(btrim(coalesce(p_entry ->> 'item_id', '')), '');
  v_wh text := nullif(btrim(coalesce(p_entry ->> 'warehouse_id', '')), '');
  v_account uuid := nullif(p_entry ->> 'account_id', '')::uuid;
  v_icode text; v_iname text; v_iunit text;
  v_key text;
  v_old public.cnc_opening_entries;
  v_row public.cnc_opening_entries;
begin
  v_company := public.erp_opening_guard(case when v_id is null then 'create' else 'edit' end);
  if v_type not in ('BANK', 'CUSTOMER', 'SUPPLIER', 'STOCK') then raise exception 'Choose the type of opening entry'; end if;
  if v_date is null then raise exception 'Opening date is required'; end if;

  if v_id is not null then
    select * into v_old from public.cnc_opening_entries where id = v_id and company_id = v_company for update;
    if v_old.id is null then raise exception 'Opening entry not found'; end if;
    if v_old.status <> 'Draft' then
      raise exception 'A % entry cannot be edited. Reverse it and enter a corrected one.', lower(v_old.status);
    end if;
    v_type := v_old.entry_type;   -- the type of an existing entry never changes
  end if;

  if v_type = 'BANK' then
    if v_account is null then raise exception 'Choose a bank account'; end if;
    v_side := case when lower(v_btype) in ('overdraft', 'credit') then 'CR' else 'DR' end;
    v_btype := case v_side when 'CR' then 'Overdraft' else 'Debit' end;
    v_key := 'BANK:' || v_account::text;
  elsif v_type = 'CUSTOMER' then
    select c.id::text, c.name into v_party_id, v_party from public.cnc_customers c
    where c.company_id = v_company and (c.id::text = v_party_id or lower(btrim(c.name)) = lower(coalesce(v_party, ''))) order by (c.id::text = v_party_id) desc limit 1;
    if v_party is null then raise exception 'Choose an existing customer'; end if;
    v_side := case when lower(v_btype) like 'credit%' then 'CR' else 'DR' end;
    v_btype := case v_side when 'CR' then 'Credit Balance' else 'Receivable' end;
    v_key := 'CUSTOMER:' || v_party_id || '|' || lower(coalesce(v_ref, ''));
  elsif v_type = 'SUPPLIER' then
    select s.id::text, s.name, coalesce(v_code, s.code) into v_party_id, v_party, v_code from public.cnc_suppliers s
    where s.company_id = v_company and (s.id::text = v_party_id or lower(btrim(s.name)) = lower(coalesce(v_party, ''))) order by (s.id::text = v_party_id) desc limit 1;
    if v_party is null then raise exception 'Choose an existing supplier'; end if;
    v_side := case when lower(v_btype) like 'debit%' then 'DR' else 'CR' end;
    v_btype := case v_side when 'DR' then 'Debit Balance' else 'Payable' end;
    v_key := 'SUPPLIER:' || v_party_id || '|' || lower(coalesce(v_ref, ''));
  else
    if v_item_kind not in ('RAW', 'PART') or v_item_id is null then raise exception 'Choose a product from the inventory master'; end if;
    select i.code, i.name, i.unit into v_icode, v_iname, v_iunit from public.erp_item_info(v_company, v_item_kind, v_item_id) i;
    if v_icode is null then raise exception 'Choose a product from the inventory master'; end if;
    if v_qty <= 0 then raise exception 'Opening quantity must be greater than zero'; end if;
    if v_cost < 0 then raise exception 'Unit cost cannot be negative'; end if;
    v_amount := round(v_qty * v_cost, 2);
    v_btype := null;
    v_key := 'STOCK:' || v_item_kind || ':' || v_item_id || ':' || coalesce(v_wh, '');
  end if;

  if v_type <> 'STOCK' and v_amount <= 0 then raise exception 'Opening balance must be greater than zero'; end if;

  begin
    if v_id is null then
      insert into public.cnc_opening_entries (
        company_id, entry_no, entry_type, opening_date, status, account_id, party_id, party_name, party_code, balance_type, side,
        invoice_ref, due_date, item_kind, item_id, item_code, item_name, unit, warehouse_id, qty, unit_cost, amount, currency,
        remarks, subject_key, created_by, updated_by)
      values (
        v_company, public.erp_next_number(v_company, 'public.cnc_opening_entries', 'entry_no', 'OBE'), v_type, v_date, 'Draft',
        case when v_type = 'BANK' then v_account end, case when v_type in ('CUSTOMER', 'SUPPLIER') then v_party_id end,
        case when v_type in ('CUSTOMER', 'SUPPLIER') then v_party end, case when v_type in ('CUSTOMER', 'SUPPLIER') then v_code end,
        v_btype, v_side, case when v_type in ('CUSTOMER', 'SUPPLIER') then v_ref end,
        case when v_type in ('CUSTOMER', 'SUPPLIER') then nullif(p_entry ->> 'due_date', '')::date end,
        case when v_type = 'STOCK' then v_item_kind end, case when v_type = 'STOCK' then v_item_id end,
        v_icode, v_iname, v_iunit, case when v_type = 'STOCK' then v_wh end,
        case when v_type = 'STOCK' then v_qty end, case when v_type = 'STOCK' then v_cost end, v_amount,
        coalesce(nullif(btrim(p_entry ->> 'currency'), ''), 'INR'), nullif(btrim(coalesce(p_entry ->> 'remarks', '')), ''),
        v_key, me.full_name, me.full_name)
      returning * into v_row;
    else
      update public.cnc_opening_entries set
        opening_date = v_date,
        account_id = case when v_type = 'BANK' then v_account end,
        party_id = case when v_type in ('CUSTOMER', 'SUPPLIER') then v_party_id end,
        party_name = case when v_type in ('CUSTOMER', 'SUPPLIER') then v_party end,
        party_code = case when v_type in ('CUSTOMER', 'SUPPLIER') then v_code end,
        balance_type = v_btype, side = v_side,
        invoice_ref = case when v_type in ('CUSTOMER', 'SUPPLIER') then v_ref end,
        due_date = case when v_type in ('CUSTOMER', 'SUPPLIER') then nullif(p_entry ->> 'due_date', '')::date end,
        item_kind = case when v_type = 'STOCK' then v_item_kind end, item_id = case when v_type = 'STOCK' then v_item_id end,
        item_code = v_icode, item_name = v_iname, unit = v_iunit, warehouse_id = case when v_type = 'STOCK' then v_wh end,
        qty = case when v_type = 'STOCK' then v_qty end, unit_cost = case when v_type = 'STOCK' then v_cost end,
        amount = v_amount, currency = coalesce(nullif(btrim(p_entry ->> 'currency'), ''), 'INR'),
        remarks = nullif(btrim(coalesce(p_entry ->> 'remarks', '')), ''), subject_key = v_key,
        updated_by = me.full_name, updated_at = now()
      where id = v_id returning * into v_row;
    end if;
  exception when unique_violation then
    raise exception 'An opening entry for this % already exists. Edit that one, or reverse it first.',
      case v_type when 'BANK' then 'bank account' when 'CUSTOMER' then 'customer' when 'SUPPLIER' then 'supplier' else 'product and warehouse' end;
  end;
  return jsonb_build_object('id', v_row.id, 'entry_no', v_row.entry_no, 'status', v_row.status);
end;
$$;

create or replace function public.erp_opening_delete(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_company uuid := public.erp_opening_guard('delete'); v_row public.cnc_opening_entries;
begin
  select * into v_row from public.cnc_opening_entries where id = p_id and company_id = v_company for update;
  if v_row.id is null then raise exception 'Opening entry not found'; end if;
  if v_row.status <> 'Draft' then
    raise exception 'Only a draft can be deleted. A posted entry must be reversed so the audit trail is kept.';
  end if;
  delete from public.cnc_opening_entries where id = p_id;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 4. Validate + preview (nothing is written)
-- -------------------------------------------------------------------------------------
create or replace function public.erp_opening_validate(p_ids uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_opening_guard('view');
  r public.cnc_opening_entries;
  v_out jsonb := '[]'::jsonb;
  v_issues text[];
  v_lines jsonb;
  v_ok boolean := true;
begin
  for r in select * from public.cnc_opening_entries where company_id = v_company and id = any(p_ids) order by opening_date, created_at loop
    v_issues := case when r.status = 'Draft' then public.erp_opening_issues(r)
                     else array['Already ' || lower(r.status) || '; nothing to post'] end;
    v_lines := null;
    if r.status = 'Draft' and coalesce(array_length(v_issues, 1), 0) = 0 then
      v_lines := (select jsonb_agg(jsonb_build_object('account', a.code || ' ' || a.name, 'debit', (x ->> 'debit')::numeric,
                    'credit', (x ->> 'credit')::numeric, 'party', x ->> 'party') order by (x ->> 'debit')::numeric desc)
                  from jsonb_array_elements(public.erp_opening_lines(r)) x
                  join public.chart_of_accounts a on a.id = (x ->> 'account_id')::uuid);
    end if;
    if coalesce(array_length(v_issues, 1), 0) > 0 then v_ok := false; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'entry_no', r.entry_no, 'entry_type', r.entry_type, 'status', r.status,
      'label', case r.entry_type when 'BANK' then (select name from public.chart_of_accounts where id = r.account_id)
                 when 'STOCK' then coalesce(r.item_code || ' - ', '') || coalesce(r.item_name, '') else r.party_name end,
      'amount', r.amount, 'issues', to_jsonb(v_issues), 'warnings', to_jsonb(public.erp_opening_warnings(r)),
      'lines', coalesce(v_lines, '[]'::jsonb)));
  end loop;
  return jsonb_build_object('ok', v_ok and jsonb_array_length(v_out) > 0, 'entries', v_out);
end;
$$;

-- -------------------------------------------------------------------------------------
-- 5. Post (one transaction: every entry posts or none does; posting twice is harmless)
-- -------------------------------------------------------------------------------------
create or replace function public.erp_opening_post(p_ids uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_company uuid := public.erp_opening_guard('post', true);
  r public.cnc_opening_entries;
  v_issues text[];
  v_jid uuid;
  v_mid text;
  v_old_stock numeric; v_old_rate numeric; v_new_rate numeric;
  v_done int := 0; v_skipped int := 0;
begin
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Select the entries to post'; end if;
  for r in select * from public.cnc_opening_entries where company_id = v_company and id = any(p_ids) order by opening_date, created_at for update loop
    if r.status <> 'Draft' then v_skipped := v_skipped + 1; continue; end if;
    v_issues := public.erp_opening_issues(r);
    if coalesce(array_length(v_issues, 1), 0) > 0 then
      raise exception '% (%): %', r.entry_no, coalesce(r.party_name, r.item_name, ''), array_to_string(v_issues, '; ');
    end if;

    if r.entry_type = 'STOCK' then
      -- Not posted twice even if the status was reset by hand.
      if exists (select 1 from public.cnc_stock_movements where company_id = v_company and reference_type = 'opening_entry' and reference_id = r.id::text) then
        raise exception '% already has an opening stock movement', r.entry_no;
      end if;
      select i.stock, i.rate into v_old_stock, v_old_rate from public.erp_item_info(r.company_id, r.item_kind, r.item_id) i;
      v_new_rate := case when coalesce(v_old_stock, 0) <= 0 then r.unit_cost
                         else round((v_old_stock * coalesce(v_old_rate, 0) + r.qty * r.unit_cost) / (v_old_stock + r.qty), 4) end;
      v_mid := public.erp_insert_movement(r.company_id, r.item_kind, r.item_id, 'Opening', 'IN', r.qty, r.unit_cost,
        'opening_entry', r.id::text, r.entry_no, coalesce(r.remarks, 'Opening stock'), r.opening_date, me.full_name, r.warehouse_id);
      perform public.erp_apply_item_stock(r.company_id, r.item_kind, r.item_id, v_new_rate);
      -- the stock-ledger trigger has written Dr Inventory / Cr Opening Balance Equity
      select id into v_jid from public.journal_entries
      where company_id = r.company_id and source_type = 'stock_movement' and source_id = v_mid;
      update public.cnc_opening_entries set movement_id = v_mid, journal_entry_id = v_jid where id = r.id;
    else
      v_jid := public.erp_post_system_journal(r.company_id, 'opening_entry', r.id::text, r.opening_date, 'Opening',
        'Opening balance: ' || coalesce(r.party_name, (select name from public.chart_of_accounts where id = r.account_id), ''),
        coalesce(r.invoice_ref, r.entry_no), public.erp_opening_lines(r));
      update public.cnc_opening_entries set journal_entry_id = v_jid where id = r.id;
    end if;

    update public.cnc_opening_entries set status = 'Posted', posted_by = me.full_name, posted_at = now(), updated_at = now() where id = r.id;
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('posted', v_done, 'skipped', v_skipped);
end;
$$;

-- -------------------------------------------------------------------------------------
-- 6. Reverse a posted entry (controlled correction; the original is kept)
-- -------------------------------------------------------------------------------------
create or replace function public.erp_opening_reverse(p_id uuid, p_reason text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_company uuid := public.erp_opening_guard('reverse', true);
  r public.cnc_opening_entries;
  v_lines jsonb;
  v_swap jsonb;
  v_jid uuid;
  v_mid text;
  v_stock numeric;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to reverse an opening entry'; end if;
  select * into r from public.cnc_opening_entries where id = p_id and company_id = v_company for update;
  if r.id is null then raise exception 'Opening entry not found'; end if;
  if r.status <> 'Posted' then raise exception 'Only a posted entry can be reversed (this one is %)', lower(r.status); end if;

  -- same two lines, debit and credit swapped, dated today
  v_lines := public.erp_opening_lines(r);
  select jsonb_agg(jsonb_build_object('account_id', x ->> 'account_id', 'debit', (x ->> 'credit')::numeric, 'credit', (x ->> 'debit')::numeric, 'party', x ->> 'party'))
  into v_swap from jsonb_array_elements(v_lines) x;

  if r.entry_type = 'STOCK' then
    select i.stock into v_stock from public.erp_item_info(r.company_id, r.item_kind, r.item_id) i;
    if coalesce(v_stock, 0) < r.qty then
      raise exception 'Cannot reverse: only % of % is in stock now (opening quantity was %). The stock has already been used.',
        coalesce(v_stock, 0), coalesce(r.item_name, 'the item'), r.qty;
    end if;
    -- 'Opening Reversal' has no automatic journal in the stock trigger, so the reversing journal is written below.
    v_mid := public.erp_insert_movement(r.company_id, r.item_kind, r.item_id, 'Opening Reversal', 'OUT', -r.qty, r.unit_cost,
      'opening_reversal', r.id::text, r.entry_no, 'Reversal of opening stock: ' || btrim(p_reason), public.erp_today(r.company_id), me.full_name, r.warehouse_id);
  end if;

  v_jid := public.erp_post_system_journal(r.company_id, 'opening_reversal', r.id::text, public.erp_today(r.company_id), 'Opening',
    'Reversal of opening balance ' || r.entry_no || ': ' || btrim(p_reason), r.entry_no, v_swap);

  update public.cnc_opening_entries set status = 'Reversed', reversal_journal_id = v_jid, reversal_movement_id = v_mid,
    reversed_by = me.full_name, reversed_at = now(), reverse_reason = btrim(p_reason), updated_at = now()
  where id = r.id;
  return jsonb_build_object('id', r.id, 'status', 'Reversed');
end;
$$;

-- -------------------------------------------------------------------------------------
-- 7. Read APIs
-- -------------------------------------------------------------------------------------

-- Rows + dashboard totals. Totals are summed from the saved entries of the chosen financial year (any type / status / search).
create or replace function public.erp_opening_list(
  p_type text default null, p_status text default null, p_search text default null, p_fy_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_opening_guard('view');
  v_from date; v_to date;
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows jsonb; v_sum jsonb;
begin
  if p_fy_id is not null then
    select start_date, end_date into v_from, v_to from public.financial_years where id = p_fy_id and company_id = v_company;
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
           'account_name', a.name, 'warehouse_name', w.name,
           'company_name', (select company_name from public.companies where id = e.company_id))
         order by e.opening_date desc, e.created_at desc), '[]')
  into v_rows
  from public.cnc_opening_entries e
  left join public.chart_of_accounts a on a.id = e.account_id
  left join public.cnc_warehouses w on w.id::text = e.warehouse_id and w.company_id = e.company_id
  where e.company_id = v_company
    and (v_from is null or e.opening_date between v_from and v_to)
    and (nullif(p_type, '') is null or e.entry_type = upper(p_type))
    and (nullif(p_status, '') is null or e.status = p_status)
    and (v_q is null or e.entry_no ilike '%' || v_q || '%' or e.party_name ilike '%' || v_q || '%' or e.item_name ilike '%' || v_q || '%'
         or e.item_code ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%' or e.invoice_ref ilike '%' || v_q || '%');

  select jsonb_build_object(
    'bank',       jsonb_build_object('posted', coalesce(sum(case when entry_type = 'BANK' and status = 'Posted' then case side when 'DR' then amount else -amount end end), 0),
                                     'draft',  coalesce(sum(case when entry_type = 'BANK' and status = 'Draft' then case side when 'DR' then amount else -amount end end), 0)),
    'receivable', jsonb_build_object('posted', coalesce(sum(case when entry_type = 'CUSTOMER' and status = 'Posted' then case side when 'DR' then amount else -amount end end), 0),
                                     'draft',  coalesce(sum(case when entry_type = 'CUSTOMER' and status = 'Draft' then case side when 'DR' then amount else -amount end end), 0)),
    'payable',    jsonb_build_object('posted', coalesce(sum(case when entry_type = 'SUPPLIER' and status = 'Posted' then case side when 'CR' then amount else -amount end end), 0),
                                     'draft',  coalesce(sum(case when entry_type = 'SUPPLIER' and status = 'Draft' then case side when 'CR' then amount else -amount end end), 0)),
    'stock',      jsonb_build_object('posted', coalesce(sum(case when entry_type = 'STOCK' and status = 'Posted' then amount end), 0),
                                     'draft',  coalesce(sum(case when entry_type = 'STOCK' and status = 'Draft' then amount end), 0)))
  into v_sum
  from public.cnc_opening_entries
  where company_id = v_company and (v_from is null or opening_date between v_from and v_to);

  return jsonb_build_object('rows', v_rows, 'summary', v_sum);
end;
$$;

-- Everything the entry forms pick from.
create or replace function public.erp_opening_lookups()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_opening_guard('view');
  me public.company_users := public.erp_current_user();
begin
  perform public.erp_ensure_financial_year(v_company, public.erp_today(v_company));
  return jsonb_build_object(
    'company', (select jsonb_build_object('id', c.id, 'company_name', c.company_name) from public.companies c where c.id = v_company),
    'banks', public.erp_bank_accounts_json(v_company),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'name', name) order by name), '[]')
                  from public.cnc_customers where company_id = v_company),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'name', name, 'code', code) order by name), '[]')
                  from public.cnc_suppliers where company_id = v_company),
    'warehouses', (select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'name', name, 'code', code) order by name), '[]')
                   from public.cnc_warehouses where company_id = v_company),
    'items', (select coalesce(jsonb_agg(x order by x ->> 'name'), '[]') from (
                select jsonb_build_object('kind', 'RAW', 'id', r.id::text, 'code', r.material_code, 'name', r.name, 'unit', r.uom,
                         'rate', coalesce(r.unit_price, 0), 'stock', coalesce(r.stock_qty, 0)) as x
                from public.cnc_raw_materials r where r.company_id = v_company and coalesce(r.status, 'Active') <> 'Inactive'
                union all
                select jsonb_build_object('kind', 'PART', 'id', p.id::text, 'code', p.part_no, 'name', p.part_name, 'unit', p.unit,
                         'rate', coalesce(p.unit_price, 0), 'stock', coalesce(p.stock_qty, 0))
                from public.cnc_parts p where p.company_id = v_company and coalesce(p.status, 'Active') <> 'Inactive') s),
    'financial_years', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'start_date', start_date, 'end_date', end_date, 'status', status)
                                                  order by start_date desc), '[]')
                        from public.financial_years where company_id = v_company),
    'can_manage', me.role in ('SUPER_ADMIN', 'COMPANY_ADMIN'));
end;
$$;

-- -------------------------------------------------------------------------------------
-- 8. Permissions on the functions
-- -------------------------------------------------------------------------------------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'erp_opening_save', 'erp_opening_delete', 'erp_opening_validate', 'erp_opening_post', 'erp_opening_reverse',
      'erp_opening_list', 'erp_opening_lookups')
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

commit;

-- Check: the table exists and is empty until entries are made.
select (select count(*) from public.cnc_opening_entries) as opening_entries;
