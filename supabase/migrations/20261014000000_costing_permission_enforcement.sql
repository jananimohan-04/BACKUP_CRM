-- Finished Goods + Costing access control: backend enforcement.
--
-- 1) The costing report RPCs now require the Project Costing (or Product
--    Costing) view permission, in addition to the existing company scoping.
--    Frontend visibility alone must not decide who can read costing data.
-- 2) cnc_costing_sheets rows with status 'Approved' can only be written by
--    users with the costing approve permission. Draft/Calculated writes keep
--    the existing create/edit row-policy behaviour. service_role (backend jobs)
--    bypasses the approval check; every other caller is checked.
--
-- Smallest compatible change: no new tables, no new auth system, existing
-- helpers (erp_report_company, erp_has_any_perm) reused.
begin;

-- ---- 1a) Gate erp_costing_projects on costing view ----
create or replace function public.erp_costing_projects(
  p_search text default null, p_page int default 1, p_page_size int default 10
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_report_company();
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_size int := least(greatest(coalesce(p_page_size, 10), 1), 100);
  v_total int;
  v_rows jsonb;
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.erp_has_any_perm(array['project-costing','product-costing'], 'view') then
    raise exception 'Project Costing view permission is required to read costing reports.' using errcode = '42501';
  end if;
  with keys as (
    select distinct project_name, party_name, part_name
    from public.product_costing where company_id = v_company
    union
    select distinct project_name, party_name, part_name
    from public.process_costing where company_id = v_company
    union
    select w.wo_no, coalesce(w.customer, ''), w.part_name
    from public.cnc_work_orders w where w.company_id = v_company
  ),
  filtered as (
    select k.*,
      (select sum(pc.total_cost) from public.product_costing pc
       where pc.company_id = v_company and pc.project_name = k.project_name
         and pc.party_name is not distinct from k.party_name and pc.part_name is not distinct from k.part_name) as product_cost,
      (select sum(pc.total_cost) from public.process_costing pc
       where pc.company_id = v_company and pc.project_name = k.project_name
         and pc.party_name is not distinct from k.party_name and pc.part_name is not distinct from k.part_name) as process_cost,
      (select sum(round(abs(coalesce(m.qty_change, m.qty::numeric)) * coalesce(m.rate, 0), 2))
       from public.cnc_stock_movements m
       join public.cnc_material_requests mr on mr.id::text = m.reference_id and mr.company_id = v_company
       join public.cnc_work_orders w on w.company_id = v_company and w.wo_no = mr.work_order_no
       where m.company_id = v_company and m.reference_type = 'material_request'
         and (w.wo_no = k.project_name or w.sales_order = k.project_name)
         and w.part_name is not distinct from k.part_name
         and coalesce(w.customer, '') = coalesce(k.party_name, '')) as material_cost,
      (select sum(pw.total_amount) from public.planned_workings pw
       where pw.company_id = v_company and pw.project_name = k.project_name) as planned_cost,
      (select max(w.quantity) from public.cnc_work_orders w
       where w.company_id = v_company and (w.wo_no = k.project_name or w.sales_order = k.project_name)) as quantity,
      (select max(so.value) from public.cnc_sales_orders so
       where so.company_id = v_company and (so.order_no = k.project_name or exists (
         select 1 from public.cnc_work_orders w
         where w.company_id = v_company and w.sales_order = so.order_no and w.wo_no = k.project_name))) as sales_value
    from keys k
    where v_q is null or k.project_name ilike '%'||v_q||'%' or k.party_name ilike '%'||v_q||'%' or k.part_name ilike '%'||v_q||'%'
  )
  select (select count(*) from filtered),
         (select coalesce(jsonb_agg(jsonb_build_object(
            'project_name', x.project_name, 'party_name', x.party_name, 'part_name', x.part_name,
            'quantity', x.quantity::text,
            'planned_cost', x.planned_cost::text,
            'actual_cost', coalesce(x.product_cost, x.process_cost, x.material_cost)::text,
            'sales_value', x.sales_value::text,
            'profit', case when x.sales_value is not null and coalesce(x.product_cost,x.process_cost,x.material_cost) is not null
                           then (x.sales_value-coalesce(x.product_cost,x.process_cost,x.material_cost))::text else null end,
            'profit_pct', case when x.sales_value is not null and x.sales_value <> 0 and coalesce(x.product_cost,x.process_cost,x.material_cost) is not null
                               then round((x.sales_value-coalesce(x.product_cost,x.process_cost,x.material_cost))*100/x.sales_value,2)::text else null end,
            'cost_source', case when x.product_cost is not null then 'product_costing'
                                when x.process_cost is not null then 'process_costing'
                                when x.material_cost is not null then 'inventory issues' else null end
          ) order by x.project_name, x.part_name), '[]')
          from (select * from filtered order by project_name, part_name limit v_size offset (v_page-1)*v_size) x)
  into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'rows', v_rows);
end;
$$;

-- ---- 1b) Gate erp_project_costing_detail on costing view ----
create or replace function public.erp_project_costing_detail(
  p_project_name text, p_part_name text default null, p_party_name text default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_report_company();
  v_project jsonb;
  v_categories jsonb;
  v_processes jsonb;
  v_materials jsonb;
  v_work_orders jsonb;
  v_operations jsonb;
  v_sales numeric;
  v_actual numeric;
  v_material_actual numeric;
begin
  if not public.erp_has_any_perm(array['project-costing','product-costing'], 'view') then
    raise exception 'Project Costing view permission is required to read costing details.' using errcode = '42501';
  end if;
  if nullif(btrim(p_project_name), '') is null then raise exception 'Choose a project'; end if;

  select max(so.value) into v_sales
  from public.cnc_sales_orders so
  where so.company_id = v_company and (so.order_no = p_project_name or exists (
    select 1 from public.cnc_work_orders w where w.company_id = v_company
      and w.sales_order = so.order_no and w.wo_no = p_project_name));

  select sum(round(abs(coalesce(m.qty_change, m.qty::numeric)) * coalesce(m.rate, 0), 2))
  into v_material_actual
  from public.cnc_stock_movements m
  join public.cnc_material_requests mr on mr.id::text = m.reference_id and mr.company_id = v_company
  join public.cnc_work_orders w on w.company_id = v_company and w.wo_no = mr.work_order_no
  where m.company_id = v_company and m.reference_type = 'material_request'
    and (w.wo_no = p_project_name or w.sales_order = p_project_name)
    and (p_part_name is null or w.part_name is not distinct from p_part_name)
    and (p_party_name is null or w.customer is not distinct from p_party_name);

  select coalesce(
    (select sum(pc.total_cost) from public.product_costing pc
      where pc.company_id = v_company and pc.project_name = p_project_name
        and (p_part_name is null or pc.part_name is not distinct from p_part_name)
        and (p_party_name is null or pc.party_name is not distinct from p_party_name)),
    (select sum(pc.total_cost) from public.process_costing pc
      where pc.company_id = v_company and pc.project_name = p_project_name
        and (p_part_name is null or pc.part_name is not distinct from p_part_name)
        and (p_party_name is null or pc.party_name is not distinct from p_party_name)),
    v_material_actual)
  into v_actual;

  select jsonb_build_object(
    'project_name', p_project_name,
    'part_name', coalesce(p_part_name, ''),
    'party_name', coalesce(p_party_name, ''),
    'planned_cost', (select sum(pw.total_amount)::text from public.planned_workings pw
                     where pw.company_id = v_company and pw.project_name = p_project_name),
    'product_cost', (select sum(pc.total_cost)::text from public.product_costing pc
                     where pc.company_id = v_company and pc.project_name = p_project_name
                       and (p_part_name is null or pc.part_name is not distinct from p_part_name)
                       and (p_party_name is null or pc.party_name is not distinct from p_party_name)),
    'process_cost', (select sum(pc.total_cost)::text from public.process_costing pc
                     where pc.company_id = v_company and pc.project_name = p_project_name
                       and (p_part_name is null or pc.part_name is not distinct from p_part_name)
                       and (p_party_name is null or pc.party_name is not distinct from p_party_name)),
    'actual_cost', v_actual::text,
    'cost_source', case
      when exists (select 1 from public.product_costing pc where pc.company_id=v_company and pc.project_name=p_project_name
                   and (p_part_name is null or pc.part_name is not distinct from p_part_name)
                   and (p_party_name is null or pc.party_name is not distinct from p_party_name)) then 'product_costing'
      when exists (select 1 from public.process_costing pc where pc.company_id=v_company and pc.project_name=p_project_name
                   and (p_part_name is null or pc.part_name is not distinct from p_part_name)
                   and (p_party_name is null or pc.party_name is not distinct from p_party_name)) then 'process_costing'
      when v_material_actual is not null then 'inventory issues' else null end,
    'sales_value', v_sales::text,
    'profit', case when v_sales is not null and v_actual is not null then (v_sales-v_actual)::text else null end,
    'profit_pct', case when v_sales is not null and v_sales <> 0 and v_actual is not null
                       then round((v_sales-v_actual)*100/v_sales,2)::text else null end,
    'invoice_value', (select coalesce(sum(i.amount),0)::text from public.cnc_invoices i
                      where i.company_id = v_company and i.sales_order_id in (
                        select so.id::text from public.cnc_sales_orders so where so.company_id = v_company
                          and (so.order_no = p_project_name or exists (
                            select 1 from public.cnc_work_orders w where w.company_id=v_company
                              and w.sales_order=so.order_no and w.wo_no=p_project_name)))
                      and not i.cancelled and i.invoice_type = 'Sales Invoice')
  ) into v_project;

  if exists (select 1 from public.product_costing pc where pc.company_id=v_company and pc.project_name=p_project_name
             and (p_part_name is null or pc.part_name is not distinct from p_part_name)
             and (p_party_name is null or pc.party_name is not distinct from p_party_name)) then
    select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'amount', c.amount::text) order by c.category), '[]')
    into v_categories
    from (select pc.category, sum(pc.total_cost) amount from public.product_costing pc
          where pc.company_id=v_company and pc.project_name=p_project_name
            and (p_part_name is null or pc.part_name is not distinct from p_part_name)
            and (p_party_name is null or pc.party_name is not distinct from p_party_name)
          group by pc.category) c;
  elsif exists (select 1 from public.process_costing pc where pc.company_id=v_company and pc.project_name=p_project_name
                and (p_part_name is null or pc.part_name is not distinct from p_part_name)
                and (p_party_name is null or pc.party_name is not distinct from p_party_name)) then
    select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'amount', c.amount::text) order by c.category), '[]')
    into v_categories
    from (select pc.process_name category, sum(pc.total_cost) amount from public.process_costing pc
          where pc.company_id=v_company and pc.project_name=p_project_name
            and (p_part_name is null or pc.part_name is not distinct from p_part_name)
            and (p_party_name is null or pc.party_name is not distinct from p_party_name)
          group by pc.process_name) c;
  else
    select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'amount', c.amount::text) order by c.category), '[]')
    into v_categories
    from (select m.material category,
                 sum(round(abs(coalesce(m.qty_change, m.qty::numeric))*coalesce(m.rate,0),2)) amount
          from public.cnc_stock_movements m
          join public.cnc_material_requests mr on mr.id::text=m.reference_id and mr.company_id=v_company
          join public.cnc_work_orders w on w.company_id=v_company and w.wo_no=mr.work_order_no
          where m.company_id=v_company and m.reference_type='material_request'
            and (w.wo_no=p_project_name or w.sales_order=p_project_name)
            and (p_part_name is null or w.part_name is not distinct from p_part_name)
            and (p_party_name is null or w.customer is not distinct from p_party_name)
          group by m.material) c;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pc.id::text, 'process', pc.process_name, 'supplier', pc.party_name,
    'duration', pc.duration::text, 'quantity', pc.quantity::text,
    'rate', pc.process_cost::text, 'amount', pc.total_cost::text, 'created_at', pc.created_at)
    order by pc.created_at, pc.process_name), '[]')
  into v_processes
  from public.process_costing pc
  where pc.company_id = v_company and pc.project_name = p_project_name
    and (p_part_name is null or pc.part_name is not distinct from p_part_name)
    and (p_party_name is null or pc.party_name is not distinct from p_party_name);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id::text, 'date', m.date, 'type', m.type, 'reference', coalesce(m.reference_no, m.reference),
    'item', m.material, 'quantity', coalesce(m.qty_change, m.qty::numeric)::text, 'unit', m.uom,
    'rate', m.rate::text, 'amount', round(abs(coalesce(m.qty_change, m.qty::numeric))*coalesce(m.rate,0),2)::text,
    'work_order', mr.work_order_no, 'request_no', mr.request_no)
    order by m.date, m.created_at), '[]')
  into v_materials
  from public.cnc_stock_movements m
  join public.cnc_material_requests mr
    on mr.id::text = m.reference_id and mr.company_id = v_company
  join public.cnc_work_orders w
    on w.company_id = v_company and w.wo_no = mr.work_order_no
  where m.company_id = v_company and m.reference_type = 'material_request'
    and (w.wo_no = p_project_name or w.sales_order = p_project_name);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id::text, 'wo_no', w.wo_no, 'sales_order', w.sales_order, 'customer', w.customer,
    'part_name', w.part_name, 'part_no', w.part_no, 'quantity', w.quantity::text,
    'completed', w.completed::text, 'rejected', w.rejected::text, 'status', w.status,
    'due_date', w.due_date)
    order by w.created_at), '[]')
  into v_work_orders
  from public.cnc_work_orders w
  where w.company_id = v_company and (w.wo_no = p_project_name or w.sales_order = p_project_name);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', jc.id::text, 'job_no', jc.job_no, 'operation', jc.operation, 'machine', jc.machine,
    'operator', jc.operator, 'qty_planned', jc.qty_planned::text, 'qty_completed', jc.qty_completed::text,
    'qty_rejected', jc.qty_rejected::text, 'cycle_time', jc.cycle_time::text,
    'setup_time', jc.setup_time::text, 'status', jc.status)
    order by jc.op_no, jc.created_at), '[]')
  into v_operations
  from public.cnc_job_cards jc
  join public.cnc_work_orders w on w.company_id = v_company and w.wo_no = jc.work_order
  where jc.company_id = v_company and (w.wo_no = p_project_name or w.sales_order = p_project_name);

  return jsonb_build_object('project', v_project, 'categories', coalesce(v_categories,'[]'),
    'processes', v_processes, 'materials', v_materials, 'work_orders', v_work_orders,
    'operations', v_operations);
end;
$$;

-- Grants unchanged (already authenticated-only from the original migration).
revoke all on function public.erp_costing_projects(text,int,int) from public, anon;
revoke all on function public.erp_project_costing_detail(text,text,text) from public, anon;
grant execute on function public.erp_costing_projects(text,int,int) to authenticated;
grant execute on function public.erp_project_costing_detail(text,text,text) to authenticated;

-- ---- 2) Approval gate for costing sheets ----
-- An 'Approved' version may only be written by a caller holding the costing
-- approve permission. Draft/Calculated writes keep existing row-policy rules.
create or replace function public.erp_enforce_costing_approval()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(new.status, '') = 'Approved' then
    if coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') = 'service_role' then
      return new;
    end if;
    if not public.erp_has_any_perm(array['project-costing','product-costing'], 'approve') then
      raise exception 'Project Costing approve permission is required to save an Approved costing version.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.erp_enforce_costing_approval() from public, anon, authenticated;

drop trigger if exists trg_costing_approval on public.cnc_costing_sheets;
create trigger trg_costing_approval
before insert or update on public.cnc_costing_sheets
for each row execute function public.erp_enforce_costing_approval();

commit;
