-- LOCAL ONLY. Separate approval required for production installation.
-- Additional claimed-job Noura deny gate; no answering rollout, activation,
-- commercial allowance seed, provider execution or second usage/cost ledger.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ declare dep record;begin
 for dep in select * from (values
 ('private.whatsapp_answer_profile(uuid,uuid)','0884d7967680f5e31d80cabe77ac5f85',true),
 ('private.whatsapp_attempt_profile_current(uuid,uuid)','faa429eba2663ff3f3778bd09a5f68ae',true),
 ('private.wa_worker_lock(uuid,uuid,boolean)','640a38a1b04404aa7617ee2f9167f8cb',true),
 ('private.billing_service_receipt_eligible(uuid)','b7d82e7e8fefc05c22f876f1ac00b7c2',false),
 ('private.billing_service_immutable()','17b4d16be72ea6e2e3e44401c7680fd2',false),
 ('public.whatsapp_reserve_job_usage(uuid,uuid)','b071381f7a927cbe43f8218c7fb012dd',true),
 ('public.billing_load_worker_frame(uuid,uuid)','d5d44bc789f0c58a0560f2fcb6cc4060',true),
 ('public.ai_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)','74e31c07c93b44dececdfdf26ce67dd1',true),
 ('public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text)','cd50d8ffe3d991c1094c451d64a8954c',true),
 ('public.ai_start_whatsapp_attempt(uuid,uuid)','391d88704db13210484733b7c33ba841',true),
 ('public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb)','8e20548d90371197057bbe5bcc4eeb07',true),
 ('public.whatsapp_claim_assistant_job_send(uuid,uuid)','e814855031032f6bded47937f15ba355',true),
 ('public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb)','a6dd5eb64f6a17b8d4742bf9e31fea6c',true),
 ('public.ai_reserve_whatsapp_profile_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid)','2161b5e69d287460f094c4139c04973a',true)) dependencies(signature,body_hash,definer) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(dep.signature)
  and md5(replace(prosrc,chr(13),''))=dep.body_hash and prosecdef=dep.definer
  and array_to_string(proconfig,',')='search_path=""') then
   raise exception 'NOURA_WORKER_PREREQUISITE_MISMATCH: %',dep.signature using errcode='55000';
  end if;
  if dep.signature like 'public.%' and (has_function_privilege('anon',to_regprocedure(dep.signature),'EXECUTE')
  or has_function_privilege('authenticated',to_regprocedure(dep.signature),'EXECUTE')
  or not has_function_privilege('service_role',to_regprocedure(dep.signature),'EXECUTE')) then
   raise exception 'NOURA_WORKER_RPC_ACL_MISMATCH: %',dep.signature using errcode='55000';
  end if;
 end loop;
 if md5(replace(pg_get_viewdef('private.billing_proven_entitlement_grants'::regclass,true),chr(13),''))<>'6c6d6a29a1dfae3e667948901044a7b1'
 or md5(replace(pg_get_viewdef('private.billing_verified_collection_history'::regclass,true),chr(13),''))<>'cdda398ed1d2f6bf1b0a4db89fcced9f'
 or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.billing_financial_receipt_immutability()'::regprocedure)<>'968854ccf1b251404062386ea9f2fe2f'
 then raise exception 'NOURA_WORKER_RECEIPT_PREREQUISITE_MISMATCH' using errcode='55000';end if;
 if (select count(*) from pg_trigger where tgfoid='private.billing_financial_receipt_immutability()'::regprocedure
 and not tgisinternal and tgenabled in ('O','A') and (tgrelid,tgname) in (
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_immutability'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_immutability'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_immutability'),
 ('public.billing_provider_events'::regclass,'billing_provider_receipt_no_truncate'),
 ('public.billing_entitlement_applications'::regclass,'billing_entitlement_receipt_no_truncate'),
 ('public.billing_settlement_outcomes'::regclass,'billing_settlement_receipt_no_truncate')))<>6
 or (select count(*) from pg_trigger where tgfoid='private.billing_service_immutable()'::regprocedure
 and not tgisinternal and tgenabled in ('O','A') and (tgrelid,tgname) in (
 ('private.billing_service_offers'::regclass,'service_offer_immutable'),
 ('private.billing_service_order_offers'::regclass,'service_order_offer_immutable'),
 ('private.billing_service_grants'::regclass,'service_grant_immutable'),
 ('private.billing_service_offers'::regclass,'service_offer_no_truncate'),
 ('private.billing_service_order_offers'::regclass,'service_order_offer_no_truncate'),
 ('private.billing_service_grants'::regclass,'service_grant_no_truncate')))<>6 then
  raise exception 'NOURA_WORKER_IMMUTABLE_GUARD_MISSING' using errcode='55000';
 end if;
 if exists(select 1 from pg_class where oid in ('private.billing_service_offers'::regclass,'private.billing_service_order_offers'::regclass,'private.billing_service_grants'::regclass) and not relrowsecurity)
 or exists(select 1 from (values('anon'),('authenticated'),('service_role')) roles(name)
 cross join (values('private.billing_service_offers'),('private.billing_service_order_offers'),('private.billing_service_grants')) tables(name)
 where has_table_privilege(roles.name,tables.name,'SELECT,INSERT,UPDATE,DELETE')) then
  raise exception 'NOURA_WORKER_SERVICE_TABLE_BOUNDARY_MISMATCH' using errcode='55000';end if;
end; $$;

-- Original-job provenance, not a new counter or ledger. No historical backfill.
alter table public.whatsapp_inbound_jobs
 add column noura_entitlement_id uuid references private.billing_service_grants(entitlement_application_id) on delete restrict,
 add column noura_subscription_id uuid references public.billing_subscriptions(id) on delete restrict,
 add column noura_plan_version_id uuid references public.billing_plan_versions(id) on delete restrict,
 add column noura_paid_through timestamptz,
 add column noura_allowance_cap bigint,
 add column noura_allowance_period_start timestamptz,
 add constraint wa_noura_binding_complete check (
 (noura_entitlement_id is null and noura_subscription_id is null and noura_plan_version_id is null and noura_paid_through is null and noura_allowance_cap is null and noura_allowance_period_start is null)
 or (noura_entitlement_id is not null and noura_subscription_id is not null and noura_plan_version_id is not null and noura_paid_through is not null and noura_allowance_cap between 1 and 999999999 and noura_allowance_cap is not null and noura_allowance_period_start is not null));
create function private.wa_noura_binding_immutable() returns trigger
language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then
  if new.noura_entitlement_id is not null then raise exception 'NOURA_BINDING_SERVER_ONLY' using errcode='23514';end if;
 elsif row(new.noura_entitlement_id,new.noura_subscription_id,new.noura_plan_version_id,new.noura_paid_through,new.noura_allowance_cap,new.noura_allowance_period_start)
 is distinct from row(old.noura_entitlement_id,old.noura_subscription_id,old.noura_plan_version_id,old.noura_paid_through,old.noura_allowance_cap,old.noura_allowance_period_start) then
  if old.noura_entitlement_id is not null or new.noura_entitlement_id is null or new.status<>'claimed'
  or old.usage_status is not null or old.send_intent_id is not null
  or coalesce(current_setting('velora.noura_job_binding',true),'')<>'1' then
   raise exception 'NOURA_BINDING_IMMUTABLE' using errcode='23514';end if;
 end if;return new;
end; $$;
revoke all on function private.wa_noura_binding_immutable() from public,anon,authenticated,service_role;
create trigger whatsapp_jobs_noura_binding before insert or update on public.whatsapp_inbound_jobs for each row execute function private.wa_noura_binding_immutable();

create function private.wa_noura_authority(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;g record;cap bigint;period timestamptz;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 -- Shared established order: company -> subscription -> conversation -> job.
 j:=private.wa_worker_lock(p_job_id,p_claim_token);
 if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 select sg.entitlement_application_id,proof.subscription_id,proof.plan_version_id,proof.applied_paid_through,v.limits into g
 from private.billing_service_grants sg join private.billing_service_order_offers so on so.order_id=sg.order_id
 join private.billing_proven_entitlement_grants proof on proof.id=sg.entitlement_application_id and proof.order_id=so.order_id
 join public.billing_subscriptions s on s.id=proof.subscription_id and s.company_id=proof.company_id
 join public.billing_plan_versions v on v.id=proof.plan_version_id
 where proof.company_id=j.company_id and proof.provider_environment='live' and so.environment='live' and s.environment='live'
 and sg.activated and so.service_code='noura' and so.tier in ('basic','premium')
 and so.capabilities=array['noura.knowledge.read']::text[] and so.plan_version_id=proof.plan_version_id
 and private.billing_service_receipt_eligible(proof.id) and v.status in ('published','retired')
 and s.status in ('active','cancel_at_period_end') and s.plan_version_id=proof.plan_version_id and s.paid_through=proof.applied_paid_through
 and proof.applied_paid_through>clock_timestamp()
 and exists(select 1 from public.companies where id=j.company_id and status='active')
 order by proof.applied_at desc,proof.id limit 1 for share of sg,v nowait;
 if not found then return jsonb_build_object('ok',false,'code','NOURA_SERVICE_NOT_ACTIVE');end if;
 period:=private.wa_worker_month();
 -- Existing immutable published-version allowance only; no numeric default.
 if coalesce(g.limits->>'automated_outbound_per_month','')!~'^[1-9][0-9]{0,8}$' then return jsonb_build_object('ok',false,'code','usage_not_configured');end if;
 cap:=(g.limits->>'automated_outbound_per_month')::bigint;
 if j.noura_entitlement_id is null then
  -- Prior paid work cannot be retroactively authorized under a new receipt.
  if j.usage_status is not null or j.send_intent_id is not null
  or exists(select 1 from public.ai_usage_ledger where worker_job_id=j.id) then
   return jsonb_build_object('ok',false,'code','NOURA_LEGACY_JOB_REQUIRES_REVIEW');end if;
  perform set_config('velora.noura_job_binding','1',true);
  update public.whatsapp_inbound_jobs set noura_entitlement_id=g.entitlement_application_id,noura_subscription_id=g.subscription_id,
   noura_plan_version_id=g.plan_version_id,noura_paid_through=g.applied_paid_through,noura_allowance_cap=cap,noura_allowance_period_start=period where id=j.id;
  perform set_config('velora.noura_job_binding','0',true);
 elsif row(j.noura_entitlement_id,j.noura_subscription_id,j.noura_plan_version_id,j.noura_paid_through,j.noura_allowance_cap,j.noura_allowance_period_start)
 is distinct from row(g.entitlement_application_id,g.subscription_id,g.plan_version_id,g.applied_paid_through,cap,period)
 or (j.usage_status is not null and (j.usage_subscription_id is distinct from g.subscription_id or j.usage_period_start is distinct from period)) then
  return jsonb_build_object('ok',false,'code','NOURA_JOB_AUTHORITY_CHANGED');
 end if;
 return jsonb_build_object('ok',true,'company_id',j.company_id,'plan_version_id',g.plan_version_id,'entitlement_application_id',g.entitlement_application_id);
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','NOURA_AUTHORITY_BUSY');
end; $$;
revoke all on function private.wa_noura_authority(uuid,uuid) from public,anon,authenticated,service_role;

-- Preserve the entire legacy window/profile/paid-proof implementation. Every
-- retrieval, model reservation/start, stage and assistant claim already uses
-- this pinned common profile guard. Service identity never comes from persona.
alter function private.whatsapp_answer_profile(uuid,uuid) rename to wa_answer_profile_pre_noura_authority;
revoke all on function private.wa_answer_profile_pre_noura_authority(uuid,uuid) from public,anon,authenticated,service_role;
create function private.whatsapp_answer_profile(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare profile jsonb;authority jsonb;begin
 profile:=private.wa_answer_profile_pre_noura_authority(p_job_id,p_claim_token);
 if profile->>'ok' is distinct from 'true' then return profile;end if;
 authority:=private.wa_noura_authority(p_job_id,p_claim_token);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 if profile->>'company_id' is distinct from authority->>'company_id' or profile->>'plan_version_id' is distinct from authority->>'plan_version_id'
 or profile->>'persona' is distinct from 'noura' then return jsonb_build_object('ok',false,'code','NOURA_PROFILE_MISMATCH');end if;
 return profile;
end; $$;
revoke all on function private.whatsapp_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;

alter function public.whatsapp_reserve_job_usage(uuid,uuid) set schema private;
alter function private.whatsapp_reserve_job_usage(uuid,uuid) rename to wa_reserve_usage_pre_noura_authority;
revoke all on function private.wa_reserve_usage_pre_noura_authority(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_reserve_job_usage(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 return private.wa_reserve_usage_pre_noura_authority(p_job_id,p_claim_token);
end; $$;
revoke all on function public.whatsapp_reserve_job_usage(uuid,uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_reserve_job_usage(uuid,uuid) to service_role;

alter function public.billing_load_worker_frame(uuid,uuid) set schema private;
alter function private.billing_load_worker_frame(uuid,uuid) rename to wa_frame_pre_noura_authority;
revoke all on function private.wa_frame_pre_noura_authority(uuid,uuid) from public,anon,authenticated,service_role;
create function public.billing_load_worker_frame(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 return private.wa_frame_pre_noura_authority(p_job_id,p_claim_token);
end; $$;
revoke all on function public.billing_load_worker_frame(uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_load_worker_frame(uuid,uuid) to service_role;
-- Checks before the operation alone are insufficient: downstream source,
-- budget and AI-ledger locks may wait past expiry. Recheck after all backing
-- work. A subtransaction discards only newly made writes on final denial,
-- preserving earlier reservations, actual cost and uncertain provider evidence.
alter function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) set schema private;
alter function private.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) rename to noura_pre_whatsapp_retrieve_approved_knowledge;
revoke all on function private.noura_pre_whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.whatsapp_retrieve_approved_knowledge(p_company_id uuid,p_job_id uuid,p_claim_token uuid,p_question text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_whatsapp_retrieve_approved_knowledge(p_company_id,p_job_id,p_claim_token,p_question);
  if result->>'ok' is distinct from 'true' then return result;end if;
  authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return authority;end;
end; $$;
revoke all on function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) to service_role;

alter function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) set schema private;
alter function private.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) rename to noura_pre_ai_reserve_whatsapp_attempt;
revoke all on function private.noura_pre_ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.ai_reserve_whatsapp_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_ai_reserve_whatsapp_attempt(p_id,p_job_id,p_claim_token,p_attempt,p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  if result->>'ok' is distinct from 'true' then return result;end if;
  authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return authority;end;
end; $$;
revoke all on function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) to service_role;

alter function public.ai_start_whatsapp_attempt(uuid,uuid) set schema private;
alter function private.ai_start_whatsapp_attempt(uuid,uuid) rename to noura_pre_ai_start_whatsapp_attempt;
revoke all on function private.noura_pre_ai_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated,service_role;
create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare result boolean;authority jsonb;job uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_ai_start_whatsapp_attempt(p_id,p_claim_token);
  if result is distinct from true then return result;end if;
  select worker_job_id into job from public.ai_usage_ledger where id=p_id;
  authority:=private.whatsapp_answer_profile(job,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return false;end;
end; $$;
revoke all on function public.ai_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_start_whatsapp_attempt(uuid,uuid) to service_role;

alter function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) set schema private;
alter function private.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) rename to noura_pre_whatsapp_stage_job_reply;
revoke all on function private.noura_pre_whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.whatsapp_stage_job_reply(p_job_id uuid,p_claim_token uuid,p_ai_attempt_id uuid,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_whatsapp_stage_job_reply(p_job_id,p_claim_token,p_ai_attempt_id,p_citations);
  if result->>'ok' is distinct from 'true' then return result;end if;
  authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return authority;end;
end; $$;
revoke all on function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) to service_role;

alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) set schema private;
alter function private.whatsapp_claim_assistant_job_send(uuid,uuid) rename to noura_pre_whatsapp_claim_assistant_job_send;
revoke all on function private.noura_pre_whatsapp_claim_assistant_job_send(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_claim_assistant_job_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;authority jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 begin
  result:=private.noura_pre_whatsapp_claim_assistant_job_send(p_job_id,p_claim_token);
  if result->>'ok' is distinct from 'true' then return result;end if;
  authority:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
  if authority->>'ok' is distinct from 'true' then raise exception 'NOURA_FINAL_AUTHORITY_DENIED' using errcode='PNA01';end if;
  return result;
 exception when sqlstate 'PNA01' then return authority;end;
end; $$;
revoke all on function public.whatsapp_claim_assistant_job_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_claim_assistant_job_send(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
