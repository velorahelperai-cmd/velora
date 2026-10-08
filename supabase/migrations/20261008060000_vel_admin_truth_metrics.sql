-- Actual collections are derived from confirmed entitlement applications and
-- their immutable locked order amounts. Test payments stay separate from live.
create or replace function public.admin_financial_summary()
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'live_collected_baisa',coalesce(sum(o.amount_baisa) filter(where a.provider_environment='live'),0),
  'test_collected_baisa',coalesce(sum(o.amount_baisa) filter(where a.provider_environment='test'),0),
  'settled_orders',count(*) filter(where a.provider_environment='live')
 ) from public.billing_entitlement_applications a join public.billing_orders o
 on o.id=a.order_id and o.company_id=a.company_id and o.provider_environment=a.provider_environment
 where a.applied_at>=date_trunc('month',clock_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat';
$$;
revoke all on function public.admin_financial_summary() from public,anon,authenticated;
grant execute on function public.admin_financial_summary() to service_role;
-- Install the existing native active-session predicate on newly introduced RLS
-- tables too (ACCESS, billing, and future copies). Never replace their role policies.
do $$declare target record;begin
 for target in select n.nspname as schema_name,c.relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and c.relrowsecurity and n.nspname='public' loop
  execute format('drop policy if exists velora_active_session on %I.%I',target.schema_name,target.table_name);
  execute format('create policy velora_active_session on %I.%I as restrictive for all to authenticated using ((select public.app_session_is_valid())) with check ((select public.app_session_is_valid()))',target.schema_name,target.table_name);
 end loop;
end;$$;
notify pgrst,'reload schema';
