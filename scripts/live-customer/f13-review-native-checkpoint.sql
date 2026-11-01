-- Synthetic native RPC chain; no provider calls, messages or import.
begin;
set local role postgres;
do $$
declare b jsonb; a private.es02_b3_connection_attempts%rowtype; r jsonb; proof jsonb; rid uuid; secrets_before bigint;
begin
 select binding,review_id into b,rid from private.wa_review_race_fixture;
 select * into a from private.es02_b3_connection_attempts where branch_id=(b->>'branchId')::uuid and flow='wa_coexistence' and status='pending';
 if a.id is null or a.confirmed_phone is not null then raise exception 'MISSING_NULL_PHONE_SUCCESSOR';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a.account_id,'session_id',a.session_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',a.account_id::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 r:=public.es02_b3_read_replacement_policy(a.account_id,a.company_id,a.branch_id);
 if r->>'requiresCoexistence' is distinct from 'true' then raise exception 'PENDING_REVIEW_POLICY_MISSING';end if;
 r:=public.es02_b3_read_replacement_policy(gen_random_uuid(),a.company_id,a.branch_id);
 if r->>'ok' is distinct from 'false' then raise exception 'FOREIGN_POLICY_READ';end if;
 r:=public.es02_b3_claim_owned_branch_connection(a.account_id,a.company_id,a.branch_id,'whatsapp','wa_coexistence',a.id,a.generation::integer,repeat('c',64),null);
 if r->>'ok' is distinct from 'true' then raise exception 'CLAIM_FAILED:%',r->>'code';end if;
 proof:=jsonb_build_object('app_id','111','waba_id','444','phone_number_id','555','display_phone_number','+96890000000',
 'scopes',jsonb_build_array('whatsapp_business_management','whatsapp_business_messaging'),
 'granular_scopes','[{"scope":"whatsapp_business_management","target_ids":["444"]},{"scope":"whatsapp_business_messaging","target_ids":["444"]}]'::jsonb,
 'expires_at',0,'data_access_expires_at',0,'authorization_expires_at',null,'platform_type','CLOUD_API','is_on_biz_app',true,'subscribed',false,'verified_at',clock_timestamp());
 select count(*) into secrets_before from vault.secrets;
 begin
  perform set_config('role','service_role',true);
  r:=public.es02_b3_checkpoint_owned_branch_connection(a.account_id,a.company_id,a.branch_id,'whatsapp','wa_coexistence',a.id,a.generation::integer,a.session_id,a.account_id,'synthetic-f13-token',jsonb_set(proof,'{display_phone_number}','"+96890000001"'));
  if r->>'code' is distinct from 'RECONCILIATION_REQUIRED' then raise exception 'WRONG_PHONE_CODE:%',r;end if;
  perform set_config('role','postgres',true);
  if (select count(*) from vault.secrets)<>secrets_before then raise exception 'FAILED_PHONE_LEAKED_SECRET';end if;
  raise exception 'ROLLBACK_SYNTHETIC_WRONG_PHONE' using errcode='P0002';
 exception when no_data_found then null;end;
 perform set_config('role','service_role',true);
 r:=public.es02_b3_checkpoint_owned_branch_connection(a.account_id,a.company_id,a.branch_id,'whatsapp','wa_coexistence',a.id,a.generation::integer,a.session_id,a.account_id,'synthetic-f13-token',proof);
 if r->>'ok' is distinct from 'true' then raise exception 'CHECKPOINT_FAILED:%',r;end if;
 r:=public.es02_b3_finalize_owned_branch_connection(a.account_id,a.company_id,a.branch_id,'whatsapp','wa_coexistence',a.id,a.generation::integer,a.session_id,null,jsonb_set(proof,'{subscribed}','true'),null);
 if r->>'ok' is distinct from 'true' then raise exception 'FINALIZE_FAILED:%',r;end if;
 perform set_config('role','postgres',true);
 if not private.wa_review_replacement_fulfilled(rid) then raise exception 'FINALIZED_REPLACEMENT_NOT_FULFILLED';end if;
 r:=public.es02_b3_read_replacement_policy(a.account_id,a.company_id,a.branch_id);
 if r->>'requiresCoexistence' is distinct from 'false' then raise exception 'OLD_REVIEW_STILL_PINNED';end if;
 if not exists(select 1 from private.wa_checkpoint_review_requests where id=rid and status='closed_preserved') then raise exception 'REVIEW_EVIDENCE_LOST';end if;
end $$;
select 'PASS native preflight/claim/wrong-number rollback/Vault checkpoint/finalize/review fulfillment';
rollback;
