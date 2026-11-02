-- Batch transport only: every decision remains in the existing native helper.
-- SECURITY INVOKER preserves the caller; this function cannot grant authority.
set local lock_timeout='2s';
set local statement_timeout='30s';
create function public.company_capability_snapshot(p_company_id uuid,p_capabilities text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_company_id is null or p_capabilities is null or cardinality(p_capabilities)<1 or cardinality(p_capabilities)>32
  or exists(select 1 from unnest(p_capabilities) c where c is null or length(c)<1 or length(c)>128) then
  raise exception using errcode='22023',message='invalid capability snapshot input';
 end if;
 select jsonb_object_agg(c,coalesce(public.has_company_capability(p_company_id,c),false)) into result
 from (select distinct unnest(p_capabilities) c) requested;
 return jsonb_build_object('company_id',p_company_id,'capabilities',result);
end $$;
revoke all on function public.company_capability_snapshot(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.company_capability_snapshot(uuid,text[]) to authenticated;
