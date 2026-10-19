-- ============================================================================
-- !!  LOCAL DEV ONLY — DO NOT RUN AGAINST HOSTED SUPABASE !!
-- ============================================================================
--
-- WHAT THIS IS
-- A temporary, LOCAL-ONLY patch that lets you sign in with an email/password
-- session against the local Supabase, because Google OAuth has no credentials
-- configured locally (SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID / _SECRET are unset,
-- so GoTrue forwards the literal string "env(...)" as the client id and Google
-- returns 401 invalid_client).
--
-- WHY IT IS NEEDED
-- public.erp_get_session() rejects any session whose Google identity cannot be
-- resolved, returning status = 'not_google'. It calls public.erp_google_email(),
-- which requires BOTH:
--   1. an auth.identities row with provider = 'google', and
--   2. a JWT `amr` entry with method = 'oauth'.
-- A password sign-in has provider = 'email' and amr = 'password', so it can never
-- satisfy that. public.erp_current_user() also filters on cu.email =
-- erp_google_email(), so without this patch a password session gets no company
-- context and RLS blocks every table.
--
-- WHAT THIS CHANGES
-- erp_google_email() keeps the original Google lookup intact and only appends a
-- fallback to the email identity when no Google identity exists. Hosted behaviour
-- is unaffected as long as this file is never applied there.
--
-- THIS IS NOT A MIGRATION. It is deliberately NOT in supabase/migrations/, so it
-- is never applied by `supabase migration up` and never synced to Lovable or
-- deployed to hosted.
--
-- TO APPLY (local only):
--   Get-Content scratch/local-only-password-signin.sql -Raw |
--     docker exec -i supabase_db_project psql -U postgres -d postgres
--
-- TODO: delete this file and restore the original erp_google_email() once
-- SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID / _SECRET are set for local dev.

create or replace function public.erp_google_email()
returns text
language sql stable security definer set search_path = ''
as $$
  select lower(coalesce(
    -- Original behaviour: a real Google identity signed in via OAuth.
    (select i.identity_data ->> 'email'
     from auth.identities i
     where i.user_id = auth.uid()
       and i.provider = 'google'
       and exists (
         select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
         where a ->> 'method' = 'oauth'
       )
     order by i.created_at
     limit 1),
    -- LOCAL DEV ONLY: fall back to the email/password identity.
    (select i.identity_data ->> 'email'
     from auth.identities i
     where i.user_id = auth.uid()
       and i.provider = 'email'
     order by i.created_at
     limit 1)
  ))
$$;
