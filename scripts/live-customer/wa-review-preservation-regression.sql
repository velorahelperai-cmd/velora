-- Synthetic data only; run through the disposable integration runner.
begin;
set local role postgres;
do $$begin
 if to_regprocedure('private.wa_resolve_review_preserving_assets(uuid,uuid,integer,uuid,uuid,text,text,text,text,text,text)') is null then
  raise exception 'MISSING_ADMINISTRATIVE_RESOLUTION';
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in ('wa_review_preserve_evidence','wa_review_check_replacement','wa_resolve_review_preserving_assets')
  and pg_get_userbyid(p.proowner)<>'postgres') then raise exception 'INCORRECT_OPERATOR_FUNCTION_OWNER';end if;
end $$;
do $$
declare b jsonb; rid uuid; aid uuid; cid uuid; bid uuid; uid uuid; digest text; snap jsonb; result jsonb; rev text; secret_id uuid; successor jsonb;
begin
 select binding into b from private.wa_recovery_fixture;
 aid:=(b->>'attemptId')::uuid;cid:=(b->>'companyId')::uuid;bid:=(b->>'branchId')::uuid;uid:=(b->>'accountId')::uuid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',b->>'sessionId','role','authenticated')::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',uid::text,true);
 perform set_config('role','service_role',true);
 result:=public.es02_b3_whatsapp_signup_checkpoint('reserve',b,'11111111-1111-4111-8111-111111111111',null);
 result:=public.es02_b3_whatsapp_signup_checkpoint('save',b,'11111111-1111-4111-8111-111111111111','synthetic-retained-secret');
 if result->>'ok' is distinct from 'true' then raise exception 'FIXTURE_CHECKPOINT_FAILED';end if;
 perform set_config('role','postgres',true);
 update private.es02_b3_connection_attempts set expires_at=clock_timestamp()-interval '1 second' where id=aid;
 -- Existing owner review-request RPC is already deployed and exercised; seed its exact receipt shape.
 insert into private.wa_checkpoint_review_requests(account_id,session_id,original_session_id,company_id,branch_id,attempt_id,generation)
 values(uid,(b->>'sessionId')::uuid,(b->>'sessionId')::uuid,cid,bid,aid,1) returning id into rid;
 select to_jsonb(c),encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex'),c.token_secret_id into snap,digest,secret_id
 from private.es02_b3_whatsapp_signup_checkpoints c where attempt_id=aid;
 if has_function_privilege('anon','private.wa_resolve_review_preserving_assets(uuid,uuid,integer,uuid,uuid,text,text,text,text,text,text)','execute')
 or has_function_privilege('authenticated','private.wa_resolve_review_preserving_assets(uuid,uuid,integer,uuid,uuid,text,text,text,text,text,text)','execute')
 or has_function_privilege('service_role','private.wa_resolve_review_preserving_assets(uuid,uuid,integer,uuid,uuid,text,text,text,text,text,text)','execute') then raise exception 'CLIENT_CAN_RESOLVE';end if;
 -- Wrong owner, branch, generation, digest and same phone are rejected without changing anything.
 result:=private.wa_resolve_review_preserving_assets(rid,gen_random_uuid(),1,cid,bid,'222','333',digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW');
 if result->>'ok'='true' then raise exception 'WRONG_ATTEMPT_ACCEPTED';end if;
 result:=private.wa_resolve_review_preserving_assets(rid,aid,2,cid,bid,'222','333',digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW');
 if result->>'ok'='true' then raise exception 'WRONG_GENERATION_ACCEPTED';end if;
 result:=private.wa_resolve_review_preserving_assets(rid,aid,1,cid,gen_random_uuid(),'222','333',digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW');
 if result->>'ok'='true' then raise exception 'WRONG_BRANCH_ACCEPTED';end if;
 result:=private.wa_resolve_review_preserving_assets(rid,aid,1,gen_random_uuid(),bid,'222','333',digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW');
 if result->>'ok'='true' then raise exception 'WRONG_COMPANY_ACCEPTED';end if;
 result:=private.wa_resolve_review_preserving_assets(rid,aid,1,cid,bid,'222','333',repeat('0',64),'+15550000001','+96890000000','SYNTHETIC_REVIEW');
 if result->>'ok'='true' then raise exception 'STALE_CHECKPOINT_ACCEPTED';end if;
 result:=private.wa_resolve_review_preserving_assets(rid,aid,1,cid,bid,'222','333',digest,'+96890000000','+96890000000','SYNTHETIC_REVIEW');
 if result->>'ok'='true' then raise exception 'SAME_PHONE_ACCEPTED';end if;
 begin
  update private.es02_b3_connection_attempts set status='claimed' where id=aid;
  result:=private.wa_resolve_review_preserving_assets(rid,aid,1,cid,bid,'222','333',digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW');
  if result->>'ok'='true' then raise exception 'IN_FLIGHT_ATTEMPT_ACCEPTED';end if;
  raise exception 'SYNTHETIC_ROLLBACK' using errcode='P0002';
 exception when no_data_found then null;end;
 -- A failed enclosing operation rolls back the review and both attempt states.
 begin
  result:=private.wa_resolve_review_preserving_assets(rid,aid,1,cid,bid,'222','333',digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW');
  if result->>'ok' is distinct from 'true' then raise exception 'VALID_REVIEW_FAILED';end if;
  raise exception 'SYNTHETIC_ROLLBACK' using errcode='P0002';
 exception when no_data_found then null;end;
 if not exists(select 1 from private.wa_checkpoint_review_requests where id=rid and status='pending')
 or not exists(select 1 from private.es02_b3_connection_attempts where id=aid and status='pending') then raise exception 'ROLLBACK_FAILED';end if;
 create table private.wa_review_race_fixture as select b as binding,rid as review_id,digest as checkpoint_digest,snap as checkpoint_snapshot,secret_id as vault_ref;
end $$;
commit;
-- AFTER_CONCURRENT_RESOLUTION
begin;
set local role postgres;
do $$
declare b jsonb;rid uuid;aid uuid;cid uuid;bid uuid;uid uuid;digest text;snap jsonb;result jsonb;rev text;secret_id uuid;successor jsonb;
begin
 select f.binding,f.review_id,f.checkpoint_digest,f.checkpoint_snapshot,f.vault_ref into b,rid,digest,snap,secret_id from private.wa_review_race_fixture f;
 aid:=(b->>'attemptId')::uuid;cid:=(b->>'companyId')::uuid;bid:=(b->>'branchId')::uuid;uid:=(b->>'accountId')::uuid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',b->>'sessionId','role','authenticated')::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',uid::text,true);
 result:=private.wa_resolve_review_preserving_assets(rid,aid,1,cid,bid,'222','333',digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW');
 if result->>'ok' is distinct from 'true' then raise exception 'RESOLUTION_FAILED';end if;
 result:=private.wa_resolve_review_preserving_assets(rid,aid,1,cid,bid,'222','333',digest,'+15550000001','+96890000000','SYNTHETIC_REVIEW');
 if result->>'outcome' is distinct from 'already_resolved' then raise exception 'REPLAY_NOT_IDEMPOTENT';end if;
 if (select to_jsonb(c) from private.es02_b3_whatsapp_signup_checkpoints c where attempt_id=aid) is distinct from snap
 or not exists(select 1 from vault.secrets where id=secret_id) then raise exception 'EVIDENCE_CHANGED';end if;
 if not exists(select 1 from public.whatsapp_embedded_signup_attempts where id=aid and status='cancelled') then raise exception 'LEGACY_NOT_RETIRED';end if;
 if exists(select 1 from public.whatsapp_company_links where company_id=cid) then raise exception 'FALSE_CONNECTION';end if;
 -- Neither direct deletion, replacement, expiry discard nor resurrection can lose/reuse the retained evidence.
 begin delete from private.es02_b3_whatsapp_signup_checkpoints where attempt_id=aid;raise exception 'CHECKPOINT_DELETE_ALLOWED';exception when check_violation then null;end;
 begin update private.es02_b3_whatsapp_signup_checkpoints set token_secret_id=null where attempt_id=aid;raise exception 'SECRET_DETACH_ALLOWED';exception when check_violation then null;end;
 begin delete from vault.secrets where id=secret_id;raise exception 'VAULT_DELETE_ALLOWED';exception when foreign_key_violation then null;end;
 begin update private.es02_b3_connection_attempts set status='pending' where id=aid;raise exception 'OLD_CALLBACK_REVIVED';exception when check_violation then null;end;
 perform set_config('role','service_role',true);
 result:=public.es02_b3_whatsapp_signup_checkpoint('load',b,null,null);
 if result->>'ok'='true' then raise exception 'RETIRED_TOKEN_RELOADED';end if;
 result:=public.es02_b3_whatsapp_signup_checkpoint('save',b,'11111111-1111-4111-8111-111111111111','replacement-must-not-save');
 if result->>'ok'='true' then raise exception 'RETIRED_CALLBACK_REUSED';end if;
 begin perform public.es02_b3_whatsapp_signup_checkpoint('discard',b,null,null);raise exception 'EXPIRY_DISCARD_ALLOWED';exception when foreign_key_violation then null;end;
 perform set_config('role','postgres',true);
 -- Native owner/session/paid binding is still mandatory; only the reviewed Coexistence phone may follow.
 rev:=private.es02_b3_project(uid,cid,bid,'whatsapp')->>'revision';
 successor:=public.es02_b3_start_owned_branch_connection(uid,cid,bid,'whatsapp','wa_coexistence',gen_random_uuid(),rev,'+96890000000','111','123','v25.0',repeat('c',64),null,null,gen_random_uuid(),true);
 if successor->>'ok'='true' then raise exception 'SESSION_BYPASS_ALLOWED';end if;
 successor:=public.es02_b3_start_owned_branch_connection(uid,cid,bid,'whatsapp','wa_new_number',gen_random_uuid(),rev,null,'111','123','v25.0',repeat('c',64),null,null,(b->>'sessionId')::uuid,false);
 if successor->>'ok'='true' then raise exception 'NEW_NUMBER_BYPASS_ALLOWED';end if;
 successor:=public.es02_b3_start_owned_branch_connection(uid,cid,bid,'whatsapp','wa_coexistence',gen_random_uuid(),rev,'+96890000001','111','123','v25.0',repeat('c',64),null,null,(b->>'sessionId')::uuid,true);
 if successor->>'ok'='true' then raise exception 'UNREVIEWED_PHONE_ALLOWED';end if;
 successor:=public.es02_b3_start_owned_branch_connection(uid,cid,bid,'whatsapp','wa_coexistence',gen_random_uuid(),rev,'+96890000000','111','123','v25.0',repeat('c',64),null,null,(b->>'sessionId')::uuid,true);
 if successor->>'ok' is distinct from 'true' then raise exception 'COEXISTENCE_SUCCESSOR_FAILED:%',successor->>'code';end if;
 if exists(select 1 from public.whatsapp_company_links where company_id=cid)
 or (select to_jsonb(c) from private.es02_b3_whatsapp_signup_checkpoints c where attempt_id=aid) is distinct from snap then raise exception 'SUCCESSOR_MUTATED_ASSETS';end if;
 if not exists(select 1 from private.es02_activation_foundation where company_id=cid and subscription_started_at is null) then raise exception 'SUBSCRIPTION_CLOCK_CHANGED';end if;
end $$;
commit;
