-- Filename: 20261020150000_es02_single_branch_scope.sql
-- Current product scope: ONE branch per business. Multi-branch support is
-- DEFERRED (docs/MASTER_PLAN.md "Single-branch current scope"), not removed.
-- Additive only: no table/column/policy/grant removal, no existing row is
-- converted, merged, archived or re-parented. Existing multi-branch rows (for
-- example historical fixtures) remain readable and keep their isolation.
-- The guard blocks only the INSERT of an additional setup/active branch for a
-- company that already has one, from every path (Smart, enterprise, ES02
-- provisioning of multi-slot orders, direct SQL by owner roles).
-- Rollback: update private.es02_gates set enabled=false where name='single_branch_scope'.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regclass('public.company_branches') is null then
    raise exception 'ES02_SINGLE_BRANCH_BASELINE_MISSING';
  end if;
end;
$guard$;

create table if not exists private.es02_gates (
  name text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.es02_gates owner to postgres;
alter table private.es02_gates enable row level security;
revoke all on table private.es02_gates from public, anon, authenticated;
grant all on table private.es02_gates to service_role;

insert into private.es02_gates(name, enabled) values ('single_branch_scope', true)
  on conflict (name) do nothing;

create or replace function private.es02_single_branch_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('setup', 'active') then
    return new;
  end if;
  if coalesce((select g.enabled from private.es02_gates g where g.name = 'single_branch_scope'), true) is distinct from true then
    return new;
  end if;
  -- On update, grandfather branches already setup/active in the same company
  if tg_op = 'UPDATE' and old.status in ('setup', 'active') and old.company_id = new.company_id then
    return new;
  end if;
  -- Serialize concurrent first/second inserts or promotions for the same company.
  perform pg_catalog.pg_advisory_xact_lock(87420401, pg_catalog.hashtext(new.company_id::text));
  if exists (
    select 1 from public.company_branches b
    where b.company_id = new.company_id
      and b.id is distinct from new.id
      and b.status in ('setup', 'active')
  ) then
    raise exception 'SECOND_BRANCH_DEFERRED' using errcode = 'P0001',
      hint = 'Multi-branch support is deferred; current scope is one branch per business.';
  end if;
  return new;
end;
$$;

alter function private.es02_single_branch_guard() owner to postgres;
revoke all on function private.es02_single_branch_guard() from public, anon, authenticated, service_role;

drop trigger if exists es02_single_branch_scope on public.company_branches;
create trigger es02_single_branch_scope
  before insert or update of company_id, status on public.company_branches
  for each row execute function private.es02_single_branch_guard();

notify pgrst, 'reload schema';
commit;
