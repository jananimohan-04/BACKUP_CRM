-- Fix: ticket screenshots/videos showed as broken images.
--
-- erp_support_create_ticket used to "move" each uploaded file by renaming its row in
-- storage.objects (pending/<auth uid>/... -> <company>/<ticket>/...). That only changes the
-- metadata row; the stored file itself stays under its original key, so the renamed path
-- pointed at nothing and every signed URL returned 404.
--
-- Now the file stays where it was uploaded and the attachment row records that path.
-- Read access is granted through the attachment row (and the uploader's own prefix), so
-- company isolation is unchanged: only people who can see the ticket can read its files.
-- Re-runnable.
begin;

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
    -- Only this uploader's own pending files may be attached.
    if split_part(v_path, '/', 1) <> 'pending' or split_part(v_path, '/', 2) <> auth.uid()::text
       or v_path like '%..%' then
      raise exception 'Attachment not owned by uploader' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'support-files' and name = v_path) then
      raise exception 'Uploaded file not found';
    end if;
    insert into public.support_ticket_attachments
      (company_id, ticket_id, path, kind, mime, size_bytes, uploaded_by_name)
    values
      (v_company, v_id, v_path, v_kind, nullif(f ->> 'mime', ''),
       coalesce(nullif(f ->> 'size', '')::bigint, 0), coalesce(me.full_name, me.email));
  end loop;
  perform public.erp_support_notify(v_id, 'ticket_created',
    'New ticket ' || v_no || ': ' || left(nullif(btrim(p_subject), ''), 120), me.id);
  return jsonb_build_object('id', v_id, 'ticket_no', v_no);
end;
$$;
revoke all on function public.erp_support_create_ticket(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.erp_support_create_ticket(text, text, text, text, text, jsonb) to authenticated;

-- Reads: Super Admin; the uploader's own pending prefix; any file attached to a ticket the
-- caller can see; and demo videos / thumbnails the caller may watch.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    drop policy if exists support_files_read on storage.objects;
    create policy support_files_read on storage.objects for select to authenticated
      using (bucket_id = 'support-files' and (
        public.erp_is_super_admin()
        or ((storage.foldername(name))[1] = 'pending' and (storage.foldername(name))[2] = auth.uid()::text)
        or exists (select 1 from public.support_ticket_attachments a
                   where a.path = name and public.erp_support_can_see_ticket(a.ticket_id))
        or exists (select 1 from public.support_demo_videos v
                   where (v.video_path = name or v.thumbnail_path = name)
                     and public.erp_support_video_visible(v.id))));
  end if;
end;
$$;

commit;
