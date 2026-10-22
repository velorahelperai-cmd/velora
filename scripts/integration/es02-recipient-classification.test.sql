-- LOCAL synthetic classification cases only; no provider network or customer send.
do $local_guard$ begin
 if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then raise exception 'LOCAL_FIXTURE_REQUIRED';end if;
end;$local_guard$;
create function pg_temp.recipient_job(fixture_company uuid,fixture_branch uuid) returns uuid language plpgsql as $$
declare fixture_conversation uuid;fixture_message uuid;fixture_job uuid:=gen_random_uuid();fixture_binding text:='synthetic-recipient-'||fixture_job::text;
begin
 insert into public.whatsapp_conversations(company_id,branch_id,phone_number_id,customer_wa_id,customer_name)
 values(fixture_company,fixture_branch,'synthetic-wallet-phone','96800000001','Synthetic recipient fixture') returning id into fixture_conversation;
 insert into public.whatsapp_messages(company_id,conversation_id,wa_message_id,body,received_at)
 values(fixture_company,fixture_conversation,fixture_binding,'Synthetic classification only',clock_timestamp()) returning id into fixture_message;
 insert into public.whatsapp_inbound_jobs(id,company_id,message_id,wa_message_id)
 values(fixture_job,fixture_company,fixture_message,fixture_binding);
 return fixture_job;
end;$$;
do $recipient_cases$
declare fixture_company uuid;fixture_branch uuid;fixture_job uuid;fixture_claim uuid;fixture_conversation uuid;
 case_index integer;classification_result jsonb;clock_result jsonb;
begin
 select a.company_id,b.id into fixture_company,fixture_branch
 from private.es02_activation_foundation a join public.company_branches b on b.company_id=a.company_id
 where a.clock_state='waiting_readiness' order by a.company_id,b.id limit 1;
 if fixture_company is null then raise exception 'LOCAL_WAITING_FOUNDATION_REQUIRED';end if;
 for case_index in 1..4 loop
  fixture_job:=pg_temp.recipient_job(fixture_company,fixture_branch);fixture_claim:=gen_random_uuid();
  select m.conversation_id into fixture_conversation from public.whatsapp_messages m
   join public.whatsapp_inbound_jobs j on j.message_id=m.id where j.id=fixture_job;
  update public.whatsapp_inbound_jobs set status='claimed',claim_token=fixture_claim,
   claim_expires_at=clock_timestamp()+interval '5 minutes',expected_automation_generation=(
    select automation_generation from public.whatsapp_conversations where id=fixture_conversation)
   where id=fixture_job;
  perform set_config('role','service_role',true);
  classification_result:=public.es02_classify_claimed_reply(fixture_job,fixture_claim,
   case when case_index=3 then 'meta_test' else 'live' end,
   case when case_index=1 then 'synthetic-wallet-phone' else null end,
   case when case_index=2 then array['+96800000001'] else '{}'::text[] end);
  perform set_config('role','none',true);
  raise notice 'RECIPIENT_CASE_RESULT:%:%',case_index,classification_result;
  perform pg_temp.wallet_must(classification_result->>'ok'='true' and
   classification_result->>'recipientClass'=case when case_index<4 then 'test_number' else 'real_customer' end,
   'recipient_classification_case_'||case_index);
  clock_result:=private.es02_start_on_accepted_reply(fixture_job);
  perform pg_temp.wallet_must(clock_result->>'code'='VERIFIED_OPERATIONAL_ACCEPTANCE_REQUIRED',
   'classification_alone_never_starts_clock_'||case_index);
  perform pg_temp.wallet_must((select subscription_started_at is null and clock_state='waiting_readiness'
   from private.es02_activation_foundation where company_id=fixture_company),'clock_unchanged_after_classification_'||case_index);
  if case_index=4 then
   perform set_config('role','service_role',true);
   classification_result:=public.es02_classify_claimed_reply(fixture_job,fixture_claim,'meta_test',null,'{}');
   perform set_config('role','none',true);
   perform pg_temp.wallet_must(classification_result->>'code'='CLASSIFICATION_CHANGED','recipient_classification_cannot_be_rewritten');
  end if;
 end loop;
end;$recipient_cases$;
