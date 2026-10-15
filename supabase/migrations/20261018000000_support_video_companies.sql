-- Demo videos: the Super Admin chooses which companies see each video.
-- all_companies = true  -> every company sees it (default, matches the earlier behaviour)
-- all_companies = false -> only the companies listed in support_video_companies.
-- Re-runnable: every statement is guarded.
begin;

alter table public.support_demo_videos
  add column if not exists all_companies boolean not null default true;

create table if not exists public.support_video_companies (
  video_id   uuid not null references public.support_demo_videos(id) on delete cascade,
  company_id uuid not null,
  primary key (video_id, company_id)
);

alter table public.support_video_companies enable row level security;
drop policy if exists support_video_companies_select on public.support_video_companies;
drop policy if exists support_video_companies_write on public.support_video_companies;
-- Members see only their own company's rows (needed by the video policy below); Super Admin sees all.
create policy support_video_companies_select on public.support_video_companies
  for select to authenticated using (
    public.erp_is_super_admin()
    or company_id = any (public.erp_visible_company_ids()));
create policy support_video_companies_write on public.support_video_companies
  for all to authenticated
  using (public.erp_is_super_admin()) with check (public.erp_is_super_admin());
revoke all on public.support_video_companies from public, anon;
grant select, insert, update, delete on public.support_video_companies to authenticated;

-- Shared visibility rule, used by the table policy and the storage policy.
create or replace function public.erp_support_video_visible(p_video_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select exists (
    select 1 from public.support_demo_videos v
    where v.id = p_video_id
      and (
        public.erp_is_super_admin()
        or (
          v.published
          and public.erp_has_any_perm(array['support'], 'view')
          and (
            v.all_companies
            or exists (
              select 1 from public.support_video_companies c
              where c.video_id = v.id
                and c.company_id = any (public.erp_visible_company_ids())
            )
          )
        )
      )
  );
$fn$;
revoke all on function public.erp_support_video_visible(uuid) from public, anon, authenticated;
grant execute on function public.erp_support_video_visible(uuid) to authenticated;

drop policy if exists support_videos_select on public.support_demo_videos;
create policy support_videos_select on public.support_demo_videos
  for select to authenticated using (public.erp_support_video_visible(id));

-- Storage: a video or thumbnail file is readable exactly when its video row is visible.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    drop policy if exists support_files_read on storage.objects;
    create policy support_files_read on storage.objects for select to authenticated
      using (bucket_id = 'support-files' and (
        public.erp_is_super_admin()
        or exists (select 1 from public.support_tickets t
                   where t.id::text = (storage.foldername(name))[2]
                     and t.company_id::text = (storage.foldername(name))[1])
        or exists (select 1 from public.support_demo_videos v
                   where (v.video_path = name or v.thumbnail_path = name)
                     and public.erp_support_video_visible(v.id))));
  end if;
end;
$$;

commit;
