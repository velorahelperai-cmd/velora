-- CLI-generated local candidate. Extends canonical financial allocation and
-- proof/settlement; no alternative provider, price seed or provider execution.
begin;
create table private.master_checkout_upgrades (
 order_id uuid primary key references public.billing_orders(id),company_id uuid not null references public.companies(id),
 subscription_id uuid not null references public.billing_subscriptions(id),cycle_receipt_id uuid not null references public.billing_entitlement_applications(id),
 prior_plan_version_id uuid not null references public.billing_plan_versions(id),target_plan_version_id uuid not null references public.billing_plan_versions(id),
 original_paid_through timestamptz not null,effective_expires_at timestamptz not null,subscription_started_at timestamptz not null
);
alter table private.master_checkout_upgrades enable row level security;
revoke all on private.master_checkout_upgrades from public,anon,authenticated,service_role;
create trigger master_checkout_upgrade_immutable before update or delete on private.master_checkout_upgrades for each row execute function private.master_checkout_immutable();
create trigger master_checkout_upgrade_no_truncate before truncate on private.master_checkout_upgrades for each statement execute function private.master_checkout_immutable();
create function private.master_checkout_upgrade_contract(cid uuid,target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g record;sub public.billing_subscriptions%rowtype;ends timestamptz;starts timestamptz;activation_rows integer;begin
 if to_regclass('private.billing_proven_entitlement_grants') is null then return null;end if;
 select * into sub from public.billing_subscriptions where company_id=cid and environment='live' and status in('active','cancel_at_period_end');
 if not found then return null;end if;
 if not exists(select 1 from private.billing_service_offers f join public.billing_plan_versions v on v.id=f.plan_version_id where f.plan_version_id=sub.plan_version_id and f.tier='basic' and v.amount_baisa=45000)
  or not exists(select 1 from private.billing_service_offers f join public.billing_plan_versions v on v.id=f.plan_version_id where f.plan_version_id=target and f.tier='premium' and v.amount_baisa=90000 and v.status='published' and v.limits->>'automated_outbound_per_month'='1500') then return null;end if;
 select proof.* into g from private.billing_proven_entitlement_grants proof where proof.company_id=cid and proof.subscription_id=sub.id and proof.provider_environment='live' and proof.plan_version_id=sub.plan_version_id and proof.applied_paid_through=sub.paid_through order by proof.applied_at desc,proof.id desc limit 1;
 if not found then return null;end if;
 if not private.billing_service_receipt_eligible(g.id) then return null;end if;
 ends:=sub.paid_through;starts:=g.applied_at;
 if to_regclass('private.master_subscription_activation') is not null then
  execute 'select subscription_started_at,expires_at from private.master_subscription_activation where receipt_id=$1' into starts,ends using g.id;
  get diagnostics activation_rows=row_count;
  if activation_rows>0 and starts is null then return null;end if;
  if activation_rows=0 then
   if exists(select 1 from private.master_activation_policy where enabled and g.applied_at>=enabled_at) then return null;end if;
   starts:=g.applied_at;ends:=sub.paid_through;
  end if;
 end if;
 if ends is null or ends<=clock_timestamp() then return null;end if;
 return jsonb_build_object('subscription_id',g.subscription_id,'cycle_receipt_id',g.id,'prior_plan_version_id',g.plan_version_id,'original_paid_through',sub.paid_through,'effective_expires_at',ends,'subscription_started_at',starts);
end;$$;
create function private.master_checkout_bind_upgrade() returns trigger language plpgsql security definer set search_path='' as $$declare b jsonb;begin
 if new.purchase_purpose<>'upgrade' then return new;end if;
 b:=private.master_checkout_upgrade_contract(new.company_id,new.plan_version_id);
 if b is null or new.provider_environment<>'live' or new.amount_baisa<>45000 or new.currency<>'OMR' then raise exception 'UPGRADE_NOT_AVAILABLE';end if;
 insert into private.master_checkout_upgrades values(new.id,new.company_id,(b->>'subscription_id')::uuid,(b->>'cycle_receipt_id')::uuid,(b->>'prior_plan_version_id')::uuid,new.plan_version_id,(b->>'original_paid_through')::timestamptz,(b->>'effective_expires_at')::timestamptz,(b->>'subscription_started_at')::timestamptz);
 return new;
end;$$;
create trigger master_checkout_bind_upgrade after insert on public.billing_orders for each row execute function private.master_checkout_bind_upgrade();

do $$declare f regprocedure;d text;anchor text;replacement text;v text;begin
 f:='public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'::regprocedure;
 d:=replace(pg_get_functiondef(f),chr(13),'');
 anchor:='p_purchase_purpose not in (''initial'', ''renew'')';
 if position(anchor in d)=0 then raise exception 'UPGRADE_PURPOSE_BODY_REQUIRES_REVIEW';end if;
 d:=replace(d,anchor,'p_purchase_purpose not in (''initial'', ''renew'', ''upgrade'')');
 anchor:='if p_amount_baisa is distinct from v_pv.amount_baisa';
 if position(anchor in d)=0 then raise exception 'UPGRADE_PRICE_BODY_REQUIRES_REVIEW';end if;
 d:=replace(d,anchor,'if (p_purchase_purpose<>''upgrade'' and p_amount_baisa is distinct from v_pv.amount_baisa) or (p_purchase_purpose=''upgrade'' and p_amount_baisa<>45000)');
 anchor:=E'    v_pv.amount_baisa,\n    v_pv.currency,';
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'UPGRADE_INSERT_PRICE_BODY_REQUIRES_REVIEW';end if;
 d:=replace(d,anchor,E'    case when p_purchase_purpose=''upgrade'' then 45000 else v_pv.amount_baisa end,\n    v_pv.currency,');
 d:=replace(d,'if private.master_activation_blocks_purchase(p_company_id)','if p_purchase_purpose<>''upgrade'' and private.master_activation_blocks_purchase(p_company_id)');
 anchor:='  -- D3: Atomically verify plan and version publication status and lock catalog row';
 if position(anchor in d)=0 then raise exception 'UPGRADE_LOCK_BODY_REQUIRES_REVIEW';end if;
 d:=replace(d,anchor,'if p_purchase_purpose=''upgrade'' and (p_provider_environment<>''live'' or private.master_checkout_upgrade_contract(p_company_id,p_plan_version_id) is null) then return jsonb_build_object(''ok'',false,''code'',''UPGRADE_NOT_AVAILABLE'');end if;'||E'\n'||anchor);
 execute d;
 -- Canonical reviewed Live creator, same configuration, session, quota, budget,
 -- unknown-attempt barrier, commercial snapshot and Paymob binding path.
 f:=to_regprocedure('public.billing_create_live_checkout_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer)');
 if f is not null then
  d:=replace(pg_get_functiondef(f),chr(13),'');
  d:=replace(d,'public.billing_create_live_checkout_order(','public.billing_create_live_upgrade_order(');
  d:=replace(d,'''velora_ai_staff'',''initial''','''velora_ai_staff'',''upgrade''');
  anchor:='fingerprint,reference,v.amount_baisa,v.currency';
  if position(anchor in d)=0 then raise exception 'UPGRADE_LIVE_PRICE_BODY_REQUIRES_REVIEW';end if;
  d:=replace(d,anchor,'fingerprint,reference,45000,v.currency');
  d:=replace(d,'if private.master_activation_blocks_purchase(p_company_id)','if private.master_checkout_upgrade_contract(p_company_id,p_plan_version_id) is null');
  execute d;
  execute 'revoke all on function public.billing_create_live_upgrade_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer) from public,anon,authenticated';
  execute 'grant execute on function public.billing_create_live_upgrade_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer) to service_role';
 end if;
 f:=to_regprocedure('public.billing_claim_live_checkout(uuid,uuid,uuid,uuid,uuid)');
 if f is not null then
  d:=replace(pg_get_functiondef(f),chr(13),'');
  d:=replace(d,'if private.master_activation_blocks_purchase(p_company_id)','if private.master_activation_blocks_purchase(p_company_id) and not exists(select 1 from private.master_checkout_upgrades b join public.billing_subscriptions native_sub on native_sub.id=b.subscription_id and native_sub.company_id=b.company_id where b.order_id=p_order_id and b.company_id=p_company_id and native_sub.plan_version_id=b.prior_plan_version_id and native_sub.paid_through=b.original_paid_through and b.effective_expires_at>clock_timestamp())');
  anchor:=' if o.id is null or a.id is null';
  if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'UPGRADE_CLAIM_BODY_REQUIRES_REVIEW';end if;
  d:=replace(d,anchor,$guard$
  if o.purchase_purpose='upgrade' and not exists(select 1 from private.master_checkout_upgrades b join public.billing_subscriptions native_sub on native_sub.id=b.subscription_id and native_sub.company_id=b.company_id
   where b.order_id=o.id and b.company_id=p_company_id and native_sub.plan_version_id=b.prior_plan_version_id and native_sub.paid_through=b.original_paid_through and b.effective_expires_at>clock_timestamp() and private.billing_service_receipt_eligible(b.cycle_receipt_id)) then return jsonb_build_object('kind','rejected','code','UPGRADE_CYCLE_CONFLICT');end if;
  $guard$||anchor);
  execute d;
 end if;
 -- Extend the authoritative original settlement behind the HMAC acceptance
 -- wrapper. Replay and duplicate collection branches remain earlier in body.
 f:=coalesce(to_regprocedure('private.billing_settle_payment_core_pre_acceptance(jsonb)'),to_regprocedure('private.billing_settle_payment_core(jsonb)'));
 if f is null then raise exception 'UPGRADE_NATIVE_SETTLEMENT_REQUIRED';end if;
 d:=replace(pg_get_functiondef(f),chr(13),'');
 anchor:=E'  v_applied_paid_through := private.billing_add_calendar_period(\n    greatest(coalesce(v_active_until, v_now), v_now),\n    v_pv.period_unit,\n    v_pv.period_count\n  );';
 replacement:=$body$
 if v_order.purchase_purpose='upgrade' then
  select b.original_paid_through into v_applied_paid_through from private.master_checkout_upgrades b
  where b.order_id=v_order_id and b.company_id=v_company_id and b.subscription_id=v_sub.id
   and b.prior_plan_version_id=v_sub.plan_version_id and b.target_plan_version_id=v_order.plan_version_id
   and b.original_paid_through=v_sub.paid_through and v_order.amount_baisa=45000 and v_order.currency='OMR';
  if not found then raise exception 'UPGRADE_CYCLE_CONFLICT';end if;
 else
  v_applied_paid_through := private.billing_add_calendar_period(
    greatest(coalesce(v_active_until, v_now), v_now), v_pv.period_unit, v_pv.period_count);
 end if;
 $body$;
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'UPGRADE_SETTLEMENT_BODY_REQUIRES_REVIEW';end if;
 d:=replace(d,anchor,replacement);
 d:=replace(d,'cancel_at_period_end = false','cancel_at_period_end = case when v_order.purchase_purpose=''upgrade'' then v_sub.cancel_at_period_end else false end');
 execute d;
 -- Retain complete HMAC/provider proof in the existing historical view. Only
 -- exact approved delta with immutable original-cycle binding bypasses full
 -- catalog price equality; ordinary receipts keep their exact previous proof.
 if to_regclass('private.billing_verified_collection_history') is not null then
  d:=pg_get_viewdef('private.billing_verified_collection_history'::regclass,true);
  anchor:='o.amount_baisa = pv.amount_baisa';
  if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'UPGRADE_HISTORY_BODY_REQUIRES_REVIEW';end if;
  replacement:='(o.amount_baisa = pv.amount_baisa or (o.purchase_purpose=''upgrade'' and o.amount_baisa=45000 and pv.amount_baisa=90000 and exists(select 1 from private.master_checkout_upgrades b where b.order_id=o.id and b.company_id=o.company_id and b.subscription_id=g.subscription_id and b.target_plan_version_id=o.plan_version_id and b.original_paid_through=g.applied_paid_through and b.original_paid_through=g.previous_paid_through)))';
  execute 'create or replace view private.billing_verified_collection_history as '||replace(d,anchor,replacement);
 end if;
end;$$;
-- Keep the initial/renewal activation row as the canonical operational cycle.
-- A verified upgrade changes the current plan proof, never its clock or bonus.
do $$declare f regprocedure;d text;anchor text;begin
 f:=to_regprocedure('private.master_activation_receipt_current(uuid)');
 if f is null then return;end if;
 alter function private.master_activation_receipt_current(uuid) rename to master_activation_receipt_current_pre_upgrade;
 -- Keep every native current-proof predicate, evaluated in two bounded SQL
 -- statements instead of expanding the receipt view twice in one join plan.
 execute $sql$create or replace function private.master_activation_receipt_current_pre_upgrade(rid uuid) returns boolean language plpgsql volatile security definer set search_path='' set jit=off as $fn$
 begin
 perform 1 from private.billing_proven_entitlement_grants g join public.billing_subscriptions s on s.id=g.subscription_id and s.company_id=g.company_id
 where g.id=rid and g.provider_environment='live' and s.environment='live' and s.status in('active','cancel_at_period_end')
 and s.plan_version_id=g.plan_version_id and s.paid_through=g.applied_paid_through;
 if not found then return false;end if;
 return private.billing_service_receipt_eligible(rid);
 end;$fn$;$sql$;
 execute $sql$create function private.master_activation_receipt_current(rid uuid) returns boolean language plpgsql volatile security definer set search_path='' as $fn$
 declare upgraded uuid;begin
 if private.master_activation_receipt_current_pre_upgrade(rid) then return true;end if;
 select upgrade.id into upgraded from private.master_checkout_upgrades b
 join public.billing_entitlement_applications original on original.id=b.cycle_receipt_id and original.subscription_id=b.subscription_id and original.company_id=b.company_id
 join public.billing_entitlement_applications upgrade on upgrade.order_id=b.order_id and upgrade.subscription_id=b.subscription_id and upgrade.company_id=b.company_id
 join public.billing_orders upgraded_order on upgraded_order.id=upgrade.order_id and upgraded_order.plan_version_id=b.target_plan_version_id
 where b.cycle_receipt_id=rid and original.applied_paid_through=b.original_paid_through and upgrade.applied_paid_through=b.original_paid_through limit 1;
 if upgraded is null then return false;end if;
 return private.billing_service_receipt_eligible(rid) and private.master_activation_receipt_current_pre_upgrade(upgraded);
 end;
 $fn$;$sql$;
 execute $sql$create function private.master_upgrade_effective_plan(rid uuid,fallback uuid) returns uuid language plpgsql volatile security definer set search_path='' as $fn$
 declare upgraded uuid;target uuid;begin
 select g.id,b.target_plan_version_id into upgraded,target from private.master_checkout_upgrades b join public.billing_entitlement_applications g on g.order_id=b.order_id and g.company_id=b.company_id where b.cycle_receipt_id=rid limit 1;
 if upgraded is not null and private.master_activation_receipt_current_pre_upgrade(upgraded) and private.billing_service_receipt_eligible(rid) then return target;end if;
 return fallback;end;
 $fn$;$sql$;
 execute $sql$create function private.master_upgrade_cycle_receipt(rid uuid) returns uuid language plpgsql volatile security definer set search_path='' set jit=off as $fn$
 declare original uuid;begin
 select b.cycle_receipt_id into original from private.master_checkout_upgrades b join public.billing_entitlement_applications g on g.order_id=b.order_id and g.company_id=b.company_id where g.id=rid limit 1;
 if original is not null and private.master_activation_receipt_current_pre_upgrade(rid) and private.billing_service_receipt_eligible(original) then return original;end if;
 return rid;end;
 $fn$;$sql$;
 f:='private.master_activation_effective_end(uuid)'::regprocedure;
 alter function private.master_activation_effective_end(uuid) rename to master_activation_effective_end_pre_upgrade;
 execute $sql$create function private.master_activation_effective_end(rid uuid) returns timestamptz language plpgsql volatile security definer set search_path='' as $fn$
 declare original uuid;begin
 original:=private.master_upgrade_cycle_receipt(rid);
 return private.master_activation_effective_end_pre_upgrade(original);
 end;
 $fn$;$sql$;
 f:='private.master_activation_receipt_state(uuid)'::regprocedure;d:=replace(pg_get_functiondef(f),chr(13),'');anchor:='private.master_activation_ready(a.company_id,a.plan_version_id)';
 if position(anchor in d)=0 then raise exception 'UPGRADE_ACTIVATION_READ_BODY_REQUIRES_REVIEW';end if;
 execute replace(d,anchor,'private.master_activation_ready(a.company_id,private.master_upgrade_effective_plan(a.receipt_id,a.plan_version_id))');
 f:='public.master_capture_subscription_activation(uuid,uuid)'::regprocedure;d:=replace(pg_get_functiondef(f),chr(13),'');anchor:=' legacy:=g.applied_at<p.enabled_at;';
 if position(anchor in d)=0 then raise exception 'UPGRADE_ACTIVATION_CAPTURE_BODY_REQUIRES_REVIEW';end if;
 execute replace(d,anchor,$guard$
 if g.purchase_purpose='upgrade' then
  if not exists(select 1 from private.master_checkout_upgrades b join private.master_subscription_activation a on a.receipt_id=b.cycle_receipt_id and a.company_id=b.company_id where b.order_id=g.order_id and b.company_id=p_company_id and b.subscription_id=g.subscription_id and a.subscription_started_at=b.subscription_started_at and a.expires_at=b.effective_expires_at) then return jsonb_build_object('ok',false,'code','UPGRADE_CYCLE_CONFLICT');end if;
  return private.master_reconcile_activation_locked(p_company_id);
 end if;
 $guard$||anchor);
 f:=to_regprocedure('private.channel_operation_allowed(uuid,text,text)');
 if f is not null then
  d:=replace(pg_get_functiondef(f),chr(13),'');anchor:='where receipt_id=g.id and company_id=cid';
  if position(anchor in d)=0 then raise exception 'UPGRADE_CHANNEL_CYCLE_BODY_REQUIRES_REVIEW';end if;
  d:=replace(d,anchor,'where receipt_id=private.master_upgrade_cycle_receipt(g.id) and company_id=cid');
  anchor:='ends:=case when found then a.expires_at else g.applied_paid_through end;';
  if position(anchor in d)=0 then raise exception 'UPGRADE_CHANNEL_END_BODY_REQUIRES_REVIEW';end if;
  execute replace(d,anchor,'ends:=private.master_activation_effective_end(g.id);');
 end if;
 f:=to_regprocedure('private.master_activation_human_deadline(uuid,text,uuid)');
 if f is not null then
  d:=replace(pg_get_functiondef(f),chr(13),'');anchor:='receipt_id=rid';
  if position(anchor in d)=0 then raise exception 'UPGRADE_HUMAN_CYCLE_BODY_REQUIRES_REVIEW';end if;
  execute replace(d,anchor,'receipt_id=private.master_upgrade_cycle_receipt(rid)');
 end if;
 execute 'revoke all on function private.master_activation_receipt_current_pre_upgrade(uuid),private.master_activation_receipt_current(uuid),private.master_upgrade_effective_plan(uuid,uuid),private.master_upgrade_cycle_receipt(uuid),private.master_activation_effective_end_pre_upgrade(uuid),private.master_activation_effective_end(uuid) from public,anon,authenticated,service_role';
 execute 'alter function private.master_activation_receipt_current(uuid) set jit=off';
 execute 'alter function private.master_upgrade_effective_plan(uuid,uuid) set jit=off';
 execute 'alter function private.master_activation_effective_end(uuid) set jit=off';
end;$$;
-- Fold E's credit reset only after the native financial/service/C transaction.
-- Failure rolls the complete settlement back; duplicate webhook is idempotent.
do $$declare name text;sig text;f regprocedure;backing text;begin
 foreach name in array array['billing_settle_paymob_hmac_verified','billing_settle_live_paymob_hmac_verified'] loop
  sig:='public.'||name||'(jsonb)';f:=to_regprocedure(sig);if f is null then continue;end if;
  backing:=name||'_pre_master_upgrade';
  execute format('alter function public.%I(jsonb) set schema private',name);
  execute format('alter function private.%I(jsonb) rename to %I',name,backing);
  execute format('revoke all on function private.%I(jsonb) from public,anon,authenticated,service_role',backing);
  execute format($wrapper$create function public.%I(p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
  declare result jsonb;credit jsonb;company uuid;purpose text;begin
   if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
   result:=private.%I(p_evidence);
   if result->>'ok'='true' and result->>'outcome' in('granted','idempotent_replay') then
    select company_id,purchase_purpose into company,purpose from public.billing_orders where id=(result->>'order_id')::uuid;
    if purpose='upgrade' then
     if to_regprocedure('public.master_apply_cycle_upgrade(uuid,uuid)') is null then raise exception 'UPGRADE_CREDITS_UNCONFIGURED';end if;
     execute 'select public.master_apply_cycle_upgrade($1,$2)' into credit using company,(result->>'entitlement_application_id')::uuid;
     if credit->>'ok' is distinct from 'true' then raise exception 'UPGRADE_CREDIT_APPLY_FAILED: %%',credit->>'code';end if;
    end if;
   end if;
   return result;
  end;$fn$;$wrapper$,name,backing);
  execute format('revoke all on function public.%I(jsonb) from public,anon,authenticated',name);
  execute format('grant execute on function public.%I(jsonb) to service_role',name);
 end loop;
end;$$;
revoke all on function private.master_checkout_upgrade_contract(uuid,uuid),private.master_checkout_bind_upgrade() from public,anon,authenticated,service_role;
alter function private.master_checkout_upgrade_contract(uuid,uuid) set jit=off;
notify pgrst,'reload schema';
commit;
