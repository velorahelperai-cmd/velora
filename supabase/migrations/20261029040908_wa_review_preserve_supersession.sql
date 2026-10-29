-- Administrative retirement only. Never decrypt, delete or claim provider completion.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table private.wa_checkpoint_review_requests
 drop constraint wa_checkpoint_review_requests_status_check,
 add constraint wa_checkpoint_review_requests_status_check check(status in ('pending','closed_preserved')),
 add column resolved_at timestamptz,
 add column resolved_by text,
 add column decision_ref text,
 add column checkpoint_digest text,
 add column replacement_phone_hash text,
 add column resolution_evidence jsonb,
 add constraint wa_review_resolution_complete check(
  (status='pending' and resolved_at is null and resolved_by is null and decision_ref is null and checkpoint_digest is null and replacement_phone_hash is null and resolution_evidence is null)
  or (status='closed_preserved' and resolved_at is not null and resolved_by='postgres'
      and decision_ref is not null and checkpoint_digest is not null and checkpoint_digest ~ '^[a-f0-9]{64}$'
      and replacement_phone_hash is not null and replacement_phone_hash ~ '^[a-f0-9]{64}$'
      and resolution_evidence is not null and jsonb_typeof(resolution_evidence)='object'));

-- Review receipts and closed attempts are permanent evidence, not cleanup eligibility.
create function private.wa_review_preserve_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='wa_checkpoint_review_requests' then
  if tg_op='DELETE' or old.status='closed_preserved' then
   raise exception 'WA_REVIEW_EVIDENCE_PRESERVED' using errcode='23514';
  end if;
 elsif tg_table_name='es02_b3_whatsapp_signup_checkpoints' then
  if exists(select 1 from private.wa_checkpoint_review_requests r where r.attempt_id=old.attempt_id) then
   raise exception 'WA_REVIEW_EVIDENCE_PRESERVED' using errcode='23514';
  end if;
 elsif tg_table_name='secrets' then
  if exists(select 1 from private.es02_b3_whatsapp_signup_checkpoints c
   join private.wa_checkpoint_review_requests r on r.attempt_id=c.attempt_id where c.token_secret_id=old.id) then
   raise exception 'WA_REVIEW_EVIDENCE_PRESERVED' using errcode='23514';
  end if;
 else
  if exists(select 1 from private.wa_checkpoint_review_requests r where r.attempt_id=old.id and r.status='closed_preserved') then
   raise exception 'WA_REVIEW_EVIDENCE_PRESERVED' using errcode='23514';
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
alter function private.wa_review_preserve_evidence() owner to postgres;
revoke all on function private.wa_review_preserve_evidence() from public,anon,authenticated,service_role;
create trigger wa_review_preserve_receipt before update or delete on private.wa_checkpoint_review_requests
 for each row execute function private.wa_review_preserve_evidence();
create trigger wa_review_preserve_checkpoint before update or delete on private.es02_b3_whatsapp_signup_checkpoints
 for each row execute function private.wa_review_preserve_evidence();
create trigger wa_review_preserve_vault before update or delete on vault.secrets
 for each row execute function private.wa_review_preserve_evidence();
create trigger wa_review_preserve_attempt before update or delete on private.es02_b3_connection_attempts
 for each row execute function private.wa_review_preserve_evidence();
create trigger wa_review_preserve_legacy before update or delete on public.whatsapp_embedded_signup_attempts
 for each row execute function private.wa_review_preserve_evidence();

-- Native owner/session/paid start still runs; limit replacement to the reviewed number.
create function private.wa_review_check_replacement() returns trigger
language plpgsql security definer set search_path='' as $$
declare r private.wa_checkpoint_review_requests%rowtype;
begin
 if new.channel<>'whatsapp' then return new;end if;
 select * into r from private.wa_checkpoint_review_requests x
 where x.company_id=new.company_id and x.branch_id=new.branch_id and x.status='closed_preserved'
 order by x.resolved_at desc,x.id desc limit 1;
 if r.id is not null and (new.account_id is distinct from r.account_id or new.flow is distinct from 'wa_coexistence'
  or new.confirmed_phone is null
  or encode(sha256(convert_to(new.confirmed_phone,'UTF8')),'hex') is distinct from r.replacement_phone_hash) then
  raise exception 'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' using errcode='23514';
 end if;
 return new;
end $$;
alter function private.wa_review_check_replacement() owner to postgres;
revoke all on function private.wa_review_check_replacement() from public,anon,authenticated,service_role;
create trigger wa_review_check_replacement before insert on private.es02_b3_connection_attempts
 for each row execute function private.wa_review_check_replacement();

-- Operator console only, not a public RPC and not callable by the service role.
-- Human approval is recorded by an external decision reference, never fabricated as a user JWT.
create function private.wa_resolve_review_preserving_assets(
 p_review_id uuid,p_attempt_id uuid,p_generation integer,p_company_id uuid,p_branch_id uuid,
 p_waba_id text,p_phone_id text,p_checkpoint_digest text,p_old_display_phone text,p_replacement_phone text,p_decision_ref text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.wa_checkpoint_review_requests%rowtype; a private.es02_b3_connection_attempts%rowtype;
 c private.es02_b3_whatsapp_signup_checkpoints%rowtype; l public.whatsapp_embedded_signup_attempts%rowtype;
 scope private.es02_b3_connection_scope%rowtype; binding jsonb; target_hash text;
begin
 if current_user<>'postgres' then raise exception 'OPERATOR_ROLE_REQUIRED' using errcode='42501';end if;
 if p_review_id is null or p_attempt_id is null or p_generation is null or p_company_id is null or p_branch_id is null
  or p_generation<1 or p_checkpoint_digest is null or p_checkpoint_digest !~ '^[a-f0-9]{64}$'
  or p_old_display_phone is null or p_old_display_phone !~ '^\+[1-9][0-9]{6,14}$'
  or p_replacement_phone is null or p_replacement_phone !~ '^\+[1-9][0-9]{6,14}$'
  or p_old_display_phone=p_replacement_phone or p_waba_id is null or p_phone_id is null
  or p_decision_ref is null or p_decision_ref !~ '^[A-Z0-9_-]{8,100}$' then
  return jsonb_build_object('ok',false,'code','invalid_input');
 end if;
 target_hash:=encode(sha256(convert_to(p_replacement_phone,'UTF8')),'hex');
 perform pg_catalog.pg_advisory_xact_lock(87420303,pg_catalog.hashtext(p_company_id::text||':whatsapp'));
 -- Same company binding and lock order as native start. No expired session is revived.
 select * into r from private.wa_checkpoint_review_requests where id=p_review_id;
 if r.id is null or r.company_id is distinct from p_company_id or r.branch_id is distinct from p_branch_id
  or r.attempt_id is distinct from p_attempt_id or r.generation is distinct from p_generation then
  return jsonb_build_object('ok',false,'code','scope_mismatch');end if;
 if r.status='closed_preserved' then
  if r.checkpoint_digest=p_checkpoint_digest and r.replacement_phone_hash=target_hash and r.decision_ref=p_decision_ref
   and r.resolution_evidence->>'wabaId'=p_waba_id and r.resolution_evidence->>'phoneNumberId'=p_phone_id
   and r.resolution_evidence->>'oldDisplayPhoneHash'=encode(sha256(convert_to(p_old_display_phone,'UTF8')),'hex') then
   return jsonb_build_object('ok',true,'outcome','already_resolved','reviewId',r.id);
  end if;
  return jsonb_build_object('ok',false,'code','decision_conflict');
 end if;
 binding:=private.es02_b3_current_binding(r.account_id,p_company_id,p_branch_id,'whatsapp');
 if binding->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false,'code','binding_changed');end if;
 select * into scope from private.es02_b3_connection_scope
 where company_id=p_company_id and branch_id=p_branch_id and channel='whatsapp' for update;
 select * into a from private.es02_b3_connection_attempts where id=p_attempt_id for update;
 select * into r from private.wa_checkpoint_review_requests where id=p_review_id for update;
 if a.id is null or a.account_id is distinct from r.account_id or a.company_id is distinct from p_company_id
  or a.branch_id is distinct from p_branch_id or a.generation is distinct from p_generation
  or a.channel is distinct from 'whatsapp' or a.flow is distinct from 'wa_new_number' or a.status is distinct from 'pending'
  or a.expires_at>clock_timestamp() or scope.revision is distinct from a.generation
  or not private.es02_b3_pin_matches(a,binding) or r.status is distinct from 'pending'
  or a.legacy_attempt_id is distinct from a.id then
  return jsonb_build_object('ok',false,'code','attempt_changed');end if;
 if exists(select 1 from private.es02_b3_connection_links where company_id=p_company_id and channel='whatsapp')
  or exists(select 1 from public.whatsapp_company_links where company_id=p_company_id)
  or exists(select 1 from private.whatsapp_coexistence_connections where company_id=p_company_id)
  or exists(select 1 from private.es02_b3_connection_attempts where company_id=p_company_id and channel='whatsapp'
   and id<>a.id and status in ('pending','claimed','vault_staged','unknown'))
  or exists(select 1 from private.whatsapp_coexistence_signup_attempts where company_id=p_company_id
   and status in ('started','claimed','token_checkpointed','reconcile_required')) then
  return jsonb_build_object('ok',false,'code','connection_or_work_present');end if;
 select * into c from private.es02_b3_whatsapp_signup_checkpoints where attempt_id=a.id for update;
 if c.attempt_id is null or c.token_secret_id is null or c.waba_id is distinct from p_waba_id or c.phone_number_id is distinct from p_phone_id
  or encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') is distinct from p_checkpoint_digest
  or not exists(select 1 from vault.secrets where id=c.token_secret_id) then
  return jsonb_build_object('ok',false,'code','checkpoint_changed');end if;
 select * into l from public.whatsapp_embedded_signup_attempts where id=a.legacy_attempt_id for update;
 if l.id is null or l.company_id is distinct from p_company_id or l.user_id is distinct from a.account_id
  or l.status is distinct from 'in_progress' or l.consumed_at is not null
  or to_jsonb(l)->>'token_secret_id' is not null then
  return jsonb_build_object('ok',false,'code','legacy_changed');end if;
 -- Cancellation here means local retirement only; Meta registration remains UNKNOWN.
 update public.whatsapp_embedded_signup_attempts set status='cancelled' where id=l.id;
 update private.es02_b3_connection_attempts set status='cancelled' where id=a.id;
 update private.es02_b3_connection_scope set revision=revision+1
 where company_id=p_company_id and branch_id=p_branch_id and channel='whatsapp';
 update private.wa_checkpoint_review_requests set status='closed_preserved',resolved_at=clock_timestamp(),resolved_by=current_user,
  decision_ref=p_decision_ref,checkpoint_digest=p_checkpoint_digest,replacement_phone_hash=target_hash,
  resolution_evidence=jsonb_build_object('disposition','RETIRED_LOCALLY_ASSETS_PRESERVED','providerState','UNKNOWN',
   'replacementFlow','wa_coexistence','wabaId',p_waba_id,'phoneNumberId',p_phone_id,
   'oldDisplayPhoneHash',encode(sha256(convert_to(p_old_display_phone,'UTF8')),'hex'),'checkpointPreserved',true,'credentialPreserved',true)
 where id=r.id;
 return jsonb_build_object('ok',true,'outcome','closed_preserved','reviewId',r.id);
end $$;
alter function private.wa_resolve_review_preserving_assets(uuid,uuid,integer,uuid,uuid,text,text,text,text,text,text) owner to postgres;
revoke all on function private.wa_resolve_review_preserving_assets(uuid,uuid,integer,uuid,uuid,text,text,text,text,text,text)
 from public,anon,authenticated,service_role;
commit;
