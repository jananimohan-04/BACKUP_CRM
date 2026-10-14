-- Plan Operation quantity: how many pieces each planned slot covers.
begin;
alter table public.cnc_operation_plans add column if not exists quantity numeric;
notify pgrst, 'reload schema';
commit;
