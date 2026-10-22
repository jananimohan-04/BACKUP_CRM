-- Production orders per PART. A product is made of parts (the parts received on its inwards); production and scheduling plan
-- each part, and the finished product is recorded afterwards through Finished Goods.
--
--  * product_name   the product a part order belongs to (part_name then holds the part).
--  * is_part_order  true for a part order. These are NOT finished product: Finished Goods stock, the sales kanban and the
--                   order quantity tracking ignore them, so a part's completed quantity never counts as a delivered product.
-- Re-runnable.
begin;

alter table public.cnc_work_orders
  add column if not exists product_name text,
  add column if not exists is_part_order boolean not null default false;

create index if not exists cnc_work_orders_part_idx on public.cnc_work_orders (company_id, is_part_order, product_name);

commit;
