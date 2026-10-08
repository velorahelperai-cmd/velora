-- CLI-created forward migration, ordered after Meta policy. Existing knowledge,
-- billing and AI ledgers remain the only sources of truth. No rollout activation.
begin;

alter table public.knowledge_sources add column usage_role text not null default 'knowledge'
  check (usage_role in ('knowledge','business_instructions'));
comment on column public.knowledge_sources.usage_role is
  'Approved source purpose. Business instructions are lower-trust context and never system policy.';
grant insert(usage_role),update(usage_role) on public.knowledge_sources to authenticated;

-- Run after the existing version/approval trigger. A simultaneous body+role edit
-- increments once; changing purpose alone invalidates its old approval too.
create function private.knowledge_sources_usage_role_approval() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if new.usage_role is distinct from old.usage_role then
  new.content_version:=greatest(new.content_version,old.content_version+1);
  new.approved_for_answers:=false;new.approved_version:=null;new.approved_at:=null;new.approved_by:=null;
 end if;
 return new;
end; $$;
revoke all on function private.knowledge_sources_usage_role_approval() from public,anon,authenticated,service_role;
create trigger knowledge_sources_z_usage_role_approval before update on public.knowledge_sources
 for each row execute function private.knowledge_sources_usage_role_approval();

create index knowledge_sources_approved_fts_idx on public.knowledge_sources
 using gin(to_tsvector('simple'::regconfig,title||' '||content))
 where status='ready' and approved_for_answers and approved_version=content_version;

create function private.whatsapp_answer_profile(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs%rowtype;s public.billing_subscriptions%rowtype;proof jsonb;gate jsonb;plan_code text;persona text;
begin
 gate:=private.whatsapp_job_service_window(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);
 if j.id is null then return jsonb_build_object('ok',false,'code','claim_or_automation_rejected');end if;
 select * into s from public.billing_subscriptions where company_id=j.company_id and environment='live';
 if not found or s.status not in ('active','cancel_at_period_end') or s.paid_through is null
 or s.paid_through<=clock_timestamp() or s.plan_version_id is null
 then return jsonb_build_object('ok',false,'code','subscription_inactive');end if;
 proof:=public.billing_read_company_operational_entitlement(j.company_id);
 if proof->>'ok' is distinct from 'true' or proof->>'active' is distinct from 'true' or proof->>'environment' is distinct from 'live'
 or proof->>'plan_version_id' is distinct from s.plan_version_id::text
 or (proof->>'paid_through')::timestamptz is distinct from s.paid_through
 then return jsonb_build_object('ok',false,'code','subscription_inactive');end if;
 select p.code into plan_code from public.billing_plan_versions v join public.billing_plans p on p.id=v.plan_id
 where v.id=s.plan_version_id and v.status in ('published','retired') for share of v,p;
 persona:=case plan_code when 'noor_basic' then 'noura' when 'noor_premium' then 'noura'
 when 'lina_basic' then 'lina' when 'lina_premium' then 'lina' when 'dana_basic' then 'dana' when 'dana_premium' then 'dana' end;
 if persona is null then return jsonb_build_object('ok',false,'code','canonical_paid_plan_required');end if;
 return jsonb_build_object('ok',true,'company_id',j.company_id,'job_id',j.id,'plan_version_id',s.plan_version_id,'plan_code',plan_code,'persona',persona);
end; $$;
revoke all on function private.whatsapp_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;

create function public.whatsapp_read_answer_profile(p_company_id uuid,p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare r jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 r:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if r->>'ok'='true' and r->>'company_id' is distinct from p_company_id::text
 then return jsonb_build_object('ok',false,'code','company_binding_rejected');end if;
 return r;
end; $$;

-- Pure lexical retrieval: OR the normalized search lexemes, using the simple
-- multilingual dictionary. No embeddings, provider calls or hidden source cuts.
-- Selection is one bounded locked database query, at most 41 full rows. Returning
-- every relevant complete source avoids dropping a contradictory price/policy.
create function public.whatsapp_retrieve_approved_knowledge(p_company_id uuid,p_job_id uuid,p_claim_token uuid,p_question text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb;j public.whatsapp_inbound_jobs%rowtype;question text;query_text text;q tsquery;ids uuid[];n integer;chars bigint;knowledge_count integer;sources jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 gate:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 if gate->>'company_id' is distinct from p_company_id::text then return jsonb_build_object('ok',false,'code','company_binding_rejected');end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=p_company_id;
 select m.body into question from public.whatsapp_messages m where m.id=j.message_id and m.company_id=p_company_id
 and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer';
 if p_question is null or p_question is distinct from question or length(btrim(p_question))=0 or length(p_question)>1000
 then return jsonb_build_object('ok',false,'code','question_binding_rejected');end if;
 select string_agg(quote_literal(word),' | ' order by word) into query_text
 from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,p_question))) as tokens(word)
 where length(word)>1 and word<>all(array['a','an','the','is','are','was','were','do','does','did','how','what','when','where','which','who','why','can','could','would','please','me','my','your','you','it','its','to','for','of','in','on','at','and','or','about','have','has','هل','ما','ماذا','كيف','متى','وين','أين','من','في','على','عن','هذا','هذه','هو','هي','أنا','انا','لو','سمحت','ممكن','ابغى','أريد','اريد','عندكم','عندك']);
 if query_text is null then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 q:=to_tsquery('simple'::regconfig,query_text);
 with selected as materialized (
  select k.id,k.usage_role,length(k.title)+length(btrim(k.content))+5 as block_chars
  from public.knowledge_sources k where k.company_id=p_company_id and k.status='ready' and k.approved_for_answers
  and k.approved_version=k.content_version and length(btrim(k.content))>0
  and (k.usage_role='business_instructions' or to_tsvector('simple'::regconfig,k.title||' '||k.content)@@q)
  order by k.usage_role,k.id limit 41 for share of k
 ) select array_agg(id),count(*)::integer,coalesce(sum(block_chars),0)+greatest(count(*)-1,0)*2,
  count(*) filter(where usage_role='knowledge')::integer into ids,n,chars,knowledge_count from selected;
 if n>40 or chars>12000 then return jsonb_build_object('ok',false,'code','CONTEXT_OVERFLOW');end if;
 if knowledge_count=0 then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 select jsonb_agg(jsonb_build_object('id',k.id,'company_id',k.company_id,'title',k.title,'content',k.content,
  'content_version',k.content_version,'approved_version',k.approved_version,'approved_for_answers',k.approved_for_answers,
  'status',k.status,'kind',k.kind,'storage_path',k.storage_path,'byte_size',k.byte_size,'updated_at',k.updated_at,'usage_role',k.usage_role)
  order by k.usage_role,k.id) into sources from public.knowledge_sources k where k.id=any(ids) and k.company_id=p_company_id;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'job_id',p_job_id,'sources',sources,'context_chars',chars);
end; $$;

alter table public.ai_usage_ledger add column answer_persona text,
 add column answer_plan_version_id uuid references public.billing_plan_versions(id) on delete restrict;
alter table public.ai_usage_ledger add constraint ai_answer_profile_snapshot_pair check (
 (answer_persona is null and answer_plan_version_id is null)
 or (answer_persona in ('noura','lina','dana') and answer_persona is not null and answer_plan_version_id is not null and worker_job_id is not null));
grant select(answer_persona,answer_plan_version_id) on public.ai_usage_ledger to authenticated;

-- Legacy rows remain null and cannot dispatch. Only atomic reservation may bind
-- once; later settlement cannot replace or clear the plan/persona evidence.
create function private.ai_answer_profile_binding_guard() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if tg_op='INSERT' then new.answer_persona:=null;new.answer_plan_version_id:=null;return new;end if;
 if row(new.answer_persona,new.answer_plan_version_id) is distinct from row(old.answer_persona,old.answer_plan_version_id)
 and not (old.answer_persona is null and old.answer_plan_version_id is null and new.answer_persona is not null
 and new.answer_plan_version_id is not null and new.worker_job_id is not null and new.status='reserved'
 and coalesce(current_setting('velora.answer_profile_binding',true),'')='1')
 then raise exception 'ANSWER_PROFILE_BINDING_IMMUTABLE' using errcode='23514';end if;
 return new;
end; $$;
revoke all on function private.ai_answer_profile_binding_guard() from public,anon,authenticated,service_role;
create trigger ai_answer_profile_binding_guard before insert or update on public.ai_usage_ledger
 for each row execute function private.ai_answer_profile_binding_guard();

create function private.whatsapp_citations_include_current_instructions(p_company_id uuid,p_citations jsonb) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.knowledge_sources k where k.company_id=p_company_id and k.usage_role='business_instructions'
 and k.status='ready' and k.approved_for_answers and k.approved_version=k.content_version and length(btrim(k.content))>0) then return true;end if;
 if jsonb_typeof(p_citations) is distinct from 'array' then return false;end if;
 return not exists(select 1 from public.knowledge_sources k where k.company_id=p_company_id and k.usage_role='business_instructions'
 and k.status='ready' and k.approved_for_answers and k.approved_version=k.content_version and length(btrim(k.content))>0
 and not exists(select 1 from jsonb_array_elements(p_citations) x where x->>'sourceId'=k.id::text
 and x->>'contentVersion'=k.content_version::text and x->>'title'=k.title));
end; $$;
revoke all on function private.whatsapp_citations_include_current_instructions(uuid,jsonb) from public,anon,authenticated,service_role;

-- Chain policy143000's window/authorization wrappers. Never bypass its guards.
alter function public.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) set schema private;
alter function private.ai_reserve_whatsapp_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) rename to wa_ai_reserve_pre_answer_profile;
revoke all on function private.wa_ai_reserve_pre_answer_profile(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.ai_reserve_whatsapp_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$ declare profile jsonb;r jsonb;bound uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 profile:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if profile->>'ok' is distinct from 'true' then return profile;end if;
 if not private.whatsapp_citations_include_current_instructions((profile->>'company_id')::uuid,p_source_citations)
 then return jsonb_build_object('ok',false,'code','KNOWLEDGE_CHANGED');end if;
 r:=private.wa_ai_reserve_pre_answer_profile(p_id,p_job_id,p_claim_token,p_attempt,p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
 if r->>'ok' is distinct from 'true' then return r;end if;
 perform set_config('velora.answer_profile_binding','1',true);
 update public.ai_usage_ledger set answer_persona=profile->>'persona',answer_plan_version_id=(profile->>'plan_version_id')::uuid
 where id=p_id and worker_job_id=p_job_id and worker_claim_token=p_claim_token and company_id=(profile->>'company_id')::uuid
 and status='reserved' and answer_persona is null and answer_plan_version_id is null returning id into bound;
 perform set_config('velora.answer_profile_binding','0',true);
 if bound is null then raise exception 'ANSWER_PROFILE_BINDING_FAILED';end if;
 return r||jsonb_build_object('answer_persona',profile->>'persona','answer_plan_version_id',profile->>'plan_version_id');
end; $$;

-- The pre-read system persona must agree with the atomic reservation snapshot.
create function public.ai_reserve_whatsapp_profile_attempt(p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,
 p_model_id text,p_provider text,p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb,
 p_expected_persona text,p_expected_plan_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ declare profile jsonb;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 profile:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if profile->>'ok' is distinct from 'true' then return profile;end if;
 if p_expected_persona is null or p_expected_plan_version_id is null or profile->>'persona' is distinct from p_expected_persona
 or profile->>'plan_version_id' is distinct from p_expected_plan_version_id::text
 then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return public.ai_reserve_whatsapp_attempt(p_id,p_job_id,p_claim_token,p_attempt,p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
end; $$;

create function private.whatsapp_attempt_profile_current(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$ declare a public.ai_usage_ledger%rowtype;profile jsonb;begin
 select * into a from public.ai_usage_ledger where id=p_id;
 if not found or a.worker_job_id is null or a.answer_persona is null or a.answer_plan_version_id is null then return false;end if;
 -- Reserved/running execution remains bound to its original lease. A settled
 -- successful draft may be recovered with a new live lease, never a new AI call.
 if a.status<>'success' and a.worker_claim_token is distinct from p_claim_token then return false;end if;
 profile:=private.whatsapp_answer_profile(a.worker_job_id,p_claim_token);
 if profile->>'ok' is distinct from 'true' or profile->>'company_id' is distinct from a.company_id::text
 or profile->>'persona' is distinct from a.answer_persona or profile->>'plan_version_id' is distinct from a.answer_plan_version_id::text
 then return false;end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs where id=a.worker_job_id and company_id=a.company_id
 and expected_automation_generation=a.automation_generation) then return false;end if;
 if not private.whatsapp_citations_include_current_instructions(a.company_id,a.source_citations) then return false;end if;
 perform 1 from public.ai_usage_ledger where id=a.id and answer_persona=a.answer_persona and answer_plan_version_id=a.answer_plan_version_id
 and worker_claim_token=a.worker_claim_token and status=a.status for update;
 return found;
end; $$;
revoke all on function private.whatsapp_attempt_profile_current(uuid,uuid) from public,anon,authenticated,service_role;

alter function public.ai_start_whatsapp_attempt(uuid,uuid) set schema private;
alter function private.ai_start_whatsapp_attempt(uuid,uuid) rename to wa_ai_start_pre_answer_profile;
revoke all on function private.wa_ai_start_pre_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;
create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if not private.whatsapp_attempt_profile_current(p_id,p_claim_token) then return false;end if;
 return private.wa_ai_start_pre_answer_profile(p_id,p_claim_token);
end; $$;

-- An already paid draft cannot be sent under a changed plan/persona either.
alter function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) set schema private;
alter function private.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) rename to wa_stage_pre_answer_profile;
revoke all on function private.wa_stage_pre_answer_profile(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.whatsapp_stage_job_reply(p_job_id uuid,p_claim_token uuid,p_ai_attempt_id uuid,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from public.ai_usage_ledger where id=p_ai_attempt_id and worker_job_id=p_job_id)
 or not private.whatsapp_attempt_profile_current(p_ai_attempt_id,p_claim_token)
 then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return private.wa_stage_pre_answer_profile(p_job_id,p_claim_token,p_ai_attempt_id,p_citations);
end; $$;

alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) set schema private;
alter function private.whatsapp_claim_assistant_job_send(uuid,uuid) rename to wa_send_pre_answer_profile;
revoke all on function private.wa_send_pre_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_claim_assistant_job_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare attempt uuid;begin
 if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501';end if;
 select staged_ai_attempt_id into attempt from public.whatsapp_inbound_jobs where id=p_job_id;
 if attempt is null or not private.whatsapp_attempt_profile_current(attempt,p_claim_token)
 then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return private.wa_send_pre_answer_profile(p_job_id,p_claim_token);
end; $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('whatsapp_read_answer_profile','whatsapp_retrieve_approved_knowledge',
 'ai_reserve_whatsapp_attempt','ai_reserve_whatsapp_profile_attempt','ai_start_whatsapp_attempt','whatsapp_stage_job_reply','whatsapp_claim_assistant_job_send') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;
end; $$;
notify pgrst,'reload schema';
commit;
