-- Native local fixture only; no external provider calls.
begin;
set local role postgres;
do $$
declare b jsonb; rid uuid; a private.es02_b3_connection_attempts%rowtype; result jsonb; rev text; old_receipt jsonb; cp jsonb;
begin
 select binding,review_id into b,rid from private.wa_review_race_fixture;
 select to_jsonb(r) into old_receipt from private.wa_checkpoint_review_requests r where id=rid;
 select * into a from private.es02_b3_connection_attempts where branch_id=(b->>'branchId')::uuid and status='pending';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a.account_id,'session_id',a.session_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',a.account_id::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 if has_function_privilege('authenticated','private.wa_amend_review_to_new_number(uuid,uuid,uuid,uuid,text,text,text,text)','execute')
 or has_function_privilege('service_role','private.wa_amend_review_to_new_number(uuid,uuid,uuid,uuid,text,text,text,text)','execute')
 or has_table_privilege('authenticated','private.wa_review_replacement_amendments','insert') then raise exception 'CLIENT_AMENDMENT_ACCESS';end if;
 result:=private.wa_amend_review_to_new_number(rid,a.account_id,a.company_id,a.branch_id,'+96890000000','+17112778333','555','F14_SYNTHETIC_DECISION');
 if result->>'code' is distinct from 'connection_or_work_present' then raise exception 'ACTIVE_WORK_NOT_BLOCKED:%',result;end if;
 result:=public.es02_b3_cancel_owned_branch_connection(a.account_id,a.company_id,a.branch_id,'whatsapp','wa_coexistence',a.id,a.generation,null);
 if result->>'ok' is distinct from 'true' then raise exception 'CANCEL_FAILED:%',result;end if;
 result:=private.wa_amend_review_to_new_number(rid,gen_random_uuid(),a.company_id,a.branch_id,'+96890000000','+17112778333','555','F14_SYNTHETIC_DECISION');
 if result->>'code' is distinct from 'scope_mismatch' then raise exception 'FOREIGN_AMENDMENT:%',result;end if;
 result:=private.wa_amend_review_to_new_number(rid,a.account_id,a.company_id,a.branch_id,'+96890000001','+17112778333','555','F14_SYNTHETIC_DECISION');
 if result->>'code' is distinct from 'scope_mismatch' then raise exception 'STALE_PHONE_AMENDMENT:%',result;end if;
 result:=private.wa_amend_review_to_new_number(rid,a.account_id,a.company_id,a.branch_id,'+96890000000','+17112778333','555','F14_SYNTHETIC_DECISION');
 if result->>'ok' is distinct from 'true' then raise exception 'AMENDMENT_FAILED:%',result;end if;
 result:=private.wa_amend_review_to_new_number(rid,a.account_id,a.company_id,a.branch_id,'+96890000000','+17112778333','555','F14_SYNTHETIC_DECISION');
 if result->>'ok' is distinct from 'true' or result->>'code'<>'already_recorded' then raise exception 'AMENDMENT_REPLAY_FAILED';end if;
 result:=private.wa_amend_review_to_new_number(rid,a.account_id,a.company_id,a.branch_id,'+96890000000','+17112778334','556','F14_SYNTHETIC_DECISION');
 if result->>'ok' is distinct from 'false' then raise exception 'AMENDMENT_CONFLICT_ALLOWED';end if;
 begin update private.wa_review_replacement_amendments set phone_number_id='999' where review_id=rid;raise exception 'AMENDMENT_MUTABLE';
 exception when check_violation then if sqlerrm<>'WA_REVIEW_AMENDMENT_PRESERVED' then raise;end if;end;
 begin delete from private.wa_review_replacement_amendments where review_id=rid;raise exception 'AMENDMENT_DELETABLE';
 exception when check_violation then if sqlerrm<>'WA_REVIEW_AMENDMENT_PRESERVED' then raise;end if;end;
 result:=public.es02_b3_read_replacement_policy(a.account_id,a.company_id,a.branch_id);
 if result->>'requiresCoexistence' is distinct from 'false' then raise exception 'WRONG_PREFLIGHT:%',result;end if;
 rev:=private.es02_b3_project(a.account_id,a.company_id,a.branch_id,'whatsapp')->>'revision';
 result:=public.es02_b3_start_owned_branch_connection(a.account_id,a.company_id,a.branch_id,'whatsapp','wa_coexistence',gen_random_uuid(),rev,null,'111','123','v25.0',repeat('c',64),null,null,a.session_id,false);
 if result->>'ok' is distinct from 'false' then raise exception 'OLD_FLOW_ALLOWED';end if;
 result:=public.es02_b3_start_owned_branch_connection(a.account_id,a.company_id,a.branch_id,'whatsapp','wa_new_number',gen_random_uuid(),rev,null,'111','123','v25.0',repeat('d',64),null,null,a.session_id,false);
 if result->>'ok' is distinct from 'true' then raise exception 'NEW_FLOW_START_FAILED:%',result;end if;
 select * into a from private.es02_b3_connection_attempts where branch_id=a.branch_id and status='pending';
 cp:=jsonb_build_object('accountId',a.account_id,'companyId',a.company_id,'branchId',a.branch_id,'attemptId',a.id,'sessionId',a.session_id,'generation',a.generation,
 'nonce',a.launch_nonce,'appId',a.app_id,'configId',a.config_id,'graphVersion',a.graph_version,'wabaId','444','phoneNumberId','999','codeHash',repeat('e',64));
 perform set_config('role','service_role',true);
 begin perform public.es02_b3_whatsapp_signup_checkpoint('reserve',cp,gen_random_uuid(),null);raise exception 'WRONG_PHONE_CHECKPOINTED';
 exception when check_violation then if sqlerrm<>'WA_REVIEW_REPLACEMENT_PHONE_MISMATCH' then raise;end if;end;
 result:=public.es02_b3_whatsapp_signup_checkpoint('reserve',jsonb_set(cp,'{phoneNumberId}','"555"'),gen_random_uuid(),null);
 if result->>'ok' is distinct from 'true' then raise exception 'CORRECT_PHONE_CHECKPOINT_FAILED:%',result;end if;
 perform set_config('role','postgres',true);
 if private.wa_review_replacement_fulfilled(rid) then raise exception 'PREMATURE_FULFILLMENT';end if;
 if (select to_jsonb(r) from private.wa_checkpoint_review_requests r where id=rid) is distinct from old_receipt then raise exception 'ORIGINAL_RECEIPT_CHANGED';end if;
 if exists(select 1 from public.whatsapp_company_links where company_id=a.company_id) then raise exception 'FALSE_CONNECTED';end if;
end $$;
select 'PASS operator amendment: no active-work bypass, exact owner/old phone, idempotence, immutable audit, new route, exact Meta phone checkpoint, original preservation';
rollback;
