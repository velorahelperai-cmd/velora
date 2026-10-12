-- IG OAuth store only. Forward migration; no provider calls or configured contracts.
-- Vault must be installed separately and have safe ACLs; this migration never
-- changes shared Vault privileges. Actual Vault/version parity needs exact review.
begin;
create table private.instagram_provider_contracts (
 contract_id text primary key check(char_length(contract_id) between 1 and 128),
 app_id text not null check(char_length(app_id) between 1 and 128),
 required_permissions text[] not null check(cardinality(required_permissions)>0),
 enabled boolean not null default false
);
-- No seed. Only a separately verified server configuration may enable a contract.
create table private.instagram_company_generations (
 company_id uuid primary key references public.companies(id) on delete cascade,
 generation bigint not null default 0 check(generation between 0 and 9007199254740990)
);
create table private.instagram_oauth_attempts (
 id uuid primary key,company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null references auth.users(id),session_id uuid not null,
 generation bigint not null check(generation between 1 and 9007199254740991),
 app_id text not null,contract_id text not null references private.instagram_provider_contracts(contract_id),
 nonce_hash text not null check(nonce_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'pending' check(status in ('pending','claimed','vault_staged','bound','rejected','unknown','expired','cancelled')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 claimed_at timestamptz,staged_at timestamptz,bound_at timestamptz,
 stage_receipt uuid unique,secret_id uuid,stage_fingerprint text,
 account_id text,permissions text[],authorization_expires_at timestamptz,link_id uuid,
 unique(company_id,generation),
 check((status not in ('vault_staged','bound')) or (stage_receipt is not null and secret_id is not null and stage_fingerprint is not null and account_id is not null and permissions is not null and authorization_expires_at is not null)),
 check((status<>'bound') or (link_id is not null and bound_at is not null))
);
-- No FK to auth.sessions: cancelling a native session must remain possible while
-- retaining exact historical session identity; every operation checks its existence.
create table private.instagram_company_links (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 generation bigint not null,attempt_id uuid not null unique references private.instagram_oauth_attempts(id),
 account_id text not null,app_id text not null,contract_id text not null,
 secret_id uuid not null,permissions text[] not null,authorization_expires_at timestamptz not null,
 status text not null default 'active' check(status in ('active','retired')),
 created_at timestamptz not null default clock_timestamp(),unique(company_id,generation)
);
create unique index instagram_one_active_account on private.instagram_company_links(account_id) where status='active';
create unique index instagram_one_active_company on private.instagram_company_links(company_id) where status='active';
create index instagram_attempt_company_history on private.instagram_oauth_attempts(company_id,created_at desc);
alter table private.instagram_provider_contracts enable row level security;
alter table private.instagram_company_generations enable row level security;
alter table private.instagram_oauth_attempts enable row level security;
alter table private.instagram_company_links enable row level security;
revoke all on private.instagram_provider_contracts,private.instagram_company_generations,private.instagram_oauth_attempts,private.instagram_company_links from public,anon,authenticated,service_role;

create function private.instagram_binding_valid(b jsonb) returns boolean
language plpgsql immutable set search_path='' as $$begin
 if jsonb_typeof(b) is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(b))<>7 then return false;end if;
 return coalesce((b->>'companyId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 and (b->>'userId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 and (b->>'sessionId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 and (b->>'attemptId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 and jsonb_typeof(b->'generation')='number' and (b->>'generation') ~ '^[1-9][0-9]{0,15}$'
 and (b->>'generation')::numeric<=9007199254740991
 and jsonb_typeof(b->'appId')='string' and char_length(b->>'appId') between 1 and 128
 and jsonb_typeof(b->'contractId')='string' and char_length(b->>'contractId') between 1 and 128,false);
end;$$;
create function private.instagram_vault_ready() returns boolean
language plpgsql stable security definer set search_path='' as $$declare r text;t text;begin
 if not exists(select 1 from pg_extension where extname='supabase_vault')
 or to_regclass('vault.secrets') is null or to_regclass('vault.decrypted_secrets') is null
 or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null then return false;end if;
 -- Supabase service_role is a trusted server credential with existing shared
 -- Vault privileges. This package does not change the shared Vault ACLs.
 -- Browser roles must never read tokens, including through column grants.
 if current_user <> 'postgres'
 or not has_schema_privilege(current_user,'vault','usage')
 or not has_table_privilege(current_user,'vault.secrets','select')
 or not has_table_privilege(current_user,'vault.secrets','delete')
 or not has_table_privilege(current_user,'vault.decrypted_secrets','select')
 or not has_function_privilege(current_user,'vault.create_secret(text,text,text,uuid)','execute') then return false;end if;
 foreach r in array array['anon','authenticated'] loop
  foreach t in array array['vault.secrets','vault.decrypted_secrets'] loop
   if has_table_privilege(r,t,'select') or has_any_column_privilege(r,t,'select') then return false;end if;
  end loop;
 end loop;return true;
end;$$;
create function private.instagram_owner_lock(cid uuid,uid uuid,sid uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$declare s jsonb;a private.app_session_activity%rowtype;begin
 -- NOWAIT avoids inversion with the existing pre-request activity lock. An
 -- uncommitted authority change yields a known no-effect UNAVAILABLE, not a grant.
 perform 1 from public.companies where id=cid and status in ('setup','active') for share nowait;
 if not found then return false;end if;
 perform 1 from public.company_members where company_id=cid and user_id=uid and role='owner' and status='active' for share nowait;
 if not found then return false;end if;
 perform 1 from auth.users where id=uid and (email_confirmed_at is not null or phone_confirmed_at is not null) for share nowait;
 if not found then return false;end if;
 select to_jsonb(x) into s from auth.sessions x where id=sid and user_id=uid for share nowait;
 if not found or ((s->>'not_after') is not null and (s->>'not_after')::timestamptz<=clock_timestamp()) then return false;end if;
 select * into a from private.app_session_activity where session_id=sid and user_id=uid for share nowait;
 return found and a.expired_at is null and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours';
end;$$;
create function private.instagram_attempt_binding(a private.instagram_oauth_attempts) returns jsonb
language sql immutable set search_path='' as $$select jsonb_build_object('companyId',a.company_id,'userId',a.user_id,'sessionId',a.session_id,'attemptId',a.id,'generation',a.generation,'appId',a.app_id,'contractId',a.contract_id)$$;
create function private.instagram_progress(a private.instagram_oauth_attempts) returns jsonb
language sql immutable set search_path='' as $$select jsonb_build_object('kind',a.status,'binding',private.instagram_attempt_binding(a))||case when a.status='vault_staged' then jsonb_build_object('stageReceipt',a.stage_receipt) when a.status='bound' then jsonb_build_object('linkId',a.link_id) else '{}'::jsonb end$$;
create function private.instagram_audit(a private.instagram_oauth_attempts,action text) returns void
language sql volatile security definer set search_path='' as $$select private.write_admin_audit(a.user_id,a.company_id,action,null,jsonb_build_object('attemptId',a.id,'generation',a.generation,'status',a.status))$$;
create function private.instagram_locked_attempt(b jsonb,server_only boolean) returns private.instagram_oauth_attempts
language plpgsql volatile security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;gen bigint;begin
 if not private.instagram_binding_valid(b) then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 if server_only then
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 else
  if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is distinct from (b->>'userId')::uuid
  or (auth.jwt()->>'session_id') is distinct from b->>'sessionId' then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 end if;
 if not private.instagram_owner_lock((b->>'companyId')::uuid,(b->>'userId')::uuid,(b->>'sessionId')::uuid) then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 -- Prevent disabling/changing the provider contract between check and commit.
 perform 1 from private.instagram_provider_contracts where contract_id=b->>'contractId' and app_id=b->>'appId' and enabled for share nowait;
 if not found then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 select generation into gen from private.instagram_company_generations where company_id=(b->>'companyId')::uuid for update;
 if not found or gen is distinct from (b->>'generation')::bigint then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 select * into a from private.instagram_oauth_attempts where id=(b->>'attemptId')::uuid for update;
 if not found or private.instagram_attempt_binding(a) is distinct from b then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 -- Time can advance while waiting for the generation/attempt lock.
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 if a.status in ('pending','claimed','vault_staged') and a.expires_at<=clock_timestamp() then
  update private.instagram_oauth_attempts set status='expired' where id=a.id returning * into a;
  perform private.instagram_audit(a,'instagram.connection_expired');
 end if;return a;
end;$$;

create function public.instagram_start_connection(p_company_id uuid,p_attempt_id uuid,p_nonce_hash text,p_app_id text,p_contract_id text,p_expected_generation bigint) returns jsonb
language plpgsql security definer set search_path='' as $$declare uid uuid;sid uuid;gen bigint;a private.instagram_oauth_attempts%rowtype;begin
 if current_setting('role',true) is distinct from 'authenticated' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 uid:=auth.uid();begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_attempt_id is null or p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' or p_app_id is null or p_contract_id is null or p_expected_generation is null or p_expected_generation<0 or p_expected_generation>=9007199254740991 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform 1 from private.instagram_provider_contracts where contract_id=p_contract_id and app_id=p_app_id and enabled for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 insert into private.instagram_company_generations(company_id) values(p_company_id) on conflict do nothing;
 select generation into gen from private.instagram_company_generations where company_id=p_company_id for update;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into a from private.instagram_oauth_attempts where id=p_attempt_id for update;
 if found then
  if a.company_id is distinct from p_company_id or a.user_id is distinct from uid or a.session_id is distinct from sid or a.nonce_hash is distinct from p_nonce_hash or a.app_id is distinct from p_app_id or a.contract_id is distinct from p_contract_id or a.generation is distinct from p_expected_generation+1 then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if a.generation<>gen then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
  return jsonb_build_object('ok',true,'binding',private.instagram_attempt_binding(a),'expiresAt',a.expires_at);
 end if;
 if gen<>p_expected_generation then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 update private.instagram_oauth_attempts set status='cancelled' where company_id=p_company_id and status in ('pending','claimed','vault_staged');
 update private.instagram_company_generations set generation=gen+1 where company_id=p_company_id;
 insert into private.instagram_oauth_attempts(id,company_id,user_id,session_id,generation,app_id,contract_id,nonce_hash,expires_at)
 values(p_attempt_id,p_company_id,uid,sid,gen+1,p_app_id,p_contract_id,p_nonce_hash,clock_timestamp()+interval '10 minutes') returning * into a;
 perform private.instagram_audit(a,'instagram.connection_started');
 return jsonb_build_object('ok',true,'binding',private.instagram_attempt_binding(a),'expiresAt',a.expires_at);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
 when unique_violation then return jsonb_build_object('ok',false,'code','CONSUMED');
end;$$;
create function public.instagram_read_connection(p_binding jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;begin
 a:=private.instagram_locked_attempt(p_binding,false);return private.instagram_progress(a);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
create function public.instagram_claim_connection(p_binding jsonb,p_nonce text) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;begin
 a:=private.instagram_locked_attempt(p_binding,false);
 if p_nonce is null or p_nonce !~ '^[0-9a-f]{64}$' or a.nonce_hash is distinct from encode(sha256(convert_to(p_nonce,'UTF8')),'hex') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.status='expired' then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.status<>'pending' then return jsonb_build_object('kind','existing','progress',private.instagram_progress(a));end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 update private.instagram_oauth_attempts set status='claimed',claimed_at=clock_timestamp() where id=a.id returning * into a;
 perform private.instagram_audit(a,'instagram.connection_claimed');
 -- Standard POST RPC response is observed only after PostgREST transaction commit.
 -- A local SQL caller inside BEGIN must not treat this row as committed authority.
 return jsonb_build_object('kind','claimed','committed',true,'binding',private.instagram_attempt_binding(a));
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
create function public.instagram_stage_connection(p_binding jsonb,p_access_token text,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;perms text[];required text[];deadline timestamptz;fingerprint text;secret uuid;begin
 a:=private.instagram_locked_attempt(p_binding,true);
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 if a.status='expired' then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.status not in ('claimed','vault_staged') then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 if p_access_token is null or char_length(btrim(p_access_token))=0 or octet_length(p_access_token)>16384 or jsonb_typeof(p_evidence) is distinct from 'object'
 or p_evidence->>'appId' is distinct from a.app_id or p_evidence->>'contractId' is distinct from a.contract_id
 or jsonb_typeof(p_evidence->'accountId') is distinct from 'string' or char_length(btrim(p_evidence->>'accountId')) not between 1 and 128
 or jsonb_typeof(p_evidence->'permissions') is distinct from 'array' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if exists(select 1 from jsonb_array_elements(p_evidence->'permissions') x where jsonb_typeof(x)<>'string' or char_length(btrim(x#>>'{}')) not between 1 and 128) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select array_agg(distinct x order by x) into perms from jsonb_array_elements_text(p_evidence->'permissions') x;
 select required_permissions into required from private.instagram_provider_contracts where contract_id=a.contract_id and app_id=a.app_id and enabled;
 if perms is null or required is null or not required<@perms then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 begin deadline:=(p_evidence->>'expiresAt')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 if deadline is null or not isfinite(deadline) or deadline<=clock_timestamp() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('token',p_access_token,'account',p_evidence->>'accountId','permissions',perms,'expiry',extract(epoch from deadline))::text,'UTF8')),'hex');
 if a.status='vault_staged' then
  if a.stage_fingerprint is distinct from fingerprint then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  return jsonb_build_object('stageReceipt',a.stage_receipt);
 end if;
 execute 'select vault.create_secret($1,$2,$3,$4)' into secret using p_access_token,'instagram-attempt-'||a.id,'Instagram OAuth stage',null::uuid;
 if secret is null then raise exception 'INSTAGRAM_VAULT_UNAVAILABLE';end if;
 -- If encryption/storage delayed the transition, rollback its secret too.
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) or a.expires_at<=clock_timestamp() or deadline<=clock_timestamp() then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 update private.instagram_oauth_attempts set status='vault_staged',stage_receipt=gen_random_uuid(),secret_id=secret,stage_fingerprint=fingerprint,account_id=p_evidence->>'accountId',permissions=perms,authorization_expires_at=deadline,staged_at=clock_timestamp() where id=a.id returning * into a;
 perform private.instagram_audit(a,'instagram.connection_staged');
 return jsonb_build_object('stageReceipt',a.stage_receipt);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
create function public.instagram_finalize_connection(p_binding jsonb,p_stage_receipt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;required text[];secret_exists boolean;link uuid;begin
 a:=private.instagram_locked_attempt(p_binding,true);
 if a.status='expired' then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.status not in ('vault_staged','bound') then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 if p_stage_receipt is null or a.stage_receipt is distinct from p_stage_receipt then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.status='bound' then return jsonb_build_object('ok',true,'linkId',a.link_id);end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 select required_permissions into required from private.instagram_provider_contracts where contract_id=a.contract_id and app_id=a.app_id and enabled;
 if required is null or not required<@a.permissions or a.authorization_expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 execute 'select exists(select 1 from vault.secrets where id=$1)' into secret_exists using a.secret_id;
 if not secret_exists then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 perform pg_advisory_xact_lock(87420106,hashtext(a.account_id));
 -- Last blocking gate: session/attempt/provider expiry must still be current.
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.authorization_expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if exists(select 1 from private.instagram_company_links where account_id=a.account_id and status='active' and company_id<>a.company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 update private.instagram_company_links set status='retired' where company_id=a.company_id and status='active';
 insert into private.instagram_company_links(company_id,generation,attempt_id,account_id,app_id,contract_id,secret_id,permissions,authorization_expires_at)
 values(a.company_id,a.generation,a.id,a.account_id,a.app_id,a.contract_id,a.secret_id,a.permissions,a.authorization_expires_at) returning id into link;
 update private.instagram_oauth_attempts set status='bound',link_id=link,bound_at=clock_timestamp() where id=a.id returning * into a;
 perform private.instagram_audit(a,'instagram.connection_bound');return jsonb_build_object('ok',true,'linkId',a.link_id);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');when unique_violation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;$$;
create function public.instagram_settle_connection(p_binding jsonb,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;begin
 a:=private.instagram_locked_attempt(p_binding,true);
 if p_outcome is null or p_outcome not in ('unknown','rejected') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if a.status='claimed' then update private.instagram_oauth_attempts set status=p_outcome where id=a.id and status='claimed' returning * into a;perform private.instagram_audit(a,'instagram.connection_settled');end if;
 return private.instagram_progress(a);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
create function public.instagram_cancel_connection(p_binding jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;begin
 a:=private.instagram_locked_attempt(p_binding,false);
 if a.status in ('pending','claimed','vault_staged') then update private.instagram_oauth_attempts set status='cancelled' where id=a.id returning * into a;perform private.instagram_audit(a,'instagram.connection_cancelled');end if;
 return private.instagram_progress(a);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
create function public.instagram_secret_connection(p_binding jsonb,p_link_id uuid,p_account_id text) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;l private.instagram_company_links%rowtype;token text;begin
 a:=private.instagram_locked_attempt(p_binding,true);
 if a.status<>'bound' or p_link_id is null or a.link_id is distinct from p_link_id or p_account_id is null or a.account_id is distinct from p_account_id then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into l from private.instagram_company_links where id=p_link_id and company_id=a.company_id and generation=a.generation and attempt_id=a.id and account_id=p_account_id and app_id=a.app_id and contract_id=a.contract_id and status='active' for share;
 if not found or l.secret_id is distinct from a.secret_id or l.authorization_expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into token using l.secret_id;
 -- Locks preserve rows, but native/app/provider expiry can advance during Vault I/O.
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) or l.authorization_expires_at<=clock_timestamp() or a.authorization_expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if token is null or btrim(token)='' then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 -- SERVER INTERNAL ONLY; never serialize this result through a UI/server action.
 return jsonb_build_object('ok',true,'accessToken',token);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;

revoke all on function private.instagram_binding_valid(jsonb),private.instagram_vault_ready(),private.instagram_owner_lock(uuid,uuid,uuid),private.instagram_attempt_binding(private.instagram_oauth_attempts),private.instagram_progress(private.instagram_oauth_attempts),private.instagram_audit(private.instagram_oauth_attempts,text),private.instagram_locked_attempt(jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.instagram_start_connection(uuid,uuid,text,text,text,bigint),public.instagram_read_connection(jsonb),public.instagram_claim_connection(jsonb,text),public.instagram_cancel_connection(jsonb),public.instagram_stage_connection(jsonb,text,jsonb),public.instagram_finalize_connection(jsonb,uuid),public.instagram_settle_connection(jsonb,text),public.instagram_secret_connection(jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.instagram_start_connection(uuid,uuid,text,text,text,bigint),public.instagram_read_connection(jsonb),public.instagram_claim_connection(jsonb,text),public.instagram_cancel_connection(jsonb) to authenticated;
grant execute on function public.instagram_stage_connection(jsonb,text,jsonb),public.instagram_finalize_connection(jsonb,uuid),public.instagram_settle_connection(jsonb,text),public.instagram_secret_connection(jsonb,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
