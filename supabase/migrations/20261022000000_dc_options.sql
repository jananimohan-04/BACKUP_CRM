-- Delivery Challan categories and DC processes: their own lists (not the machine Process Master), kept in the database
-- per company. The DC form shows them as dropdowns and a "+" adds a new one. Seeded with the common values.
-- Re-runnable.
begin;

create table if not exists public.cnc_dc_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
select public.erp_secure_table('cnc_dc_categories');
create unique index if not exists cnc_dc_categories_name_key on public.cnc_dc_categories (company_id, lower(name));

create table if not exists public.cnc_dc_processes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
select public.erp_secure_table('cnc_dc_processes');
create unique index if not exists cnc_dc_processes_name_key on public.cnc_dc_processes (company_id, lower(name));

insert into public.cnc_dc_categories (company_id, name)
select c.id, v.name from public.companies c
cross join (values ('After Process'), ('Cancelled'), ('Rejected'), ('Returnable'), ('REWORK'), ('SEND FOR SERVICE'), ('Sold'), ('Stock'), ('Without Process')) as v(name)
on conflict do nothing;

insert into public.cnc_dc_processes (company_id, name)
select c.id, v.name from public.companies c
cross join (values ('Anodizing'), ('Blackening'), ('CNC Machining'), ('Cutting Process'), ('Deburring'), ('Grinding'), ('Hardening'),
                   ('Heat Treatment'), ('material+machining'), ('None'), ('Polishing'), ('Surface Coating'), ('Tapping'), ('Turning Process')) as v(name)
on conflict do nothing;

commit;
