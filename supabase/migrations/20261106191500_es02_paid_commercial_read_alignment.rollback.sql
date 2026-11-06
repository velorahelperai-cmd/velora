-- Rollback companion for 20261106191500_es02_paid_commercial_read_alignment.sql
-- Restores commercial-only send/display proof (pre-ES02 alignment). Reply fence
-- from 20261106180000 is left in place; roll that migration separately if needed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $display$
declare
  source text;
  patched text;
  new_paid text := $n$paid:=exists(select 1 from private.billing_proven_entitlement_grants g where g.company_id=p_company_id and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id)) or private.billing_es02_live_paid_through(p_company_id) is not null;$n$;
  old_paid text := $n$paid:=exists(select 1 from private.billing_proven_entitlement_grants g where g.company_id=p_company_id and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id));$n$;
  new_branch text := $n$if s.id is null or s.paid_through is null then
  current_proof:=false;
  bound:=false;
 elsif s.plan_version_id is null then
  current_proof:=private.billing_es02_live_paid_through(p_company_id) is not distinct from s.paid_through;
  bound:=current_proof;
  paid:=paid or current_proof;
 else$n$;
  old_branch text := $n$if s.id is null or s.plan_version_id is null or s.paid_through is null then
  current_proof:=false;
  bound:=false;
 else$n$;
begin
  select pg_get_functiondef('public.billing_read_company_display_evidence(uuid)'::regprocedure)
    into source;
  if position('billing_es02_live_paid_through(p_company_id)' in source) = 0 then
    return;
  end if;
  patched := replace(source, new_paid, old_paid);
  patched := replace(patched, new_branch, old_branch);
  if patched = source then
    raise exception 'ES02_DISPLAY_ROLLBACK_NO_CHANGE';
  end if;
  execute patched;
end;
$display$;

do $send$
declare
  p record;
begin
  select prosrc, proowner, proacl, proconfig, prosecdef, provolatile
    into strict p
  from pg_proc
  where oid = to_regprocedure('private.billing_chat_send(uuid)');
  if position('ES02_PAID_COMMERCIAL_SEND' in p.prosrc) = 0 then
    return;
  end if;
  execute $definition$
create or replace function private.billing_chat_send(cid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $body$
begin /* F40_LAZY_SEND_PROOF */
  if private.billing_lifecycle_receipt(cid) is null then
    return not exists (
      select 1
      from public.billing_subscriptions
      where company_id = cid
        and environment = 'live'
        and paid_through is not null
    );
  end if;
  return exists (
    select 1
    from public.billing_subscriptions s
    join private.billing_proven_entitlement_grants g
      on g.subscription_id = s.id
     and g.company_id = s.company_id
     and g.plan_version_id = s.plan_version_id
    where s.company_id = cid
      and s.environment = 'live'
      and g.provider_environment = 'live'
      and s.paid_through = g.applied_paid_through
      and s.status in ('active', 'cancel_at_period_end')
      and g.applied_paid_through > statement_timestamp()
      and private.billing_service_receipt_eligible(g.id)
  );
end;
$body$
$definition$;
end;
$send$;

do $policy$
declare
  p record;
begin
  select prosrc, proowner, proacl, proconfig, prosecdef, provolatile
    into strict p
  from pg_proc
  where oid = to_regprocedure('private.billing_chat_policy(uuid,text)');
  if position('ES02_PAID_COMMERCIAL_POLICY' in p.prosrc) = 0 then
    return;
  end if;
  execute $definition$
create or replace function private.billing_chat_policy(cid uuid, channel text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare r jsonb;e timestamptz;begin
 r:=private.billing_lifecycle_receipt(cid);if r is null then return not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null);end if;
 e:=(r->>'expiredAt')::timestamptz;
 if statement_timestamp()>=e+interval '720 hours' then return false;end if;
 if statement_timestamp()<e and exists(select 1 from private.billing_expiry_episodes where company_id=cid and disconnected_at is not null) then
  if channel='instagram' then return exists(select 1 from private.instagram_company_links l join private.instagram_company_generations g on g.company_id=l.company_id and g.bound_account_id=l.account_id and g.generation=l.generation where l.company_id=cid and l.status='active' and l.authorization_expires_at>statement_timestamp());end if;
  if channel='whatsapp' then return exists(select 1 from public.whatsapp_company_links where company_id=cid and status='verified' and authorization_status='active' and (authorization_expires_at>statement_timestamp() or (authorization_expires_at is null and authorization_non_expiring)));end if;
 end if;return true;
end;$function$;
$definition$;
end;
$policy$;

drop function if exists private.billing_es02_live_paid_through(uuid);

commit;
