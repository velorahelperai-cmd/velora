-- Forward-only; local development. No provider operations or rollout changes.
begin;
alter table private.instagram_company_generations add column attempt_generation bigint not null default 0 check(attempt_generation between 0 and 9007199254740990),add column bound_account_id text;
alter table private.instagram_oauth_attempts add column username text,add column failure_reason text check(failure_reason in ('account_mismatch','provider_rejected'));
alter table private.instagram_company_links add column username text,add column authorization_issue text check(authorization_issue='provider_rejected_authorization');
-- Preserve the high-water attempt fence, restore only the actual active generation.
update private.instagram_company_generations g set attempt_generation=g.generation,bound_account_id=(select account_id from private.instagram_company_links l where l.company_id=g.company_id order by (status='active') desc,generation desc limit 1);
update private.instagram_company_generations g set generation=l.generation from private.instagram_company_links l where l.company_id=g.company_id and l.status='active';
create function private.instagram_generation_insert() returns trigger language plpgsql set search_path='' as $$begin new.attempt_generation:=greatest(new.generation,new.attempt_generation);return new;end;$$;
create trigger instagram_generation_insert before insert on private.instagram_company_generations for each row execute function private.instagram_generation_insert();
create or replace function public.instagram_start_connection(p_company_id uuid,p_attempt_id uuid,p_nonce_hash text,p_app_id text,p_contract_id text,p_expected_generation bigint) returns jsonb
language plpgsql security definer set search_path='' as $$declare uid uuid;sid uuid;gen bigint;a private.instagram_oauth_attempts%rowtype;begin
 if current_setting('role',true) is distinct from 'authenticated' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 uid:=auth.uid();begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_attempt_id is null or p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' or p_app_id is null or p_contract_id is null or p_expected_generation is null or p_expected_generation<0 or p_expected_generation>=9007199254740991 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform 1 from private.instagram_provider_contracts where contract_id=p_contract_id and app_id=p_app_id and enabled for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 insert into private.instagram_company_generations(company_id) values(p_company_id) on conflict do nothing;
 select attempt_generation into gen from private.instagram_company_generations where company_id=p_company_id for update;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- Atomically refuse superseding an unresolved exchange; the same company
 -- generation lock serializes start against claim/stage/finalize.
 if exists(select 1 from private.instagram_oauth_attempts where company_id=p_company_id and generation=gen and status in ('claimed','vault_staged','unknown')) then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 select * into a from private.instagram_oauth_attempts where id=p_attempt_id for update;
 if found then
  if a.company_id is distinct from p_company_id or a.user_id is distinct from uid or a.session_id is distinct from sid or a.nonce_hash is distinct from p_nonce_hash or a.app_id is distinct from p_app_id or a.contract_id is distinct from p_contract_id or a.generation is distinct from p_expected_generation+1 then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if a.generation<>gen then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
  return jsonb_build_object('ok',true,'binding',private.instagram_attempt_binding(a),'expiresAt',a.expires_at);
 end if;
 if gen<>p_expected_generation then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 if gen>=9007199254740990 then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 update private.instagram_oauth_attempts set status='cancelled' where company_id=p_company_id and status in ('pending','claimed','vault_staged');
 update private.instagram_company_generations set attempt_generation=gen+1 where company_id=p_company_id;
 insert into private.instagram_oauth_attempts(id,company_id,user_id,session_id,generation,app_id,contract_id,nonce_hash,expires_at)
 values(p_attempt_id,p_company_id,uid,sid,gen+1,p_app_id,p_contract_id,p_nonce_hash,clock_timestamp()+interval '10 minutes') returning * into a;
 perform private.instagram_audit(a,'instagram.connection_started');
 return jsonb_build_object('ok',true,'binding',private.instagram_attempt_binding(a),'expiresAt',a.expires_at);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
 when unique_violation then return jsonb_build_object('ok',false,'code','CONSUMED');
end;$$;
create or replace function private.instagram_locked_attempt(b jsonb,server_only boolean) returns private.instagram_oauth_attempts
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
 select attempt_generation into gen from private.instagram_company_generations where company_id=(b->>'companyId')::uuid for update;
 if not found then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 select * into a from private.instagram_oauth_attempts where id=(b->>'attemptId')::uuid for update;
 if not found or private.instagram_attempt_binding(a) is distinct from b then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 if gen<>a.generation and not (a.status='bound' and exists(select 1 from private.instagram_company_links l where l.id=a.link_id and l.company_id=a.company_id and l.status='active' and l.generation=a.generation)) then raise insufficient_privilege;end if;
 -- Time can advance while waiting for the generation/attempt lock.
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 if a.status='claimed' and a.expires_at<=clock_timestamp() then update private.instagram_oauth_attempts set status='unknown' where id=a.id returning * into a;end if;
 if a.status='pending' and a.expires_at<=clock_timestamp() then
  update private.instagram_oauth_attempts set status='expired' where id=a.id returning * into a;
  perform private.instagram_audit(a,'instagram.connection_expired');
 end if;return a;
end;$$;
create or replace function public.instagram_stage_connection(p_binding jsonb,p_access_token text,p_evidence jsonb) returns jsonb
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
 if exists(select 1 from private.instagram_company_generations g where g.company_id=a.company_id and g.bound_account_id is not null and g.bound_account_id<>p_evidence->>'accountId') or exists(select 1 from private.instagram_company_links l where l.company_id=a.company_id and l.account_id<>p_evidence->>'accountId') then
 update private.instagram_oauth_attempts set status='rejected',failure_reason='account_mismatch' where id=a.id;perform private.instagram_audit(a,'instagram.account_mismatch');return jsonb_build_object('ok',false,'code','ACCOUNT_MISMATCH');end if;
 if p_evidence ? 'username' and (jsonb_typeof(p_evidence->'username')<>'string' or p_evidence->>'username' !~ '^[A-Za-z0-9_.]{1,30}$') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('token',p_access_token,'account',p_evidence->>'accountId','permissions',perms,'expiry',extract(epoch from deadline))::text,'UTF8')),'hex');
 if a.status='vault_staged' then
  if a.stage_fingerprint is distinct from fingerprint then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  return jsonb_build_object('stageReceipt',a.stage_receipt);
 end if;
 execute 'select vault.create_secret($1,$2,$3,$4)' into secret using p_access_token,'instagram-attempt-'||a.id,'Instagram OAuth stage',null::uuid;
 if secret is null then raise exception 'INSTAGRAM_VAULT_UNAVAILABLE';end if;
 -- If encryption/storage delayed the transition, rollback its secret too.
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) or a.expires_at<=clock_timestamp() or deadline<=clock_timestamp() then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 update private.instagram_oauth_attempts set username=p_evidence->>'username',status='vault_staged',stage_receipt=gen_random_uuid(),secret_id=secret,stage_fingerprint=fingerprint,account_id=p_evidence->>'accountId',permissions=perms,authorization_expires_at=deadline,staged_at=clock_timestamp() where id=a.id returning * into a;
 perform private.instagram_audit(a,'instagram.connection_staged');
 return jsonb_build_object('stageReceipt',a.stage_receipt);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
create or replace function public.instagram_finalize_connection(p_binding jsonb,p_stage_receipt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;required text[];secret_exists boolean;link uuid;begin
 a:=private.instagram_locked_attempt(p_binding,true);
 if a.status='expired' then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.status not in ('vault_staged','bound') then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 if p_stage_receipt is null or a.stage_receipt is distinct from p_stage_receipt then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.status='bound' then return jsonb_build_object('ok',true,'linkId',a.link_id);end if;
 perform 1 from private.instagram_subscription_attempts where attempt_id=a.id and stage_receipt=a.stage_receipt
  and account_id=a.account_id and app_id=a.app_id and generation=a.generation and fields=array['messages']::text[]
  and state='verified' and settled_at is not null for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 select required_permissions into required from private.instagram_provider_contracts where contract_id=a.contract_id and app_id=a.app_id and enabled;
 if required is null or not required<@a.permissions or a.authorization_expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 execute 'select exists(select 1 from vault.secrets where id=$1)' into secret_exists using a.secret_id;
 if not secret_exists then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 perform pg_advisory_xact_lock(87420106,hashtext(a.account_id));
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.authorization_expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if exists(select 1 from private.instagram_company_links where account_id=a.account_id and status='active' and company_id<>a.company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if exists(select 1 from private.instagram_company_generations where company_id=a.company_id and bound_account_id is not null and bound_account_id<>a.account_id) then return jsonb_build_object('ok',false,'code','ACCOUNT_MISMATCH');end if;
 update private.instagram_company_generations set generation=a.generation,bound_account_id=a.account_id where company_id=a.company_id;
 update private.instagram_company_links set status='retired' where company_id=a.company_id and status='active';
 insert into private.instagram_company_links(company_id,generation,attempt_id,account_id,app_id,contract_id,secret_id,permissions,authorization_expires_at,username)
 values(a.company_id,a.generation,a.id,a.account_id,a.app_id,a.contract_id,a.secret_id,a.permissions,a.authorization_expires_at,a.username) returning id into link;
 update private.instagram_oauth_attempts set status='bound',link_id=link,bound_at=clock_timestamp() where id=a.id returning * into a;
 perform private.instagram_audit(a,'instagram.connection_bound');
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) or a.authorization_expires_at<=clock_timestamp() then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'linkId',a.link_id);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');when unique_violation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;$$;
create or replace function public.instagram_owner_connection(p_company_id uuid,p_app_id text,p_contract_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;sid uuid;gen bigint;l private.instagram_company_links%rowtype;k text;reason text;ready boolean;
begin
 if current_setting('role',true) is distinct from 'authenticated' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select attempt_generation into gen from private.instagram_company_generations where company_id=p_company_id for share nowait;
 if not found then gen:=0;end if;
 select * into l from private.instagram_company_links where company_id=p_company_id and status='active';
 update private.instagram_oauth_attempts set status='expired' where company_id=p_company_id and generation=gen and status='pending' and expires_at<=clock_timestamp();
 select status,failure_reason into k,reason from private.instagram_oauth_attempts where company_id=p_company_id and generation=gen;
 ready:=exists(select 1 from private.instagram_provider_contracts where contract_id=p_contract_id and app_id=p_app_id and enabled
  and required_permissions @> array['instagram_business_basic','instagram_business_manage_messages']::text[]) and private.instagram_vault_ready();
 return jsonb_build_object('ok',true,'generation',gen,'link',case when l.id is null then null else jsonb_build_object('linkId',l.id,'accountId',l.account_id,'generation',l.generation,'username',l.username,'expiresAt',l.authorization_expires_at,'needsAuthorization',l.authorization_expires_at<=clock_timestamp() or not l.permissions @> array['instagram_business_basic','instagram_business_manage_messages']::text[]) end,'attemptKind',k,'attemptReason',reason,'contractReady',ready);
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create or replace function public.instagram_disconnect_connection(p_company_id uuid,p_link_id uuid,p_expected_generation bigint) returns jsonb language sql set search_path='' as $$select jsonb_build_object('ok',false,'code','FORBIDDEN')$$;
revoke all on function public.instagram_disconnect_connection(uuid,uuid,bigint) from public,anon,authenticated,service_role;
create function public.instagram_admin_disconnect(p_company_id uuid,p_link_id uuid,p_expected_generation bigint) returns jsonb language plpgsql security definer set search_path='' as $$declare uid uuid;sid uuid;g private.instagram_company_generations%rowtype;l private.instagram_company_links%rowtype;begin
 if current_setting('role',true)<>'authenticated' or not coalesce(public.billing_admin_authorized_session(),false) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 perform 1 from public.companies where id=p_company_id for update nowait;
 select * into g from private.instagram_company_generations where company_id=p_company_id for update nowait;
 select * into l from private.instagram_company_links where company_id=p_company_id and id=p_link_id for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if l.status='retired' then return jsonb_build_object('ok',true,'providerRevocation','unconfirmed');end if;
 if g.generation<>p_expected_generation then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if not pg_try_advisory_xact_lock(87420106,hashtext(l.account_id)) then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 update private.instagram_company_links set status='retired' where id=l.id;
 update private.instagram_company_generations set generation=greatest(g.generation,g.attempt_generation)+1,attempt_generation=greatest(g.generation,g.attempt_generation)+1 where company_id=p_company_id;
 update private.instagram_oauth_attempts set status='cancelled' where company_id=p_company_id and status in ('pending','claimed','vault_staged','unknown');
 perform private.write_admin_audit(uid,p_company_id,'instagram.admin_local_disconnect',null,jsonb_build_object('linkId',l.id,'accountId',l.account_id,'providerRevocation','unconfirmed'));
 if not coalesce(public.billing_admin_authorized_session(),false) then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'providerRevocation','unconfirmed');
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
revoke all on function public.instagram_admin_disconnect(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.instagram_admin_disconnect(uuid,uuid,bigint) to authenticated;
revoke all on function private.instagram_generation_insert() from public,anon,authenticated,service_role;
-- Cancellation can only retire a still-unclaimed authorization attempt.
create or replace function public.instagram_cancel_connection(p_binding jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;begin
 a:=private.instagram_locked_attempt(p_binding,false);
 if a.status='pending' then update private.instagram_oauth_attempts set status='cancelled' where id=a.id returning * into a;perform private.instagram_audit(a,'instagram.connection_cancelled');end if;
 return private.instagram_progress(a);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
create function public.instagram_owner_recovery(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;begin
 if current_setting('role',true) is distinct from 'authenticated' or not private.instagram_owner_lock(p_company_id,auth.uid(),(auth.jwt()->>'session_id')::uuid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select a1.* into a from private.instagram_oauth_attempts a1 join private.instagram_company_generations g on g.company_id=a1.company_id and g.attempt_generation=a1.generation where a1.company_id=p_company_id and a1.user_id=auth.uid() and a1.session_id=(auth.jwt()->>'session_id')::uuid;
 if not found then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 return jsonb_build_object('ok',true,'binding',private.instagram_attempt_binding(a));
end;$$;
revoke all on function public.instagram_owner_recovery(uuid) from public,anon,authenticated,service_role;
grant execute on function public.instagram_owner_recovery(uuid) to authenticated;
create or replace function public.instagram_owner_attempt(p_company_id uuid,p_attempt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare uid uuid;sid uuid;a private.instagram_oauth_attempts%rowtype;expected text;begin
 if current_setting('role',true) is distinct from 'authenticated' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into a from private.instagram_oauth_attempts where id=p_attempt_id and company_id=p_company_id and user_id=uid and session_id=sid;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select bound_account_id into expected from private.instagram_company_generations where company_id=p_company_id;
 return jsonb_build_object('ok',true,'binding',private.instagram_attempt_binding(a),'expectedAccountId',expected);
exception when invalid_text_representation or lock_not_available then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;$$;
-- After the lease, an unstaged claim cannot have installed a connection. Verify
-- this durably and close it under the same attempt lock; never exchange its code again.
create function public.instagram_verify_unstaged_owner_attempt(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;gen bigint;uid uuid;sid uuid;begin
 uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 if current_setting('role',true) is distinct from 'authenticated' or not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select attempt_generation into gen from private.instagram_company_generations where company_id=p_company_id for update;
 select * into a from private.instagram_oauth_attempts where company_id=p_company_id and generation=gen for update;
 if found and a.status in ('claimed','unknown') and a.expires_at<=clock_timestamp() and a.secret_id is null and a.link_id is null and not exists(select 1 from private.instagram_company_links where attempt_id=a.id) then
  update private.instagram_oauth_attempts set status='expired' where id=a.id;
  perform private.write_admin_audit(uid,p_company_id,'instagram.unstaged_attempt_verified_closed',null,jsonb_build_object('attemptId',a.id,'generation',gen,'providerAuthorization','unconfirmed'));
  if not private.instagram_owner_lock(p_company_id,uid,sid) then raise insufficient_privilege;end if;
  return jsonb_build_object('ok',true,'resolved',true,'code','EXPIRED');
 end if;return jsonb_build_object('ok',true,'resolved',false);
exception when insufficient_privilege or invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;
revoke all on function public.instagram_verify_unstaged_owner_attempt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.instagram_verify_unstaged_owner_attempt(uuid) to authenticated;
create function public.instagram_admin_connection(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare l private.instagram_company_links%rowtype;gen bigint;begin
 if current_setting('role',true) is distinct from 'authenticated' or not coalesce(public.billing_admin_authorized_session(),false) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into l from private.instagram_company_links where company_id=p_company_id and status='active';
 select generation into gen from private.instagram_company_generations where company_id=p_company_id;
 return jsonb_build_object('ok',true,'link',case when l.id is null then null else jsonb_build_object('linkId',l.id,'generation',gen,'accountId',l.account_id) end);
end;$$;
revoke all on function public.instagram_admin_connection(uuid) from public,anon,authenticated,service_role;
grant execute on function public.instagram_admin_connection(uuid) to authenticated;
create function public.instagram_owner_profile_credential(p_company_id uuid,p_user_id uuid,p_session_id uuid,p_link_id uuid,p_generation bigint) returns jsonb
language plpgsql security definer set search_path='' as $$declare l private.instagram_company_links%rowtype;token text;begin
 if current_setting('role',true) is distinct from 'service_role' or not private.instagram_owner_lock(p_company_id,p_user_id,p_session_id) then return jsonb_build_object('ok',false);end if;
 select l1.* into l from private.instagram_company_links l1 join private.instagram_company_generations g on g.company_id=l1.company_id and g.generation=l1.generation
 where l1.id=p_link_id and l1.company_id=p_company_id and l1.generation=p_generation and l1.status='active' and l1.authorization_expires_at>clock_timestamp() for share of l1,g nowait;
 if not found or not private.instagram_vault_ready() then return jsonb_build_object('ok',false);end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into token using l.secret_id;
 if token is null then return jsonb_build_object('ok',false);end if;
 return jsonb_build_object('ok',true,'accountId',l.account_id,'accessToken',token);
exception when lock_not_available then return jsonb_build_object('ok',false);end;$$;
create function public.instagram_store_owner_profile(p_company_id uuid,p_user_id uuid,p_session_id uuid,p_link_id uuid,p_generation bigint,p_account_id text,p_username text,p_authorization_invalid boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' or not private.instagram_owner_lock(p_company_id,p_user_id,p_session_id) then return false;end if;
 if p_authorization_invalid is null or (not p_authorization_invalid and (p_username is null or p_username !~ '^[A-Za-z0-9_.]{1,30}$')) then return false;end if;
 perform 1 from private.instagram_company_generations where company_id=p_company_id and generation=p_generation for share nowait;if not found then return false;end if;
 update private.instagram_company_links set username=case when p_authorization_invalid then username else p_username end,authorization_issue=case when p_authorization_invalid then 'provider_rejected_authorization' else authorization_issue end,authorization_expires_at=case when p_authorization_invalid then least(authorization_expires_at,clock_timestamp()) else authorization_expires_at end
 where id=p_link_id and company_id=p_company_id and account_id=p_account_id and generation=p_generation and status='active';return found;
exception when lock_not_available then return false;end;$$;
revoke all on function public.instagram_owner_profile_credential(uuid,uuid,uuid,uuid,bigint),public.instagram_store_owner_profile(uuid,uuid,uuid,uuid,bigint,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.instagram_owner_profile_credential(uuid,uuid,uuid,uuid,bigint),public.instagram_store_owner_profile(uuid,uuid,uuid,uuid,bigint,text,text,boolean) to service_role;
-- Persist a conclusive invalid-token outcome atomically with its native send receipt.
-- Late failure for a retired generation cannot invalidate a newer connection.
do $$begin
 if to_regprocedure('public.instagram_settle_send(jsonb,uuid,jsonb)') is not null then
  alter function public.instagram_settle_send(jsonb,uuid,jsonb) set schema private;
  alter function private.instagram_settle_send(jsonb,uuid,jsonb) rename to instagram_settle_send_pre_auth_health;
  revoke all on function private.instagram_settle_send_pre_auth_health(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
  execute $wrapper$create function public.instagram_settle_send(p_binding jsonb,p_claim_receipt uuid,p_outcome jsonb) returns jsonb language plpgsql security definer set search_path='' as $body$declare r jsonb;i private.instagram_send_intents%rowtype;begin
   if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
   r:=private.instagram_settle_send_pre_auth_health(p_binding,p_claim_receipt,p_outcome-'reauthorizationRequired');
   if r->>'ok'='true' and r->>'state'='rejected' and p_outcome->'reauthorizationRequired'='true'::jsonb then
    select * into i from private.instagram_send_intents where id=(p_binding->>'intentId')::uuid and claim_receipt=p_claim_receipt and state='rejected';
    if found then update private.instagram_company_links l set authorization_expires_at=least(l.authorization_expires_at,clock_timestamp()),authorization_issue='provider_rejected_authorization'
     where l.id=i.link_id and l.company_id=i.company_id and l.account_id=i.account_id and l.generation=i.generation and l.status='active';end if;
   end if;return r;
  end;$body$;$wrapper$;
  revoke all on function public.instagram_settle_send(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
  grant execute on function public.instagram_settle_send(jsonb,uuid,jsonb) to service_role;
 end if;
end;$$;
create function public.instagram_cancel_owner_oauth(p_binding jsonb,p_nonce text) returns jsonb language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;begin
 a:=private.instagram_locked_attempt(p_binding,false);
 if p_nonce is null or a.nonce_hash<>encode(sha256(convert_to(p_nonce,'UTF8')),'hex') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.status='pending' then update private.instagram_oauth_attempts set status='cancelled' where id=a.id;perform private.instagram_audit(a,'instagram.connection_cancelled');return jsonb_build_object('ok',true);end if;
 if a.status='cancelled' then return jsonb_build_object('ok',true);end if;
 return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;$$;
revoke all on function public.instagram_cancel_owner_oauth(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.instagram_cancel_owner_oauth(jsonb,text) to authenticated;
notify pgrst,'reload schema';commit;
