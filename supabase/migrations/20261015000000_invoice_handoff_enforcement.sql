-- Delivery Challan → Invoice handoff: backend enforcement.
--
-- 1) erp_save_invoice now enforces module permissions: inserts need the
--    Invoice create permission, updates need the Invoice edit permission.
--    (Credit notes insert through the same path, so they need create.)
--    Reads (erp_invoices / erp_invoice / erp_invoices_summary) need Invoice view.
--    Company scoping and all calculations are unchanged.
-- 2) Idempotency backstop: at most one non-Proforma invoice per delivery row.
--    Created only when existing data is clean; otherwise a notice is raised
--    and the app-level guards (Billed status + pre-commit re-check) apply.
-- 3) The "Ready for Invoice" handoff state lives in cnc_deliveries.status
--    (free text, no schema change). Setting it is an update on cnc_deliveries,
--    already gated by the existing delivery-module edit row policy — no new
--    permission table, no new auth system.
begin;

-- ---- 1) Gate erp_save_invoice on create (insert) / edit (update) ----
create or replace function public.erp_save_invoice(p_invoice jsonb, p_items jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.company_users := public.erp_current_user();
  v_company uuid := public.erp_report_company();
  co public.companies;
  v_id text := nullif(p_invoice ->> 'id', '');
  v_existing public.cnc_invoices;
  v_type text := coalesce(nullif(p_invoice ->> 'invoice_type', ''), 'Sales Invoice');
  v_pos text := nullif(p_invoice ->> 'place_of_supply', '');
  v_intra boolean;
  l jsonb;
  n int := 0;
  v_basic numeric := 0; v_disc numeric := 0; v_taxable numeric := 0; v_tax numeric := 0;
  v_line_taxable numeric; v_line_tax numeric; v_rate numeric;
  v_total numeric; v_round numeric; v_no text;
begin
  if me.id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if v_id is null and not public.erp_has_any_perm(array['invoices'], 'create') then
    raise exception 'Invoice create permission is required to create an invoice.' using errcode = '42501';
  end if;
  if v_id is not null and not public.erp_has_any_perm(array['invoices'], 'edit') then
    raise exception 'Invoice edit permission is required to modify an invoice.' using errcode = '42501';
  end if;
  select * into co from public.companies where id = v_company;
  v_intra := v_pos is null or co.state_code is null or v_pos = co.state_code;   -- same state → CGST+SGST, else IGST

  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one line item'; end if;

  if v_id is not null then
    select * into v_existing from public.cnc_invoices where id::text = v_id and company_id = v_company;
    if v_existing.id is null then raise exception 'Invoice not found'; end if;
    if v_existing.cancelled then raise exception 'A cancelled invoice cannot be edited'; end if;
    if public.erp_invoice_received(v_company, v_id) <> 0 then raise exception 'This invoice already has receipts; edit is blocked. Raise a credit note instead.'; end if;
  end if;

  -- Compute totals from the lines.
  for l in select * from jsonb_array_elements(p_items) loop
    v_rate := coalesce(nullif(l ->> 'gst_rate', '')::numeric, co.default_gst_rate);
    v_line_taxable := round(coalesce((l->>'quantity')::numeric,0) * coalesce((l->>'rate')::numeric,0)
                      * (1 - coalesce(nullif(l->>'discount_pct','')::numeric,0)/100), 2);
    v_line_tax := round(v_line_taxable * v_rate / 100, 2);
    v_basic := v_basic + round(coalesce((l->>'quantity')::numeric,0) * coalesce((l->>'rate')::numeric,0), 2);
    v_taxable := v_taxable + v_line_taxable;
    v_tax := v_tax + v_line_tax;
    n := n + 1;
  end loop;
  v_disc := round(v_basic - v_taxable, 2);
  v_total := v_taxable + v_tax;
  v_round := round(v_total) - v_total;
  v_total := round(v_total);

  v_no := coalesce(nullif(p_invoice ->> 'invoice_no', ''), v_existing.invoice_no,
                   public.erp_next_number(v_company, 'public.cnc_invoices', 'invoice_no',
                     case when v_type = 'Credit Note' then 'CN' when v_type = 'Proforma Invoice' then 'PI' else coalesce(co.invoice_prefix, 'INV') end));

  if v_id is null then
    v_id := public.erp_insert_json('cnc_invoices', jsonb_build_object(
      'company_id', v_company, 'invoice_no', v_no, 'invoice_type', v_type,
      'invoice_date', coalesce(nullif(p_invoice->>'invoice_date','')::date, public.erp_today(v_company)),
      'due_date', nullif(p_invoice->>'due_date','')::date, 'customer_name', p_invoice->>'customer_name',
      'customer_id', nullif(p_invoice->>'customer_id',''), 'customer_gstin', p_invoice->>'customer_gstin',
      'billing_address', p_invoice->>'billing_address', 'place_of_supply', v_pos, 'po_no', p_invoice->>'po_no',
      'dc_no', p_invoice->>'dc_no', 'sales_order_id', nullif(p_invoice->>'sales_order_id',''),
      'delivery_id', nullif(p_invoice->>'delivery_id',''), 'part_name', p_invoice->>'part_name',
      'quantity', coalesce(nullif(p_invoice->>'quantity','')::numeric, 0),
      'basic_value', v_basic, 'discount_amount', v_disc, 'taxable_value', v_taxable,
      'cgst', case when v_intra then round(v_tax/2,2) else 0 end, 'sgst', case when v_intra then v_tax - round(v_tax/2,2) else 0 end,
      'igst', case when v_intra then 0 else v_tax end, 'round_off', v_round, 'amount', v_total,
      'status', 'Sent', 'payment_terms', p_invoice->>'payment_terms', 'notes', p_invoice->>'notes',
      'credit_note_of', nullif(p_invoice->>'credit_note_of',''), 'created_by', me.full_name)) ->> 'id';
  else
    perform public.erp_update_json('cnc_invoices', v_id, v_company, jsonb_build_object(
      'invoice_no', v_no, 'invoice_type', v_type,
      'invoice_date', coalesce(nullif(p_invoice->>'invoice_date','')::date, v_existing.invoice_date),
      'due_date', nullif(p_invoice->>'due_date','')::date, 'customer_name', p_invoice->>'customer_name',
      'customer_id', nullif(p_invoice->>'customer_id',''), 'customer_gstin', p_invoice->>'customer_gstin',
      'billing_address', p_invoice->>'billing_address', 'place_of_supply', v_pos, 'po_no', p_invoice->>'po_no',
      'dc_no', p_invoice->>'dc_no', 'part_name', p_invoice->>'part_name',
      'quantity', coalesce(nullif(p_invoice->>'quantity','')::numeric, 0),
      'basic_value', v_basic, 'discount_amount', v_disc, 'taxable_value', v_taxable,
      'cgst', case when v_intra then round(v_tax/2,2) else 0 end, 'sgst', case when v_intra then v_tax - round(v_tax/2,2) else 0 end,
      'igst', case when v_intra then 0 else v_tax end, 'round_off', v_round, 'amount', v_total,
      'payment_terms', p_invoice->>'payment_terms', 'notes', p_invoice->>'notes', 'updated_at', now()));
    delete from public.cnc_invoice_items where invoice_id = v_id and company_id = v_company;
  end if;

  n := 0;
  for l in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    v_rate := coalesce(nullif(l ->> 'gst_rate', '')::numeric, co.default_gst_rate);
    perform public.erp_insert_json('cnc_invoice_items', jsonb_build_object(
      'company_id', v_company, 'invoice_id', v_id, 'line_no', n, 'description', coalesce(l->>'description',''),
      'hsn', l->>'hsn', 'quantity', coalesce((l->>'quantity')::numeric,0), 'unit', l->>'unit',
      'rate', coalesce((l->>'rate')::numeric,0), 'discount_pct', coalesce(nullif(l->>'discount_pct','')::numeric,0),
      'gst_rate', v_rate, 'amount', round(coalesce((l->>'quantity')::numeric,0) * coalesce((l->>'rate')::numeric,0)
                    * (1 - coalesce(nullif(l->>'discount_pct','')::numeric,0)/100), 2)));
  end loop;

  return jsonb_build_object('id', v_id, 'invoice_no', v_no);
end;
$$;

-- ---- 2) Gate invoice reads on Invoice view ----
create or replace function public.erp_invoices(p_type text default null, p_status text default null, p_customer text default null,
  p_search text default null, p_from date default null, p_to date default null, p_page int default 1, p_page_size int default 10)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_report_company();
  v_size int := least(greatest(coalesce(p_page_size, 10), 1), 500);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_total int;
  v_rows jsonb;
begin
  if not public.erp_has_any_perm(array['invoices'], 'view') then
    raise exception 'Invoice view permission is required to read invoices.' using errcode = '42501';
  end if;
  with base as (
    select inv, public.erp_invoice_status(v_company, inv) as st
    from public.cnc_invoices inv
    where inv.company_id = v_company
      and (nullif(p_type, '') is null or inv.invoice_type = p_type
           or (p_type = 'Cancelled' and inv.cancelled))
      and (nullif(p_customer, '') is null or inv.customer_id = p_customer or inv.customer_name = p_customer)
      and (p_from is null or inv.invoice_date >= p_from)
      and (p_to is null or inv.invoice_date <= p_to)
      and (v_q is null or inv.invoice_no ilike '%'||v_q||'%' or inv.customer_name ilike '%'||v_q||'%'
           or inv.po_no ilike '%'||v_q||'%' or inv.dc_no ilike '%'||v_q||'%' or inv.part_name ilike '%'||v_q||'%')
  ),
  filtered as (select * from base where nullif(p_status, '') is null or st = p_status)
  select (select count(*) from filtered),
         (select coalesce(jsonb_agg(public.erp_invoice_json(f.inv, v_company, false)
                   order by (f.inv).invoice_date desc nulls last, (f.inv).invoice_no desc), '[]')
          from (select inv from filtered order by (inv).invoice_date desc nulls last limit v_size offset (v_page-1)*v_size) f)
  into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'rows', v_rows);
end;
$$;

create or replace function public.erp_invoice(p_id text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid := public.erp_report_company();
  inv public.cnc_invoices;
begin
  if not public.erp_has_any_perm(array['invoices'], 'view') then
    raise exception 'Invoice view permission is required to read invoices.' using errcode = '42501';
  end if;
  select * into inv from public.cnc_invoices where id::text = p_id and company_id = v_company;
  if inv.id is null then raise exception 'Invoice not found' using errcode = '22023'; end if;
  return public.erp_invoice_json(inv, v_company, true);
end;
$$;

create or replace function public.erp_invoices_summary(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_company uuid := public.erp_report_company();
begin
  if not public.erp_has_any_perm(array['invoices'], 'view') then
    raise exception 'Invoice view permission is required to read invoice summaries.' using errcode = '42501';
  end if;
  return (
    with inv as (
      select i.*, round(coalesce(i.amount,0),2) as total, public.erp_invoice_received(v_company, i.id::text) as rcv,
             public.erp_invoice_status(v_company, i) as st
      from public.cnc_invoices i
      where i.company_id = v_company and not i.cancelled and i.invoice_type <> 'Proforma Invoice'
        and (p_from is null or i.invoice_date >= p_from) and (p_to is null or i.invoice_date <= p_to))
    select jsonb_build_object(
      'total_invoices', count(*),
      'total_value', coalesce(sum(total), 0)::text,
      'total_received', coalesce(sum(rcv), 0)::text,
      'outstanding', coalesce(sum(total - rcv), 0)::text,
      'overdue_count', count(*) filter (where st = 'Overdue'),
      'overdue_amount', coalesce(sum(total - rcv) filter (where st = 'Overdue'), 0)::text,
      'by_status', (select coalesce(jsonb_object_agg(st, c), '{}') from (select st, count(*) c from inv group by st) s),
      'ageing', jsonb_build_object(
        'current', coalesce(sum(total - rcv) filter (where public.erp_today(v_company) - invoice_date <= 30), 0)::text,
        'd31_60', coalesce(sum(total - rcv) filter (where public.erp_today(v_company) - invoice_date between 31 and 60), 0)::text,
        'd61_90', coalesce(sum(total - rcv) filter (where public.erp_today(v_company) - invoice_date between 61 and 90), 0)::text,
        'd90_plus', coalesce(sum(total - rcv) filter (where public.erp_today(v_company) - invoice_date > 90), 0)::text),
      'top_customers', (select coalesce(jsonb_agg(jsonb_build_object('customer', customer_name, 'value', v::text) order by v desc), '[]')
                        from (select customer_name, sum(total) v from inv group by customer_name order by v desc limit 5) t),
      'monthly', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'invoiced', iv::text, 'received', rv::text) order by d), '[]')
                  from (select invoice_date d, sum(total) iv, sum(rcv) rv from inv
                        where invoice_date >= public.erp_today(v_company) - 30 group by invoice_date) m))
    from inv);
end;
$$;

-- ---- 3) Idempotency backstop: one non-Proforma invoice per delivery row ----
do $$
begin
  if not exists (
    select 1 from public.cnc_invoices
    where delivery_id is not null and invoice_type <> 'Proforma Invoice'
    group by company_id, delivery_id having count(*) > 1
  ) then
    create unique index if not exists cnc_invoices_no_dup_delivery
      on public.cnc_invoices (company_id, delivery_id)
      where delivery_id is not null and invoice_type <> 'Proforma Invoice';
  else
    raise notice 'Skipping cnc_invoices_no_dup_delivery: duplicate invoices exist; clean them first.';
  end if;
end;
$$;

commit;
