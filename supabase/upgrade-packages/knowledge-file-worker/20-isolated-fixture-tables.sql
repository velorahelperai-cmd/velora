-- Disposable isolated-acceptance only. Not a production migration.
-- Creates the minimum branch-binding table shape the review candidate requires
-- when a full ES02 B5 chain cannot be replayed on this host.
begin;
create table if not exists public.company_branches (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null default 'main',
  unique (company_id, id)
);
create table if not exists private.es02_branch_knowledge_sources (
  company_id uuid not null,
  branch_id uuid not null,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (branch_id, source_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);
alter table private.es02_branch_knowledge_sources enable row level security;
revoke all on table private.es02_branch_knowledge_sources from public, anon, authenticated, service_role;
commit;
