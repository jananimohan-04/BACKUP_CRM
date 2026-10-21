-- Adds petty_date to cnc_inwards for tracking the exact date when a member paid out of pocket.
begin;

alter table public.cnc_inwards
  add column if not exists petty_date date;

commit;
