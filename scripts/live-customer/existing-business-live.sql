-- REVIEW CANDIDATE ONLY. No hosted application authorized by this file.
-- Existing prelaunch Test company -> one verified Live purchase, same identities.
begin;
set local role postgres;
set local lock_timeout='5s';
set local statement_timeout='45s';
do $$begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.es02_finish_thawani_live_checkout(uuid,uuid)'::regprocedure) is distinct from 'dc9a706d17abde2e069c47ea5d2ebe2d' then raise exception 'EXISTING_LIVE_FINISH_BASELINE_DRIFT';end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.es02_paid_branch_readiness(uuid,uuid)'::regprocedure) is distinct from 'c84f4d00f1e63d42e120aeb8688452d8' then raise exception 'EXISTING_LIVE_READINESS_BASELINE_DRIFT';end if;
 if not exists(select 1 from pg_constraint where conrelid='private.es02_branch_channel_selections'::regclass and confrelid='private.es02_branch_slot_rights'::regclass and conname='es02_branch_channel_selections_order_id_slot_index_fkey' and not condeferrable and pg_get_constraintdef(oid)='FOREIGN KEY (order_id, slot_index) REFERENCES private.es02_branch_slot_rights(order_id, slot_index)') then raise exception 'EXISTING_LIVE_CHANNEL_FK_BASELINE_DRIFT';end if;
end$$;
-- Default remains IMMEDIATE. Only the paired rights/preference update below
-- explicitly defers this FK, then validates it before continuing/returning.
alter table private.es02_branch_channel_selections alter constraint es02_branch_channel_selections_order_id_slot_index_fkey deferrable initially immediate;

-- Installed only with a reviewed exact account/order/company/branch target.
create table private.es02_existing_live_targets(
 order_id uuid primary key references private.es02_account_orders(id),
 account_id uuid not null references auth.users(id),
 company_id uuid not null unique references public.companies(id),
 branch_id uuid not null, test_order_id uuid not null unique references private.es02_account_orders(id),
 approved_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id),
 check(order_id<>test_order_id)
);
-- Immutable historical evidence; not a second spendable entitlement projection.
create table private.es02_purchase_environment_history(
 order_id uuid primary key references private.es02_account_orders(id),
 account_id uuid not null references auth.users(id),company_id uuid not null references public.companies(id),
 environment text not null check(environment in ('test','live')),
 order_snapshot jsonb not null, activation jsonb not null,rights jsonb not null,
 credits jsonb not null,subscription jsonb not null,channel_selection jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 check(order_snapshot->>'id'=order_id::text),
 check(order_snapshot->>'environment'=environment),
 check(activation->>'company_id'=company_id::text),
 check(activation->>'order_id'=order_id::text),
 check(jsonb_typeof(rights)='array' and jsonb_typeof(credits)='array')
);
create table private.es02_existing_live_bindings(
 order_id uuid primary key references private.es02_existing_live_targets(order_id),
 account_id uuid not null references auth.users(id),company_id uuid not null unique references public.companies(id),
 branch_id uuid not null,test_order_id uuid not null references private.es02_purchase_environment_history(order_id),
 bound_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id)
);
alter table private.es02_existing_live_targets enable row level security;
alter table private.es02_purchase_environment_history enable row level security;
alter table private.es02_existing_live_bindings enable row level security;
revoke all on private.es02_existing_live_targets,private.es02_purchase_environment_history,private.es02_existing_live_bindings from public,anon,authenticated,service_role;
create function private.es02_existing_live_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'ES02_ENVIRONMENT_EVIDENCE_IMMUTABLE' using errcode='23514';end$$;
revoke all on function private.es02_existing_live_immutable() from public,anon,authenticated,service_role;
do $$declare rel text;begin
 foreach rel in array array['es02_existing_live_targets','es02_purchase_environment_history','es02_existing_live_bindings'] loop
  execute format('create trigger evidence_immutable before update or delete on private.%I for each row execute function private.es02_existing_live_immutable()',rel);
  -- Respect the installed account-deletion cutover; never bypass another agent's fence.
  if to_regprocedure('private.ad_write_fence()') is not null then
   execute format('create trigger ad_account_write_fence before insert or update or delete on private.%I for each row execute function private.ad_write_fence()',rel);
  end if;
 end loop;
end$$;

create function private.es02_capture_environment_history(p_company uuid,p_order uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into private.es02_purchase_environment_history(order_id,account_id,company_id,environment,order_snapshot,activation,rights,credits,subscription,channel_selection)
 select o.id,o.account_id,p_company,o.environment,to_jsonb(o),to_jsonb(a),
  coalesce((select jsonb_agg(to_jsonb(r) order by r.slot_index) from private.es02_branch_slot_rights r where r.company_id=p_company and r.order_id=o.id),'[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from private.es02_credit_balances c where c.company_id=p_company and c.order_group_id=o.original_order_group_id),'[]'::jsonb),
  coalesce((select to_jsonb(s) from public.billing_subscriptions s where s.company_id=p_company and s.environment=o.environment),'null'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(s) order by s.branch_id) from private.es02_branch_channel_selections s where s.company_id=p_company and s.order_id=o.id),'[]'::jsonb)
 from private.es02_account_orders o join private.es02_activation_foundation a on a.company_id=p_company and a.order_id=o.id
 where o.id=p_order and o.provisioned_company_id=p_company and o.status='provisioned';
 if not found then raise exception 'ES02_HISTORY_SCOPE_INVALID';end if;
end$$;
revoke all on function private.es02_capture_environment_history(uuid,uuid) from public,anon,authenticated,service_role;

create function private.es02_bind_existing_thawani_live(p_expected_account_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;t private.es02_existing_live_targets;o private.es02_account_orders;old_order private.es02_account_orders;
 a private.es02_activation_foundation;r private.es02_branch_slot_rights;sel private.es02_branch_channel_selections;
 prior private.es02_existing_live_bindings;slot jsonb;payload jsonb;op uuid;now_at timestamptz;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select * into t from private.es02_existing_live_targets where order_id=p_order_id and account_id=actor;
 if t.order_id is null then return jsonb_build_object('ok',false,'code','EXISTING_COMPANY_TARGET_REQUIRED');end if;
 -- Same actor provision lock as every account checkout. Company-first row lock
 -- serializes against branch/service workers before any entitlement mutation.
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':es02-provision',0));
 perform 1 from public.companies where id=t.company_id for no key update;
 perform 1 from public.company_members where company_id=t.company_id and user_id=actor and role='owner' and status='active' for share;
 if not found or private.es02_require_active_actor(actor) is distinct from actor then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from private.es02_account_orders where id in (t.order_id,t.test_order_id) order by id for update;
 select * into o from private.es02_account_orders where id=t.order_id and account_id=actor;
 select * into old_order from private.es02_account_orders where id=t.test_order_id and account_id=actor;
 if o.id is null or not coalesce(private.es02_verified_live_catalog_order(o),false)
  or o.status not in ('settled','provisioned') or o.purpose<>'initial_subscription' then return jsonb_build_object('ok',false,'code','VERIFIED_LIVE_PAYMENT_REQUIRED');end if;
 select * into a from private.es02_activation_foundation where company_id=t.company_id for update;
 select * into r from private.es02_branch_slot_rights where company_id=t.company_id and branch_id=t.branch_id for update;
 select * into prior from private.es02_existing_live_bindings where order_id=o.id;
 if prior.order_id is not null then
  if prior.company_id=t.company_id and prior.account_id=actor and prior.branch_id=t.branch_id and prior.test_order_id=t.test_order_id
   and o.status='provisioned' and o.provisioned_company_id=t.company_id and a.order_id=o.id and r.order_id=o.id
   and exists(select 1 from private.es02_purchase_environment_history where order_id=o.id and environment='live')
   and exists(select 1 from private.es02_purchase_environment_history where order_id=t.test_order_id and environment='test') then
   return jsonb_build_object('ok',true,'action','reuse','data',jsonb_build_object('companyId',t.company_id,'orderId',o.id,'orderGroupId',o.original_order_group_id));
  end if;
  return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');
 end if;
 if o.status<>'settled' or o.provisioned_company_id is not null
  or old_order.id is null or old_order.environment is distinct from 'test' or old_order.status is distinct from 'provisioned' or old_order.provisioned_company_id is distinct from t.company_id
  or a.company_id is null or a.order_id is distinct from old_order.id or a.account_id is distinct from actor or a.order_group_id is distinct from old_order.original_order_group_id
  or a.clock_state is distinct from 'waiting_readiness' or a.subscription_started_at is not null or a.paid_through_at is not null
  or a.first_channel_ready or a.actual_ai_ready or a.operational_ready
  or r.id is null or r.order_id<>old_order.id or r.slot_index<>0
  or not exists(select 1 from public.companies where id=t.company_id and created_by=actor and status='setup')
  or not exists(select 1 from public.company_branches where id=t.branch_id and company_id=t.company_id and is_primary and status='setup')
  or (select count(*) from public.company_branches where company_id=t.company_id)<>1
  or (select count(*) from private.es02_branch_slot_rights where company_id=t.company_id)<>1
  or not exists(select 1 from public.billing_subscriptions where company_id=t.company_id and environment='test' and status='awaiting_payment' and paid_through is null and plan_version_id is null)
  or o.branch_slots<>1 or jsonb_array_length(o.slots)<>1 then
  return jsonb_build_object('ok',false,'code','PRELAUNCH_TEST_SCOPE_REQUIRED');end if;
 slot:=o.slots->0;
 if slot->>'persona' is distinct from r.persona or slot->>'package' is distinct from r.package or o.term is distinct from r.term
  or (slot->>'amountBaisa')::integer is distinct from r.amount_baisa
  or (slot->>'repliesPerMonth')::integer is distinct from r.replies_per_month
  or (slot->>'employees')::integer is distinct from r.employees or (slot->>'channels')::integer is distinct from r.channels then
  return jsonb_build_object('ok',false,'code','SAME_PLAN_REQUIRED');end if;
 -- This bounded cutover cannot discard or reset used/uncertain service work.
 if exists(select 1 from public.whatsapp_inbound_jobs where company_id=t.company_id)
  or exists(select 1 from private.es02_reply_credit_holds where company_id=t.company_id)
  or exists(select 1 from private.es02_branch_trial_operations where company_id=t.company_id)
  or exists(select 1 from private.es02_branch_assistant_trials where company_id=t.company_id)
  or exists(select 1 from private.es02_branch_launch_confirmations where company_id=t.company_id)
  or exists(select 1 from private.es02_b3_connection_attempts where company_id=t.company_id)
  or exists(select 1 from private.es02_credit_balances where company_id=t.company_id and (kind<>'base' or remaining<>granted))
  or exists(select 1 from public.billing_subscriptions where company_id=t.company_id and environment='live')
  or exists(select 1 from private.es02_account_provisioning where order_id=o.id)
  or exists(select 1 from private.es02_purchase_environment_history where order_id in(o.id,old_order.id)) then
  return jsonb_build_object('ok',false,'code','CUTOVER_RECONCILIATION_REQUIRED');end if;
 select * into sel from private.es02_branch_channel_selections where company_id=t.company_id and branch_id=t.branch_id for update;
 if sel.id is not null and (sel.order_id<>old_order.id or sel.account_id<>actor or sel.slot_index<>0) then
  return jsonb_build_object('ok',false,'code','CHANNEL_SCOPE_CHANGED');end if;
 -- All checks precede writes; any error rolls back history and the full cutover.
 perform private.es02_capture_environment_history(t.company_id,old_order.id);
 now_at:=clock_timestamp();
 set constraints private.es02_branch_channel_selections_order_id_slot_index_fkey deferred;
 update private.es02_branch_slot_rights set order_id=o.id where id=r.id;
 update private.es02_activation_foundation set order_id=o.id,order_group_id=o.original_order_group_id,
  payment_confirmed_at=o.settled_at,entitlement_created_at=now_at,activation_deadline_at=o.settled_at+interval '7 days',updated_at=now_at
 where company_id=t.company_id;
 -- Keep the same preference only. B3 provider connection proofs are never copied.
 if sel.id is not null then
  op:=gen_random_uuid();payload:=jsonb_build_object('accountId',actor,'companyId',t.company_id,'branchId',t.branch_id,'clientOpId',op,'channels',sel.channels,'orderId',o.id,'slotIndex',0);
  update private.es02_branch_channel_selections set order_id=o.id,client_op_id=op,request_payload=payload,request_fingerprint=md5(payload::text) where id=sel.id;
 end if;
 set constraints private.es02_branch_channel_selections_order_id_slot_index_fkey immediate;
 insert into public.billing_subscriptions(company_id,environment,status,paid_through) values(t.company_id,'live','awaiting_payment',null);
 insert into private.es02_credit_balances(company_id,order_group_id,kind,granted,remaining,ordinary_expiry) values(t.company_id,o.original_order_group_id,'base',o.replies_per_month,o.replies_per_month,null);
 insert into private.es02_account_provisioning(order_id,account_id,company_id,state,idempotency_key,completed_at) values(o.id,actor,t.company_id,'completed',o.id,now_at);
 update private.es02_account_orders set status='provisioned',provisioned_company_id=t.company_id,updated_at=now_at where id=o.id;
 perform private.es02_capture_environment_history(t.company_id,o.id);
 insert into private.es02_existing_live_bindings(order_id,account_id,company_id,branch_id,test_order_id) values(o.id,actor,t.company_id,t.branch_id,old_order.id);
 return jsonb_build_object('ok',true,'action','provisioned','data',jsonb_build_object('companyId',t.company_id,'orderId',o.id,'orderGroupId',o.original_order_group_id));
end$$;
revoke all on function private.es02_bind_existing_thawani_live(uuid,uuid) from public,anon,authenticated,service_role;

-- Route an explicitly approved existing-company target before the old new-company path.
do $$declare target regprocedure:='public.es02_finish_thawani_live_checkout(uuid,uuid)'::regprocedure;definition text;prior_acl aclitem[];anchor text:=' perform pg_advisory_xact_lock(hashtextextended(actor::text||'':es02-provision'',0));';begin
 select proacl into prior_acl from pg_proc where oid=target;definition:=replace(pg_get_functiondef(target),chr(13),'');
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'EXISTING_LIVE_FINISH_PATCH_AMBIGUOUS';end if;
 definition:=replace(definition,anchor,$route$
 if exists(select 1 from private.es02_existing_live_targets where order_id=p_order_id and account_id=actor) then
  return private.es02_bind_existing_thawani_live(actor,p_order_id);
 end if;
$route$||anchor);execute definition;
 if (select proacl from pg_proc where oid=target) is distinct from prior_acl then raise exception 'EXISTING_LIVE_FINISH_ACL_DRIFT';end if;
end$$;

-- Thawani cash is discounted independently of catalog rights. Require its exact
-- existing grant/session/invoice/ledger proof; retain all operational guards.
do $$declare target regprocedure:='private.es02_paid_branch_readiness(uuid,uuid)'::regprocedure;definition text;prior_acl aclitem[];
 authority text:='or o.environment is distinct from ''live'' or o.settlement_authority is distinct from ''paymob_hmac''';
 amount_gate text:='e.amount_baisa=o.amount_baisa and e.currency=o.currency';begin
 select proacl into prior_acl from pg_proc where oid=target;definition:=replace(pg_get_functiondef(target),chr(13),'');
 if length(definition)-length(replace(definition,authority,''))<>length(authority) or length(definition)-length(replace(definition,amount_gate,''))<>length(amount_gate) then raise exception 'EXISTING_LIVE_READINESS_PATCH_AMBIGUOUS';end if;
 definition:=replace(definition,authority,'or o.environment is distinct from ''live'' or (o.settlement_authority is distinct from ''paymob_hmac'' and not coalesce(private.es02_verified_live_catalog_order(o),false))');
 definition:=replace(definition,amount_gate,'(e.amount_baisa=o.amount_baisa or (coalesce(private.es02_verified_live_catalog_order(o),false) and e.evidence_marker=''thawani_api_verified_live'' and e.amount_baisa=100)) and e.currency=o.currency');execute definition;
 if (select proacl from pg_proc where oid=target) is distinct from prior_acl then raise exception 'EXISTING_LIVE_READINESS_ACL_DRIFT';end if;
end$$;
notify pgrst,'reload schema';
commit;
