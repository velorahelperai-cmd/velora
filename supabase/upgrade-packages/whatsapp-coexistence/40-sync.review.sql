-- OPTIONAL REVIEW PACKAGE. Requires 20-signup and 30-projection. Not applied here.
-- Deliberate owner consent only; each company/link/generation/type is sticky once.
-- No HTTP, AI jobs, registration, deregistration, retries or auto-resume in SQL.
begin;
do $$ begin
 if to_regclass('private.whatsapp_coexistence_connections') is null
 or to_regclass('private.whatsapp_coexistence_events') is null
 or to_regprocedure('private.whatsapp_signup_owner_valid(uuid,uuid,uuid)') is null
 or to_regclass('vault.decrypted_secrets') is null then
  raise exception 'COEXISTENCE_SYNC_PREREQUISITES_MISSING';
 end if;
end; $$;

create table private.whatsapp_coexistence_sync_requests(
 id uuid primary key,
 company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null,session_id uuid not null,
 link_id uuid not null,link_generation bigint not null check(link_generation>=1),
 sync_type text not null check(sync_type in ('history','smb_app_state_sync')),
 app_id text not null,graph_version text not null,
 phone_number_id text not null check(phone_number_id ~ '^[0-9]{1,64}$'),
 signup_attempt_id uuid not null references private.whatsapp_coexistence_signup_attempts(id),
 onboarded_at timestamptz not null,deadline_at timestamptz not null,
 stage text not null default 'claimed' check(stage in ('claimed','executing','requested','reconcile_required')),
 consented_at timestamptz not null default clock_timestamp(),executing_at timestamptz,requested_at timestamptz,
 provider_request_id text check(provider_request_id is null or (length(provider_request_id) between 1 and 512 and provider_request_id !~ '[[:space:][:cntrl:]]')),
 unique(company_id,link_id,link_generation,sync_type),
 foreign key(company_id,link_id) references public.whatsapp_company_links(company_id,id),
 check(isfinite(onboarded_at) and isfinite(deadline_at) and deadline_at>onboarded_at and deadline_at<=onboarded_at+interval '24 hours'),
 check((provider_request_id is null)=(requested_at is null)),
 check(stage<>'requested' or provider_request_id is not null)
);
alter table private.whatsapp_coexistence_sync_requests enable row level security;
revoke all on private.whatsapp_coexistence_sync_requests from public,anon,authenticated,service_role;
comment on table private.whatsapp_coexistence_sync_requests is
 'Sticky owner/native-session-bound consent and execution fence. A lost claim/credential/write/finalization response never releases the unique sync slot. No plaintext token. Provider request ID means requested, not completed.';

-- Every credential retrieval rechecks the request's current native owner/session
-- and exact current coexistence link/asset generation. Cached scopes originate only
-- from 20's independently verified token/WABA proof; no client grant is accepted.
create function private.whatsapp_coexistence_sync_gate(p_company_id uuid,p_user_id uuid,p_session_id uuid,p_link_id uuid,p_generation bigint,p_app_id text,p_graph_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.whatsapp_company_links%rowtype;c private.whatsapp_coexistence_connections%rowtype;a private.whatsapp_coexistence_signup_attempts%rowtype;begin
 if not private.whatsapp_signup_owner_valid(p_company_id,p_user_id,p_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into l from public.whatsapp_company_links where company_id=p_company_id and id=p_link_id for share;
 select * into c from private.whatsapp_coexistence_connections where company_id=p_company_id;
 if l.id is null or c.company_id is null or l.generation is distinct from p_generation
 or c.link_id is distinct from l.id or c.link_generation is distinct from l.generation
 or c.status<>'active' or c.ai_enabled or l.keep_on_phone is distinct from true
 or l.status<>'verified' or l.authorization_status<>'active'
 or l.authorization_user_id is distinct from p_user_id or l.authorization_session_id is null
 or l.authorization_app_id is distinct from p_app_id or l.authorization_verified_at is null or l.authorization_verified_at>clock_timestamp()
 or l.provider_waba_id is distinct from c.waba_id or l.provider_phone_number_id is distinct from c.phone_number_id
 or l.access_secret_id is null or not coalesce(l.authorization_scopes @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb,false)
 or not coalesce(l.authorization_expires_at>clock_timestamp() or (l.authorization_expires_at is null and l.authorization_non_expiring),false)
 or exists(select 1 from private.whatsapp_meta_authorization_revocations r where r.waba_id=l.provider_waba_id and r.occurred_at>=l.authorization_verified_at)
 then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;
 select * into a from private.whatsapp_coexistence_signup_attempts where company_id=p_company_id and status='completed'
 and user_id=p_user_id and session_id=l.authorization_session_id and app_id=p_app_id and graph_version=p_graph_version
 and finalized_link_id=l.id and finalized_link_generation=l.generation
 and expected_phone_number=c.expected_phone_number and created_at<=c.linked_at and created_at<=l.authorization_verified_at
 order by created_at desc,id desc limit 1;
 if a.id is null then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;
 -- Start-of-attempt predates actual onboarding. It conservatively shortens the
 -- documented window instead of granting 24 more hours after local finalization.
 if a.created_at>clock_timestamp() or a.created_at+interval '24 hours'<=clock_timestamp() then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 return jsonb_build_object('ok',true,'signup_attempt_id',a.id,'onboarded_at',a.created_at,'deadline_at',a.created_at+interval '24 hours',
  'phone_number_id',l.provider_phone_number_id,'authorization_expires_at',l.authorization_expires_at,'authorization_non_expiring',l.authorization_non_expiring);
end; $$;
revoke all on function private.whatsapp_coexistence_sync_gate(uuid,uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;

create function private.whatsapp_coexistence_sync_public(p_row private.whatsapp_coexistence_sync_requests)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('ok',true,'request_id',p_row.id,'company_id',p_row.company_id,'user_id',p_row.user_id,'session_id',p_row.session_id,
  'link_id',p_row.link_id,'link_generation',p_row.link_generation,'sync_type',p_row.sync_type,'app_id',p_row.app_id,'graph_version',p_row.graph_version,
  'stage',p_row.stage,'onboarded_at',p_row.onboarded_at,'deadline_at',p_row.deadline_at,'provider_request_id',p_row.provider_request_id);
$$;
revoke all on function private.whatsapp_coexistence_sync_public(private.whatsapp_coexistence_sync_requests) from public,anon,authenticated,service_role;

create function public.whatsapp_coexistence_sync_readiness(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ declare sid uuid;f text;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 foreach f in array array['public.whatsapp_coexistence_claim_sync(uuid,uuid,uuid,bigint,text,boolean,text,text)',
  'public.whatsapp_coexistence_authorize_sync(uuid,uuid,uuid)','public.whatsapp_coexistence_finalize_sync(uuid,uuid,uuid,text)',
  'public.whatsapp_coexistence_fail_sync(uuid,uuid,uuid)','public.whatsapp_coexistence_read_sync_status(uuid)'] loop
  if to_regprocedure(f) is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 end loop;
 if to_regclass('vault.decrypted_secrets') is null then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'version','coexistence_sync_v1','owner_requested_only',true,'once_only',true,'ai_enabled',false);
end; $$;

create function public.whatsapp_coexistence_claim_sync(p_company_id uuid,p_request_id uuid,p_link_id uuid,p_link_generation bigint,p_sync_type text,p_consent boolean,p_app_id text,p_graph_version text)
returns jsonb language plpgsql security definer set search_path='' as $$ declare sid uuid;g jsonb;r private.whatsapp_coexistence_sync_requests%rowtype;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 perform 1 from public.companies where id=p_company_id for update;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_request_id is null or p_link_id is null or p_link_generation is null or p_link_generation<1 or p_consent is distinct from true
 or p_sync_type is null or p_sync_type not in ('history','smb_app_state_sync') or coalesce(p_app_id,'')!~'^[0-9]{1,64}$'
 or coalesce(p_graph_version,'')!~'^v[0-9]+\.0$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if public.whatsapp_coexistence_sync_readiness(p_company_id)->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false,'code','NEEDS_SETUP');end if;
 g:=private.whatsapp_coexistence_sync_gate(p_company_id,auth.uid(),sid,p_link_id,p_link_generation,p_app_id,p_graph_version);
 if g->>'ok' is distinct from 'true' then return g;end if;
 insert into private.whatsapp_coexistence_sync_requests(id,company_id,user_id,session_id,link_id,link_generation,sync_type,app_id,graph_version,phone_number_id,signup_attempt_id,onboarded_at,deadline_at)
 values(p_request_id,p_company_id,auth.uid(),sid,p_link_id,p_link_generation,p_sync_type,p_app_id,p_graph_version,g->>'phone_number_id',(g->>'signup_attempt_id')::uuid,(g->>'onboarded_at')::timestamptz,(g->>'deadline_at')::timestamptz)
 on conflict do nothing returning * into r;
 if not found then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 return private.whatsapp_coexistence_sync_public(r);
end; $$;

create function public.whatsapp_coexistence_authorize_sync(p_request_id uuid,p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.whatsapp_coexistence_sync_requests%rowtype;g jsonb;token text;secret_id uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select * into r from private.whatsapp_coexistence_sync_requests where id=p_request_id and user_id=p_user_id and session_id=p_session_id;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies where id=r.company_id for update;
 -- Lock order matches signup/disconnect: company, link, request.
 g:=private.whatsapp_coexistence_sync_gate(r.company_id,p_user_id,p_session_id,r.link_id,r.link_generation,r.app_id,r.graph_version);
 if g->>'ok' is distinct from 'true' then return g;end if;
 select * into r from private.whatsapp_coexistence_sync_requests where id=p_request_id for update;
 if r.stage<>'claimed' then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 if r.deadline_at<=clock_timestamp() or r.signup_attempt_id::text is distinct from g->>'signup_attempt_id'
 or r.phone_number_id is distinct from g->>'phone_number_id' then return jsonb_build_object('ok',false,'code','EXPIRED');end if;
 select access_secret_id into secret_id from public.whatsapp_company_links where id=r.link_id and company_id=r.company_id and generation=r.link_generation;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into token using secret_id;
 if token is null or nullif(btrim(token),'') is null or length(token)>16384 then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;
 -- This commits before the service receives credentials. Lost return => sticky
 -- executing state, never another token retrieval or provider request.
 update private.whatsapp_coexistence_sync_requests set stage='executing',executing_at=clock_timestamp() where id=r.id returning * into r;
 return private.whatsapp_coexistence_sync_public(r)||jsonb_build_object('access_token',token,'phone_number_id',r.phone_number_id,
  'authorization_expires_at',g->'authorization_expires_at','authorization_non_expiring',g->'authorization_non_expiring');
end; $$;

create function public.whatsapp_coexistence_finalize_sync(p_request_id uuid,p_user_id uuid,p_session_id uuid,p_provider_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$ declare r private.whatsapp_coexistence_sync_requests%rowtype;g jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if p_provider_request_id is null or length(p_provider_request_id) not between 1 and 512 or p_provider_request_id ~ '[[:space:][:cntrl:]]' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into r from private.whatsapp_coexistence_sync_requests where id=p_request_id and user_id=p_user_id and session_id=p_session_id;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies where id=r.company_id for update;
 g:=private.whatsapp_coexistence_sync_gate(r.company_id,p_user_id,p_session_id,r.link_id,r.link_generation,r.app_id,r.graph_version);
 if g->>'ok' is distinct from 'true' then return g;end if;
 select * into r from private.whatsapp_coexistence_sync_requests where id=p_request_id for update;
 if r.stage<>'executing' or r.provider_request_id is not null then return jsonb_build_object('ok',false,'code','CONSUMED');end if;
 update private.whatsapp_coexistence_sync_requests set stage='requested',provider_request_id=p_provider_request_id,requested_at=clock_timestamp() where id=r.id returning * into r;
 if r.sync_type='history' then
  update private.whatsapp_coexistence_connections set history_sync_status='pending',updated_at=clock_timestamp()
  where company_id=r.company_id and link_id=r.link_id and link_generation=r.link_generation and history_sync_status='not_requested';
 end if;
 return private.whatsapp_coexistence_sync_public(r);
end; $$;

create function public.whatsapp_coexistence_fail_sync(p_request_id uuid,p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ declare cid uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select company_id into cid from private.whatsapp_coexistence_sync_requests where id=p_request_id and user_id=p_user_id and session_id=p_session_id;
 if cid is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies where id=cid for update;
 -- Exact original claim binding suffices to record uncertainty even after logout
 -- or revocation; no credential/data/authorization is granted by this marker.
 update private.whatsapp_coexistence_sync_requests set stage='reconcile_required' where id=p_request_id and user_id=p_user_id and session_id=p_session_id;
 return jsonb_build_object('ok',found);
end; $$;

create function public.whatsapp_coexistence_read_sync_status(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;c private.whatsapp_coexistence_connections%rowtype;r private.whatsapp_coexistence_sync_requests%rowtype;t text;s text;err integer;items jsonb:='[]'::jsonb;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 perform 1 from public.companies where id=p_company_id for share;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into c from private.whatsapp_coexistence_connections where company_id=p_company_id;
 if c.company_id is null then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;
 foreach t in array array['history','smb_app_state_sync'] loop
  select * into r from private.whatsapp_coexistence_sync_requests where company_id=p_company_id and link_id=c.link_id and link_generation=c.link_generation and sync_type=t;
  err:=null;
  if t='history' then
   select history_error_code into err from private.whatsapp_coexistence_events where company_id=p_company_id and link_id=c.link_id and link_generation=c.link_generation
   and kind='history_chunk' and history_error_code is not null order by (history_error_code=2593109) desc,stored_at,id limit 1;
   s:=case when err is not null then 'failed' when c.history_sync_status in ('completed','syncing','failed','reconcile_required') then c.history_sync_status
    when r.stage in ('claimed','executing','reconcile_required') then 'reconcile_required' when r.stage='requested' then 'pending' else 'not_requested' end;
  else
   s:=case when exists(select 1 from private.whatsapp_coexistence_events e where e.company_id=p_company_id and e.link_id=c.link_id and e.link_generation=c.link_generation and e.kind='contact' and e.projection_status<>'projected') then 'reconcile_required'
    when exists(select 1 from private.whatsapp_coexistence_events e where e.company_id=p_company_id and e.link_id=c.link_id and e.link_generation=c.link_generation and e.kind='contact') then 'syncing'
    when r.stage in ('claimed','executing','reconcile_required') then 'reconcile_required' when r.stage='requested' then 'pending' else 'not_requested' end;
  end if;
  -- Contacts have no documented terminal progress marker. Never infer completed.
  items:=items||jsonb_build_array(jsonb_build_object('sync_type',t,'state',s,'requested',r.provider_request_id is not null,'declined',coalesce(err=2593109,false),'error_code',err,'provider_request_id',r.provider_request_id));
 end loop;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'link_id',c.link_id,'link_generation',c.link_generation,'ai_enabled',false,'syncs',items);
end; $$;

do $$ declare f text;begin
 foreach f in array array['public.whatsapp_coexistence_sync_readiness(uuid)','public.whatsapp_coexistence_claim_sync(uuid,uuid,uuid,bigint,text,boolean,text,text)','public.whatsapp_coexistence_read_sync_status(uuid)'] loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);execute format('grant execute on function %s to authenticated',f);
 end loop;
 foreach f in array array['public.whatsapp_coexistence_authorize_sync(uuid,uuid,uuid)','public.whatsapp_coexistence_finalize_sync(uuid,uuid,uuid,text)','public.whatsapp_coexistence_fail_sync(uuid,uuid,uuid)'] loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);execute format('grant execute on function %s to service_role',f);
 end loop;
end; $$;
notify pgrst,'reload schema';
commit;
