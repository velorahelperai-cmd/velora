-- VEL-005A follow-up: index companies.created_by for lookup/filter performance
create index if not exists companies_created_by_idx
  on public.companies (created_by);
