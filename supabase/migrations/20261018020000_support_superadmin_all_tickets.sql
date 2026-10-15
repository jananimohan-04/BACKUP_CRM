-- Fix: a Super Admin did not see tickets raised by other companies.
--
-- erp_support_can_see_ticket required the ticket's company to be among erp_visible_company_ids().
-- For a Super Admin that list is only the company currently chosen in the top bar, so a ticket
-- raised by any other company was invisible (All Tickets empty, replies and status changes
-- refused) until the Super Admin switched to exactly that company.
--
-- Support is a cross-company inbox: a Super Admin sees every ticket, whichever company is
-- selected. Everyone else is unchanged (own company; own tickets, or all of the company's
-- tickets for its Company Admin). Re-runnable.
begin;

create or replace function public.erp_support_can_see_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket_id
      and public.erp_has_any_perm(array['support'], 'view')
      and (
        public.erp_is_super_admin()
        or (
          t.company_id = any (public.erp_visible_company_ids())
          and (
            t.created_by_user_id = (select (public.erp_current_user()).id)
            or (select (public.erp_current_user()).role) = 'COMPANY_ADMIN'
          )
        )
      )
  );
$fn$;
revoke all on function public.erp_support_can_see_ticket(uuid) from public, anon, authenticated;
grant execute on function public.erp_support_can_see_ticket(uuid) to authenticated;

commit;
