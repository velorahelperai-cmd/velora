-- Real local PostgreSQL fixture. Synthetic user/content/provider evidence only.
do $$begin if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then raise exception 'DISPOSABLE_ONLY';end if;end$$;
-- Match the hosted legacy index, which the broader local migration chain removed.
create unique index if not exists company_members_one_active_owner_per_user on public.company_members(user_id) where role='owner' and status='active';
create function pg_temp.must(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'ASSERT_FAILED:%',label;end if;end$$;
create table public.existing_live_fixture(key text primary key,value jsonb);
create function public.existing_live_forced_failure() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_WRITE_FAILURE';end$$;
create function public.existing_live_concurrency_barrier() returns trigger language plpgsql as $$declare lock_key bigint;begin
 perform pg_sleep(5);
 lock_key:=hashtextextended(new.account_id::text||':es02-provision',0);
 insert into public.existing_live_fixture(key,value) select 'advisoryWaiters',to_jsonb(count(*)) from pg_locks
  where locktype='advisory' and not granted and classid::bigint=((lock_key>>32)&4294967295) and objid::bigint=(lock_key&4294967295) and objsubid=1;
 return new;end$$;
do $$
declare actor uuid:='177ef439-3fb0-4e3e-96b8-2a9e8661386d';sid uuid:=gen_random_uuid();lineage uuid:=gen_random_uuid();registry uuid:=gen_random_uuid();grantid uuid:=gen_random_uuid();oid uuid;oldid uuid:=gen_random_uuid();cid uuid;bid uuid;r jsonb;claim jsonb;o private.es02_account_orders;old private.es02_account_orders;before_state jsonb;company_before jsonb;sids jsonb;extra_sid uuid;extra_lineage uuid;extra_registry uuid;idx integer;
 prep jsonb:='{"name":"Synthetic existing shop","type":"retail","country":"OM","city":"Muscat","phone":"+96890000000","branches":[{"name":"Main","city":"Muscat"}]}';
begin
 insert into auth.users(id,email_confirmed_at) values(actor,clock_timestamp());
 insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(sid,actor,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour');
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values(sid,actor,clock_timestamp());
 insert into public.vel_broker_browser_lineages(id,bootstrap_hash,valid_until) values(lineage,'fixture-'||lineage,clock_timestamp()+interval '1 hour');
 insert into public.vel_broker_sessions(id,handle_hash,cookie_name,generation,user_id,native_session_id,access_token_enc,refresh_token_enc,token_expires_at,status,browser_lineage_id) values(registry,'fixture-'||registry,'fixture',1,actor,sid,'synthetic','synthetic',clock_timestamp()+interval '1 hour','active',lineage);
 update public.vel_broker_browser_lineages set current_registry_id=registry where id=lineage;
 sids:=jsonb_build_array(sid);
 for idx in 1..3 loop
  extra_sid:=gen_random_uuid();extra_lineage:=gen_random_uuid();extra_registry:=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(extra_sid,actor,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour');
  insert into private.app_session_activity(session_id,user_id,last_activity_at) values(extra_sid,actor,clock_timestamp());
  insert into public.vel_broker_browser_lineages(id,bootstrap_hash,valid_until) values(extra_lineage,'fixture-'||extra_lineage,clock_timestamp()+interval '1 hour');
  insert into public.vel_broker_sessions(id,handle_hash,cookie_name,generation,user_id,native_session_id,access_token_enc,refresh_token_enc,token_expires_at,status,browser_lineage_id) values(extra_registry,'fixture-'||extra_registry,'fixture-'||extra_registry,'fixture-generation-'||extra_registry,actor,extra_sid,'synthetic','synthetic',clock_timestamp()+interval '1 hour','active',extra_lineage);
  update public.vel_broker_browser_lineages set current_registry_id=extra_registry where id=extra_lineage;
  sids:=sids||jsonb_build_array(extra_sid);
 end loop;
 insert into private.es02_thawani_live_grants(id,account_id,enabled,amount_baisa,currency,approved_at,expires_at) values(grantid,actor,true,100,'OMR',clock_timestamp(),clock_timestamp()+interval '1 day');
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',sid)::text,true);perform set_config('request.jwt.claim.sub',actor::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
 r:=public.es02_begin_thawani_live_checkout(actor,gen_random_uuid(),'monthly','[{"persona":"level_1","package":"basic"}]',prep,true,grantid);
 perform pg_temp.must(r->>'ok'='true','live_order_preparation');oid:=(r->'data'->>'orderId')::uuid;
 select * into o from private.es02_account_orders where id=oid;
 -- Historical Test purchase fixture uses the same catalog and normal provisioner.
 old:=jsonb_populate_record(o,jsonb_build_object('id',oldid,'environment','test','status','settled','client_op_id',gen_random_uuid(),'payment_attempt_id',gen_random_uuid(),'special_reference','synthetic-old-'||oldid,'original_order_group_id',gen_random_uuid(),'settled_at',clock_timestamp(),'provider_transaction_id','synthetic-test-'||oldid));
 insert into private.es02_account_orders select old.*;
 insert into private.es02_thawani_test_accounts(account_id,enabled) values(actor,true);
 insert into private.es02_thawani_test_checkouts(order_id,account_id,preparation,state,invoice,paid_at) values(oldid,actor,prep,'paid','synthetic-old-invoice',clock_timestamp());
 r:=public.es02_provision_owned_purchase(actor,oldid,oldid,prep-'branches','[{"name":"Main","city":"Muscat"}]');
 perform pg_temp.must(r->>'ok'='true','original_test_company');cid:=(r->'data'->>'companyId')::uuid;
 select id into bid from public.company_branches where company_id=cid and is_primary;
 r:=public.es02_select_owned_branch_channels(actor,cid,bid,gen_random_uuid(),'["whatsapp"]');perform pg_temp.must(r->>'ok'='true','original_channel_preference');
 select to_jsonb(c) into company_before from public.companies c where id=cid;
 -- The new candidate must exist; the RED run without it fails here.
 insert into private.es02_existing_live_targets(order_id,account_id,company_id,branch_id,test_order_id) values(oid,actor,cid,bid,oldid);
 r:=public.es02_finish_thawani_live_checkout(actor,oid);perform pg_temp.must(r->>'ok'='false','unpaid_transition_denied');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);perform set_config('request.jwt.claim.role','service_role',true);
 claim:=public.es02_claim_thawani_live_checkout(actor,oid,sid);perform pg_temp.must(public.es02_complete_thawani_live_checkout(actor,oid,(claim->>'token')::uuid,'checkout_existingfixture','991100'),'provider_binding');
 r:=public.es02_record_thawani_live_payment(actor,oid,'checkout_existingfixture',(claim->>'token')::uuid,'991100',100,'OMR');perform pg_temp.must(r->>'outcome'='settled','exact_live_settlement');
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',sid)::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',gen_random_uuid())::text,true);
 perform pg_temp.must(public.es02_finish_thawani_live_checkout(actor,oid)->>'ok'='false','foreign_native_session_denied');
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',sid)::text,true);
 update private.es02_branch_slot_rights set replies_per_month=replies_per_month+1 where company_id=cid;
 perform pg_temp.must(public.es02_finish_thawani_live_checkout(actor,oid)->>'code'='SAME_PLAN_REQUIRED','changed_plan_denied');
 update private.es02_branch_slot_rights set replies_per_month=replies_per_month-1 where company_id=cid;
 create trigger existing_live_fail before insert on private.es02_existing_live_bindings for each row execute function public.existing_live_forced_failure();
 begin perform public.es02_finish_thawani_live_checkout(actor,oid);raise exception 'EXPECTED_FORCED_FAILURE';exception when others then if sqlerrm<>'SYNTHETIC_WRITE_FAILURE' then raise;end if;end;
 perform pg_temp.must((select status='settled' and provisioned_company_id is null from private.es02_account_orders where id=oid),'forced_failure_order_rollback');
 perform pg_temp.must((select order_id=oldid from private.es02_activation_foundation where company_id=cid),'forced_failure_foundation_rollback');
 perform pg_temp.must((select count(*)=0 from private.es02_purchase_environment_history),'forced_failure_history_rollback');
 perform pg_temp.must((select count(*)=0 from public.billing_subscriptions where company_id=cid and environment='live'),'forced_failure_subscription_rollback');
 perform pg_temp.must((select count(*)=1 from private.es02_credit_balances where company_id=cid),'forced_failure_credit_rollback');
 perform pg_temp.must((select order_id=oldid from private.es02_branch_slot_rights where company_id=cid and branch_id=bid),'forced_failure_rights_rollback');
 perform pg_temp.must((select order_id=oldid from private.es02_branch_channel_selections where company_id=cid and branch_id=bid),'forced_failure_channel_rollback');
 perform pg_temp.must((select count(*)=0 from private.es02_account_provisioning where order_id=oid),'forced_failure_receipt_rollback');
 drop trigger existing_live_fail on private.es02_existing_live_bindings;
 create trigger existing_live_barrier before insert on private.es02_existing_live_bindings for each row execute function public.existing_live_concurrency_barrier();
 perform pg_temp.must(not has_function_privilege('authenticated','private.es02_bind_existing_thawani_live(uuid,uuid)','execute'),'no_direct_client_binding');
 perform pg_temp.must(not has_table_privilege('service_role','private.es02_existing_live_targets','insert'),'no_service_role_target_creation');
 perform pg_temp.must((select to_jsonb(c)=company_before from public.companies c where id=cid),'company_data_unchanged');
 perform pg_temp.must(to_regclass('public.company_members_one_active_owner_per_user') is not null,'owner_index_preserved');
 insert into public.existing_live_fixture values('context',jsonb_build_object('actor',actor,'sid',sid,'sids',sids,'order',oid,'oldOrder',oldid,'company',cid,'branch',bid,'companyBefore',company_before));
end$$;
create function public.existing_live_assertions() returns text language plpgsql as $$
declare f jsonb;cid uuid;bid uuid;oid uuid;oldid uuid;begin
 select value into f from public.existing_live_fixture where key='context';cid:=(f->>'company')::uuid;bid:=(f->>'branch')::uuid;oid:=(f->>'order')::uuid;oldid:=(f->>'oldOrder')::uuid;
 if (select count(*) from public.companies where created_by=(f->>'actor')::uuid)<>1 then raise exception 'DUPLICATE_COMPANY';end if;
 if (select count(*) from public.company_branches where company_id=cid)<>1 then raise exception 'DUPLICATE_BRANCH';end if;
 if (select count(*) from private.es02_existing_live_bindings where order_id=oid)<>1 then raise exception 'DUPLICATE_BINDING';end if;
 if coalesce((select (value#>>'{}')::integer from public.existing_live_fixture where key='advisoryWaiters'),0)<3 then raise exception 'CONCURRENT_LOCK_CONTENTION_NOT_OBSERVED';end if;
 if (select count(*) from private.es02_purchase_environment_history where company_id=cid)<>2 then raise exception 'HISTORY_NOT_SEPARATE';end if;
 if (select order_id<>oid or clock_state<>'waiting_readiness' or subscription_started_at is not null or paid_through_at is not null from private.es02_activation_foundation where company_id=cid) then raise exception 'CLOCK_STARTED';end if;
 if (select count(*) from private.es02_branch_slot_rights where company_id=cid and branch_id=bid and order_id=oid)<>1 then raise exception 'RIGHTS_NOT_ONCE';end if;
 if (select count(*) from private.es02_credit_balances where company_id=cid)<>2 or (select count(*) from private.es02_credit_balances c join private.es02_account_orders o on o.original_order_group_id=c.order_group_id where c.company_id=cid and o.id=oid and c.granted=1000 and c.remaining=1000)<>1 then raise exception 'CREDIT_GROUP_SEPARATION';end if;
 if (select status<>'provisioned' or environment<>'test' or provisioned_company_id<>cid from private.es02_account_orders where id=oldid) then raise exception 'TEST_ORDER_CHANGED';end if;
 if (select count(*) from public.billing_subscriptions where company_id=cid and environment='test')<>1 or (select count(*) from public.billing_subscriptions where company_id=cid and environment='live' and status='awaiting_payment' and paid_through is null)<>1 then raise exception 'SUBSCRIPTION_SEPARATION';end if;
 if not exists(select 1 from private.es02_purchase_environment_history where order_id=oldid and environment='test' and activation->>'order_id'=oldid::text and rights->0->>'order_id'=oldid::text) then raise exception 'TEST_PROVENANCE_LOST';end if;
 if (select subscription from private.es02_purchase_environment_history where order_id=oldid) is distinct from (select to_jsonb(s) from public.billing_subscriptions s where s.company_id=cid and s.environment='test') then raise exception 'TEST_SUBSCRIPTION_CHANGED';end if;
 if (select credits from private.es02_purchase_environment_history where order_id=oldid) is distinct from (select jsonb_agg(to_jsonb(c) order by c.id) from private.es02_credit_balances c join private.es02_account_orders o on o.original_order_group_id=c.order_group_id where o.id=oldid and c.company_id=cid) then raise exception 'TEST_CREDIT_HISTORY_CHANGED';end if;
 if (select to_jsonb(c)<>f->'companyBefore' from public.companies c where id=cid) then raise exception 'COMPANY_CHANGED';end if;
 begin update private.es02_purchase_environment_history set environment='live' where order_id=oldid;raise exception 'EXPECTED_IMMUTABLE_REJECTION';exception when check_violation then if sqlerrm<>'ES02_ENVIRONMENT_EVIDENCE_IMMUTABLE' then raise;end if;end;
 if private.es02_paid_branch_readiness(cid,bid)->>'code' is distinct from 'BRANCH_NOT_LAUNCHED' then raise exception 'THAWANI_READINESS_GUARD_INCORRECT';end if;
 begin update private.es02_activation_foundation set clock_state='active',subscription_started_at=clock_timestamp(),paid_through_at=clock_timestamp()+interval '1 month' where company_id=cid;raise exception 'EXPECTED_START_001_REJECTION';exception when check_violation then if sqlerrm<>'ES02_INITIAL_CLOCK_ACCEPTANCE_REQUIRED' then raise;end if;end;
 return 'PASS';end$$;
