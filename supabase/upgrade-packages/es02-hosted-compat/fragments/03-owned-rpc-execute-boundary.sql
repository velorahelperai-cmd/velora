-- ES02 hosted ACL C4 — owned RPC EXECUTE boundary (auth-only).
-- Cause: hosted postgres/public default function EXECUTE includes service_role;
-- C2 REVOKE public,anon alone leaves service_role EXECUTE. Explicit revoke restores
-- the approved authenticated-only ACL before the unchanged C3 footprint guard.
-- Does not alter function bodies, owners, signatures, RLS, or schema default privileges.
-- Exact typed signatures must already exist (after es02-140000); missing fails closed.

do $$
begin
  if to_regprocedure('public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)') is null then
    raise exception 'ES02_HOSTED_ACL: missing exact signature es02_create_account_order(uuid,uuid,text,jsonb,boolean)';
  end if;
  if to_regprocedure('public.es02_read_owned_purchase(uuid)') is null then
    raise exception 'ES02_HOSTED_ACL: missing exact signature es02_read_owned_purchase(uuid)';
  end if;
  if to_regprocedure('public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)') is null then
    raise exception 'ES02_HOSTED_ACL: missing exact signature es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)';
  end if;
  if to_regprocedure('public.es02_read_activation_foundation(uuid,uuid)') is null then
    raise exception 'ES02_HOSTED_ACL: missing exact signature es02_read_activation_foundation(uuid,uuid)';
  end if;
  if to_regprocedure('public.es02_reconcile_activation_readiness(uuid,uuid)') is null then
    raise exception 'ES02_HOSTED_ACL: missing exact signature es02_reconcile_activation_readiness(uuid,uuid)';
  end if;
end;
$$;

revoke all on function public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)
  from public, anon, service_role;
grant execute on function public.es02_create_account_order(uuid,uuid,text,jsonb,boolean)
  to authenticated;

revoke all on function public.es02_read_owned_purchase(uuid)
  from public, anon, service_role;
grant execute on function public.es02_read_owned_purchase(uuid)
  to authenticated;

revoke all on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  from public, anon, service_role;
grant execute on function public.es02_provision_owned_purchase(uuid,uuid,uuid,jsonb,jsonb)
  to authenticated;

revoke all on function public.es02_read_activation_foundation(uuid,uuid)
  from public, anon, service_role;
grant execute on function public.es02_read_activation_foundation(uuid,uuid)
  to authenticated;

revoke all on function public.es02_reconcile_activation_readiness(uuid,uuid)
  from public, anon, service_role;
grant execute on function public.es02_reconcile_activation_readiness(uuid,uuid)
  to authenticated;
