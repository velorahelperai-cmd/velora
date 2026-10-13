-- PROPOSED ONLY. No provider contract, proof, token, rollout or permission seed.
-- Primary contract reviewed 2026-10-13: Meta webhook setup (2026-09-16), fields
-- (2026-09-23). Instagram Login, graph.instagram.com/v26.0, messages only,
-- Instagram User token, POST subscribed_apps, exact {"success":true}.
-- https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
-- https://developers.facebook.com/documentation/instagram-platform/webhooks/fields
begin;
create table private.instagram_subscription_attempts(
 attempt_id uuid primary key references private.instagram_oauth_attempts(id),
 stage_receipt uuid not null,account_id text not null check(account_id ~ '^[0-9]{1,64}$'),
 app_id text not null,generation bigint not null,
 fields text[] not null check(fields=array['messages']::text[]),
 state text not null check(state in ('claimed','verified','rejected','unknown')),
 claim_receipt uuid not null unique,claimed_at timestamptz not null,
 settled_at timestamptz,
 check((state='claimed')=(settled_at is null))
);
alter table private.instagram_subscription_attempts enable row level security;
revoke all on private.instagram_subscription_attempts from public,anon,authenticated,service_role;

create function private.instagram_subscription_progress(a private.instagram_oauth_attempts,s private.instagram_subscription_attempts) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('binding',private.instagram_attempt_binding(a),'stageReceipt',a.stage_receipt,
 'accountId',a.account_id,'fields',array['messages']::text[],'state',coalesce(s.state,'unstarted'))
$$;
create function private.instagram_subscription_stage(b jsonb,receipt uuid) returns private.instagram_oauth_attempts
language plpgsql volatile security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;begin
 a:=private.instagram_locked_attempt(b,true);
 if a.status='expired' then raise exception 'EXPIRED' using errcode='PIG01';end if;
 if a.status not in ('vault_staged','bound') or receipt is null or a.stage_receipt is distinct from receipt
  or a.account_id is null or a.account_id !~ '^[0-9]{1,64}$' or a.authorization_expires_at<=clock_timestamp()
  or not array['instagram_business_basic','instagram_business_manage_messages']::text[]<@a.permissions then
  raise insufficient_privilege;
 end if;
 return a;
end;$$;
create function public.instagram_read_subscription(p_binding jsonb,p_stage_receipt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;s private.instagram_subscription_attempts%rowtype;begin
 a:=private.instagram_subscription_stage(p_binding,p_stage_receipt);
 select * into s from private.instagram_subscription_attempts where attempt_id=a.id;
 if found and (s.stage_receipt is distinct from a.stage_receipt or s.account_id is distinct from a.account_id
  or s.app_id is distinct from a.app_id or s.generation is distinct from a.generation or s.fields is distinct from array['messages']::text[]) then raise insufficient_privilege;end if;
 return private.instagram_subscription_progress(a,s);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when sqlstate 'PIG01' then return jsonb_build_object('ok',false,'code','EXPIRED');
 when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;

create function public.instagram_claim_subscription(p_binding jsonb,p_stage_receipt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;s private.instagram_subscription_attempts%rowtype;token text;deadline timestamptz;begin
 a:=private.instagram_subscription_stage(p_binding,p_stage_receipt);
 select * into s from private.instagram_subscription_attempts where attempt_id=a.id;
 if found then
  if s.stage_receipt is distinct from a.stage_receipt or s.account_id is distinct from a.account_id
   or s.app_id is distinct from a.app_id or s.generation is distinct from a.generation or s.fields is distinct from array['messages']::text[] then raise insufficient_privilege;end if;
  return private.instagram_subscription_progress(a,s)||jsonb_build_object('kind','existing');
 end if;
 if a.status<>'vault_staged' then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 if not private.instagram_vault_ready() then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into token using a.secret_id;
 if token is null or btrim(token)='' or octet_length(token)>16384 then return jsonb_build_object('ok',false,'code','RECONCILIATION_REQUIRED');end if;
 -- Recheck time-based authority after Vault I/O. No token before durable claim.
 if not private.instagram_owner_lock(a.company_id,a.user_id,a.session_id) then raise insufficient_privilege;end if;
 if a.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 if a.authorization_expires_at<=clock_timestamp() then raise insufficient_privilege;end if;
 deadline:=least(a.expires_at,a.authorization_expires_at,clock_timestamp()+interval '10 seconds');
 insert into private.instagram_subscription_attempts(attempt_id,stage_receipt,account_id,app_id,generation,fields,state,claim_receipt,claimed_at)
 values(a.id,a.stage_receipt,a.account_id,a.app_id,a.generation,array['messages']::text[],'claimed',gen_random_uuid(),clock_timestamp()) returning * into s;
 perform private.instagram_audit(a,'instagram.subscription_claimed');
 -- PostgREST POST response resolves only after commit. SERVER INTERNAL token.
 return private.instagram_subscription_progress(a,s)||jsonb_build_object('kind','claimed','committed',true,
  'claimReceipt',s.claim_receipt,'accessToken',token,'notAfter',deadline);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when sqlstate 'PIG01' then return jsonb_build_object('ok',false,'code','EXPIRED');
 when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;

create function public.instagram_settle_subscription(p_binding jsonb,p_stage_receipt uuid,p_claim_receipt uuid,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.instagram_oauth_attempts%rowtype;s private.instagram_subscription_attempts%rowtype;begin
 a:=private.instagram_subscription_stage(p_binding,p_stage_receipt);
 if p_outcome is null or p_outcome not in ('verified','rejected','unknown') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into s from private.instagram_subscription_attempts where attempt_id=a.id for update;
 if not found or p_claim_receipt is null or s.claim_receipt is distinct from p_claim_receipt
  or s.stage_receipt is distinct from a.stage_receipt or s.account_id is distinct from a.account_id
  or s.app_id is distinct from a.app_id or s.generation is distinct from a.generation
  or s.fields is distinct from array['messages']::text[] then raise insufficient_privilege;end if;
 if s.state='claimed' then
  update private.instagram_subscription_attempts set state=p_outcome,settled_at=clock_timestamp()
   where attempt_id=a.id and state='claimed' returning * into s;
  perform private.instagram_audit(a,'instagram.subscription_settled');
 end if;
 return private.instagram_subscription_progress(a,s);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when sqlstate 'PIG01' then return jsonb_build_object('ok',false,'code','EXPIRED');
 when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;

-- Existing bound replay is historical acknowledgement. Every newly activated link
-- requires this attempt's exact durable provider-subscription success checkpoint.
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
 update private.instagram_company_links set status='retired' where company_id=a.company_id and status='active';
 insert into private.instagram_company_links(company_id,generation,attempt_id,account_id,app_id,contract_id,secret_id,permissions,authorization_expires_at)
 values(a.company_id,a.generation,a.id,a.account_id,a.app_id,a.contract_id,a.secret_id,a.permissions,a.authorization_expires_at) returning id into link;
 update private.instagram_oauth_attempts set status='bound',link_id=link,bound_at=clock_timestamp() where id=a.id returning * into a;
 perform private.instagram_audit(a,'instagram.connection_bound');return jsonb_build_object('ok',true,'linkId',a.link_id);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');when unique_violation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;$$;

alter function private.instagram_subscription_progress(private.instagram_oauth_attempts,private.instagram_subscription_attempts) owner to postgres;
alter function private.instagram_subscription_stage(jsonb,uuid) owner to postgres;
alter function public.instagram_read_subscription(jsonb,uuid) owner to postgres;
alter function public.instagram_claim_subscription(jsonb,uuid) owner to postgres;
alter function public.instagram_settle_subscription(jsonb,uuid,uuid,text) owner to postgres;
revoke all on function private.instagram_subscription_progress(private.instagram_oauth_attempts,private.instagram_subscription_attempts),private.instagram_subscription_stage(jsonb,uuid),public.instagram_read_subscription(jsonb,uuid),public.instagram_claim_subscription(jsonb,uuid),public.instagram_settle_subscription(jsonb,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.instagram_read_subscription(jsonb,uuid),public.instagram_claim_subscription(jsonb,uuid),public.instagram_settle_subscription(jsonb,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
