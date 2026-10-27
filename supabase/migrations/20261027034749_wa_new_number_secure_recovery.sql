-- REVIEW ONLY until owner approval. No provider calls, payment or subscription writes.
begin;
create table private.es02_b3_whatsapp_signup_checkpoints(
 attempt_id uuid primary key references private.es02_b3_connection_attempts(id),
 reservation uuid not null unique,
 code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
 waba_id text not null check(waba_id ~ '^[0-9]{1,64}$'),
 phone_number_id text not null check(phone_number_id ~ '^[0-9]{1,64}$'),
 token_secret_id uuid,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.es02_b3_whatsapp_signup_checkpoints enable row level security;
alter table private.es02_b3_whatsapp_signup_checkpoints owner to postgres;
revoke all on private.es02_b3_whatsapp_signup_checkpoints from public,anon,authenticated,service_role;

create function public.es02_b3_whatsapp_signup_checkpoint(p_operation text,p_binding jsonb,p_reservation uuid default null,p_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 a private.es02_b3_connection_attempts%rowtype;
 c private.es02_b3_whatsapp_signup_checkpoints%rowtype;
 observed jsonb;
 account_id uuid; company_id uuid; branch_id uuid; attempt_id uuid; session_id uuid; generation integer;
 acquired boolean:=false; secret_id uuid; token text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_operation not in ('ready','reserve','save','load','discard') or jsonb_typeof(p_binding) is distinct from 'object' then return jsonb_build_object('ok',false);end if;
 begin
  account_id:=(p_binding->>'accountId')::uuid; company_id:=(p_binding->>'companyId')::uuid;
  branch_id:=(p_binding->>'branchId')::uuid;attempt_id:=(p_binding->>'attemptId')::uuid;
  session_id:=(p_binding->>'sessionId')::uuid;generation:=(p_binding->>'generation')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('ok',false);end;
 if not private.es02_b3_session_open(account_id,session_id) then return jsonb_build_object('ok',false);end if;
 observed:=private.es02_b3_current_binding(account_id,company_id,branch_id,'whatsapp');
 if observed->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false);end if;
 if p_operation='ready' then return jsonb_build_object('ok',true);end if;
 select * into a from private.es02_b3_connection_attempts x where x.id=attempt_id and x.account_id=account_id
  and x.company_id=company_id and x.branch_id=branch_id and x.session_id=session_id and x.generation=generation
  and x.flow='wa_new_number' and x.channel='whatsapp' for update;
 if a.id is not null and p_operation='discard' and (a.status in ('bound','cancelled','expired','rejected') or a.expires_at<=clock_timestamp()) then
  select token_secret_id into secret_id from private.es02_b3_whatsapp_signup_checkpoints x where x.attempt_id=a.id for update;
  delete from vault.secrets where id=secret_id;
  update private.es02_b3_whatsapp_signup_checkpoints set token_secret_id=null where private.es02_b3_whatsapp_signup_checkpoints.attempt_id=a.id;
  return jsonb_build_object('ok',true);
 end if;
 if p_operation='discard' or a.id is null or a.status not in ('pending','claimed','unknown') or a.expires_at<=clock_timestamp()
  or not private.es02_b3_pin_matches(a,observed) then return jsonb_build_object('ok',false);end if;
 select * into c from private.es02_b3_whatsapp_signup_checkpoints x where x.attempt_id=a.id for update;
 if p_operation='reserve' then
  if a.status<>'pending' or p_binding->>'nonce' is distinct from a.launch_nonce
   or p_binding->>'appId' is distinct from a.app_id or p_binding->>'configId' is distinct from a.config_id
   or p_binding->>'graphVersion' is distinct from a.graph_version
   or coalesce(p_binding->>'wabaId','') !~ '^[0-9]{1,64}$' or coalesce(p_binding->>'phoneNumberId','') !~ '^[0-9]{1,64}$'
   or coalesce(p_binding->>'codeHash','') !~ '^[a-f0-9]{64}$' or p_reservation is null then return jsonb_build_object('ok',false);end if;
  if c.attempt_id is null then
   insert into private.es02_b3_whatsapp_signup_checkpoints(attempt_id,reservation,code_hash,waba_id,phone_number_id)
    values(a.id,p_reservation,p_binding->>'codeHash',p_binding->>'wabaId',p_binding->>'phoneNumberId') returning * into c;
   acquired:=true;
  elsif c.code_hash is distinct from p_binding->>'codeHash' or c.waba_id is distinct from p_binding->>'wabaId'
   or c.phone_number_id is distinct from p_binding->>'phoneNumberId' then return jsonb_build_object('ok',false);end if;
  return jsonb_build_object('ok',true,'acquired',acquired,'prepared',c.token_secret_id is not null);
 end if;
 if c.attempt_id is null then return jsonb_build_object('ok',false);end if;
 if p_operation='save' then
  if a.status<>'pending' or c.reservation is distinct from p_reservation or nullif(btrim(p_token),'') is null or length(p_token)>16384 then return jsonb_build_object('ok',false);end if;
  if c.token_secret_id is null then
   select vault.create_secret(p_token,'wa-new-number-checkpoint-'||a.id::text,'Temporary encrypted WhatsApp authorization checkpoint') into secret_id;
   update private.es02_b3_whatsapp_signup_checkpoints set token_secret_id=secret_id where private.es02_b3_whatsapp_signup_checkpoints.attempt_id=a.id;
  end if;
  return jsonb_build_object('ok',true);
 end if;
 if c.token_secret_id is null then return jsonb_build_object('ok',false);end if;
 select decrypted_secret into token from vault.decrypted_secrets where id=c.token_secret_id;
 if nullif(btrim(token),'') is null then return jsonb_build_object('ok',false);end if;
 return jsonb_build_object('ok',true,'token',token,'nonce',a.launch_nonce,'wabaId',c.waba_id,'phoneNumberId',c.phone_number_id,
  'appId',a.app_id,'configId',a.config_id,'graphVersion',a.graph_version);
end;$$;
alter function public.es02_b3_whatsapp_signup_checkpoint(text,jsonb,uuid,text) owner to postgres;
revoke all on function public.es02_b3_whatsapp_signup_checkpoint(text,jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.es02_b3_whatsapp_signup_checkpoint(text,jsonb,uuid,text) to service_role;
-- A cancel racing the completion claim must not discard an authorization after provider writes may start.
create function private.es02_b3_guard_whatsapp_checkpoint_cancel() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if old.flow='wa_new_number' and old.status in ('claimed','unknown','vault_staged') and new.status='cancelled'
  and exists(select 1 from private.es02_b3_whatsapp_signup_checkpoints c where c.attempt_id=old.id and c.token_secret_id is not null)
 then raise exception 'WHATSAPP_CHECKPOINT_RECONCILIATION_REQUIRED' using errcode='23514';end if;
 return new;
end;$$;
alter function private.es02_b3_guard_whatsapp_checkpoint_cancel() owner to postgres;
revoke all on function private.es02_b3_guard_whatsapp_checkpoint_cancel() from public,anon,authenticated,service_role;
create trigger es02_b3_guard_whatsapp_checkpoint_cancel before update of status on private.es02_b3_connection_attempts
 for each row execute function private.es02_b3_guard_whatsapp_checkpoint_cancel();
commit;
