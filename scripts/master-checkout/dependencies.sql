-- Offline local Auth/session ports only. Billing bodies/tables use native SQL.
alter table public.companies add column created_by uuid references auth.users(id);
create or replace function public.is_platform_owner() returns boolean language sql stable as $$select false$$;
