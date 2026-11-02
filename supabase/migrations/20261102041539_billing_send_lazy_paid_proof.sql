begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare p record;
begin
 select prosrc,proowner,proacl,proconfig,prosecdef,provolatile into strict p
 from pg_proc where oid=to_regprocedure('private.billing_chat_send(uuid)');
 if position('F40_LAZY_SEND_PROOF' in p.prosrc)>0 then return;end if;
 if md5(replace(p.prosrc,chr(13),''))<>'b5b55c8eef56be20e700ff2a96ea86f5'
 or not p.prosecdef or p.provolatile<>'s'
 or p.proconfig is distinct from array['search_path=""'] then
  raise exception 'F40_SEND_PREREQUISITE_MISMATCH';
 end if;
 -- Preserve both CASE branches exactly; only plan the paid-proof join when used.
 execute $definition$create or replace function private.billing_chat_send(cid uuid)
 returns boolean language plpgsql stable security definer set search_path to ''
 as $body$
 begin /* F40_LAZY_SEND_PROOF */
  if private.billing_lifecycle_receipt(cid) is null then
   return not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null);
  end if;
  return exists(select 1 from public.billing_subscriptions s join private.billing_proven_entitlement_grants g on g.subscription_id=s.id and g.company_id=s.company_id and g.plan_version_id=s.plan_version_id
   where s.company_id=cid and s.environment='live' and g.provider_environment='live' and s.paid_through=g.applied_paid_through
    and s.status in ('active','cancel_at_period_end') and g.applied_paid_through>statement_timestamp() and private.billing_service_receipt_eligible(g.id));
 end;
 $body$ $definition$;
 if not exists(select 1 from pg_proc q where q.oid=to_regprocedure('private.billing_chat_send(uuid)') and q.proowner=p.proowner and q.proacl is not distinct from p.proacl and q.proconfig is not distinct from p.proconfig and q.prosecdef=p.prosecdef and q.provolatile=p.provolatile) then
  raise exception 'F40_SEND_AUTHORITY_CHANGED';
 end if;
end;
$migration$;
commit;
