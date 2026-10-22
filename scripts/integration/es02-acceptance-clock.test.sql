-- Run only inside the pinned local fixture's outer BEGIN/ROLLBACK.
select pg_temp.wallet_must(to_regprocedure('private.es02_start_on_accepted_reply(uuid)') is not null,'native_acceptance_clock_exists');
select pg_temp.wallet_must(to_regprocedure('public.es02_classify_claimed_reply(uuid,uuid,text,text,text[])') is not null,'trusted_recipient_classifier_exists');
do $checks$
declare result jsonb; t text; r text;
begin
  foreach t in array array['es02_operational_recipient_proofs','es02_initial_acceptance_receipts'] loop
    perform pg_temp.wallet_must((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=t),'clock_rls_'||t);
    foreach r in array array['anon','authenticated','service_role'] loop
      perform pg_temp.wallet_must(not has_table_privilege(r,format('private.%I',t),'select,insert,update,delete'),'clock_direct_access_denied_'||r||'_'||t);
    end loop;
  end loop;
  perform pg_temp.wallet_must(not has_function_privilege('anon','public.es02_classify_claimed_reply(uuid,uuid,text,text,text[])','execute'),'classifier_anon_denied');
  perform pg_temp.wallet_must(not has_function_privilege('authenticated','public.es02_classify_claimed_reply(uuid,uuid,text,text,text[])','execute'),'classifier_authenticated_denied');
  perform pg_temp.wallet_must(has_function_privilege('service_role','public.es02_classify_claimed_reply(uuid,uuid,text,text,text[])','execute'),'classifier_service_allowed');
  result:=private.es02_start_on_accepted_reply(gen_random_uuid());
  perform pg_temp.wallet_must(result->>'ok'='false' and result->>'code'='VERIFIED_OPERATIONAL_ACCEPTANCE_REQUIRED','random_receipt_cannot_start_clock');
  perform set_config('role','authenticated',true);
  begin
    perform public.es02_classify_claimed_reply(gen_random_uuid(),gen_random_uuid(),'live',null,'{}');
    raise exception 'CLASSIFIER_BROWSER_CALL_ALLOWED';
  exception when insufficient_privilege then raise notice 'WALLET_PASS:classifier_browser_denied';end;
  perform set_config('role','service_role',true);
  result:=public.es02_classify_claimed_reply(gen_random_uuid(),gen_random_uuid(),'live',null,'{}');
  perform pg_temp.wallet_must(result->>'ok'='false','unknown_job_cannot_be_real_customer');
  perform set_config('role','none',true);
end;$checks$;

do $initial_fence$
declare cid uuid;bid uuid;grp uuid;j1 uuid;j2 uuid;r jsonb;
begin
 select b.company_id,b.order_group_id into cid,grp from private.es02_credit_balances b
 join private.es02_activation_foundation a on a.company_id=b.company_id and a.clock_state='waiting_readiness'
 where b.remaining>=2 and not exists(select 1 from private.es02_reply_credit_holds h where h.company_id=b.company_id)
 order by b.id limit 1;
 if cid is null then raise exception 'EXISTING_UNUSED_LOCAL_BALANCE_REQUIRED';end if;
 select id into bid from public.company_branches where company_id=cid order by id limit 1;
 begin
  j1:=pg_temp.wallet_job(cid,bid);j2:=pg_temp.wallet_job(cid,bid);
  -- Synthetic local classification proof only; no provider/contact or new grant.
  insert into private.es02_operational_recipient_proofs(job_id,company_id,branch_id,recipient_class,inbound_binding)
  values(j1,cid,bid,'real_customer','synthetic-fence-proof'),(j2,cid,bid,'real_customer','synthetic-fence-proof');
  r:=private.es02_hold_reply_credit(j1,cid,grp);
  perform pg_temp.wallet_must(r->>'ok'='true','first_real_reply_can_hold');
  r:=private.es02_hold_reply_credit(j2,cid,grp);
  perform pg_temp.wallet_must(r->>'code'='INITIAL_REPLY_PENDING','competing_initial_real_reply_blocked');
  perform private.es02_settle_reply_credit(j1,'unknown');
  r:=private.es02_hold_reply_credit(j2,cid,grp);
  perform pg_temp.wallet_must(r->>'code'='INITIAL_REPLY_PENDING','unknown_initial_reply_blocks_another_initial_send');
  begin
   update private.es02_activation_foundation set clock_state='active',subscription_started_at=clock_timestamp(),paid_through_at=clock_timestamp()+interval '1 month' where company_id=cid;
   raise exception 'READINESS_STARTED_CLOCK_WITHOUT_RECEIPT';
  exception when check_violation then raise notice 'WALLET_PASS:readiness_cannot_start_native_clock';end;
  raise exception 'fixture_subtransaction_rollback' using errcode='PWF01';
 exception when sqlstate 'PWF01' then null;end;
end;$initial_fence$;
