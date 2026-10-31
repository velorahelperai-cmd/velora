-- WITHDRAWN as full-chain acceptance substitute (owner 2026-10-31).
-- Do not use this excerpt to bypass staff/credit migration blockers.
-- Kept only as a historical DDL reference; native-acceptance no longer applies it.
begin;
create table if not exists public.company_branches (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 name text not null check(char_length(btrim(name)) between 1 and 120),
 timezone text not null default 'UTC',
 status text not null default 'setup' check(status in ('setup','active','suspended')),
 is_primary boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 unique(company_id,id)
);
create table if not exists private.es02_branch_knowledge_sources (
  company_id uuid not null,
  branch_id uuid not null,
  source_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (branch_id, source_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id),
  foreign key (source_id) references public.knowledge_sources (id) on delete cascade
);
alter table private.es02_branch_knowledge_sources owner to postgres;
alter table private.es02_branch_knowledge_sources enable row level security;
revoke all on table private.es02_branch_knowledge_sources from public, anon, authenticated, service_role;
commit;
