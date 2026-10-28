-- Local candidate only. Production application requires separate owner approval.
begin;
create table private.es02_b3_early_whatsapp_authorizations(
 attempt_id uuid primary key references private.es02_b3_connection_attempts(id),
 account_id uuid not null,session_id uuid not null,company_id uuid not null,branch_id uuid not null,
 generation integer not null,app_id text not null,config_id text not null,graph_version text not null,
 code_hash text not null unique check(code_hash ~ '^[a-f0-9]{64}$'),
 reservation uuid not null unique,
 state text not null check(state in ('reserved','stored','consumed','expired')),
 token_secret_id uuid,expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 consumed_at timestamptz,waba_id text,phone_number_id text
);
alter table private.es02_b3_early_whatsapp_authorizations owner to postgres;
alter table private.es02_b3_early_whatsapp_authorizations enable row level security;
revoke all on private.es02_b3_early_whatsapp_authorizations from public,anon,authenticated,service_role;

create function public.es02_b3_early_whatsapp_authorization(p_operation text,p_binding jsonb,p_reservation uuid default null,p_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 a private.es02_b3_connection_attempts%rowtype;
 c private.es02_b3_early_whatsapp_authorizations%rowtype;
 observed jsonb;r jsonb;secret_id uuid;token text;
 account_id uuid;session_id uuid;company_id uuid;branch_id uuid;attempt_id uuid;generation integer;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_operation not in ('reserve','save','load','promote','cleanup') or jsonb_typeof(p_binding) is distinct from 'object' then return jsonb_build_object('ok',false);end if;
 begin
  account_id:=(p_binding->>'accountId')::uuid;session_id:=(p_binding->>'sessionId')::uuid;
  company_id:=(p_binding->>'companyId')::uuid;branch_id:=(p_binding->>'branchId')::uuid;
  attempt_id:=(p_binding->>'attemptId')::uuid;generation:=(p_binding->>'generation')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('ok',false);end;
 select * into a from private.es02_b3_connection_attempts x where x.id=attempt_id and x.account_id=account_id
  and x.session_id=session_id and x.company_id=company_id and x.branch_id=branch_id and x.generation=generation
  and x.flow='wa_new_number' and x.channel='whatsapp' for update;
 if a.id is null or p_binding->>'nonce' is distinct from a.launch_nonce
  or p_binding->>'appId' is distinct from a.app_id or p_binding->>'configId' is distinct from a.config_id
  or p_binding->>'graphVersion' is distinct from a.graph_version then return jsonb_build_object('ok',false);end if;
 select * into c from private.es02_b3_early_whatsapp_authorizations x where x.attempt_id=a.id for update;
 if p_operation='cleanup' then
  -- Expiry alone is UNKNOWN, not authority to destroy reconciliation credentials.
  -- Reservations and pending/claimed attempts are never swept, even with a closed session.
  if c.attempt_id is null or c.state<>'stored' or c.expires_at>clock_timestamp() or a.expires_at>clock_timestamp()
    or a.status<>'cancelled' or not exists(select 1 from public.whatsapp_embedded_signup_attempts l
      where l.id=a.legacy_attempt_id and l.company_id=a.company_id and l.user_id=a.account_id
        and l.session_id=a.session_id and l.status='cancelled' and l.consumed_at is not null)
    or exists(select 1 from private.es02_b3_whatsapp_signup_checkpoints x where x.attempt_id=a.id)
    or exists(select 1 from private.es02_b3_connection_links x where x.attempt_id=a.id)
    or exists(select 1 from public.whatsapp_company_links x where x.company_id=a.company_id)
    then return jsonb_build_object('ok',false);end if;
  if c.token_secret_id is not null then delete from vault.secrets where id=c.token_secret_id;end if;
  update private.es02_b3_early_whatsapp_authorizations set token_secret_id=null,state=case when state='consumed' then state else 'expired' end where private.es02_b3_early_whatsapp_authorizations.attempt_id=a.id;
  return jsonb_build_object('ok',true);
 end if;
 if a.status<>'pending' or a.expires_at<=clock_timestamp() or not private.es02_b3_session_open(account_id,session_id) then return jsonb_build_object('ok',false);end if;
 observed:=private.es02_b3_current_binding(account_id,company_id,branch_id,'whatsapp');
 if observed->>'ok' is distinct from 'true' or not private.es02_b3_pin_matches(a,observed) then return jsonb_build_object('ok',false);end if;
 if c.attempt_id is not null and (c.account_id<>account_id or c.session_id<>session_id or c.company_id<>company_id or c.branch_id<>branch_id or c.generation<>generation or c.app_id<>a.app_id or c.config_id<>a.config_id or c.graph_version<>a.graph_version or c.expires_at<=clock_timestamp()) then return jsonb_build_object('ok',false);end if;
 if p_operation='reserve' then
  if coalesce(p_binding->>'codeHash','') !~ '^[a-f0-9]{64}$' or p_reservation is null then return jsonb_build_object('ok',false);end if;
  if c.attempt_id is null then
   -- An older checkpoint may already have consumed this attempt's code.
   -- Never create a second exchange reservation; use existing recovery instead.
   if exists(select 1 from private.es02_b3_whatsapp_signup_checkpoints x where x.attempt_id=a.id) then return jsonb_build_object('ok',false);end if;
   begin
    insert into private.es02_b3_early_whatsapp_authorizations(attempt_id,account_id,session_id,company_id,branch_id,generation,app_id,config_id,graph_version,code_hash,reservation,state,expires_at)
     values(a.id,account_id,session_id,company_id,branch_id,generation,a.app_id,a.config_id,a.graph_version,p_binding->>'codeHash',p_reservation,'reserved',a.expires_at);
   exception when unique_violation then return jsonb_build_object('ok',false);end;
   return jsonb_build_object('ok',true,'acquired',true,'stored',false);
  end if;
  if c.code_hash is distinct from p_binding->>'codeHash' then return jsonb_build_object('ok',false);end if;
  return jsonb_build_object('ok',true,'acquired',false,'stored',c.state='stored','promoted',c.state='consumed');
 end if;
 if c.attempt_id is null then return jsonb_build_object('ok',false);end if;
 if p_operation='save' then
  if c.reservation is distinct from p_reservation or c.state not in ('reserved','stored') or nullif(btrim(p_token),'') is null or length(p_token)>16384 then return jsonb_build_object('ok',false);end if;
  if c.state='stored' then
   select decrypted_secret into token from vault.decrypted_secrets where id=c.token_secret_id;
   return jsonb_build_object('ok',token is not distinct from p_token);
  end if;
  select vault.create_secret(p_token,'wa-early-'||a.id::text,'Temporary pre-FINISH authorization') into secret_id;
  update private.es02_b3_early_whatsapp_authorizations set token_secret_id=secret_id,state='stored' where private.es02_b3_early_whatsapp_authorizations.attempt_id=a.id;
  return jsonb_build_object('ok',true);
 end if;
 if p_operation='promote' and c.state='consumed' then
  return jsonb_build_object('ok',c.waba_id is not distinct from p_binding->>'wabaId' and c.phone_number_id is not distinct from p_binding->>'phoneNumberId','promoted',true);
 end if;
 if c.state<>'stored' or c.token_secret_id is null then return jsonb_build_object('ok',false);end if;
 select decrypted_secret into token from vault.decrypted_secrets where id=c.token_secret_id;
 if nullif(btrim(token),'') is null then return jsonb_build_object('ok',false);end if;
 if p_operation='load' then return jsonb_build_object('ok',true,'token',token);end if;
 -- Called only after server-side Meta asset verification. Existing checkpoint contract is unchanged.
 if coalesce(p_binding->>'wabaId','') !~ '^[0-9]{1,64}$' or coalesce(p_binding->>'phoneNumberId','') !~ '^[0-9]{1,64}$' then return jsonb_build_object('ok',false);end if;
 r:=public.es02_b3_whatsapp_signup_checkpoint('reserve',p_binding||jsonb_build_object('codeHash',c.code_hash),c.reservation,null);
 if r->>'ok' is distinct from 'true' or r->>'acquired' is distinct from 'true' then return jsonb_build_object('ok',false);end if;
 r:=public.es02_b3_whatsapp_signup_checkpoint('save',p_binding,c.reservation,token);
 if r->>'ok' is distinct from 'true' then raise exception 'CHECKPOINT_PROMOTION_FAILED';end if;
 delete from vault.secrets where id=c.token_secret_id;
 update private.es02_b3_early_whatsapp_authorizations set state='consumed',token_secret_id=null,consumed_at=clock_timestamp(),waba_id=p_binding->>'wabaId',phone_number_id=p_binding->>'phoneNumberId' where private.es02_b3_early_whatsapp_authorizations.attempt_id=a.id;
 return jsonb_build_object('ok',true,'promoted',true);
end;$$;
alter function public.es02_b3_early_whatsapp_authorization(text,jsonb,uuid,text) owner to postgres;
revoke all on function public.es02_b3_early_whatsapp_authorization(text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.es02_b3_early_whatsapp_authorization(text,jsonb,uuid,text) to service_role;

-- Reuse the existing Supabase Cron runtime. Both switches start OFF.
create table private.es02_b3_early_wa_cleanup_settings(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false
);
alter table private.es02_b3_early_wa_cleanup_settings owner to postgres;
alter table private.es02_b3_early_wa_cleanup_settings enable row level security;
revoke all on private.es02_b3_early_wa_cleanup_settings from public,anon,authenticated,service_role;
insert into private.es02_b3_early_wa_cleanup_settings(singleton) values(true);
create function public.es02_b3_cleanup_early_wa_tick(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record;r jsonb;cleaned integer:=0;failed integer:=0;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if (select enabled from private.es02_b3_early_wa_cleanup_settings where singleton) is distinct from true then return jsonb_build_object('ok',false,'code','CLEANUP_DISABLED');end if;
 if p_limit is null or p_limit<1 or p_limit>50 then return jsonb_build_object('ok',false,'code','INVALID_LIMIT');end if;
 if not pg_try_advisory_xact_lock(20261028,430) then return jsonb_build_object('ok',true,'code','BUSY','cleaned',0);end if;
 -- Discovery returns no credentials. Per-attempt RPC rechecks all guards under its row lock.
 for candidate in
  select a.account_id,a.session_id,a.company_id,a.branch_id,a.id,a.generation,a.launch_nonce,a.app_id,a.config_id,a.graph_version
   from private.es02_b3_early_whatsapp_authorizations c join private.es02_b3_connection_attempts a on a.id=c.attempt_id
   where c.state='stored' and c.token_secret_id is not null and c.expires_at<=clock_timestamp()
     and a.status='cancelled' and a.expires_at<=clock_timestamp()
     and exists(select 1 from public.whatsapp_embedded_signup_attempts l where l.id=a.legacy_attempt_id
       and l.company_id=a.company_id and l.user_id=a.account_id and l.session_id=a.session_id and l.status='cancelled' and l.consumed_at is not null)
     and not exists(select 1 from private.es02_b3_whatsapp_signup_checkpoints x where x.attempt_id=a.id)
     and not exists(select 1 from private.es02_b3_connection_links x where x.attempt_id=a.id)
     and not exists(select 1 from public.whatsapp_company_links x where x.company_id=a.company_id)
   order by c.expires_at,c.attempt_id limit p_limit
 loop
  begin
   r:=public.es02_b3_early_whatsapp_authorization('cleanup',jsonb_build_object(
    'accountId',candidate.account_id,'sessionId',candidate.session_id,'companyId',candidate.company_id,'branchId',candidate.branch_id,
    'attemptId',candidate.id,'generation',candidate.generation,'nonce',candidate.launch_nonce,
    'appId',candidate.app_id,'configId',candidate.config_id,'graphVersion',candidate.graph_version),null,null);
   if r->>'ok'='true' then cleaned:=cleaned+1;end if;
  exception when others then failed:=failed+1;end;
 end loop;
 return jsonb_build_object('ok',failed=0,'cleaned',cleaned,'failed',failed);
end;$$;
alter function public.es02_b3_cleanup_early_wa_tick(integer) owner to postgres;
revoke all on function public.es02_b3_cleanup_early_wa_tick(integer) from public,anon,authenticated;
grant execute on function public.es02_b3_cleanup_early_wa_tick(integer) to service_role;
-- No new extension/service, no alteration to billing's job. Explicit later approval enables this job + singleton.
do $$declare job bigint;begin
 job:=cron.schedule('velora-wa-early-authorization-cleanup-v1','*/5 * * * *',
  'set role service_role; select public.es02_b3_cleanup_early_wa_tick(50); reset role;');
 perform cron.alter_job(job,active:=false);
end;$$;
commit;
