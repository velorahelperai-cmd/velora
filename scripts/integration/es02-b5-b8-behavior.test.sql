-- Local fixture-only native proof. UUID parameters are identifiers, never credentials.
-- Requires psql -v actor_id=... -v session_id=... -v company_id=... -v branch_id=...
begin;
select set_config('es02.test.actor', :'actor_id', true);
select set_config('es02.test.session', :'session_id', true);
select set_config('es02.test.company', :'company_id', true);
select set_config('es02.test.branch', :'branch_id', true);
do $guard$ begin if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then raise exception 'LOCAL_FIXTURE_REQUIRED';end if;end;$guard$;
set local statement_timeout='20s';
create function pg_temp.must(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT_FAILED:%',label;end if;raise notice 'PASS:%',label;end;$$;
do $$
declare
  actor uuid:=current_setting('es02.test.actor')::uuid;
  sid uuid:=current_setting('es02.test.session')::uuid;
  company uuid:=current_setting('es02.test.company')::uuid;
  branch uuid:=current_setting('es02.test.branch')::uuid;
  operation uuid:=gen_random_uuid(); other_operation uuid:=gen_random_uuid();
  result jsonb; snap jsonb; binding jsonb; attempt uuid:=gen_random_uuid(); legacy uuid; ready_revision text; knowledge text; page uuid; version integer; hours bigint; lang text; persona text;
begin
  -- Synthetic content only, rolled back; preserve any pre-existing schedule/language.
  insert into private.es02_branch_hours(company_id,branch_id,schedule,revision)
    values(company,branch,'{"monday":{"state":"open","intervals":[{"start":"09:00","end":"18:00","nextDay":false}]}}',1) on conflict do nothing;
  insert into private.es02_branch_reply_language_confirmations(company_id,branch_id,reply_language,revision)
    values(company,branch,'ar',1) on conflict do nothing;
  select revision into hours from private.es02_branch_hours where company_id=company and branch_id=branch;
  select reply_language into lang from private.es02_branch_reply_language_confirmations where company_id=company and branch_id=branch;
  select case r.persona when 'level_1' then 'noura' when 'level_2' then 'lina' else 'dana' end into persona from private.es02_branch_slot_rights r where r.company_id=company and r.branch_id=branch;
  perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated','session_id',sid)::text,true);
  perform set_config('role','authenticated',true);
  result:=public.es02_add_owned_branch_website(actor,company,branch,1,'https://es02-synthetic.invalid/native-proof');
  perform pg_temp.must(result->>'ok'='true','authenticated_save_website');
  select (v->>'id')::uuid,(v->>'version')::integer into page,version from jsonb_array_elements(result->'data'->'snapshot'->'pages') v where v->>'url'='https://es02-synthetic.invalid/native-proof';
  result:=public.es02_index_branch_website_page(actor,company,branch,page,'Synthetic shop','Synthetic shop opens at nine.','indexed',null,version,'https://es02-synthetic.invalid/native-proof');
  perform pg_temp.must(result->>'ok'='true','authenticated_index_saved_version');
  result:=public.es02_index_branch_website_page(actor,company,branch,page,'Stale','Must not overwrite.','indexed',null,version,'https://es02-synthetic.invalid/native-proof');
  perform pg_temp.must(result->>'code'='PAGE_CHANGED','stale_index_cannot_overwrite');
  result:=public.es02_read_owned_branch_answer_context(actor,company,branch);
  perform pg_temp.must(result->>'ok'='true' and (result->'data'->'pages')::text like '%Synthetic shop opens at nine.%','indexed_text_retrievable_for_answers');
  knowledge:=result->'data'->>'knowledgeRevision';
  result:=public.es02_read_owned_branch_answer_context(gen_random_uuid(),company,branch);
  perform pg_temp.must(result->>'ok'='false','context_actor_impersonation_denied');
  begin
    perform public.es02_reserve_branch_trial(operation,actor,sid,company,branch,'Synthetic question',knowledge,hours,lang,persona,'gemini-3.8-flash',1,'synthetic-pricing','{"modelId":"gemini-3.8-flash","version":"synthetic-pricing"}','[]');
    raise exception 'AUTHENTICATED_RESERVATION_WRITER_CALLABLE';
  exception when insufficient_privilege then raise notice 'PASS:authenticated_cannot_reserve_service_execution'; end;
  perform set_config('role','service_role',true);
  result:=public.es02_reserve_branch_trial(operation,actor,sid,company,branch,'Synthetic question',knowledge,hours,lang,persona,'gemini-3.8-flash',1,'synthetic-pricing','{"modelId":"gemini-3.8-flash","version":"synthetic-pricing"}','[{"sourceId":"synthetic","title":"Synthetic shop","contentVersion":1}]');
  perform pg_temp.must(result->>'ok'='true' and result->>'newlyReserved'='true','free_trial_reserved_in_existing_cost_ledger:'||coalesce(result->>'code','NO_CODE'));
  result:=public.es02_reserve_branch_trial(operation,actor,sid,company,branch,'Synthetic question',knowledge,hours,lang,persona,'gemini-3.8-flash',1,'synthetic-pricing','{"modelId":"gemini-3.8-flash","version":"synthetic-pricing"}','[]');
  perform pg_temp.must(result->>'newlyReserved'='false' and result->>'state'='reserved','operation_replay_does_not_reserve_twice');
  result:=public.es02_start_branch_trial(operation);
  perform pg_temp.must(result->>'ok'='true','native_context_rechecked_before_dispatch');
  perform pg_temp.must(public.ai_settle_admin_attempt(operation,'success',0.000001,0.0004,'{"promptTokens":5,"completionTokens":5,"cachedTokens":0,"reasoningTokens":0,"cacheWriteTokens":0,"totalTokens":10}','synthetic-request',null,1,'synthetic-response','gemini-3.8-flash'),'existing_cost_settlement_accepts_setup_mode');
  result:=public.es02_record_owned_branch_assistant_trial(actor,company,branch,'Synthetic question','Synthetic provider-double answer','gemini-3.8-flash',hours,lang,persona,knowledge,operation);
  perform pg_temp.must(result->>'ok'='true','trusted_completed_execution_creates_trial_proof');
  result:=public.es02_record_owned_branch_assistant_trial(actor,company,branch,'Synthetic question','Forged standalone answer','gemini-3.8-flash',hours,lang,persona,knowledge,gen_random_uuid());
  perform pg_temp.must(result->>'code'='VERIFIED_EXECUTION_REQUIRED','service_writer_requires_completed_ledger_execution');
  perform set_config('role','authenticated',true);
  snap:=public.es02_read_owned_branch_assistant_trial(actor,company,branch);
  perform pg_temp.must(snap->>'ok'='true' and (snap->'data'->'snapshot'->'trialAllowance'->>'used')::integer=1,'refresh_reads_persisted_free_count');
  perform pg_temp.must(jsonb_typeof(snap->'data'->'snapshot'->'messages'->0->'result'->'citations')='array','trial_transcript_has_citation_array');
  begin
    perform public.es02_record_owned_branch_assistant_trial(actor,company,branch,'Q','Forged','gemini-3.8-flash',hours,lang,persona,knowledge,gen_random_uuid());
    raise exception 'NEW_AUTHENTICATED_ENGINE_WRITER_CALLABLE';
  exception when insufficient_privilege then raise notice 'PASS:new_authenticated_engine_writer_denied'; end;
  result:=public.es02_read_owned_branch_launch_summary(actor,company,branch);
  perform pg_temp.must(result->'data'->'snapshot'->'readiness'->>'status'='blocked','missing_real_channel_proof_blocks_launch');
  perform set_config('role','service_role',true);
  result:=public.es02_reserve_branch_trial(other_operation,actor,sid,company,branch,'Unknown synthetic result',knowledge,hours,lang,persona,'gemini-3.8-flash',1,'synthetic-pricing','{"modelId":"gemini-3.8-flash","version":"synthetic-pricing"}','[]');
  perform pg_temp.must(result->>'newlyReserved'='true','next_explicit_operation_can_reserve');
  perform public.es02_start_branch_trial(other_operation);
  perform pg_temp.must(public.ai_settle_admin_attempt(other_operation,'uncertain',null,null,'{}',null,'SYNTHETIC_UNKNOWN',1,null,null),'unknown_result_keeps_existing_budget_hold');
  result:=public.es02_reserve_branch_trial(gen_random_uuid(),actor,sid,company,branch,'No blind retry',knowledge,hours,lang,persona,'gemini-3.8-flash',1,'synthetic-pricing','{"modelId":"gemini-3.8-flash","version":"synthetic-pricing"}','[]');
  perform pg_temp.must(result->>'code'='TRIAL_PENDING','unknown_result_blocks_blind_new_request');
  perform set_config('role','none',true);
  perform pg_temp.must((select count(*)=2 from public.ai_usage_ledger where id in(operation,other_operation) and usage_mode='setup_trial'),'trial_costs_use_existing_ledger');
  -- Simulate stored B3/legacy verification only. No secret is created or fetched,
  -- and no Meta endpoint is contacted. All rows/activation are rolled back.
  perform set_config('role','authenticated',true);
  perform public.es02_select_owned_branch_channels(actor,company,branch,gen_random_uuid(),'["whatsapp"]');
  perform set_config('role','none',true);
  binding:=private.es02_b3_current_binding(actor,company,branch,'whatsapp');
  perform pg_temp.must(binding->>'ok'='true','native_B3_paid_binding_is_current');
  insert into public.whatsapp_company_links(company_id,status,provider_phone_number_id,provider_waba_id,generation,keep_on_phone,access_secret_id,authorization_status,authorization_app_id,authorization_user_id,authorization_session_id,authorization_verified_at,authorization_non_expiring)
    values(company,'verified','synthetic-phone-id','synthetic-waba-id',741,false,gen_random_uuid(),'active','synthetic-app',actor,sid,clock_timestamp(),true)
    on conflict(company_id) do update set status='verified',provider_phone_number_id='synthetic-phone-id',provider_waba_id='synthetic-waba-id',generation=741,keep_on_phone=false,access_secret_id=gen_random_uuid(),authorization_status='active',authorization_app_id='synthetic-app',authorization_user_id=actor,authorization_session_id=sid,authorization_verified_at=clock_timestamp(),authorization_non_expiring=true,authorization_expires_at=null
    returning id into legacy;
  insert into private.es02_b3_connection_scope(company_id,branch_id,channel,revision) values(company,branch,'whatsapp',1) on conflict do nothing;
  insert into private.es02_b3_connection_attempts(id,account_id,company_id,branch_id,channel,flow,client_op_id,fingerprint,revision,generation,order_id,slot_index,selection_id,selection_fingerprint,paid_fingerprint,legacy_attempt_id,legacy_generation,session_id,app_id,status,expires_at)
    values(attempt,actor,company,branch,'whatsapp','wa_new_number',gen_random_uuid(),'synthetic-proof','1',1,(binding->>'orderId')::uuid,(binding->>'slotIndex')::integer,(binding->>'selectionId')::uuid,binding->>'selectionFingerprint',binding->>'paidFingerprint',gen_random_uuid(),741,sid,'synthetic-app','bound',clock_timestamp()+interval '1 hour');
  insert into private.es02_b3_connection_links(attempt_id,company_id,branch_id,channel,legacy_link_id,legacy_generation,verified,status)
    values(attempt,company,branch,'whatsapp',legacy,741,true,'active');
  perform set_config('role','authenticated',true);
  result:=public.es02_b3_read_owned_branch_connection(actor,company,branch,'whatsapp');
  perform pg_temp.must(result->'connection'->>'verified'='true','B3_rechecks_matching_live_generation');
  result:=public.es02_read_owned_branch_launch_summary(actor,company,branch);
  perform pg_temp.must(result->'data'->'snapshot'->'readiness'->>'status'='ready','knowledge_trial_B3_chain_reaches_ready');
  ready_revision:=result->'data'->'snapshot'->'readiness'->>'revision';
  result:=public.es02_confirm_owned_branch_launch(actor,company,branch,1,ready_revision,gen_random_uuid(),true);
  perform pg_temp.must(result->'data'->'snapshot'->'activation'->>'status'='launched','explicit_launch_creates_activation_receipt');
  perform set_config('role','none',true);
  update public.whatsapp_company_links set status='disconnected',generation=742 where id=legacy;
  perform set_config('role','authenticated',true);
  result:=public.es02_read_owned_branch_launch_summary(actor,company,branch);
  perform pg_temp.must(result->'data'->'snapshot'->'readiness'->>'status'='blocked' and result->'data'->'snapshot'->'readiness'->>'revision'<>ready_revision,'legacy_generation_change_invalidates_readiness');
  result:=public.es02_confirm_owned_branch_launch(actor,company,branch,1,ready_revision,gen_random_uuid(),true);
  perform pg_temp.must(result->>'ok'='false','stale_launch_confirmation_denied');
  perform set_config('role','none',true);
  perform set_config('velora.allow_status_change','on',true);
  update public.companies set status='suspended' where id=company;
  perform set_config('role','authenticated',true);
  result:=public.es02_read_owned_branch_launch_summary(actor,company,branch);
  perform pg_temp.must(result->>'ok'='false' and result->>'code'='SUSPENDED','launch_passes_subscription_suspension_denial');
  raise notice 'NATIVE_INCLUSION_ALL_PASSED';
end;
$$;
rollback;
