-- Align commercial billing read/send with the ES02 paid ledger for EVERY company.
-- ES02 stores live paid companies as billing_subscriptions.plan_version_id IS NULL
-- with matching private.es02_activation_foundation.paid_through_at. Commercial
-- billing_chat_send / display evidence only joined proven plan_version grants, so
-- any really paid ES02 tenant read as empty/unpaid and reply/take-over stayed false.
-- Parameterized by company_id only — no single-tenant hardcoding.
-- Does not insert subscription rows; only repairs the shared read/send proof path.
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

do $policy$
declare
  p record;
  marker text := 'ES02_PAID_COMMERCIAL_POLICY';
begin
  select prosrc, proowner, proacl, proconfig, prosecdef, provolatile
    into strict p
  from pg_proc
  where oid = to_regprocedure('private.billing_chat_policy(uuid,text)');

  if position(marker in p.prosrc) > 0 then
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
/* ES02_PAID_COMMERCIAL_POLICY */
declare
  r jsonb;
  e timestamptz;
  es02_pt timestamptz;
begin
  r := private.billing_lifecycle_receipt(cid);
  if r is null then
    es02_pt := private.billing_es02_live_paid_through(cid);
    if es02_pt is not null then
      if exists (
        select 1
        from private.billing_expiry_episodes
        where company_id = cid
          and disconnected_at is not null
      ) then
        if channel = 'instagram' then
          return exists (
            select 1
            from private.instagram_company_links l
            join private.instagram_company_generations g
              on g.company_id = l.company_id
             and g.bound_account_id = l.account_id
             and g.generation = l.generation
            where l.company_id = cid
              and l.status = 'active'
              and l.authorization_expires_at > statement_timestamp()
          );
        end if;
        if channel = 'whatsapp' then
          return exists (
            select 1
            from public.whatsapp_company_links
            where company_id = cid
              and status = 'verified'
              and authorization_status = 'active'
              and (
                authorization_expires_at > statement_timestamp()
                or (authorization_expires_at is null and authorization_non_expiring)
              )
          );
        end if;
      end if;
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

  e := (r->>'expiredAt')::timestamptz;
  if statement_timestamp() >= e + interval '720 hours' then
    return false;
  end if;
  if statement_timestamp() < e and exists (
    select 1
    from private.billing_expiry_episodes
    where company_id = cid
      and disconnected_at is not null
  ) then
    if channel = 'instagram' then
      return exists (
        select 1
        from private.instagram_company_links l
        join private.instagram_company_generations g
          on g.company_id = l.company_id
         and g.bound_account_id = l.account_id
         and g.generation = l.generation
        where l.company_id = cid
          and l.status = 'active'
          and l.authorization_expires_at > statement_timestamp()
      );
    end if;
    if channel = 'whatsapp' then
      return exists (
        select 1
        from public.whatsapp_company_links
        where company_id = cid
          and status = 'verified'
          and authorization_status = 'active'
          and (
            authorization_expires_at > statement_timestamp()
            or (authorization_expires_at is null and authorization_non_expiring)
          )
      );
    end if;
  end if;
  return true;
end;
$function$;
$definition$;

  if not exists (
    select 1
    from pg_proc q
    where q.oid = to_regprocedure('private.billing_chat_policy(uuid,text)')
      and q.proowner = p.proowner
      and q.proacl is not distinct from p.proacl
      and q.proconfig is not distinct from p.proconfig
      and q.prosecdef = p.prosecdef
      and q.provolatile = p.provolatile
  ) then
    raise exception 'ES02_POLICY_ALIGNMENT_AUTHORITY_CHANGED';
  end if;
end;
$policy$;

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


-- Align staff send intent claim and dispatch with ES02 paid ledger.
-- ES02 stores live paid companies with plan_version_id IS NULL and valid paid_through_at.
-- Check constraints and trigger previously enforced plan_version_id IS NOT NULL,
-- causing staff WhatsApp send claims to be denied as subscription_inactive.
alter table public.whatsapp_send_intents
  drop constraint if exists wa_staff_payment_binding_complete;
alter table public.whatsapp_send_intents
  add constraint wa_staff_payment_binding_complete
  check (staff_claim_paid_through is not null or staff_claim_plan_version_id is null);

alter table public.whatsapp_send_intents
  drop constraint if exists wa_staff_dispatch_binding_complete;
alter table public.whatsapp_send_intents
  add constraint wa_staff_dispatch_binding_complete
  check (
    ((staff_dispatch_token is null) and (staff_dispatch_authorized_at is null))
    or (
      (staff_dispatch_token is not null)
      and (staff_dispatch_authorized_at is not null)
      and (sender_kind = 'staff'::text)
      and (staff_actor_session_id is not null)
      and (
        ((staff_claim_paid_through is not null) and (staff_review_grant_id is null))
        or ((staff_review_grant_id is not null) and (staff_claim_plan_version_id is null) and (staff_claim_paid_through is null))
      )
    )
  );

create or replace function private.wa_staff_dispatch_provenance()
returns trigger
language plpgsql
security definer
set search_path to ''
as $body$
declare
  sid uuid;
  assigned uuid;
begin
  if tg_op='INSERT' then
    if new.staff_actor_session_id is not null or new.staff_claim_plan_version_id is not null
    or new.staff_claim_paid_through is not null or new.staff_dispatch_token is not null or new.staff_dispatch_authorized_at is not null
    then raise exception 'STAFF_PROVENANCE_SERVER_ONLY' using errcode='23514';end if;
    if new.sender_kind='staff' and current_setting('role',true)='authenticated' then
      begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then sid:=null;end;
      perform 1 from public.companies where id=new.company_id and status='active' for share nowait;
      if not found then raise exception 'STAFF_ACTOR_UNAUTHORIZED' using errcode='42501';end if;
      select assigned_to into assigned from public.whatsapp_conversations where id=new.conversation_id and company_id=new.company_id;
      if not found or not private.wa_staff_session_authority(new.actor_user_id,sid,new.company_id,assigned)
      then raise exception 'STAFF_ACTOR_UNAUTHORIZED' using errcode='42501';end if;
      new.staff_actor_session_id:=sid;
    end if;
  else
    if row(new.actor_user_id,new.staff_actor_session_id,new.company_id,new.conversation_id,new.phone_number_id,new.recipient_wa_id,new.body,new.sender_kind,new.link_id,new.link_generation)
    is distinct from row(old.actor_user_id,old.staff_actor_session_id,old.company_id,old.conversation_id,old.phone_number_id,old.recipient_wa_id,old.body,old.sender_kind,old.link_id,old.link_generation)
    then raise exception 'STAFF_PROVENANCE_IMMUTABLE' using errcode='23514';end if;
    if row(new.staff_claim_plan_version_id,new.staff_claim_paid_through) is distinct from row(old.staff_claim_plan_version_id,old.staff_claim_paid_through) then
      if current_user is distinct from (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid='public.whatsapp_send_intents'::regclass)
      or old.staff_claim_plan_version_id is not null
      or (new.staff_claim_plan_version_id is null and private.billing_es02_live_paid_through(new.company_id) is null)
      or old.outcome<>'attempting' or new.outcome<>'attempting' or old.attempt_token is null
      or new.staff_actor_session_id is null or coalesce(current_setting('velora.staff_claim_binding',true),'')<>'1'
      then raise exception 'STAFF_PAYMENT_BINDING_IMMUTABLE' using errcode='23514';end if;
    end if;
    if row(new.staff_dispatch_token,new.staff_dispatch_authorized_at) is distinct from row(old.staff_dispatch_token,old.staff_dispatch_authorized_at) then
      if current_user is distinct from (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid='public.whatsapp_send_intents'::regclass)
      or old.staff_dispatch_token is not null or new.staff_dispatch_token is null or old.outcome<>'attempting'
      or new.outcome<>'attempting' or new.staff_dispatch_token is distinct from old.attempt_token
      or coalesce(current_setting('velora.staff_dispatch_binding',true),'')<>'1'
      then raise exception 'STAFF_DISPATCH_BINDING_IMMUTABLE' using errcode='23514';end if;
    end if;
  end if;
  return new;
end;
$body$;

create or replace function public.billing_read_company_operational_entitlement(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $body$
declare
  s public.billing_subscriptions%rowtype;
  trusted boolean;
  es02_pt timestamptz;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
    and current_setting('role',true) is distinct from 'service_role'
    and not private.billing_ui_company_owner(p_company_id) then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  select * into s from public.billing_subscriptions where company_id=p_company_id and environment='live';
  if not found then
    return jsonb_build_object('ok',true,'active',false,'environment','live','status','none',
      'paid_through',null,'plan_version_id',null,'cancel_at_period_end',false);
  end if;
  
  es02_pt := private.billing_es02_live_paid_through(p_company_id);
  trusted := exists(
    select 1 from private.billing_proven_entitlement_grants g
    where g.subscription_id=s.id
      and g.company_id=p_company_id
      and g.provider_environment='live'
      and g.applied_paid_through=s.paid_through
      and g.plan_version_id=s.plan_version_id
  ) or (
    s.plan_version_id is null
    and es02_pt is not null
    and es02_pt is not distinct from s.paid_through
  );

  return jsonb_build_object(
    'ok',true,
    'active',trusted and s.status in ('active','cancel_at_period_end')
      and s.paid_through>statement_timestamp()
      and exists(select 1 from public.companies c where c.id=p_company_id and c.status<>'suspended'),
    'environment','live',
    'status',s.status,
    'paid_through',case when trusted then s.paid_through else null end,
    'plan_version_id',case when trusted then coalesce(s.plan_version_id::text, 'es02') else null end,
    'cancel_at_period_end',s.cancel_at_period_end
  );
end;
$body$;

revoke all on function public.billing_read_company_operational_entitlement(uuid) from public, anon;
grant execute on function public.billing_read_company_operational_entitlement(uuid) to authenticated, service_role;

create or replace function private.wa_f5_pre_number_gate_claim_staff(p_intent_id uuid, p_actor_user_id uuid, p_lease_seconds integer default 90)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  i public.whatsapp_send_intents%rowtype;
  r jsonb;
  proof jsonb;
  g record;
  s public.billing_subscriptions%rowtype;
  es02_pt timestamptz;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into i from public.whatsapp_send_intents where id=p_intent_id;
  if found and i.sender_kind='assistant' then
    return jsonb_build_object('ok',false,'code','assistant_job_required');
  end if;
  if found then
    perform 1 from public.companies where id=i.company_id for no key update;
    perform 1 from public.billing_subscriptions where company_id=i.company_id and environment='live' for no key update;
    perform 1 from public.whatsapp_conversations where id=i.conversation_id and company_id=i.company_id for update;
    select * into i from public.whatsapp_send_intents where id=p_intent_id for update;
    if i.sender_kind='staff' and i.outcome='ready' and (i.staff_actor_session_id is null or i.actor_user_id is distinct from p_actor_user_id) then
      return jsonb_build_object('ok',false,'code','forbidden');
    end if;
  end if;
  begin
    r := private.wa_claim_pre_fixed_ack(p_intent_id, p_actor_user_id, p_lease_seconds);
    if r->'ok'='true'::jsonb and r->'claimed'='true'::jsonb and i.sender_kind='staff' and i.outcome='ready' then
      proof := public.billing_read_company_operational_entitlement(i.company_id);
      if proof->'ok' is distinct from 'true'::jsonb or proof->'active' is distinct from 'true'::jsonb
        or proof->>'environment' is distinct from 'live' or proof->>'plan_version_id' is null
        or proof->>'paid_through' is null or (proof->>'paid_through')::timestamptz<=clock_timestamp() then
        r := jsonb_build_object('ok',false,'code','subscription_inactive','intent',private.whatsapp_send_intent_public(i));
        raise exception 'STAFF_PAID_DISPATCH_DENIED' using errcode='PWA03';
      end if;
      select * into s from public.billing_subscriptions where company_id=i.company_id and environment='live';
      es02_pt := private.billing_es02_live_paid_through(i.company_id);
      if s.plan_version_id is null then
        if es02_pt is null or es02_pt is distinct from s.paid_through or s.paid_through <= clock_timestamp() then
          r := jsonb_build_object('ok',false,'code','subscription_inactive','intent',private.whatsapp_send_intent_public(i));
          raise exception 'STAFF_PAID_DISPATCH_DENIED' using errcode='PWA03';
        end if;
      else
        select * into g from private.billing_proven_entitlement_grants
        where subscription_id=s.id and company_id=i.company_id
          and provider_environment='live' and plan_version_id=s.plan_version_id and applied_paid_through=s.paid_through
        order by id limit 1;
        if g.id is not null then
          perform 1 from public.billing_entitlement_applications where id=g.id for share nowait;
          perform 1 from public.billing_orders where id=g.order_id for share nowait;
          perform 1 from public.billing_payment_attempts where id=g.payment_attempt_id for share nowait;
          perform 1 from public.billing_provider_events where id=g.provider_event_id for share nowait;
          perform 1 from public.billing_settlement_outcomes where entitlement_application_id=g.id for share nowait;
        end if;
        if g.id is null or not private.billing_service_receipt_eligible(g.id) then
          r := jsonb_build_object('ok',false,'code','subscription_inactive','intent',private.whatsapp_send_intent_public(i));
          raise exception 'STAFF_PAID_DISPATCH_DENIED' using errcode='PWA03';
        end if;
      end if;
      perform set_config('velora.staff_claim_binding','1',true);
      update public.whatsapp_send_intents
      set staff_claim_plan_version_id=s.plan_version_id,
          staff_claim_paid_through=(proof->>'paid_through')::timestamptz
      where id=i.id and outcome='attempting' and attempt_token=(r->>'attempt_token')::uuid;
      perform set_config('velora.staff_claim_binding','',true);
      return r || jsonb_build_object(
        'manual_paid_entitlement', jsonb_build_object(
          'company_id', i.company_id,
          'environment', 'live',
          'plan_version_id', coalesce(proof->>'plan_version_id', 'es02'),
          'paid_through', proof->'paid_through'
        )
      );
    end if;
    return r;
  exception
    when sqlstate 'PWA03' then return r;
    when lock_not_available then return jsonb_build_object('ok',false,'code','subscription_inactive','intent',private.whatsapp_send_intent_public(i));
  end;
end;
$body$;

revoke all on function private.wa_f5_pre_number_gate_claim_staff(uuid, uuid, integer) from public, anon, authenticated, service_role;

create or replace function public.whatsapp_authorize_staff_dispatch(p_intent_id uuid, p_attempt_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  i public.whatsapp_send_intents%rowtype;
  c public.whatsapp_conversations%rowtype;
  s public.billing_subscriptions%rowtype;
  g record;
  window_gate jsonb;
  now_at timestamptz;
  es02_pt timestamptz;
begin
  if current_setting('role',true)<>'authenticated' or auth.uid() is null then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  select * into i from public.whatsapp_send_intents where id=p_intent_id;
  if not found or i.sender_kind<>'staff' or i.actor_user_id is distinct from auth.uid()
    or i.staff_actor_session_id is null or i.staff_actor_session_id::text is distinct from auth.jwt()->>'session_id'
    or p_attempt_token is null or i.attempt_token is distinct from p_attempt_token
  then
    return jsonb_build_object('ok',false,'code','dispatch_binding_mismatch');
  end if;
  -- Same business lock order as claim, payment settlement and recovery.
  perform 1 from public.companies where id=i.company_id for no key update;
  select * into s from public.billing_subscriptions where company_id=i.company_id and environment='live' for no key update;
  select * into c from public.whatsapp_conversations where id=i.conversation_id and company_id=i.company_id for update;
  select * into i from public.whatsapp_send_intents where id=p_intent_id for update;
  if i.staff_dispatch_token is not null then
    return jsonb_build_object('ok',false,'code','dispatch_already_authorized');
  end if;
  if i.outcome<>'attempting' or i.attempt_token is distinct from p_attempt_token
    or i.actor_user_id is distinct from auth.uid() or i.staff_actor_session_id::text is distinct from auth.jwt()->>'session_id'
    or c.id is null or c.phone_number_id is distinct from i.phone_number_id or c.customer_wa_id is distinct from i.recipient_wa_id
  then
    return jsonb_build_object('ok',false,'code','dispatch_binding_mismatch');
  end if;
  if not exists(select 1 from public.companies where id=i.company_id and status='active')
    or not private.wa_staff_session_authority(i.actor_user_id,i.staff_actor_session_id,i.company_id,c.assigned_to)
  then
    return jsonb_build_object('ok',false,'code','staff_authority_revoked');
  end if;

  es02_pt := private.billing_es02_live_paid_through(i.company_id);
  if s.plan_version_id is null then
    if es02_pt is null or es02_pt is distinct from s.paid_through or s.paid_through <= clock_timestamp() then
      return jsonb_build_object('ok',false,'code','paid_entitlement_unconfirmed');
    end if;
  else
    -- Lock the exact receipt read set. NOWAIT also covers reverse-order administrative edits.
    select * into g from private.billing_proven_entitlement_grants
    where subscription_id=s.id and company_id=i.company_id
      and provider_environment='live' and plan_version_id=s.plan_version_id and applied_paid_through=s.paid_through
    order by id limit 1;
    if g.id is null then
      return jsonb_build_object('ok',false,'code','paid_entitlement_unconfirmed');
    end if;
    perform 1 from public.billing_entitlement_applications where id=g.id for share nowait;
    perform 1 from public.billing_orders where id=g.order_id for share nowait;
    perform 1 from public.billing_payment_attempts where id=g.payment_attempt_id for share nowait;
    perform 1 from public.billing_provider_events where id=g.provider_event_id for share nowait;
    perform 1 from public.billing_settlement_outcomes where entitlement_application_id=g.id for share nowait;
  end if;

  if i.link_id is not null then
    perform 1 from public.whatsapp_company_links where id=i.link_id for share nowait;
  end if;
  if not private.whatsapp_intent_link_current(i) then
    return jsonb_build_object('ok',false,'code','link_changed');
  end if;
  window_gate := private.whatsapp_service_window(i.company_id,i.conversation_id,i.phone_number_id,i.recipient_wa_id);
  now_at := clock_timestamp();
  if window_gate->>'ok' is distinct from 'true' or (window_gate->>'valid_until')::timestamptz<=now_at then
    return jsonb_build_object('ok',false,'code','service_window_closed');
  end if;
  -- Final time and proof checks after all locks/window work; retain immutable evidence.
  if i.attempt_expires_at is null or i.attempt_expires_at<=now_at
    or not private.wa_staff_session_authority(i.actor_user_id,i.staff_actor_session_id,i.company_id,c.assigned_to)
  then
    return jsonb_build_object('ok',false,'code','staff_authority_expired');
  end if;
  if s.status not in ('active','cancel_at_period_end') or s.paid_through<=clock_timestamp()
    or i.staff_claim_plan_version_id is distinct from s.plan_version_id
    or i.staff_claim_paid_through is distinct from s.paid_through
  then
    return jsonb_build_object('ok',false,'code','paid_entitlement_unconfirmed');
  end if;

  if s.plan_version_id is null then
    if es02_pt is null or es02_pt is distinct from s.paid_through then
      return jsonb_build_object('ok',false,'code','paid_entitlement_unconfirmed');
    end if;
  else
    if not exists(
      select 1 from private.billing_proven_entitlement_grants
      where id=g.id and subscription_id=s.id
        and company_id=i.company_id and provider_environment='live'
        and plan_version_id=s.plan_version_id and applied_paid_through=s.paid_through
    ) or not private.billing_service_receipt_eligible(g.id) then
      return jsonb_build_object('ok',false,'code','paid_entitlement_unconfirmed');
    end if;
  end if;

  perform set_config('velora.staff_dispatch_binding','1',true);
  update public.whatsapp_send_intents
  set staff_dispatch_token=p_attempt_token,
      staff_dispatch_authorized_at=clock_timestamp()
  where id=i.id;
  perform set_config('velora.staff_dispatch_binding','',true);
  return jsonb_build_object('ok',true,'authorized',true,'intent_id',i.id);
exception
  when lock_not_available then
    return jsonb_build_object('ok',false,'code','dispatch_authority_busy');
end;
$body$;

revoke all on function public.whatsapp_authorize_staff_dispatch(uuid, uuid) from public, anon, service_role;
grant execute on function public.whatsapp_authorize_staff_dispatch(uuid, uuid) to authenticated;

commit;
