-- =====================================================================================
-- Company Profile & Business Details shared by everyone in a company
--
-- Quotation > Company Profile (address, GSTIN, phones, bank details, logo, signature, sub-companies) was kept in each
-- person's own browser, so one user saw it and another did not. It now lives here, one row per company:
--   * every user of the company reads the same profile (quotation PDFs print it)
--   * administrators, or members with the "quotations" edit grant, can save it
-- The page keeps a browser copy as a cache and uploads an existing browser copy the first time the company has none.
--
-- Safe to re-run. Nothing here drops or rewrites existing data.
-- =====================================================================================
begin;

create table if not exists public.cnc_company_profiles (
  id          uuid primary key default gen_random_uuid(),
  data        jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

select public.erp_secure_table('cnc_company_profiles');
create unique index if not exists cnc_company_profiles_company_key on public.cnc_company_profiles (company_id);
-- Written only by erp_save_company_profile below.
revoke insert, update, delete on public.cnc_company_profiles from authenticated;

-- The saved profile of the caller's company (null if none yet).
create or replace function public.erp_get_company_profile()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_company uuid;
begin
  if me.id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  v_company := public.erp_report_company();
  return (select p.data from public.cnc_company_profiles p where p.company_id = v_company);
end;
$$;

-- Creates or replaces the profile of the caller's company.
create or replace function public.erp_save_company_profile(p_data jsonb)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_company uuid;
begin
  if me.id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if me.role not in ('SUPER_ADMIN', 'COMPANY_ADMIN') and not public.erp_has_perm('quotations', 'edit') then
    raise exception 'You do not have permission to change the company profile' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or not (p_data ? 'profile') then
    raise exception 'The company profile is not in the expected format';
  end if;
  v_company := public.erp_report_company();
  insert into public.cnc_company_profiles (company_id, data, updated_by)
  values (v_company, p_data, me.full_name)
  on conflict (company_id) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

revoke all on function public.erp_get_company_profile() from public, anon;
revoke all on function public.erp_save_company_profile(jsonb) from public, anon;
grant execute on function public.erp_get_company_profile() to authenticated;
grant execute on function public.erp_save_company_profile(jsonb) to authenticated;

commit;

select (select count(*) from public.cnc_company_profiles) as company_profiles;
