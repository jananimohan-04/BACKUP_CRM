-- Inward "EXPENSES" now count as company expenses in the books (so they appear in Profit & Loss),
-- and a petty cash option records expenses a company member paid out of pocket, to be reimbursed at month end.
--
--  * cnc_inwards gets petty_cash, paid_by and settled_at.
--  * Each EXPENSES inward, and any inward marked petty cash, posts one journal entry. Expenses:
--        Dr  Company Expenses (5xxx, an EXPENSE account -> shows in Profit & Loss)
--        Cr  Trade Payables           when the company is to pay the vendor (party = the Company field), or
--        Cr  Payable to Members       when petty cash (party = the member who paid)
--    Editing or deleting the inward rewrites / removes its journal. A Deleted inward posts nothing.
--    A non-expense inward paid by a member: Dr Trade Payables, Cr Payable to Members.
--  * Paying a member back (Petty Cash Entry page) debits Payable to Members, clearing what is owed.
-- Re-runnable.
begin;

alter table public.cnc_inwards
  add column if not exists petty_cash boolean not null default false,
  add column if not exists paid_by text,
  add column if not exists settled_at timestamptz;

-- Creates a system ledger account for a company on first use (code is bumped if it is already taken).
create or replace function public.erp_ensure_account(
  p_company uuid, p_key text, p_code text, p_name text, p_type text, p_parent_code text, p_sort int)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_code text := p_code;
begin
  select id into v_id from public.chart_of_accounts where company_id = p_company and system_key = p_key;
  if v_id is not null then return v_id; end if;
  while exists (select 1 from public.chart_of_accounts where company_id = p_company and code = v_code) loop
    v_code := (v_code::int + 1)::text;
  end loop;
  insert into public.chart_of_accounts (company_id, code, name, account_type, bs_class, is_group, system_key, sort_order, parent_id)
  values (p_company, v_code, p_name, p_type, null, false, p_key, p_sort,
          (select id from public.chart_of_accounts where company_id = p_company and code = p_parent_code limit 1))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.erp_ensure_account(uuid, text, text, text, text, text, int) from public, anon, authenticated;

create or replace function public.erp_post_inward_expense()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_amount numeric;
  v_date date;
  v_credit text;
  v_party text;
  v_what text;
begin
  if tg_op = 'DELETE' then
    delete from public.journal_entries
    where company_id = old.company_id and source_type = 'inward_expense' and source_id = old.id::text;
    return old;
  end if;

  v_date := coalesce(new.inward_date::date, new.created_at::date, public.erp_today());
  -- Only two kinds of inward post here: an EXPENSES inward, and ANY inward a member paid for out of pocket (petty cash).
  -- Everything else is posted by its own module (purchases by the goods receipt, and so on).
  if coalesce(new.status, '') = 'Deleted'
     or (upper(btrim(coalesce(new.category, ''))) <> 'EXPENSES' and not coalesce(new.petty_cash, false)) then
    perform public.erp_post_system_journal(new.company_id, 'inward_expense', new.id::text, v_date, 'Journal', null, null, null);
    return new;
  end if;

  v_amount := round(coalesce(new.total_amount::numeric, 0), 2);

  -- A purchase / service / other inward paid by a member: the vendor is settled by the member, so the
  -- company now owes the member instead of the vendor (Dr Trade Payables, Cr Payable to Members).
  if upper(btrim(coalesce(new.category, ''))) <> 'EXPENSES' then
    perform public.erp_ensure_account(new.company_id, 'MEMBER_PAYABLE', '2545', 'Payable to Members (Petty Cash)', 'LIABILITY', '2500', 52);
    v_party := coalesce(nullif(btrim(new.paid_by), ''), 'Member');
    perform public.erp_post_system_journal(new.company_id, 'inward_expense', new.id::text, v_date, 'Journal',
      'Paid by member: ' || coalesce(nullif(btrim(new.product_name), ''), nullif(btrim(new.part_name), ''), 'Inward') || ' — ' || v_party || ' (petty cash)',
      coalesce(new.reference_no, new.inward_no),
      jsonb_build_array(
        jsonb_build_object('key', 'TRADE_PAYABLES', 'debit', v_amount, 'party', nullif(btrim(coalesce(new.party_name, '')), '')),
        jsonb_build_object('key', 'MEMBER_PAYABLE', 'credit', v_amount, 'party', v_party)));
    return new;
  end if;
  perform public.erp_ensure_account(new.company_id, 'COMPANY_EXPENSES', '5950', 'Company Expenses', 'EXPENSE', '5000', 88);
  if coalesce(new.petty_cash, false) then
    perform public.erp_ensure_account(new.company_id, 'MEMBER_PAYABLE', '2545', 'Payable to Members (Petty Cash)', 'LIABILITY', '2500', 52);
    v_credit := 'MEMBER_PAYABLE';
    v_party := coalesce(nullif(btrim(new.paid_by), ''), 'Member');
  else
    v_credit := 'TRADE_PAYABLES';
    v_party := nullif(btrim(coalesce(new.party_name, '')), '');
  end if;
  v_what := coalesce(nullif(btrim(new.product_name), ''), nullif(btrim(new.part_name), ''), 'Expense');

  perform public.erp_post_system_journal(new.company_id, 'inward_expense', new.id::text, v_date, 'Journal',
    'Expense: ' || v_what || coalesce(' — ' || v_party, '') || case when coalesce(new.petty_cash, false) then ' (petty cash)' else '' end,
    coalesce(new.reference_no, new.inward_no),
    jsonb_build_array(
      jsonb_build_object('key', 'COMPANY_EXPENSES', 'debit', v_amount),
      jsonb_build_object('key', v_credit, 'credit', v_amount, 'party', v_party)));
  return new;
end;
$$;
revoke all on function public.erp_post_inward_expense() from public, anon, authenticated;

drop trigger if exists zz_erp_post_inward_expense on public.cnc_inwards;
create trigger zz_erp_post_inward_expense after insert or update or delete on public.cnc_inwards
  for each row execute function public.erp_post_inward_expense();

-- Post the expenses that were entered before this migration (a closed year or a bad row never stops the migration).
do $$
declare r record;
begin
  for r in select id from public.cnc_inwards where (upper(btrim(coalesce(category, ''))) = 'EXPENSES' or petty_cash) and coalesce(status, '') <> 'Deleted' loop
    begin
      update public.cnc_inwards set status = status where id = r.id;
    exception when others then
      raise notice 'Expense % not posted: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

commit;
