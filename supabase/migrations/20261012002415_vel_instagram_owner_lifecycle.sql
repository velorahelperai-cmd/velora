-- REVIEW DRAFT ONLY: CLI migration allocation is pending. Requires the reviewed
-- Instagram connection store. No provider-contract seed, Vault ACL change,
-- table/data deletion, rollout, Auth change or external provider operation.
begin;
create function public.instagram_owner_connection(p_company_id uuid,p_app_id text,p_contract_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;sid uuid;gen bigint;l private.instagram_company_links%rowtype;k text;ready boolean;
begin
 if current_setting('role',true) is distinct from 'authenticated' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select generation into gen from private.instagram_company_generations where company_id=p_company_id for share nowait;
 if not found then gen:=0;end if;
 select * into l from private.instagram_company_links where company_id=p_company_id and status='active';
 select status into k from private.instagram_oauth_attempts where company_id=p_company_id and generation=gen;
 ready:=exists(select 1 from private.instagram_provider_contracts where contract_id=p_contract_id and app_id=p_app_id and enabled
  and required_permissions @> array['instagram_business_basic','instagram_business_manage_messages']::text[]) and private.instagram_vault_ready();
 return jsonb_build_object('ok',true,'generation',gen,'link',case when l.id is null then null else jsonb_build_object('linkId',l.id,'accountId',l.account_id,'generation',l.generation) end,'attemptKind',k,'contractReady',ready);
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;

create function public.instagram_owner_attempt(p_company_id uuid,p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;sid uuid;a private.instagram_oauth_attempts%rowtype;
begin
 if current_setting('role',true) is distinct from 'authenticated' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into a from private.instagram_oauth_attempts where id=p_attempt_id and company_id=p_company_id and user_id=uid and session_id=sid;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- No token/stage receipt. The subsequent committed claim checks nonce, expiry,
 -- generation, enabled contract and fresh native authority before exchange.
 return jsonb_build_object('ok',true,'binding',private.instagram_attempt_binding(a));
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;

create function public.instagram_disconnect_connection(p_company_id uuid,p_link_id uuid,p_expected_generation bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;sid uuid;gen bigint;l private.instagram_company_links%rowtype;
begin
 if current_setting('role',true) is distinct from 'authenticated' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_link_id is null or p_expected_generation is null or p_expected_generation<0 or p_expected_generation>=9007199254740991 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select generation into gen from private.instagram_company_generations where company_id=p_company_id for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into l from private.instagram_company_links where id=p_link_id and company_id=p_company_id for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not private.instagram_owner_lock(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- Exact retired-link replay acknowledges its history, never a later binding.
 if l.status='retired' then return jsonb_build_object('ok',true,'linkId',l.id,'generation',gen);end if;
 -- A pending reauthorization may already have advanced the company generation.
 -- Compare the observed company generation, not the older active-link generation.
 if gen<>p_expected_generation then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if gen>=9007199254740990 then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 -- Same account-lock namespace as finalization, without waiting for provider work.
 if not pg_try_advisory_xact_lock(87420106,hashtext(l.account_id)) then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 update private.instagram_company_generations set generation=gen+1 where company_id=p_company_id;
 update private.instagram_oauth_attempts set status='cancelled' where company_id=p_company_id and status in ('pending','claimed','vault_staged');
 update private.instagram_company_links set status='retired' where id=l.id;
 perform private.write_admin_audit(uid,p_company_id,'instagram.connection_disconnected',null,jsonb_build_object('linkId',l.id,'generation',gen+1));
 -- Time can advance during storage/audit work even while authority rows are
 -- locked. Raise within this block so expiry rolls back every write and audit.
 if not private.instagram_owner_lock(p_company_id,uid,sid) then raise exception 'INSTAGRAM_FORBIDDEN' using errcode='42501';end if;
 -- History/Vault references remain. An already-dispatched provider call cannot
 -- be recalled; all later claims/secret reads reject the retired generation.
 return jsonb_build_object('ok',true,'linkId',l.id,'generation',gen+1);
exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
 when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
end;$$;

-- Preserve the existing start RPC and ACL; add its atomic reconnect gate.
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
 select generation into gen from private.instagram_company_generations where company_id=p_company_id for update;
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
 update private.instagram_oauth_attempts set status='cancelled' where company_id=p_company_id and status in ('pending','claimed','vault_staged');
 update private.instagram_company_generations set generation=gen+1 where company_id=p_company_id;
 insert into private.instagram_oauth_attempts(id,company_id,user_id,session_id,generation,app_id,contract_id,nonce_hash,expires_at)
 values(p_attempt_id,p_company_id,uid,sid,gen+1,p_app_id,p_contract_id,p_nonce_hash,clock_timestamp()+interval '10 minutes') returning * into a;
 perform private.instagram_audit(a,'instagram.connection_started');
 return jsonb_build_object('ok',true,'binding',private.instagram_attempt_binding(a),'expiresAt',a.expires_at);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
 when unique_violation then return jsonb_build_object('ok',false,'code','CONSUMED');
end;$$;

revoke all on function public.instagram_owner_connection(uuid,text,text),public.instagram_owner_attempt(uuid,uuid),public.instagram_disconnect_connection(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.instagram_owner_connection(uuid,text,text),public.instagram_owner_attempt(uuid,uuid),public.instagram_disconnect_connection(uuid,uuid,bigint) to authenticated;
commit;
