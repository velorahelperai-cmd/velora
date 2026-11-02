-- An expired worker lease with no provider or send evidence is safe to reclaim.
-- Preserve the actual claim count; record each distinct transport-only expiry.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
alter table public.whatsapp_inbound_jobs
 add column preprovider_transport_recoveries integer not null default 0,
 add column preprovider_last_claim_hash text,
 add constraint wa_preprovider_recovery_count check(preprovider_transport_recoveries>=0 and preprovider_transport_recoveries<=attempt_count),
 add constraint wa_preprovider_recovery_hash check(preprovider_last_claim_hash is null or preprovider_last_claim_hash ~ '^[0-9a-f]{64}$');

create function private.es02_record_preprovider_expiry(p_job uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare cid uuid; conv_id uuid; c public.whatsapp_conversations; j public.whatsapp_inbound_jobs; token_hash text;
begin
 select x.company_id,m.conversation_id into cid,conv_id from public.whatsapp_inbound_jobs x
 join public.whatsapp_messages m on m.id=x.message_id and m.company_id=x.company_id
 where x.id=p_job and x.status='claimed' and x.claim_token is not null and x.claim_expires_at<=clock_timestamp();
 if cid is null then return false;end if;
 perform 1 from public.companies where id=cid for no key update nowait;
 select * into c from public.whatsapp_conversations where id=conv_id and company_id=cid for update nowait;
 select * into j from public.whatsapp_inbound_jobs where id=p_job and company_id=cid for update nowait;
 if j.id is null or c.id is null or c.status<>'open' or not c.automation_allowed
  or j.status<>'claimed' or j.claim_token is null or j.claim_expires_at is null or j.claim_expires_at>clock_timestamp()
  or j.response_kind is not null or j.expected_automation_generation is distinct from c.automation_generation
  or j.attempt_count<=j.preprovider_transport_recoveries or j.send_intent_id is not null or j.staged_ai_attempt_id is not null
  or j.staged_reply is not null or j.staged_citations is not null or j.completed_at is not null
  or j.usage_period_start is not null or j.usage_subscription_id is not null
  or (j.usage_status is not null and j.usage_status<>'released')
  or not exists(select 1 from private.es02_activation_foundation a where a.company_id=cid and a.ai_auto_start_at is not null)
  or exists(select 1 from public.ai_usage_ledger l where l.worker_job_id=j.id)
  or exists(select 1 from public.whatsapp_send_intents i where i.original_job_id=j.id)
  or exists(select 1 from private.es02_reply_credit_holds h where h.job_id=j.id) then return false;end if;
 token_hash:=encode(extensions.digest(convert_to(j.claim_token::text,'UTF8'),'sha256'),'hex');
 if j.preprovider_last_claim_hash=token_hash then return false;end if;
 update public.whatsapp_inbound_jobs set preprovider_transport_recoveries=preprovider_transport_recoveries+1,
  preprovider_last_claim_hash=token_hash,updated_at=clock_timestamp() where id=j.id and company_id=cid;
 return found;
exception when lock_not_available or deadlock_detected then return false;
end;$$;
revoke all on function private.es02_record_preprovider_expiry(uuid) from public,anon,authenticated,service_role;

do $patch$
declare body text; old_count text:='j.attempt_count>=5'; new_count text:='(j.attempt_count-j.preprovider_transport_recoveries)>=5';
 old_claim text:=' r:=public.claim_whatsapp_inbound_job(candidate.id,120);';
 new_claim text:=' perform private.es02_record_preprovider_expiry(candidate.id);'||chr(10)||old_claim;
begin
 select pg_get_functiondef('private.wa_claim_job_pre_accepted_usage(uuid,integer)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_count,'')))/length(old_count)<>2 then raise exception 'WA_CLAIM_RETRY_SOURCE_DRIFT';end if;
 execute replace(body,old_count,new_count);
 select pg_get_functiondef('public.whatsapp_claim_inbound_batch(integer)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_claim,'')))/length(old_claim)<>1 then raise exception 'WA_BATCH_RETRY_SOURCE_DRIFT';end if;
 execute replace(body,old_claim,new_claim);
end;$patch$;
commit;
