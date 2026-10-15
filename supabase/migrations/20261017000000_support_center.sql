-- Support Center (tickets, replies, demo videos, notifications).
-- Tables, RLS, storage bucket, RPCs and permission seeds. No existing
-- workflows are touched. Frontend keys: module 'support' (see
-- src/config/permissions.ts), pages support/center.
begin;

-- --------------------------------------------------------------------------
-- 1. Tables (company_id is added by erp_secure_table, except where noted)
-- --------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id                uuid primary key default gen_random_uuid(),
  ticket_no         text not null,
  subject           text not null,
  module            text not null default '',
  issue_type        text not null default 'Other'
    check (issue_type in ('Bug', 'Access Issue', 'Calculation Issue', 'Feature Request', 'Other')),
  priority          text not null default 'Medium'
    check (priority in ('Low', 'Medium', 'High', 'Critical')),
  description       text not null default '',
  status            text not null default 'Open'
    check (status in ('Open', 'In Review', 'Need Information', 'In Progress', 'Resolved', 'Closed')),
  created_by_user_id uuid,
  created_by_name   text,
  resolution        text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.support_ticket_comments (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references public.support_tickets(id) on delete cascade,
  body              text not null,
  is_internal       boolean not null default false,
  is_system         boolean not null default false,
  author_user_id    uuid,
  author_name       text,
  created_at        timestamptz not null default now()
);

create table if not exists public.support_ticket_attachments (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references public.support_tickets(id) on delete cascade,
  path              text not null,
  kind              text not null default 'file'
    check (kind in ('original', 'annotated', 'video', 'file')),
  mime              text,
  size_bytes        bigint not null default 0,
  uploaded_by_name  text,
  created_at        timestamptz not null default now()
);

-- Demo videos are global (Super Admin publishes for every company).
create table if not exists public.support_demo_videos (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text not null default '',
  module            text not null default '',
  thumbnail_path    text,
  video_path        text,
  published         boolean not null default false,
  published_at      timestamptz,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Recipient-scoped (Super Admins have no company, so no company scoping here).
create table if not exists public.support_notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null,
  ticket_id         uuid references public.support_tickets(id) on delete cascade,
  kind              text not null default 'reply',
  text              text not null default '',
  is_read           boolean not null default false,
  created_at        timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 2. Tenancy + RLS. Ticket tables follow the standard helper, then swap the
-- company-only policy for ownership-aware ones. Writes go through RPCs, so
-- direct insert/update/delete are revoked (same pattern as invoice items).
-- --------------------------------------------------------------------------
select public.erp_secure_table('support_tickets');
select public.erp_secure_table('support_ticket_comments');
select public.erp_secure_table('support_ticket_attachments');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_company_no_key') then
    alter table public.support_tickets
      add constraint support_tickets_company_no_key unique (company_id, ticket_no);
  end if;
end;
$$;

drop policy if exists erp_company_isolation on public.support_tickets;
drop policy if exists erp_company_isolation on public.support_ticket_comments;
drop policy if exists erp_company_isolation on public.support_ticket_attachments;

-- Shared visibility: own company + support view + (creator | company admin | super admin).
create or replace function public.erp_support_can_see_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket_id
      and t.company_id = any (public.erp_visible_company_ids())
      and public.erp_has_any_perm(array['support'], 'view')
      and (
        t.created_by_user_id = (select (public.erp_current_user()).id)
        or (select (public.erp_current_user()).role) = 'COMPANY_ADMIN'
        or public.erp_is_super_admin()
      )
  );
$fn$;
revoke all on function public.erp_support_can_see_ticket(uuid) from public, anon, authenticated;
grant execute on function public.erp_support_can_see_ticket(uuid) to authenticated;

drop policy if exists support_tickets_select on public.support_tickets;
drop policy if exists support_comments_select on public.support_ticket_comments;
drop policy if exists support_attachments_select on public.support_ticket_attachments;
create policy support_tickets_select on public.support_tickets
  for select to authenticated using (public.erp_support_can_see_ticket(id));
create policy support_comments_select on public.support_ticket_comments
  for select to authenticated using (
    exists (select 1 from public.support_tickets t where t.id = ticket_id)
    and (not is_internal
         or (select (public.erp_current_user()).role) in ('COMPANY_ADMIN', 'SUPER_ADMIN')));
create policy support_attachments_select on public.support_ticket_attachments
  for select to authenticated using (
    exists (select 1 from public.support_tickets t where t.id = ticket_id));

-- All writes through RPCs (which enforce transitions, ownership and the
-- internal-note rule). Direct writes stay revoked.
revoke insert, update, delete on public.support_tickets from authenticated;
revoke insert, update, delete on public.support_ticket_comments from authenticated;
revoke insert, update, delete on public.support_ticket_attachments from authenticated;

-- Demo videos: reads = published (+support view) or super admin; writes = super admin only.
alter table public.support_demo_videos enable row level security;
drop policy if exists support_videos_select on public.support_demo_videos;
drop policy if exists support_videos_write on public.support_demo_videos;
create policy support_videos_select on public.support_demo_videos
  for select to authenticated using (
    (published and public.erp_has_any_perm(array['support'], 'view'))
    or public.erp_is_super_admin());
create policy support_videos_write on public.support_demo_videos
  for all to authenticated
  using (public.erp_is_super_admin()) with check (public.erp_is_super_admin());
revoke all on public.support_demo_videos from public, anon;
grant select, insert, update, delete on public.support_demo_videos to authenticated;

-- Notifications: recipients read/mark their own; rows are written by RPCs/triggers only.
alter table public.support_notifications enable row level security;
drop policy if exists support_notifications_select on public.support_notifications;
drop policy if exists support_notifications_update on public.support_notifications;
create policy support_notifications_select on public.support_notifications
  for select to authenticated using (
    recipient_user_id = (select (public.erp_current_user()).id)
    and public.erp_has_any_perm(array['support'], 'view'));
create policy support_notifications_update on public.support_notifications
  for update to authenticated
  using (recipient_user_id = (select (public.erp_current_user()).id))
  with check (recipient_user_id = (select (public.erp_current_user()).id));
revoke all on public.support_notifications from public, anon;
grant select, update on public.support_notifications to authenticated;

-- Keep the module map truthful (used by admin tooling).
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
    when 'cnc_work_orders'             then array['production', 'finished-goods', 'scheduling']
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
    when 'support_tickets'            then array['support']
    when 'support_ticket_comments'    then array['support']
    when 'support_ticket_attachments' then array['support']
    when 'support_demo_videos'        then array['support']
    when 'support_notifications'      then array['support']
    else array[]::text[]
  end;
$fn$;
revoke all on function public.erp_table_modules(text) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. Private storage bucket. Ticket files live under
-- <company_id>/<ticket_id>/..., in-flight uploads under pending/<auth_uid>/...,
-- videos under videos/.... Reads inherit ticket/video visibility.
-- --------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public) values ('support-files', 'support-files', false)
    on conflict (id) do nothing;
    drop policy if exists support_files_read on storage.objects;
    drop policy if exists support_files_write on storage.objects;
    drop policy if exists support_files_update on storage.objects;
    drop policy if exists support_files_delete on storage.objects;
    create policy support_files_read on storage.objects for select to authenticated
      using (bucket_id = 'support-files' and (
        public.erp_is_super_admin()
        or exists (select 1 from public.support_tickets t
                   where t.id::text = (storage.foldername(name))[2]
                     and t.company_id::text = (storage.foldername(name))[1])
        or exists (select 1 from public.support_demo_videos v
                   where (v.video_path = name or v.thumbnail_path = name)
                     and (v.published or public.erp_is_super_admin()))));
    -- Users upload only into their own pending prefix; super admins manage videos/.
    create policy support_files_write on storage.objects for insert to authenticated
      with check (bucket_id = 'support-files' and (
        ((storage.foldername(name))[1] = 'pending'
         and (storage.foldername(name))[2] = auth.uid()::text)
        or (public.erp_is_super_admin()
            and (storage.foldername(name))[1] = 'videos')));
    create policy support_files_update on storage.objects for update to authenticated
      using (bucket_id = 'support-files' and (
        ((storage.foldername(name))[1] = 'pending'
         and (storage.foldername(name))[2] = auth.uid()::text)
        or public.erp_is_super_admin()));
    create policy support_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'support-files' and (
        ((storage.foldername(name))[1] = 'pending'
         and (storage.foldername(name))[2] = auth.uid()::text)
        or public.erp_is_super_admin()));
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- 4. RPCs. SECURITY DEFINER so they can move storage objects, resolve ticket
-- numbers and fan out notifications; every one re-checks the caller.
-- --------------------------------------------------------------------------
create or replace function public.erp_support_notify(p_ticket_id uuid, p_kind text, p_text text, p_actor uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t_company uuid;
  t_creator uuid;
begin
  select company_id, created_by_user_id into t_company, t_creator
  from public.support_tickets where id = p_ticket_id;
  if not found then return; end if;
  insert into public.support_notifications (recipient_user_id, ticket_id, kind, text)
  select distinct u.id, p_ticket_id, p_kind, p_text
  from public.company_users u
  where u.status = 'Active'
    and u.id <> coalesce(p_actor, '00000000-0000-0000-0000-000000000000')
    and (u.id = t_creator
         or (u.role = 'COMPANY_ADMIN' and u.company_id = t_company)
         or u.role = 'SUPER_ADMIN');
end;
$$;
revoke all on function public.erp_support_notify(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.erp_support_create_ticket(
  p_subject text, p_module text default '', p_issue_type text default 'Other',
  p_priority text default 'Medium', p_description text default '', p_files jsonb default '[]')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_company uuid := public.erp_report_company();
  v_no text;
  v_id uuid;
  f jsonb;
  v_path text;
  v_kind text;
  v_rest text;
  v_new text;
begin
  if me.id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not public.erp_has_any_perm(array['support'], 'create') then
    raise exception 'Support Center create permission is required to raise a ticket.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_subject, '')), '') is null then raise exception 'Subject is required'; end if;
  v_no := public.erp_next_number(v_company, 'public.support_tickets', 'ticket_no', 'TKT');
  insert into public.support_tickets
    (company_id, ticket_no, subject, module, issue_type, priority, description, status, created_by_user_id, created_by_name)
  values
    (v_company, v_no, btrim(p_subject), nullif(btrim(coalesce(p_module, '')), ''),
     coalesce(nullif(p_issue_type, ''), 'Other'), coalesce(nullif(p_priority, ''), 'Medium'),
     coalesce(p_description, ''), 'Open', me.id, coalesce(me.full_name, me.email))
  returning id into v_id;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]')) loop
    v_path := nullif(f ->> 'path', '');
    v_kind := coalesce(nullif(f ->> 'kind', ''), 'file');
    if v_path is null then continue; end if;
    if v_kind not in ('original', 'annotated', 'video', 'file') then
      raise exception 'Bad attachment kind';
    end if;
    -- Only this uploader's own pending files may be attached (company comes
    -- from the account, never from the form).
    if split_part(v_path, '/', 1) <> 'pending' or split_part(v_path, '/', 2) <> auth.uid()::text then
      raise exception 'Attachment not owned by uploader' using errcode = '42501';
    end if;
    v_rest := regexp_replace(v_path, '^pending/[^/]+/', '');
    if v_rest is null or v_rest = '' or v_rest like '%..%' then
      raise exception 'Bad attachment path';
    end if;
    v_new := v_company::text || '/' || v_id::text || '/' || v_rest;
    update storage.objects set name = v_new
    where bucket_id = 'support-files' and name = v_path;
    if not found then raise exception 'Uploaded file not found'; end if;
    insert into public.support_ticket_attachments
      (company_id, ticket_id, path, kind, mime, size_bytes, uploaded_by_name)
    values
      (v_company, v_id, v_new, v_kind, nullif(f ->> 'mime', ''),
       coalesce(nullif(f ->> 'size', '')::bigint, 0), coalesce(me.full_name, me.email));
  end loop;
  perform public.erp_support_notify(v_id, 'ticket_created',
    'New ticket ' || v_no || ': ' || left(nullif(btrim(p_subject), ''), 120), me.id);
  return jsonb_build_object('id', v_id, 'ticket_no', v_no);
end;
$$;
revoke all on function public.erp_support_create_ticket(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.erp_support_create_ticket(text, text, text, text, text, jsonb) to authenticated;

create or replace function public.erp_support_add_comment(
  p_ticket uuid, p_body text, p_internal boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_id uuid;
  v_admin boolean;
begin
  if me.id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not public.erp_support_can_see_ticket(p_ticket) then
    raise exception 'Ticket not found or not visible' using errcode = '42501';
  end if;
  if not public.erp_has_any_perm(array['support'], 'create') then
    raise exception 'Support Center create permission is required to reply.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then raise exception 'Reply text is required'; end if;
  v_admin := me.role in ('COMPANY_ADMIN', 'SUPER_ADMIN');
  if coalesce(p_internal, false) and not v_admin then
    raise exception 'Only administrators can write internal notes' using errcode = '42501';
  end if;
  insert into public.support_ticket_comments
    (company_id, ticket_id, body, is_internal, is_system, author_user_id, author_name)
  values
    ((select company_id from public.support_tickets where id = p_ticket),
     p_ticket, p_body, coalesce(p_internal, false), false, me.id, coalesce(me.full_name, me.email))
  returning id into v_id;
  perform public.erp_support_notify(p_ticket, 'reply',
    'New reply on ticket: ' || left(nullif(btrim(p_body), ''), 120), me.id);
  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function public.erp_support_add_comment(uuid, text, boolean) from public, anon;
grant execute on function public.erp_support_add_comment(uuid, text, boolean) to authenticated;

create or replace function public.erp_support_set_status(
  p_ticket uuid, p_status text, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  t public.support_tickets;
  v_admin boolean;
  v_msg text;
begin
  if me.id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_status not in ('Open', 'In Review', 'Need Information', 'In Progress', 'Resolved', 'Closed') then
    raise exception 'Unknown status';
  end if;
  select * into t from public.support_tickets where id = p_ticket;
  if t.id is null or not public.erp_support_can_see_ticket(p_ticket) then
    raise exception 'Ticket not found or not visible' using errcode = '42501';
  end if;
  v_admin := me.role = 'SUPER_ADMIN'
    or (me.role = 'COMPANY_ADMIN' and me.company_id = t.company_id);
  if not v_admin then
    -- Creators may only confirm a resolution or reopen a closed ticket.
    if not (t.created_by_user_id = me.id
            and ((t.status = 'Resolved' and p_status = 'Closed')
                 or (t.status = 'Closed' and p_status = 'Open'))) then
      raise exception 'Only administrators can change ticket status' using errcode = '42501';
    end if;
  end if;
  if t.status = p_status then
    return jsonb_build_object('id', t.id, 'status', t.status);
  end if;
  update public.support_tickets
  set status = p_status,
      resolved_at = case when p_status = 'Resolved' then now() else resolved_at end,
      resolution = case when p_status = 'Resolved' then nullif(p_note, '') else resolution end,
      updated_at = now()
  where id = p_ticket;
  v_msg := 'Status changed from ' || t.status || ' to ' || p_status || ' by ' || coalesce(me.full_name, me.email) || '.';
  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    v_msg := v_msg || ' Note: ' || btrim(p_note);
  end if;
  insert into public.support_ticket_comments
    (company_id, ticket_id, body, is_internal, is_system, author_user_id, author_name)
  values (t.company_id, p_ticket, v_msg, false, true, me.id, coalesce(me.full_name, me.email));
  perform public.erp_support_notify(p_ticket, 'status', v_msg, me.id);
  return jsonb_build_object('id', t.id, 'status', p_status);
end;
$$;
revoke all on function public.erp_support_set_status(uuid, text, text) from public, anon;
grant execute on function public.erp_support_set_status(uuid, text, text) to authenticated;

-- --------------------------------------------------------------------------
-- 5. Seed: every active member can raise and track tickets immediately.
-- Admins already bypass through their role. New users are granted by hand.
-- --------------------------------------------------------------------------
insert into public.user_module_permissions (user_id, module_key, can_view, can_create)
select u.id, 'support', true, true
from public.company_users u
where u.role = 'USER' and u.status = 'Active'
on conflict (user_id, module_key) do nothing;

commit;
