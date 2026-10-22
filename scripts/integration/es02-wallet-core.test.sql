-- Native wallet core tests. Run inside an outer BEGIN/ROLLBACK on the existing
-- c1_ui_integration fixture only. Creates synthetic message/job records but NO
-- credit rows, Auth identities or sessions. Existing balances are rolled back.
do $guard$ begin
 if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then raise exception 'LOCAL_FIXTURE_REQUIRED';end if;
end;$guard$;
create function pg_temp.wallet_must(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'WALLET_ASSERT_FAILED:%',label;end if;
 raise notice 'WALLET_PASS:%',label;
end;$$;
create function pg_temp.wallet_job(company uuid,branch uuid) returns uuid language plpgsql as $$
declare conv uuid;msg uuid;job uuid:=gen_random_uuid();wid text:='synthetic-wallet-'||job::text;
begin
 insert into public.whatsapp_conversations(company_id,branch_id,phone_number_id,customer_wa_id,customer_name)
 values(company,branch,'synthetic-wallet-phone',wid,'Synthetic wallet fixture') returning id into conv;
 insert into public.whatsapp_messages(company_id,conversation_id,wa_message_id,body,received_at)
 values(company,conv,wid,'Synthetic wallet-only question',clock_timestamp()) returning id into msg;
 insert into public.whatsapp_inbound_jobs(id,company_id,message_id,wa_message_id) values(job,company,msg,wid);
 return job;
end;$$;
-- This subtransaction TEMPORARILY reclassifies one existing fixture balance.
-- No INSERT/grant/increase of units; rollback restores kind/expiry/remaining.
-- It tests purchased eligibility, not a genuine financial purchase receipt.
do $purchased$
declare b private.es02_credit_balances;branch uuid;j uuid;r jsonb;fake_current_group uuid:=gen_random_uuid();
begin
 begin
  select x.* into b from private.es02_credit_balances x where x.kind='base' and x.remaining>=1 order by x.id limit 1;
  if b.id is null then raise exception 'EXISTING_BALANCE_REQUIRED';end if;
  select id into branch from public.company_branches where company_id=b.company_id order by id limit 1;
  update private.es02_credit_balances set kind='purchased',ordinary_expiry=clock_timestamp()-interval '1 day' where id=b.id;
  j:=pg_temp.wallet_job(b.company_id,branch);
  r:=private.es02_hold_reply_credit(j,b.company_id,fake_current_group);
  perform pg_temp.wallet_must(r->>'ok'='true' and r->>'kind'='purchased','reclassified_purchased_ignores_ordinary_expiry');
  perform pg_temp.wallet_must((select order_group_id=fake_current_group and balance_id=b.id from private.es02_reply_credit_holds where job_id=j),'purchased_carries_across_order_groups');
  perform pg_temp.wallet_must((select remaining=b.remaining from private.es02_credit_balances where id=b.id),'purchased_hold_preserves_owned_units');
  r:=private.es02_settle_reply_credit(j,'accepted');
  perform pg_temp.wallet_must(r->>'ok'='true' and (select remaining=b.remaining-1 from private.es02_credit_balances where id=b.id),'reclassified_purchased_acceptance_debits_once');
  raise exception 'ROLLBACK_SYNTHETIC_RECLASSIFICATION' using errcode='PWT01';
 exception when sqlstate 'PWT01' then null;end;
 perform pg_temp.wallet_must((select kind=b.kind and ordinary_expiry is not distinct from b.ordinary_expiry and remaining=b.remaining from private.es02_credit_balances where id=b.id),'purchased_test_reclassification_restored');
end;$purchased$;
do $tests$
declare b private.es02_credit_balances; branch uuid;j uuid;j2 uuid;j3 uuid;r jsonb;before_remaining integer;rol text;refused boolean;
begin
 r:=private.es02_hold_reply_credit(null,null,null);
 perform pg_temp.wallet_must(r->>'code'='INVALID_INPUT','null_scope_denied');
 select x.* into b from private.es02_credit_balances x where x.kind='base' and x.remaining>=4
 and (x.ordinary_expiry is null or x.ordinary_expiry>clock_timestamp()) order by x.id limit 1;
 if b.id is null then raise exception 'EXISTING_BASE_BALANCE_REQUIRED';end if;
 select id into branch from public.company_branches where company_id=b.company_id order by id limit 1;
 if branch is null then raise exception 'EXISTING_BALANCE_BRANCH_REQUIRED';end if;
 j:=pg_temp.wallet_job(b.company_id,branch);j2:=pg_temp.wallet_job(b.company_id,branch);j3:=pg_temp.wallet_job(b.company_id,branch);
 before_remaining:=b.remaining;
 r:=private.es02_hold_reply_credit(j,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='true' and r->>'reused'='false','base_hold_created');
 perform pg_temp.wallet_must((select remaining=before_remaining from private.es02_credit_balances where id=b.id),'hold_does_not_debit_before_acceptance');
 r:=private.es02_hold_reply_credit(j,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='true' and r->>'reused'='true','hold_replay_is_idempotent');
 r:=private.es02_settle_reply_credit(j,'accepted');
 perform pg_temp.wallet_must(r->>'ok'='true' and (select remaining=before_remaining-1 from private.es02_credit_balances where id=b.id),'acceptance_debits_once');
 r:=private.es02_settle_reply_credit(j,'accepted');
 perform pg_temp.wallet_must(r->>'ok'='true' and r->>'reused'='true' and (select remaining=before_remaining-1 from private.es02_credit_balances where id=b.id),'acceptance_replay_no_second_debit');
 r:=private.es02_hold_reply_credit(j,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='false' and r->>'code'='CREDIT_ALREADY_ACCEPTED','accepted_job_cannot_resend');
 r:=private.es02_settle_reply_credit(j,'released');
 perform pg_temp.wallet_must(r->>'ok'='false' and r->>'code'='CREDIT_ALREADY_ACCEPTED','accepted_cannot_release');
 refused:=false;begin update private.es02_reply_credit_holds set state='released' where job_id=j;exception when check_violation then refused:=true;end;
 perform pg_temp.wallet_must(refused,'accepted_row_immutable');
 r:=private.es02_hold_reply_credit(j2,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='true','second_job_hold_created');
 r:=private.es02_settle_reply_credit(j2,'unknown');
 perform pg_temp.wallet_must(r->>'ok'='true' and (select remaining=before_remaining-1 from private.es02_credit_balances where id=b.id),'unknown_retains_hold_without_debit');
 r:=private.es02_hold_reply_credit(j2,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='false' and r->>'code'='CREDIT_RECONCILIATION_REQUIRED','unknown_cannot_resend');
 r:=private.es02_settle_reply_credit(j2,'accepted');
 perform pg_temp.wallet_must(r->>'ok'='true' and (select remaining=before_remaining-2 from private.es02_credit_balances where id=b.id),'unknown_reconciles_acceptance_once');
 r:=private.es02_hold_reply_credit(j3,b.company_id,b.order_group_id);r:=private.es02_settle_reply_credit(j3,'released');
 perform pg_temp.wallet_must(r->>'ok'='true' and (select remaining=before_remaining-2 from private.es02_credit_balances where id=b.id),'confirmed_rejection_releases_without_debit');
 r:=private.es02_settle_reply_credit(j3,'released');
 perform pg_temp.wallet_must(r->>'ok'='true' and r->>'reused'='true','rejection_replay_idempotent');
 r:=private.es02_hold_reply_credit(j3,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='false' and r->>'code'='CREDIT_RESERVATION_RELEASED','released_job_not_automatically_reheld');
 r:=private.es02_hold_reply_credit(j,gen_random_uuid(),b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='false','foreign_company_denied');
 r:=private.es02_hold_reply_credit(j,b.company_id,gen_random_uuid());
 perform pg_temp.wallet_must(r->>'ok'='false','operation_scope_mismatch_denied');
 r:=private.es02_hold_reply_credit(null,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'code'='INVALID_INPUT','null_job_denied');
 r:=private.es02_settle_reply_credit(j,'invalid');
 perform pg_temp.wallet_must(r->>'code'='INVALID_INPUT','invalid_settlement_denied');
 foreach rol in array array['anon','authenticated','service_role'] loop
  perform pg_temp.wallet_must(not has_table_privilege(rol,'private.es02_reply_credit_holds','select,insert,update,delete'),'no_direct_table_access_'||rol);
  perform pg_temp.wallet_must(not has_function_privilege(rol,'private.es02_hold_reply_credit(uuid,uuid,uuid)','execute') and not has_function_privilege(rol,'private.es02_settle_reply_credit(uuid,text)','execute'),'no_direct_helper_access_'||rol);
 end loop;
 perform pg_temp.wallet_must((select relrowsecurity from pg_class where oid='private.es02_reply_credit_holds'::regclass),'holds_rls_enabled');
 -- Reduce an EXISTING balance to one unit solely inside the rollback transaction.
 -- This creates no credits or grants. Two sequential reservations model last-unit exclusion.
 update private.es02_credit_balances set remaining=1 where id=b.id;
 j:=pg_temp.wallet_job(b.company_id,branch);j2:=pg_temp.wallet_job(b.company_id,branch);
 r:=private.es02_hold_reply_credit(j,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='true','last_unit_first_holder');
 r:=private.es02_hold_reply_credit(j2,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='false' and r->>'code'='CREDITS_EXHAUSTED','last_unit_second_holder_denied');
 r:=private.es02_settle_reply_credit(j,'released');r:=private.es02_hold_reply_credit(j2,b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'ok'='true','released_last_unit_available_to_other_job');
 r:=private.es02_settle_reply_credit(j3,'accepted');
 perform pg_temp.wallet_must(r->>'ok'='false' and r->>'code'='CREDIT_ACCOUNTING_REVIEW','released_contradictory_acceptance_needs_review');
 r:=private.es02_hold_reply_credit(pg_temp.wallet_job(b.company_id,branch),b.company_id,b.order_group_id);
 perform pg_temp.wallet_must(r->>'code'='CREDIT_ACCOUNTING_REVIEW','unresolved_receipt_blocks_new_allocations');
end;$tests$;
