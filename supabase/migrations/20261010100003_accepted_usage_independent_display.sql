-- LOCAL ONLY. Install after staff_final_dispatch_authority; separate production approval.
-- Original job reservation and original intent receipts only. No quota/ledger seeds.
begin;
set local lock_timeout='2s';set local statement_timeout='30s';
lock table public.whatsapp_send_intents,public.whatsapp_inbound_jobs in share row exclusive mode;
do $$ declare dep record;begin
 for dep in select * from (values
 ('public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid)','eca34ded58fb668f5446257e127005a7'),
 ('public.retry_whatsapp_send_persist(uuid,uuid)','c719a41f5612689dc10474c9db8bd655'),
 ('public.billing_finalize_automated_usage(uuid,uuid)','93ead2a087ad01b7273d8cbb2661cee2'),
 ('public.billing_read_company_usage(uuid)','20383c04e624e1e3743bbc3202bfedb6'),
 ('public.whatsapp_repair_accepted_jobs(integer)','f03828295567cd4d0aa719180e341e65'),
 ('public.whatsapp_retry_inbound_job(uuid,uuid,text,boolean,boolean)','e7773738d7e6dceb29df07c9042ec40e'),
 ('public.claim_whatsapp_inbound_job(uuid,integer)','583f9aac6c0a84680d444b461f4e8ec6')) dependencies(signature,body_hash) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(dep.signature) and md5(replace(prosrc,chr(13),''))=dep.body_hash
   and prosecdef and array_to_string(proconfig,',')='search_path=""') then raise exception 'ACCEPTED_USAGE_PREREQUISITE_MISMATCH: %',dep.signature using errcode='55000';end if;
  if dep.signature not like '%billing_read_company_usage%' and (has_function_privilege('anon',to_regprocedure(dep.signature),'EXECUTE')
   or has_function_privilege('authenticated',to_regprocedure(dep.signature),'EXECUTE') or not has_function_privilege('service_role',to_regprocedure(dep.signature),'EXECUTE'))
  then raise exception 'ACCEPTED_USAGE_RPC_ACL_MISMATCH: %',dep.signature using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('private.whatsapp_guard_persisted_identity()')
 and md5(replace(prosrc,chr(13),''))='2c9414fbe1fa9dce58a2764c87274307')
 or not exists(select 1 from pg_trigger where tgrelid='public.whatsapp_send_intents'::regclass and tgfoid=to_regprocedure('private.whatsapp_guard_persisted_identity()') and tgenabled in ('O','A') and not tgisinternal)
 or not exists(select 1 from pg_trigger where tgrelid='public.whatsapp_inbound_jobs'::regclass and tgfoid=to_regprocedure('private.whatsapp_guard_persisted_identity()') and tgenabled in ('O','A') and not tgisinternal)
 then raise exception 'ACCEPTED_USAGE_IDENTITY_GUARD_MISMATCH' using errcode='55000';end if;
 if to_regprocedure('public.whatsapp_authorize_staff_dispatch(uuid,uuid)') is null
 or exists(select 1 from pg_class where oid in ('public.whatsapp_send_intents'::regclass,'public.whatsapp_inbound_jobs'::regclass) and pg_get_userbyid(relowner)<>current_user)
 then raise exception 'ACCEPTED_USAGE_DEPLOYMENT_ORDER_MISMATCH' using errcode='55000';end if;
 if exists(select 1 from public.whatsapp_send_intents where wa_message_id is not null group by wa_message_id having count(*)>1)
 then raise exception 'ACCEPTED_USAGE_HISTORICAL_PROVIDER_DUPLICATES' using errcode='23514',hint='Review duplicate receipt ownership separately. No receipt is deleted, reassigned or selected as a winner.';end if;
 if exists(select 1 from public.whatsapp_inbound_jobs j left join public.whatsapp_send_intents i on i.id=j.send_intent_id
 and i.company_id=j.company_id and i.original_job_id=j.id where j.usage_status='accepted' and (i.id is null or i.outcome<>'accepted'
 or nullif(btrim(i.wa_message_id),'') is null or j.usage_subscription_id is null or j.usage_period_start is null))
 then raise exception 'ACCEPTED_USAGE_HISTORICAL_BINDING_MISMATCH' using errcode='23514';end if;
end; $$;
-- Canonical ownership is unique independently of a display row. Disputed observations
-- remain on their own intent, never another tenant's row and never a second charge.
create unique index whatsapp_send_provider_receipt_uidx on public.whatsapp_send_intents(wa_message_id) where wa_message_id is not null;
alter table public.whatsapp_send_intents add column acceptance_observed_wa_message_id text,
 add column acceptance_observed_at timestamptz,add column finalized_attempt_token uuid,
 add constraint whatsapp_acceptance_observation_pair check ((acceptance_observed_wa_message_id is null and acceptance_observed_at is null)
 or (nullif(btrim(acceptance_observed_wa_message_id),'') is not null and acceptance_observed_at is not null));

create function private.wa_acceptance_lock(p_company uuid,p_intent uuid) returns public.whatsapp_inbound_jobs
language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;j public.whatsapp_inbound_jobs%rowtype;begin
 select * into i from public.whatsapp_send_intents where id=p_intent and company_id=p_company;if not found then return null;end if;
 perform 1 from public.companies where id=p_company for no key update;
 select * into j from public.whatsapp_inbound_jobs where id=i.original_job_id and company_id=p_company and send_intent_id=i.id;
 if j.id is not null then perform 1 from public.billing_subscriptions where id=j.usage_subscription_id and company_id=p_company for no key update;end if;
 perform 1 from public.whatsapp_conversations where id=i.conversation_id and company_id=p_company for update;
 if j.id is not null then select * into j from public.whatsapp_inbound_jobs where id=j.id and company_id=p_company and send_intent_id=i.id for update;end if;
 perform 1 from public.whatsapp_send_intents where id=p_intent and company_id=p_company for update;
 return j;
end; $$;
revoke all on function private.wa_acceptance_lock(uuid,uuid) from public,anon,authenticated,service_role;

create function private.wa_accepted_receipt_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_table_name='whatsapp_send_intents' then
  if tg_op='INSERT' then
   if new.acceptance_observed_wa_message_id is not null or new.acceptance_observed_at is not null or new.finalized_attempt_token is not null then raise exception 'ACCEPTANCE_OBSERVATION_SERVER_ONLY' using errcode='23514';end if;
  else
   if old.finalized_attempt_token is null and old.outcome='attempting' and old.attempt_token is not null and new.outcome in ('accepted','rejected','unknown') then
    if current_user<>(select pg_get_userbyid(relowner) from pg_class where oid=tg_relid) then raise exception 'FINALIZED_ATTEMPT_SERVER_ONLY' using errcode='23514';end if;
    new.finalized_attempt_token:=old.attempt_token;
   elsif new.finalized_attempt_token is distinct from old.finalized_attempt_token then raise exception 'FINALIZED_ATTEMPT_IMMUTABLE' using errcode='23514';end if;
   if row(new.acceptance_observed_wa_message_id,new.acceptance_observed_at) is distinct from row(old.acceptance_observed_wa_message_id,old.acceptance_observed_at) then
    if old.acceptance_observed_wa_message_id is not null or new.acceptance_observed_wa_message_id is null or old.outcome not in ('attempting','unknown','rejected')
     or coalesce(old.attempt_token,old.finalized_attempt_token) is null or coalesce(current_setting('velora.acceptance_observation',true),'')<>'1'
     or current_user<>(select pg_get_userbyid(relowner) from pg_class where oid=tg_relid) then raise exception 'ACCEPTANCE_OBSERVATION_IMMUTABLE' using errcode='23514';end if;
   end if;
   if old.outcome='accepted' and nullif(btrim(old.wa_message_id),'') is not null
   and (new.outcome is distinct from 'accepted' or new.original_job_id is distinct from old.original_job_id)
   then raise exception 'ACCEPTED_RECEIPT_IMMUTABLE' using errcode='23514';end if;
  end if;
 else
  if tg_op='INSERT' and new.usage_status='accepted' then raise exception 'ACCEPTED_USAGE_SERVER_ONLY' using errcode='23514';end if;
  if tg_op='UPDATE' then
   if old.usage_status='accepted' and row(new.usage_status,new.usage_subscription_id,new.usage_period_start,new.send_intent_id,new.staged_ai_attempt_id,new.staged_reply,new.staged_citations,new.expected_automation_generation)
    is distinct from row(old.usage_status,old.usage_subscription_id,old.usage_period_start,old.send_intent_id,old.staged_ai_attempt_id,old.staged_reply,old.staged_citations,old.expected_automation_generation)
   then raise exception 'ACCEPTED_USAGE_IRREVERSIBLE' using errcode='23514';end if;
   if new.usage_status='accepted' and old.usage_status is distinct from 'accepted'
    and (coalesce(current_setting('velora.accepted_usage_settlement',true),'')<>'1'
    or current_user<>(select pg_get_userbyid(relowner) from pg_class where oid=tg_relid)) then raise exception 'ACCEPTED_USAGE_SERVER_ONLY' using errcode='23514';end if;
  end if;
 end if;return new;
end; $$;
revoke all on function private.wa_accepted_receipt_guard() from public,anon,authenticated,service_role;
create trigger whatsapp_accepted_receipt_guard before insert or update on public.whatsapp_send_intents for each row execute function private.wa_accepted_receipt_guard();
create trigger whatsapp_accepted_usage_guard before insert or update on public.whatsapp_inbound_jobs for each row execute function private.wa_accepted_receipt_guard();

create or replace function public.billing_finalize_automated_usage(p_company_id uuid,p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;i public.whatsapp_send_intents%rowtype;state text;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 j:=private.wa_acceptance_lock(p_company_id,p_intent_id);
 select * into i from public.whatsapp_send_intents where id=p_intent_id and company_id=p_company_id and original_job_id=j.id for update;
 if j.id is null or i.id is null or i.sender_kind<>'assistant' or j.usage_subscription_id is null or j.usage_period_start is null
 or j.usage_status is null or not exists(select 1 from public.billing_subscriptions where id=j.usage_subscription_id and company_id=j.company_id)
 or i.expected_automation_generation is distinct from j.expected_automation_generation or i.body is distinct from j.staged_reply
 or not exists(select 1 from public.whatsapp_messages m where m.id=j.message_id and m.company_id=j.company_id
 and m.conversation_id=i.conversation_id and m.direction='inbound' and m.sender='customer')
 or not exists(select 1 from public.ai_usage_ledger a where a.id=j.staged_ai_attempt_id and a.company_id=j.company_id and a.worker_job_id=j.id
 and a.status='success' and a.response_text=i.body and a.source_citations=j.staged_citations and a.automation_generation=j.expected_automation_generation)
 or (j.noura_entitlement_id is not null and (j.noura_subscription_id is distinct from j.usage_subscription_id or j.noura_allowance_period_start is distinct from j.usage_period_start))
 then return jsonb_build_object('ok',false,'code','reservation_binding_review');end if;
 if j.usage_status='accepted' then return jsonb_build_object('ok',true,'status','accepted','reused',true);end if;
 state:=case when i.outcome='accepted' and nullif(btrim(i.wa_message_id),'') is not null
 and (i.acceptance_observed_wa_message_id is null or i.acceptance_observed_wa_message_id=i.wa_message_id) then 'accepted'
 when i.outcome='rejected' and i.wa_message_id is null and i.acceptance_observed_wa_message_id is null then 'released' else 'unknown' end;
 perform set_config('velora.accepted_usage_settlement','1',true);
 update public.whatsapp_inbound_jobs set usage_status=state,status=case when state='accepted' then 'completed' else 'review_required' end,
 completed_at=case when state='accepted' then coalesce(completed_at,clock_timestamp()) else completed_at end,
 result_code='send_'||state,claim_token=null,claim_expires_at=null,updated_at=clock_timestamp() where id=j.id;
 perform set_config('velora.accepted_usage_settlement','',true);
 return jsonb_build_object('ok',true,'status',state,'reused',j.usage_status=state);
end; $$;
revoke all on function public.billing_finalize_automated_usage(uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_finalize_automated_usage(uuid,uuid) to service_role;

alter function public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid) set schema private;
alter function private.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid) rename to wa_finalize_pre_accepted_usage;
revoke all on function private.wa_finalize_pre_accepted_usage(uuid,uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
create function public.finalize_whatsapp_send_attempt(p_intent_id uuid,p_attempt_token uuid,p_result text,p_wa_message_id text default null,p_error_code text default null,p_actor_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;j public.whatsapp_inbound_jobs%rowtype;r jsonb;u jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id;
 j:=private.wa_acceptance_lock(i.company_id,p_intent_id);
 select * into i from public.whatsapp_send_intents where id=p_intent_id for update;
 if p_result='accepted' and nullif(btrim(p_wa_message_id),'') is not null and i.outcome in ('attempting','unknown','rejected')
 and p_attempt_token is not null and coalesce(i.attempt_token,i.finalized_attempt_token)=p_attempt_token and i.acceptance_observed_wa_message_id is null then
  perform set_config('velora.acceptance_observation','1',true);
  update public.whatsapp_send_intents set acceptance_observed_wa_message_id=btrim(p_wa_message_id),acceptance_observed_at=clock_timestamp() where id=i.id;
  perform set_config('velora.acceptance_observation','',true);
 end if;
 if p_result='accepted' and nullif(btrim(p_wa_message_id),'') is not null
 and ((i.acceptance_observed_wa_message_id is not null and i.acceptance_observed_wa_message_id<>btrim(p_wa_message_id))
 or (i.outcome='accepted' and i.wa_message_id<>btrim(p_wa_message_id))) then
  return jsonb_build_object('ok',false,'code','receipt_identity_review');end if;
 if i.provider_error_code='contradictory_receipt_review' then return jsonb_build_object('ok',false,'code','contradictory_receipt_review');end if;
 -- A later proven response can resolve an unknown attempt using its retained
 -- original fence. Historical unbound fences are never fabricated. A response
 -- contradicting proven rejection stays disputed/held; it is not new dispatch.
 if p_result='accepted' and p_attempt_token is not null and i.finalized_attempt_token=p_attempt_token
 and nullif(btrim(p_wa_message_id),'') is not null and i.outcome in ('unknown','rejected') then
  if i.outcome='rejected' then
   update public.whatsapp_send_intents set outcome='unknown',provider_error_code='contradictory_receipt_review' where id=i.id;
   perform public.billing_finalize_automated_usage(i.company_id,i.id);
   return jsonb_build_object('ok',false,'code','contradictory_receipt_review');
  end if;
  begin
   if exists(select 1 from public.whatsapp_messages m where m.wa_message_id=btrim(p_wa_message_id)
    and (m.company_id,m.conversation_id,m.body,m.sender,m.direction) is distinct from (i.company_id,i.conversation_id,i.body,i.sender_kind,'outbound'))
   then raise exception 'provider_identity_review' using errcode='23514';end if;
   update public.whatsapp_send_intents set outcome='accepted',wa_message_id=btrim(p_wa_message_id),provider_error_code='persist_pending' where id=i.id;
   r:=jsonb_build_object('ok',true,'persist_pending',true,'intent',private.whatsapp_send_intent_public((select x from public.whatsapp_send_intents x where x.id=i.id)));
  exception when others then
   update public.whatsapp_send_intents set provider_error_code='provider_identity_review' where id=i.id;
   r:=jsonb_build_object('ok',false,'code','provider_identity_review');
  end;
  if j.id is not null then begin
   u:=public.billing_finalize_automated_usage(i.company_id,i.id);
   if u->>'ok' is distinct from 'true' then r:=r||jsonb_build_object('accounting_pending',true);end if;
  exception when others then r:=r||jsonb_build_object('accounting_pending',true);end;end if;
  return r;
 end if;
 -- Save the fenced observation OUTSIDE the original uniqueness/display scope.
 -- A disputed canonical identity retains its own receipt and unknown hold.
 begin
  r:=private.wa_finalize_pre_accepted_usage(p_intent_id,p_attempt_token,p_result,p_wa_message_id,p_error_code,p_actor_user_id);
 exception when others then
  select * into i from public.whatsapp_send_intents where id=p_intent_id;
  if i.outcome='attempting' and i.acceptance_observed_wa_message_id is not null then
   update public.whatsapp_send_intents set outcome='unknown',provider_error_code='provider_identity_review',attempt_token=null where id=i.id;
  end if;
  r:=jsonb_build_object('ok',false,'code','receipt_or_display_review');
 end;
 select * into i from public.whatsapp_send_intents where id=p_intent_id;
 if j.id is not null and ((r->>'ok'='true' and i.outcome in ('accepted','rejected','unknown'))
 or (i.outcome='unknown' and i.acceptance_observed_wa_message_id is not null)) then
  begin
   u:=public.billing_finalize_automated_usage(i.company_id,i.id);
   if u->>'ok' is distinct from 'true' then r:=r||jsonb_build_object('accounting_pending',true);end if;
  exception when others then r:=r||jsonb_build_object('accounting_pending',true);end;
 end if;
 return r;
end; $$;
revoke all on function public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.finalize_whatsapp_send_attempt(uuid,uuid,text,text,text,uuid) to service_role;

alter function public.retry_whatsapp_send_persist(uuid,uuid) set schema private;
alter function private.retry_whatsapp_send_persist(uuid,uuid) rename to wa_retry_display_pre_accepted_usage;
revoke all on function private.wa_retry_display_pre_accepted_usage(uuid,uuid) from public,anon,authenticated,service_role;
create function public.retry_whatsapp_send_persist(p_intent_id uuid,p_actor_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype;j public.whatsapp_inbound_jobs%rowtype;r jsonb;u jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into i from public.whatsapp_send_intents where id=p_intent_id;j:=private.wa_acceptance_lock(i.company_id,i.id);
 if j.id is not null then begin
  u:=public.billing_finalize_automated_usage(i.company_id,i.id);
  if u->>'status' is distinct from 'accepted' then return jsonb_build_object('ok',false,'code','acceptance_accounting_pending');end if;
 exception when others then return jsonb_build_object('ok',false,'code','acceptance_accounting_pending');end;end if;
 begin r:=private.wa_retry_display_pre_accepted_usage(p_intent_id,p_actor_user_id);
 exception when others then return jsonb_build_object('ok',false,'code','display_identity_or_persistence_review');end;
 return r;
end; $$;
revoke all on function public.retry_whatsapp_send_persist(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_whatsapp_send_persist(uuid,uuid) to service_role;

-- Do not let stale-generation/exhaustion or worker exception writers downgrade
-- a durable accepted receipt. Settlement is independent of current authority.
alter function public.whatsapp_retry_inbound_job(uuid,uuid,text,boolean,boolean) set schema private;
alter function private.whatsapp_retry_inbound_job(uuid,uuid,text,boolean,boolean) rename to wa_retry_job_pre_accepted_usage;
revoke all on function private.wa_retry_job_pre_accepted_usage(uuid,uuid,text,boolean,boolean) from public,anon,authenticated,service_role;
create function public.whatsapp_retry_inbound_job(p_job_id uuid,p_claim_token uuid,p_code text,p_uncertain boolean default false,p_terminal boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;r jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
 if exists(select 1 from public.whatsapp_send_intents where id=j.send_intent_id and company_id=j.company_id and original_job_id=j.id and outcome='accepted' and wa_message_id is not null) then
  r:=public.billing_finalize_automated_usage(j.company_id,j.send_intent_id);
  return r||jsonb_build_object('status',case when r->>'status'='accepted' then 'completed' else 'review_required' end);
 end if;
 return private.wa_retry_job_pre_accepted_usage(p_job_id,p_claim_token,p_code,p_uncertain,p_terminal);
end; $$;
revoke all on function public.whatsapp_retry_inbound_job(uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.whatsapp_retry_inbound_job(uuid,uuid,text,boolean,boolean) to service_role;
alter function public.claim_whatsapp_inbound_job(uuid,integer) set schema private;
alter function private.claim_whatsapp_inbound_job(uuid,integer) rename to wa_claim_job_pre_accepted_usage;
revoke all on function private.wa_claim_job_pre_accepted_usage(uuid,integer) from public,anon,authenticated,service_role;
create function public.claim_whatsapp_inbound_job(p_job_id uuid,p_lease_seconds integer default 120) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;begin
 if current_setting('role',true)<>'service_role' then return jsonb_build_object('ok',false,'code','server_role_required');end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
 if exists(select 1 from public.whatsapp_send_intents where id=j.send_intent_id and company_id=j.company_id and original_job_id=j.id and outcome='accepted' and wa_message_id is not null) then
  perform public.billing_finalize_automated_usage(j.company_id,j.send_intent_id);return jsonb_build_object('ok',false,'code','accepted_receipt_repair_only');
 end if;
 return private.wa_claim_job_pre_accepted_usage(p_job_id,p_lease_seconds);
end; $$;
revoke all on function public.claim_whatsapp_inbound_job(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_inbound_job(uuid,integer) to service_role;

create or replace function public.whatsapp_repair_accepted_jobs(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;r jsonb;u jsonb;repaired int:=0;pending int:=0;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 for candidate in select i.id,i.company_id from public.whatsapp_send_intents i join public.whatsapp_inbound_jobs j
 on j.id=i.original_job_id and j.company_id=i.company_id and j.send_intent_id=i.id
 where i.outcome='accepted' and i.wa_message_id is not null and (i.message_id is null or j.usage_status is distinct from 'accepted' or j.status<>'completed')
 order by i.updated_at,i.id limit greatest(1,least(coalesce(p_limit,10),50)) loop
  begin
   u:=public.billing_finalize_automated_usage(candidate.company_id,candidate.id);
   if u->>'status'='accepted' then r:=public.retry_whatsapp_send_persist(candidate.id,null);
    if r->>'ok'='true' then repaired:=repaired+1;else pending:=pending+1;end if;
   else pending:=pending+1;end if;
  exception when others then pending:=pending+1;end;
 end loop;
 return jsonb_build_object('ok',true,'repaired',repaired,'pending',pending);
end; $$;
revoke all on function public.whatsapp_repair_accepted_jobs(integer) from public,anon,authenticated;
grant execute on function public.whatsapp_repair_accepted_jobs(integer) to service_role;

create or replace function public.billing_read_company_usage(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare period timestamptz:=private.wa_worker_month();accepted bigint;held bigint;cap jsonb;begin
 if not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select count(*) filter(where j.usage_status='accepted'),count(*) filter(where j.usage_status in ('reserved','unknown')) into accepted,held
 from public.whatsapp_inbound_jobs j where j.company_id=p_company_id and j.usage_period_start=period;
 select accepted+count(*) filter(where i.outcome='accepted' and nullif(btrim(i.wa_message_id),'') is not null
 and coalesce(i.acceptance_observed_at,i.attempt_started_at,i.created_at)>=period),
 held+count(*) filter(where i.outcome in ('ready','attempting','unknown') and i.created_at>=period) into accepted,held
 from public.whatsapp_send_intents i where i.company_id=p_company_id and i.sender_kind='assistant' and i.original_job_id is null;
 select v.limits->'automated_outbound_per_month' into cap from public.billing_subscriptions s join public.billing_plan_versions v on v.id=s.plan_version_id
 where s.company_id=p_company_id and s.environment='live';
 return jsonb_build_object('ok',true,'data',jsonb_build_object('month_start',to_char(period at time zone 'Asia/Muscat','YYYY-MM-DD'),
 'successful_automated_outbound',coalesce(accepted,0),'held_outbound_capacity',coalesce(held,0),'cap',cap));
end; $$;
revoke all on function public.billing_read_company_usage(uuid) from public,anon;
grant execute on function public.billing_read_company_usage(uuid) to authenticated;
notify pgrst,'reload schema';commit;
