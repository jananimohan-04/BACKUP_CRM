-- Questions asked to the ERP help assistant (Tamil / English / Tanglish, typed or spoken), per company.
-- Used to (a) keep a monthly question limit per company and (b) see what people could not get an answer to,
-- so the help notes can be improved. The question text only; no ERP records are stored here.
-- Re-runnable.
begin;

create table if not exists public.help_questions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  user_name  text,
  question   text not null,
  page       text,
  lang       text,
  helpful    boolean,           -- thumbs up (true) / down (false) from the person
  created_at timestamptz not null default now()
);
select public.erp_secure_table('help_questions');
create index if not exists help_questions_company_month_idx on public.help_questions (company_id, created_at desc);

commit;
