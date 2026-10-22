-- LOCAL REVIEW ONLY. This fragment bridges existing worker APIs to verified
-- ES02 order authority without manufacturing a legacy plan/paid-through.
-- The enclosing installer must pin every renamed native function beforehand.
create function private.es02_job_scope(p_job uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.whatsapp_inbound_jobs j join private.es02_activation_foundation a on a.company_id=j.company_id where j.id=p_job);
$$;
alter function private.es02_job_scope(uuid) owner to postgres;
revoke all on function private.es02_job_scope(uuid) from public,anon,authenticated,service_role;

alter function private.whatsapp_answer_profile(uuid,uuid) rename to es02_pre_answer_profile;
revoke all on function private.es02_pre_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;
create function private.whatsapp_answer_profile(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;begin
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_answer_profile(p_job_id,p_claim_token);end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if g->>'ok' is distinct from 'true' then return g;end if;
 return jsonb_build_object('ok',true,'authority','es02','job_id',p_job_id,'company_id',g->'company_id','persona',g->'persona',
  'es02_order_id',g->'order_id','es02_branch_id',g->'branch_id','es02_slot_index',g->'slot_index','es02_paid_fingerprint',g->'paid_fingerprint');
end;$$;
alter function private.whatsapp_answer_profile(uuid,uuid) owner to postgres;
revoke all on function private.whatsapp_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;

alter function public.billing_load_worker_frame(uuid,uuid) set schema private;
alter function private.billing_load_worker_frame(uuid,uuid) rename to es02_pre_load_worker_frame;
revoke all on function private.es02_pre_load_worker_frame(uuid,uuid) from public,anon,authenticated,service_role;
create function public.billing_load_worker_frame(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;r jsonb;f jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_load_worker_frame(p_job_id,p_claim_token);end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if g->>'ok' is distinct from 'true' then return g;end if;
 -- Exact native projection only: its original-job/link checks remain. The old
 -- public entitlement wrapper cannot authorize this new ES02 order contract.
 r:=private.wa_frame_pre_meta_policy(p_job_id,p_claim_token);
 if r->>'ok' is distinct from 'true' then return r;end if;
 if r->'data'->>'ai_attempt_id' is not null and not exists(select 1 from public.ai_usage_ledger l
  where l.id=(r->'data'->>'ai_attempt_id')::uuid and l.worker_job_id=p_job_id and l.company_id=(g->>'company_id')::uuid
   and l.es02_order_id=(g->>'order_id')::uuid and l.es02_branch_id=(g->>'branch_id')::uuid and l.es02_slot_index=(g->>'slot_index')::integer
   and l.es02_paid_fingerprint=g->>'paid_fingerprint' and l.es02_persona=g->>'persona') then
  return jsonb_build_object('ok',false,'code','ES02_LEGACY_ATTEMPT_REVIEW');end if;
 f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if f->>'ok' is distinct from 'true' or f is distinct from g then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return jsonb_set(r,'{data}',r->'data'||jsonb_build_object('authority','es02'));
end;$$;
alter function public.billing_load_worker_frame(uuid,uuid) owner to postgres;
revoke all on function public.billing_load_worker_frame(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.billing_load_worker_frame(uuid,uuid) to service_role;

alter function public.whatsapp_reserve_job_usage(uuid,uuid) set schema private;
alter function private.whatsapp_reserve_job_usage(uuid,uuid) rename to es02_pre_reserve_job_usage;
revoke all on function private.es02_pre_reserve_job_usage(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_reserve_job_usage(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;j public.whatsapp_inbound_jobs;h private.es02_reply_credit_holds;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_reserve_job_usage(p_job_id,p_claim_token);end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if g->>'ok' is distinct from 'true' then return g;end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=(g->>'company_id')::uuid for update;
 select * into h from private.es02_reply_credit_holds where job_id=p_job_id and company_id=j.company_id for update;
 if h.job_id is null then return jsonb_build_object('ok',false,'code','CREDIT_RESERVATION_REQUIRED');end if;
 if h.state<>'held' or h.review_required or exists(select 1 from private.es02_reply_credit_holds where company_id=j.company_id and review_required) then
  return jsonb_build_object('ok',false,'code','CREDIT_RECONCILIATION_REQUIRED');end if;
 if h.order_group_id is distinct from (g->>'order_group_id')::uuid or j.usage_status is distinct from 'reserved'
  or j.usage_subscription_id is distinct from (g->>'subscription_id')::uuid or j.usage_period_start is distinct from (g->>'period_start')::timestamptz then
  return jsonb_build_object('ok',false,'code','USAGE_BINDING_CHANGED');end if;
 return jsonb_build_object('ok',true,'reused',true,'can_dispatch',false,'status','reserved');
end;$$;
alter function public.whatsapp_reserve_job_usage(uuid,uuid) owner to postgres;
revoke all on function public.whatsapp_reserve_job_usage(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_reserve_job_usage(uuid,uuid) to service_role;

alter function public.ai_start_whatsapp_attempt(uuid,uuid) set schema private;
alter function private.ai_start_whatsapp_attempt(uuid,uuid) rename to es02_pre_start_whatsapp_attempt;
revoke all on function private.es02_pre_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated,service_role;
create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if exists(select 1 from public.ai_usage_ledger where id=p_id and es02_order_id is not null) then
  return private.es02_start_whatsapp_attempt(p_id,p_claim_token);end if;
 return private.es02_pre_start_whatsapp_attempt(p_id,p_claim_token);
end;$$;
alter function public.ai_start_whatsapp_attempt(uuid,uuid) owner to postgres;
revoke all on function public.ai_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ai_start_whatsapp_attempt(uuid,uuid) to service_role;

create function private.es02_successful_worker_attempt(p_job uuid,p_claim uuid,p_attempt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;j public.whatsapp_inbound_jobs;a public.ai_usage_ledger;begin
 g:=private.es02_claimed_reply_authority(p_job,p_claim);if g->>'ok' is distinct from 'true' then return g;end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job and company_id=(g->>'company_id')::uuid for update;
 select * into a from public.ai_usage_ledger where id=p_attempt and company_id=j.company_id and worker_job_id=j.id for update;
 if not found or a.status<>'success' or a.response_text is null or length(btrim(a.response_text)) not between 1 and 4096
  or a.automation_generation is distinct from j.expected_automation_generation or a.usage_mode<>'company_live'
  or a.es02_order_id is distinct from (g->>'order_id')::uuid or a.es02_branch_id is distinct from (g->>'branch_id')::uuid
  or a.es02_slot_index is distinct from (g->>'slot_index')::integer or a.es02_paid_fingerprint is distinct from g->>'paid_fingerprint'
  or a.es02_persona is distinct from g->>'persona' or a.answer_persona is not null or a.answer_plan_version_id is not null then
  return jsonb_build_object('ok',false,'code','VERIFIED_ES02_REPLY_REQUIRED');end if;
 if j.usage_status is distinct from 'reserved' or j.usage_subscription_id is distinct from (g->>'subscription_id')::uuid
  or j.usage_period_start is distinct from (g->>'period_start')::timestamptz
  or not exists(select 1 from private.es02_reply_credit_holds where job_id=j.id and company_id=j.company_id
   and order_group_id=(g->>'order_group_id')::uuid and state='held' and not review_required)
  or exists(select 1 from private.es02_reply_credit_holds where company_id=j.company_id and review_required)
  or not private.es02_whatsapp_citations_current(j.company_id,a.es02_branch_id,a.source_citations) then
  return jsonb_build_object('ok',false,'code','ENTITLEMENT_USAGE_OR_KNOWLEDGE_CHANGED');end if;
 return g;
end;$$;
alter function private.es02_successful_worker_attempt(uuid,uuid,uuid) owner to postgres;
revoke all on function private.es02_successful_worker_attempt(uuid,uuid,uuid) from public,anon,authenticated,service_role;

alter function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) set schema private;
alter function private.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) rename to es02_pre_stage_job_reply;
revoke all on function private.es02_pre_stage_job_reply(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.whatsapp_stage_job_reply(p_job_id uuid,p_claim_token uuid,p_ai_attempt_id uuid,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g jsonb;f jsonb;r jsonb;j public.whatsapp_inbound_jobs;a public.ai_usage_ledger;c public.whatsapp_conversations;l public.whatsapp_company_links;i uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_stage_job_reply(p_job_id,p_claim_token,p_ai_attempt_id,p_citations);end if;
 begin
  g:=private.es02_successful_worker_attempt(p_job_id,p_claim_token,p_ai_attempt_id);
  if g->>'ok' is distinct from 'true' then r:=g;raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
  select * into a from public.ai_usage_ledger where id=p_ai_attempt_id;
  if p_citations is distinct from a.source_citations then r:=jsonb_build_object('ok',false,'code','citations_changed');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  if j.send_intent_id is not null then
   if j.staged_ai_attempt_id is distinct from p_ai_attempt_id or j.staged_citations is distinct from p_citations or j.staged_reply is distinct from a.response_text
    or not exists(select 1 from public.whatsapp_send_intents x where x.id=j.send_intent_id and x.company_id=j.company_id and x.original_job_id=j.id
     and x.sender_kind='assistant' and x.body=j.staged_reply and x.expected_automation_generation=j.expected_automation_generation
     and private.whatsapp_intent_link_current(x)) then r:=jsonb_build_object('ok',false,'code','staged_content_mismatch');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
   return jsonb_build_object('ok',true,'reused',true,'intent_id',j.send_intent_id);
  end if;
  select x.* into c from public.whatsapp_conversations x join public.whatsapp_messages m on m.conversation_id=x.id and m.company_id=x.company_id where m.id=j.message_id;
  select * into l from public.whatsapp_company_links where company_id=j.company_id and status='verified' and provider_phone_number_id=c.phone_number_id for share;
  if not found then r:=jsonb_build_object('ok',false,'code','link_unavailable');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  r:=public.create_whatsapp_assistant_send_intent('wa-job:'||j.id,c.id,a.response_text,c.phone_number_id,j.expected_automation_generation,l.id,l.generation);
  if r->>'ok' is distinct from 'true' then raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  i:=(r->'intent'->>'id')::uuid;
  update public.whatsapp_send_intents set original_job_id=j.id where id=i and company_id=j.company_id;
  update public.whatsapp_inbound_jobs set staged_reply=a.response_text,staged_citations=p_citations,staged_ai_attempt_id=a.id,send_intent_id=i where id=j.id;
  f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
  if f->>'ok' is distinct from 'true' or f is distinct from g then r:=jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  return jsonb_build_object('ok',true,'reused',false,'intent_id',i);
 exception when sqlstate 'PEB01' then return r;end;
end;$$;
alter function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) owner to postgres;
revoke all on function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) to service_role;

alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) set schema private;
alter function private.whatsapp_claim_assistant_job_send(uuid,uuid) rename to es02_pre_claim_assistant_job_send;
revoke all on function private.es02_pre_claim_assistant_job_send(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_claim_assistant_job_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare j public.whatsapp_inbound_jobs;i public.whatsapp_send_intents;g jsonb;f jsonb;r jsonb;token uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_claim_assistant_job_send(p_job_id,p_claim_token);end if;
 begin
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
  g:=private.es02_successful_worker_attempt(p_job_id,p_claim_token,j.staged_ai_attempt_id);
  if g->>'ok' is distinct from 'true' then r:=g;raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
  select * into i from public.whatsapp_send_intents where id=j.send_intent_id and company_id=j.company_id and original_job_id=j.id for update;
  if not found or i.sender_kind<>'assistant' or i.body is distinct from j.staged_reply or i.expected_automation_generation is distinct from j.expected_automation_generation
   or i.staff_review_grant_id is not null or coalesce(to_jsonb(i)->>'response_kind','ai_answer_v1')<>'ai_answer_v1'
   or not private.whatsapp_intent_link_current(i)
   or not exists(select 1 from public.ai_usage_ledger a where a.id=j.staged_ai_attempt_id and a.company_id=j.company_id
    and a.worker_job_id=j.id and a.response_text=j.staged_reply and a.source_citations=j.staged_citations) then
   r:=jsonb_build_object('ok',false,'code','intent_binding_changed');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  -- Existing attempting/unknown/accepted/rejected outcomes are never a fresh send.
  if i.outcome<>'ready' then return jsonb_build_object('ok',true,'claimed',false,'intent',private.whatsapp_send_intent_public(i));end if;
  token:=gen_random_uuid();
  update public.whatsapp_send_intents set outcome='attempting',attempt_token=token,attempt_started_at=clock_timestamp(),attempt_expires_at=clock_timestamp()+interval '90 seconds' where id=i.id returning * into i;
  f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
  if f->>'ok' is distinct from 'true' or f is distinct from g then r:=jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  return jsonb_build_object('ok',true,'claimed',true,'attempt_token',token,'intent',private.whatsapp_send_intent_public(i));
 exception when sqlstate 'PEB01' then return r;end;
end;$$;
alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) owner to postgres;
revoke all on function public.whatsapp_claim_assistant_job_send(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_claim_assistant_job_send(uuid,uuid) to service_role;

create function public.es02_verify_claimed_reply_citations(p_job_id uuid,p_claim_token uuid,p_source_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;f jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);if g->>'ok' is distinct from 'true' then return g;end if;
 if not private.es02_whatsapp_citations_current((g->>'company_id')::uuid,(g->>'branch_id')::uuid,p_source_citations) then return jsonb_build_object('ok',false,'code','KNOWLEDGE_CHANGED');end if;
 f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if f->>'ok' is distinct from 'true' or f is distinct from g then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return jsonb_build_object('ok',true,'company_id',g->'company_id','job_id',p_job_id);
end;$$;
alter function public.es02_verify_claimed_reply_citations(uuid,uuid,jsonb) owner to postgres;
revoke all on function public.es02_verify_claimed_reply_citations(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.es02_verify_claimed_reply_citations(uuid,uuid,jsonb) to service_role;

alter function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) set schema private;
alter function private.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) rename to es02_pre_retrieve_approved_knowledge;
revoke all on function private.es02_pre_retrieve_approved_knowledge(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.whatsapp_retrieve_approved_knowledge(p_company_id uuid,p_job_id uuid,p_claim_token uuid,p_question text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g jsonb;f jsonb;query_text text;q tsquery;rows jsonb;citations jsonb;n integer;chars bigint;knowledge_count integer;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_retrieve_approved_knowledge(p_company_id,p_job_id,p_claim_token,p_question);end if;
 if p_company_id is null or p_question is null or length(btrim(p_question)) not between 1 and 1000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);if g->>'ok' is distinct from 'true' then return g;end if;
 if g->>'company_id' is distinct from p_company_id::text then return jsonb_build_object('ok',false,'code','company_binding_rejected');end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id
  where j.id=p_job_id and j.company_id=p_company_id and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer'
   and m.body=p_question) then return jsonb_build_object('ok',false,'code','question_binding_rejected');end if;
 select string_agg(quote_literal(word),' | ' order by word) into query_text
 from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,p_question))) tokens(word) where length(word)>1;
 if query_text is null then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 q:=to_tsquery('simple'::regconfig,query_text);
 with candidates as (
  select k.id::text as id,k.company_id,k.title,btrim(k.content) as content,k.content_version,k.approved_version,k.approved_for_answers,
   k.status,k.kind,k.storage_path,k.byte_size,k.updated_at,k.usage_role
  from public.knowledge_sources k where k.company_id=p_company_id and k.status='ready' and k.approved_for_answers
   and k.approved_version=k.content_version and length(btrim(k.content))>0
   and (k.usage_role='business_instructions' or to_tsvector('simple'::regconfig,k.title||' '||k.content)@@q)
  union all
  select 'page-'||p.id,p.company_id,coalesce(nullif(p.title,''),p.url),btrim(p.extracted_text),p.version,p.version,true,'ready','text',null,null,p.updated_at,'knowledge'
  from private.es02_branch_website_pages p where p.company_id=p_company_id and p.branch_id=(g->>'branch_id')::uuid
   and p.status='indexed' and length(btrim(p.extracted_text))>0 and to_tsvector('simple'::regconfig,coalesce(p.title,p.url)||' '||p.extracted_text)@@q
  union all
  select 'hours-'||h.branch_id,h.company_id,'Working Hours',
   'Branch hours ('||b.name||', timezone: '||b.timezone||'): '||h.schedule::text,h.revision::integer,h.revision::integer,true,'ready','text',null,null,h.updated_at,'business_instructions'
  from private.es02_branch_hours h join public.company_branches b on b.id=h.branch_id and b.company_id=h.company_id
  where h.company_id=p_company_id and h.branch_id=(g->>'branch_id')::uuid and h.revision between 1 and 2147483647
 ), selected as materialized (
  select * from candidates order by usage_role,id limit 41
 ) select coalesce(jsonb_agg(to_jsonb(s) order by s.usage_role,s.id),'[]'::jsonb),count(*),
  coalesce(sum(length(s.title)+length(s.content)+5),0)+greatest(count(*)-1,0)*2,count(*) filter(where s.usage_role='knowledge')
 into rows,n,chars,knowledge_count from selected s;
 if n>40 or chars>12000 then return jsonb_build_object('ok',false,'code','CONTEXT_OVERFLOW');end if;
 if knowledge_count=0 then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 select jsonb_agg(jsonb_build_object('sourceId',x->>'id','title',x->>'title','contentVersion',x->'content_version')) into citations from jsonb_array_elements(rows)x;
 if not private.es02_whatsapp_citations_current(p_company_id,(g->>'branch_id')::uuid,citations) then return jsonb_build_object('ok',false,'code','APPROVAL_INCOMPLETE');end if;
 f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if f->>'ok' is distinct from 'true' or f is distinct from g then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'job_id',p_job_id,'sources',rows,'context_chars',chars);
end;$$;
alter function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) owner to postgres;
revoke all on function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) to service_role;
