-- Run after the exact compiled LOCAL candidate inside an outer ROLLBACK.
-- ACL and real native denial paths, not a successful paid-provider journey.
do $guard$ begin
 if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then raise exception 'LOCAL_FIXTURE_REQUIRED';end if;
end;$guard$;
create function pg_temp.bridge_must(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'BRIDGE_ASSERT_FAILED:%',label;end if;
 raise notice 'BRIDGE_PASS:%',label;
end;$$;
do $acl$
declare signature text;role_name text;p pg_proc;
begin
 foreach signature in array array[
 'public.billing_load_worker_frame(uuid,uuid)',
 'public.whatsapp_reserve_job_usage(uuid,uuid)',
 'public.ai_start_whatsapp_attempt(uuid,uuid)',
 'public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb)',
 'public.whatsapp_claim_assistant_job_send(uuid,uuid)',
 'public.es02_verify_claimed_reply_citations(uuid,uuid,jsonb)',
 'public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text)',
 'public.billing_finalize_automated_usage(uuid,uuid)'] loop
  select * into p from pg_proc where oid=to_regprocedure(signature);
  perform pg_temp.bridge_must(p.oid is not null and p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
    and p.proconfig @> array['search_path=""'],'definer_owner_empty_path_'||signature);
  foreach role_name in array array['anon','authenticated'] loop
   perform pg_temp.bridge_must(not has_function_privilege(role_name,p.oid,'execute'),'browser_denied_'||role_name||'_'||signature);
  end loop;
  perform pg_temp.bridge_must(has_function_privilege('service_role',p.oid,'execute'),'worker_allowed_'||signature);
 end loop;
 for p in select f.* from pg_proc f join pg_namespace n on n.oid=f.pronamespace
  where n.nspname='private' and f.proname like 'es02_pre_%' loop
  perform pg_temp.bridge_must(not has_function_privilege('service_role',p.oid,'execute')
   and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute'),
   'native_alias_not_directly_callable_'||p.proname);
 end loop;
end;$acl$;
do $denials$
declare r jsonb;cid uuid;bid uuid;grp uuid;j uuid;units integer;
begin
 perform set_config('role','service_role',true);
 r:=public.es02_verify_claimed_reply_citations(gen_random_uuid(),gen_random_uuid(),'[]');
 perform pg_temp.bridge_must(r->>'ok'='false','missing_claim_citations_denied');
 r:=public.whatsapp_stage_job_reply(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'[]');
 perform pg_temp.bridge_must(r->>'ok'='false','missing_claim_stage_denied');
 r:=public.whatsapp_claim_assistant_job_send(gen_random_uuid(),gen_random_uuid());
 perform pg_temp.bridge_must(r->>'ok'='false','missing_claim_send_denied');
 r:=public.whatsapp_retrieve_approved_knowledge(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'Synthetic unknown question');
 perform pg_temp.bridge_must(r->>'ok'='false','missing_claim_retrieval_denied');
 perform set_config('role','none',true);
 -- A synthetic job has no native send-intent/receipt. Raw usage status must
 -- never become provider evidence. No new balance, order, HMAC or Auth row.
 begin
  select b.company_id,b.order_group_id,b.remaining into cid,grp,units from private.es02_credit_balances b
   where b.remaining>=2 order by b.id limit 1;
  select id into bid from public.company_branches where company_id=cid order by id limit 1;
  if cid is null or bid is null then raise exception 'EXISTING_FIXTURE_BALANCE_REQUIRED';end if;
  -- Earlier wallet tests may have a review freeze. Their changes remain in the
  -- outer transaction: use an isolated subtransaction and an unused company.
  select b.company_id,b.order_group_id,b.remaining into cid,grp,units from private.es02_credit_balances b
   where b.remaining>=2 and not exists(select 1 from private.es02_reply_credit_holds h where h.company_id=b.company_id and h.review_required)
   order by b.id limit 1;
  if cid is null then raise exception 'UNFROZEN_EXISTING_FIXTURE_BALANCE_REQUIRED';end if;
  select id into bid from public.company_branches where company_id=cid order by id limit 1;
  j:=pg_temp.wallet_job(cid,bid);
  r:=private.es02_hold_reply_credit(j,cid,grp);
  perform pg_temp.bridge_must(r->>'ok'='true','native_negative_existing_units_held');
  perform pg_temp.bridge_must(not private.es02_native_reply_outcome_proven(j,'accepted'),'synthetic_job_is_not_acceptance_evidence');
  perform pg_temp.bridge_must(not private.es02_native_reply_outcome_proven(j,'released'),'synthetic_job_is_not_rejection_evidence');
  update public.whatsapp_inbound_jobs set usage_status='released' where id=j;
  r:=private.es02_reconcile_native_reply_credit(j);
  perform pg_temp.bridge_must(r->>'ok'='false' and r->>'code'='ES02_PROVIDER_OUTCOME_PROOF_REQUIRED','raw_release_requires_native_rejection');
  perform pg_temp.bridge_must((select state='unknown' from private.es02_reply_credit_holds where job_id=j),'unproven_release_keeps_hold');
  r:=private.es02_reconcile_native_reply_credit(j);
  perform pg_temp.bridge_must(r->>'ok'='false' and (select state='unknown' from private.es02_reply_credit_holds where job_id=j),'unproven_release_replay_keeps_hold');
  perform pg_temp.bridge_must((select remaining=units from private.es02_credit_balances where company_id=cid and order_group_id=grp),'unproven_outcome_no_debit_or_refund');
  raise exception 'ROLLBACK_NEGATIVE_NATIVE_JOB' using errcode='PBN01';
 exception when sqlstate 'PBN01' then null;end;
end;$denials$;
