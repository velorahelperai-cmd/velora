-- Local forward repair for the historical accepted-usage guard on baseline
-- whatsapp_inbound_jobs rows. Preserve the enabled trigger and all existing
-- receipt/usage enforcement where the optional response_kind contract exists.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $preflight$
begin
 if not exists (
   select 1 from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private' and p.proname='wa_accepted_receipt_guard'
     and p.pronargs=0 and md5(p.prosrc)='1f5fd4697287ee783ceeda21489a1573'
     and pg_get_userbyid(p.proowner)='postgres'
 ) then raise exception 'WA_ACCEPTED_RECEIPT_GUARD_SOURCE_DRIFT'; end if;
 if (select count(*) from pg_trigger t
     where t.tgfoid=to_regprocedure('private.wa_accepted_receipt_guard()')
       and not t.tgisinternal and t.tgenabled in ('O','A')
       and ((t.tgrelid='public.whatsapp_send_intents'::regclass and t.tgname='whatsapp_accepted_receipt_guard')
         or (t.tgrelid='public.whatsapp_inbound_jobs'::regclass and t.tgname='whatsapp_accepted_usage_guard')))<>2
 then raise exception 'WA_ACCEPTED_RECEIPT_GUARD_TRIGGER_DRIFT'; end if;
end;
$preflight$;

create or replace function private.wa_accepted_receipt_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 -- This guard spans two relations with versioned, intentionally separate
 -- row shapes. Baseline inbound jobs do not carry the optional accepted-usage
 -- contract; avoid dereferencing fields from that later contract on baseline
 -- rows. The guard remains active and enforces the full contract when present.
 if tg_table_name='whatsapp_inbound_jobs' and not (to_jsonb(new) ? 'response_kind') then
  return new;
 end if;
 if tg_table_name='whatsapp_send_intents' then
  if tg_op='INSERT' then
   if new.sender_kind<>'assistant' or new.response_kind is not null or new.original_job_id is null then return new; end if;
  elsif old.sender_kind<>'assistant' or old.response_kind is not null or old.original_job_id is null then
   return new;
  end if;
  if tg_op='INSERT' then
   if new.acceptance_observed_wa_message_id is not null or new.acceptance_observed_at is not null or new.finalized_attempt_token is not null then
    raise exception 'ACCEPTANCE_OBSERVATION_SERVER_ONLY' using errcode='23514';
   end if;
  else
   if old.finalized_attempt_token is null and old.outcome='attempting' and old.attempt_token is not null and new.outcome in ('accepted','rejected','unknown') then
    if current_user<>(select pg_get_userbyid(relowner) from pg_class where oid=tg_relid) then raise exception 'FINALIZED_ATTEMPT_SERVER_ONLY' using errcode='23514'; end if;
    new.finalized_attempt_token:=old.attempt_token;
   elsif new.finalized_attempt_token is distinct from old.finalized_attempt_token then
    raise exception 'FINALIZED_ATTEMPT_IMMUTABLE' using errcode='23514';
   end if;
   if row(new.acceptance_observed_wa_message_id,new.acceptance_observed_at) is distinct from row(old.acceptance_observed_wa_message_id,old.acceptance_observed_at) then
    if old.acceptance_observed_wa_message_id is not null or new.acceptance_observed_wa_message_id is null or old.outcome not in ('attempting','unknown','rejected')
      or coalesce(old.attempt_token,old.finalized_attempt_token) is null or coalesce(current_setting('velora.acceptance_observation',true),'')<>'1'
      or current_user<>(select pg_get_userbyid(relowner) from pg_class where oid=tg_relid) then
     raise exception 'ACCEPTANCE_OBSERVATION_IMMUTABLE' using errcode='23514';
    end if;
   end if;
   if old.outcome='accepted' and nullif(btrim(old.wa_message_id),'') is not null
     and (new.outcome is distinct from 'accepted' or new.original_job_id is distinct from old.original_job_id) then
    raise exception 'ACCEPTED_RECEIPT_IMMUTABLE' using errcode='23514';
   end if;
  end if;
 else
  if tg_op='INSERT' then
   if new.response_kind is not null then return new; end if;
  elsif old.response_kind is not null then
   return new;
  end if;
  if tg_op='INSERT' and new.usage_status='accepted' then raise exception 'ACCEPTED_USAGE_SERVER_ONLY' using errcode='23514'; end if;
  if tg_op='UPDATE' then
   if old.usage_status='accepted' and row(new.response_kind,new.usage_status,new.usage_subscription_id,new.usage_period_start,new.send_intent_id,new.staged_ai_attempt_id,new.staged_reply,new.staged_citations,new.expected_automation_generation)
     is distinct from row(old.response_kind,old.usage_status,old.usage_subscription_id,old.usage_period_start,old.send_intent_id,old.staged_ai_attempt_id,old.staged_reply,old.staged_citations,old.expected_automation_generation) then
    raise exception 'ACCEPTED_USAGE_IRREVERSIBLE' using errcode='23514';
   end if;
   if new.usage_status='accepted' and old.usage_status is distinct from 'accepted'
     and (coalesce(current_setting('velora.accepted_usage_settlement',true),'')<>'1'
       or current_user<>(select pg_get_userbyid(relowner) from pg_class where oid=tg_relid)) then
    raise exception 'ACCEPTED_USAGE_SERVER_ONLY' using errcode='23514';
   end if;
  end if;
 end if;
 return new;
end;
$$;

do $verify$
begin
 if pg_get_userbyid((select p.proowner from pg_proc p where p.oid=to_regprocedure('private.wa_accepted_receipt_guard()')))<>'postgres'
   or (select count(*) from pg_trigger t where t.tgfoid=to_regprocedure('private.wa_accepted_receipt_guard()') and not t.tgisinternal and t.tgenabled in ('O','A'))<>2
 then raise exception 'WA_ACCEPTED_RECEIPT_GUARD_POSTCONDITION_FAILED'; end if;
end;
$verify$;
commit;
