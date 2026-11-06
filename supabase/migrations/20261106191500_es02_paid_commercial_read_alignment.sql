-- Align commercial billing read/send with the ES02 paid ledger.
-- ES02 stores live paid companies as billing_subscriptions.plan_version_id IS NULL
-- with matching private.es02_activation_foundation.paid_through_at. Commercial
-- billing_chat_send / display evidence only joined proven plan_version grants, so
-- a really paid ES02 tenant read as empty/unpaid and reply/take-over stayed false.
-- Does not insert subscription rows; only repairs the read/send proof path.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.billing_es02_live_paid_through(cid uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  a private.es02_activation_foundation;
  o private.es02_account_orders;
  s public.billing_subscriptions;
begin
  select * into a from private.es02_activation_foundation where company_id = cid;
  if a.company_id is null
    or a.clock_state <> 'active'
    or a.paid_through_at is null
    or a.paid_through_at <= statement_timestamp()
  then
    return null;
  end if;

  select * into o from private.es02_account_orders where id = a.order_id;
  if o.id is null
    or o.provisioned_company_id is distinct from cid
    or o.account_id is distinct from a.account_id
    or o.original_order_group_id is distinct from a.order_group_id
    or o.status is distinct from 'provisioned'
    or o.environment is distinct from 'live'
    or (
      o.settlement_authority is distinct from 'paymob_hmac'
      and not coalesce(private.es02_verified_live_catalog_order(o), false)
    )
    or o.settled_at is null
    or nullif(btrim(o.provider_transaction_id), '') is null
    or not exists (
      select 1
      from private.es02_account_settlement_events e
      where e.order_id = o.id
        and e.account_id = o.account_id
        and e.provider_transaction_id = o.provider_transaction_id
        and e.outcome = 'applied'
        and (
          e.amount_baisa = o.amount_baisa
          or (
            coalesce(private.es02_verified_live_catalog_order(o), false)
            and e.evidence_marker = 'thawani_api_verified_live'
            and e.amount_baisa = 100
          )
        )
        and e.currency = o.currency
    )
    or not exists (
      select 1 from public.companies c where c.id = cid and c.status = 'active'
    )
  then
    return null;
  end if;

  select * into s from public.billing_subscriptions where company_id = cid and environment = 'live';
  if s.id is null
    or s.plan_version_id is not null
    or s.status not in ('active', 'cancel_at_period_end')
    or s.paid_through is distinct from a.paid_through_at
  then
    return null;
  end if;

  return a.paid_through_at;
end;
$body$;

revoke all on function private.billing_es02_live_paid_through(uuid)
  from public, anon, authenticated, service_role;

do $send$
declare
  p record;
  body text;
  marker text := 'F40_LAZY_SEND_PROOF';
  es02_marker text := 'ES02_PAID_COMMERCIAL_SEND';
begin
  select prosrc, proowner, proacl, proconfig, prosecdef, provolatile
    into strict p
  from pg_proc
  where oid = to_regprocedure('private.billing_chat_send(uuid)');

  if position(es02_marker in p.prosrc) > 0 then
    return;
  end if;
  if position(marker in p.prosrc) = 0 then
    raise exception 'ES02_SEND_ALIGNMENT_REQUIRES_F40';
  end if;

  execute $definition$
create or replace function private.billing_chat_send(cid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $body$
begin /* F40_LAZY_SEND_PROOF ES02_PAID_COMMERCIAL_SEND */
  if private.billing_lifecycle_receipt(cid) is null then
    if private.billing_es02_live_paid_through(cid) is not null then
      return true;
    end if;
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

  if not exists (
    select 1
    from pg_proc q
    where q.oid = to_regprocedure('private.billing_chat_send(uuid)')
      and q.proowner = p.proowner
      and q.proacl is not distinct from p.proacl
      and q.proconfig is not distinct from p.proconfig
      and q.prosecdef = p.prosecdef
      and q.provolatile = p.provolatile
  ) then
    raise exception 'ES02_SEND_ALIGNMENT_AUTHORITY_CHANGED';
  end if;
end;
$send$;

do $display$
declare
  source text;
  patched text;
  old_paid text := $n$paid:=exists(select 1 from private.billing_proven_entitlement_grants g where g.company_id=p_company_id and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id));$n$;
  new_paid text := $n$paid:=exists(select 1 from private.billing_proven_entitlement_grants g where g.company_id=p_company_id and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id)) or private.billing_es02_live_paid_through(p_company_id) is not null;$n$;
  old_branch text := $n$if s.id is null or s.plan_version_id is null or s.paid_through is null then
  current_proof:=false;
  bound:=false;
 else$n$;
  new_branch text := $n$if s.id is null or s.paid_through is null then
  current_proof:=false;
  bound:=false;
 elsif s.plan_version_id is null then
  current_proof:=private.billing_es02_live_paid_through(p_company_id) is not distinct from s.paid_through;
  bound:=current_proof;
  paid:=paid or current_proof;
 else$n$;
begin
  select pg_get_functiondef('public.billing_read_company_display_evidence(uuid)'::regprocedure)
    into source;
  if position('billing_es02_live_paid_through(p_company_id)' in source) > 0 then
    return;
  end if;
  if position(old_paid in source) = 0 or position(old_branch in source) = 0 then
    raise exception 'ES02_DISPLAY_ALIGNMENT_SOURCE_DRIFT';
  end if;
  patched := replace(source, old_paid, new_paid);
  patched := replace(patched, old_branch, new_branch);
  if patched = source then
    raise exception 'ES02_DISPLAY_ALIGNMENT_NO_CHANGE';
  end if;
  execute patched;
end;
$display$;

-- Keep owner manual reply/take-over with the ES02 read fence when still unpatched.
do $reply$
declare
  source text;
  patched text;
  needle_send text := $n$p_capability='wa.conversations.read' or private.billing_chat_send(p_company_id)$n$;
  repl_send text := $n$p_capability in ('wa.conversations.read','wa.conversations.reply','wa.conversations.take_over') or private.billing_chat_send(p_company_id)$n$;
  needle_es02 text := $n$p_capability='wa.conversations.read' and exists($n$;
  repl_es02 text := $n$p_capability in ('wa.conversations.read','wa.conversations.reply','wa.conversations.take_over') and exists($n$;
  target regprocedure;
  patched_count int := 0;
begin
  foreach target in array array[
    to_regprocedure('public.has_company_capability(uuid,text)'),
    to_regprocedure('private.master_archive_native_has_capability(uuid,text)'),
    to_regprocedure('private.master_files_native_has_capability(uuid,text)'),
    to_regprocedure('public.lifecycle_native_has_company_capability(uuid,text)'),
    to_regprocedure('private.user_has_company_capability(uuid,uuid,text)'),
    to_regprocedure('private.master_archive_native_user_capability(uuid,uuid,text)'),
    to_regprocedure('private.master_files_native_user_capability(uuid,uuid,text)'),
    to_regprocedure('private.lifecycle_native_company_capability(uuid,uuid,text)')
  ]
  loop
    if target is null then
      continue;
    end if;
    select pg_get_functiondef(target) into source;
    if position(needle_send in source) = 0 then
      continue;
    end if;
    patched := replace(source, needle_send, repl_send);
    if position(needle_es02 in patched) > 0 then
      patched := replace(patched, needle_es02, repl_es02);
    end if;
    if patched = source then
      raise exception 'ES02_REPLY_FENCE_NO_CHANGE %', target;
    end if;
    execute patched;
    patched_count := patched_count + 1;
  end loop;
  -- Already applied by 20261106180000 is fine; zero patches here means fence already widened.
  if patched_count = 0 and position(
    $n$p_capability in ('wa.conversations.read','wa.conversations.reply','wa.conversations.take_over') or private.billing_chat_send(p_company_id)$n$
    in pg_get_functiondef('public.has_company_capability(uuid,text)'::regprocedure)
  ) = 0 then
    raise exception 'ES02_REPLY_FENCE_NOT_FOUND';
  end if;
end;
$reply$;

commit;
