-- TEST ONLY. Existing isolated harness, synthetic tenants and no provider execution.
begin;
create function pg_temp.knowledge_fixture(p_question text default 'espresso price') returns jsonb language plpgsql as $$
declare f jsonb:=test_fixture.company();c public.whatsapp_conversations%rowtype;l public.whatsapp_company_links%rowtype;r jsonb;j uuid;token uuid;begin
 select * into c from public.whatsapp_conversations where id=(f->>'conversation')::uuid;
 select * into l from public.whatsapp_company_links where id=(f->>'link')::uuid;
 r:=public.whatsapp_store_meta_inbound((f->>'company')::uuid,l.provider_waba_id,c.phone_number_id,c.customer_wa_id,'Synthetic customer',
 'synthetic-knowledge-'||gen_random_uuid(),p_question,'text',clock_timestamp());
 if r->>'ok' is distinct from 'true' then raise exception 'Synthetic knowledge ingress rejected: %',r;end if;
 j:=(r->>'job_id')::uuid;r:=public.claim_whatsapp_inbound_job(j,120);token:=(r->>'claim_token')::uuid;
 if token is null then raise exception 'Synthetic knowledge claim failed';end if;
 return f||jsonb_build_object('job',j,'claim',token,'question',p_question);
end; $$;
create function pg_temp.approved_source(f jsonb,p_title text,p_content text,p_role text default 'knowledge') returns uuid language plpgsql as $$
declare k uuid:=gen_random_uuid();begin
 insert into public.knowledge_sources(id,company_id,kind,title,content,status,created_by,usage_role)
 values(k,(f->>'company')::uuid,'text',p_title,p_content,'ready',(f->>'user')::uuid,p_role);
 perform set_config('velora.knowledge_approval','1',true);
 update public.knowledge_sources set approved_for_answers=true where id=k;
 return k;
end; $$;
create function pg_temp.knowledge_reserve(f jsonb,k uuid,a uuid,p_expected text default 'noura',p_version uuid default null) returns jsonb language plpgsql as $$
declare r jsonb;citations jsonb;begin
 r:=public.whatsapp_reserve_job_usage((f->>'job')::uuid,(f->>'claim')::uuid);
 if r->>'ok' is distinct from 'true' then raise exception 'Synthetic job capacity rejected: %',r;end if;
 perform test_fixture.ai_budget((f->>'company')::uuid,10);
 select jsonb_build_array(jsonb_build_object('sourceId',id,'title',title,'contentVersion',content_version)) into citations from public.knowledge_sources where id=k;
 return public.ai_reserve_whatsapp_profile_attempt(a,(f->>'job')::uuid,(f->>'claim')::uuid,1,'gpt-6-luna','openai',1,
 'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}',citations,p_expected,coalesce(p_version,(f->>'plan_version')::uuid));
end; $$;

set local role service_role;
do $$ declare f jsonb:=pg_temp.knowledge_fixture();k uuid;v integer;begin
 k:=pg_temp.approved_source(f,'Voice','Use concise replies.');
 select content_version into v from public.knowledge_sources where id=k;
 update public.knowledge_sources set usage_role='business_instructions' where id=k;
 if not exists(select 1 from public.knowledge_sources where id=k and content_version=v+1 and not approved_for_answers
 and approved_version is null and approved_at is null and approved_by is null)
 then raise exception 'Changing source purpose retained old approval/version';end if;
 perform set_config('velora.knowledge_approval','1',true);update public.knowledge_sources set approved_for_answers=true where id=k;
 select content_version into v from public.knowledge_sources where id=k;
 update public.knowledge_sources set usage_role='knowledge',content='Changed business instructions' where id=k;
 if not exists(select 1 from public.knowledge_sources where id=k and content_version=v+1 and not approved_for_answers)
 then raise exception 'Simultaneous purpose/body change did not invalidate exactly one generation';end if;
end; $$;
select 'PASS|Source purpose changes invalidate approval and content version exactly once';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();other jsonb:=test_fixture.company();k uuid;k2 uuid;style uuid;foreign_source uuid;unapproved uuid;r jsonb;i integer;begin
 k:=pg_temp.approved_source(f,'Espresso menu','Espresso costs exactly 1.200 OMR.');
 k2:=pg_temp.approved_source(f,'Espresso delivery price','Delivery espresso costs exactly 1.500 OMR.');
 style:=pg_temp.approved_source(f,'Business instructions','Use concise replies and offer a staff handoff when information is absent.','business_instructions');
 foreign_source:=pg_temp.approved_source(other,'Espresso other tenant','Espresso costs 99 OMR.');
 unapproved:=pg_temp.approved_source(f,'Espresso obsolete price','Espresso costs 0 OMR.');
 update public.knowledge_sources set approved_for_answers=false where id=unapproved;
 for i in 1..60 loop perform pg_temp.approved_source(f,'Unrelated article '||i,'Unrelated maintenance catalogue item '||i);end loop;
 r:=public.whatsapp_retrieve_approved_knowledge((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid,f->>'question');
 if r->>'ok' is distinct from 'true' or jsonb_array_length(r->'sources')<>3
 or not exists(select 1 from jsonb_array_elements(r->'sources') x where x->>'id'=k::text and x->>'content'='Espresso costs exactly 1.200 OMR.' and x->>'content_version'='1')
 or not exists(select 1 from jsonb_array_elements(r->'sources') x where x->>'id'=k2::text)
 or not exists(select 1 from jsonb_array_elements(r->'sources') x where x->>'id'=style::text and x->>'usage_role'='business_instructions')
 or exists(select 1 from jsonb_array_elements(r->'sources') x where x->>'id' in (foreign_source::text,unapproved::text) or x->>'company_id'<>f->>'company')
 then raise exception 'Approved tenant full-source retrieval failed: %',r;end if;
 r:=public.whatsapp_retrieve_approved_knowledge((other->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid,f->>'question');
 if r->>'code' is distinct from 'company_binding_rejected' then raise exception 'Query allowed another tenant: %',r;end if;
 r:=public.whatsapp_retrieve_approved_knowledge((f->>'company')::uuid,(f->>'job')::uuid,gen_random_uuid(),f->>'question');
 if r->>'ok' is distinct from 'false' then raise exception 'Wrong claim retrieved company knowledge';end if;
end; $$;
select 'PASS|Large corpus retrieval returns every matching full approved tenant source plus instructions only';

do $$ declare f jsonb:=pg_temp.knowledge_fixture('unknownwidget');r jsonb;begin
 perform pg_temp.approved_source(f,'Business voice','Use concise replies.','business_instructions');
 perform pg_temp.approved_source(f,'Menu','Espresso costs 1.200 OMR.');
 r:=public.whatsapp_retrieve_approved_knowledge((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid,f->>'question');
 if r->>'code' is distinct from 'NO_KNOWLEDGE' or r ? 'sources' then raise exception 'Unknown query supplied unrelated grounding: %',r;end if;
 r:=public.whatsapp_retrieve_approved_knowledge((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid,'espresso price');
 if r->>'code' is distinct from 'question_binding_rejected' then raise exception 'Caller query replaced original inbound';end if;
end; $$;
select 'PASS|No match and substituted question fail closed before AI cost';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();k uuid;r jsonb;i integer;begin
 k:=pg_temp.approved_source(f,'Espresso policy','Espresso '||repeat('p',12001));
 r:=public.whatsapp_retrieve_approved_knowledge((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid,f->>'question');
 if r->>'code' is distinct from 'CONTEXT_OVERFLOW' or r ? 'sources' then raise exception 'Oversized source was silently cut';end if;
 delete from public.knowledge_sources where id=k;
 for i in 1..41 loop perform pg_temp.approved_source(f,'Espresso price '||i,'Espresso price item '||i);end loop;
 r:=public.whatsapp_retrieve_approved_knowledge((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid,f->>'question');
 if r->>'code' is distinct from 'CONTEXT_OVERFLOW' or r ? 'sources' then raise exception 'Excess relevant sources silently dropped';end if;
end; $$;
select 'PASS|Character and relevant source-count overflow never returns a truncated price or policy';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();other jsonb:=test_fixture.company();r jsonb;begin
 -- The second fixture retires the first plan version; existing paid grants remain usable.
 r:=public.whatsapp_read_answer_profile((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid);
 if r->>'ok' is distinct from 'true' or r->>'persona'<>'noura' or r->>'plan_code'<>'noor_basic' or r->>'plan_version_id'<>f->>'plan_version'
 then raise exception 'Canonical paid historic version lost persona: %',r;end if;
 r:=public.whatsapp_read_answer_profile((other->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid);
 if r->>'code' is distinct from 'company_binding_rejected' then raise exception 'Profile accepted other tenant';end if;
 update public.billing_subscriptions set paid_through=clock_timestamp()-interval '1 second' where company_id=(f->>'company')::uuid;
 r:=public.whatsapp_read_answer_profile((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid);
 if r->>'ok' is distinct from 'false' then raise exception 'Expired paid plan returned persona';end if;
end; $$;
select 'PASS|Persona requires exact tenant claim and real unexpired canonical paid plan including historic retired versions';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();plan uuid;variant text;expected text;r jsonb;begin
 select plan_id into plan from public.billing_plan_versions where id=(f->>'plan_version')::uuid;
 -- All rows in this isolated rollback harness are synthetic. Free any existing
 -- variant names temporarily to exercise the real paid lookup for all six codes.
 update public.billing_plans set code='synthetic-variant-'||gen_random_uuid() where id<>plan
 and code in ('noor_premium','lina_basic','lina_premium','dana_basic','dana_premium');
 foreach variant in array array['noor_basic','noor_premium','lina_basic','lina_premium','dana_basic','dana_premium'] loop
  update public.billing_plans set code=variant where id=plan;
  expected:=case when variant like 'noor_%' then 'noura' when variant like 'lina_%' then 'lina' else 'dana' end;
  r:=public.whatsapp_read_answer_profile((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid);
  if r->>'ok' is distinct from 'true' or r->>'persona' is distinct from expected or r->>'plan_code' is distinct from variant
  then raise exception 'Canonical paid variant % did not map to %: %',variant,expected,r;end if;
 end loop;
 foreach variant in array array['lina','dana','free'] loop
  update public.billing_plans set code=variant where id=plan;
  r:=public.whatsapp_read_answer_profile((f->>'company')::uuid,(f->>'job')::uuid,(f->>'claim')::uuid);
  if r->>'code' is distinct from 'canonical_paid_plan_required' then raise exception 'Noncanonical % returned persona: %',variant,r;end if;
 end loop;
 update public.billing_plans set code='noor_basic' where id=plan;
end; $$;
select 'PASS|All six real paid catalog codes map to fixed personas and bare/free names are rejected';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();k uuid;a uuid:=gen_random_uuid();r jsonb;begin
 k:=pg_temp.approved_source(f,'Espresso price','Espresso 1.200 OMR.');
 r:=pg_temp.knowledge_reserve(f,k,a,'dana');
 if r->>'code' is distinct from 'ANSWER_PROFILE_CHANGED' or exists(select 1 from public.ai_usage_ledger where id=a)
 then raise exception 'Stale system identity allocated cost: %',r;end if;
 r:=pg_temp.knowledge_reserve(f,k,a);
 if r->>'ok' is distinct from 'true' or not exists(select 1 from public.ai_usage_ledger where id=a
 and answer_persona='noura' and answer_plan_version_id=(f->>'plan_version')::uuid)
 then raise exception 'Reservation did not bind exact canonical profile: %',r;end if;
 begin update public.ai_usage_ledger set answer_persona='dana' where id=a;raise exception 'Persona evidence was mutable';
 exception when check_violation or insufficient_privilege then null;end;
 update public.knowledge_sources set usage_role='business_instructions' where id=k;
 if public.ai_start_whatsapp_attempt(a,(f->>'claim')::uuid) then raise exception 'Changed source purpose started paid model';end if;
end; $$;
select 'PASS|Expected persona must match atomic immutable reservation and role revocation prevents dispatch';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();k uuid;style uuid;a uuid:=gen_random_uuid();r jsonb;citations jsonb;begin
 k:=pg_temp.approved_source(f,'Espresso price','Espresso 1.200 OMR.');
 style:=pg_temp.approved_source(f,'Approved company instructions','Use concise replies.','business_instructions');
 r:=pg_temp.knowledge_reserve(f,k,a);
 if r->>'code' is distinct from 'KNOWLEDGE_CHANGED' or exists(select 1 from public.ai_usage_ledger where id=a)
 then raise exception 'Paid context omitted currently approved instructions: %',r;end if;
 select jsonb_agg(jsonb_build_object('sourceId',id,'title',title,'contentVersion',content_version) order by id) into citations
 from public.knowledge_sources where id in (k,style);
 r:=public.ai_reserve_whatsapp_profile_attempt(a,(f->>'job')::uuid,(f->>'claim')::uuid,1,'gpt-6-luna','openai',1,
 'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}',citations,'noura',(f->>'plan_version')::uuid);
 if r->>'ok' is distinct from 'true' then raise exception 'Complete approved instruction snapshot was rejected: %',r;end if;
end; $$;
select 'PASS|All currently approved business instructions must be cited at the atomic paid reservation';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();a uuid;r jsonb;citations jsonb;begin
 r:=public.whatsapp_reserve_job_usage((f->>'job')::uuid,(f->>'claim')::uuid);
 if r->>'ok' is distinct from 'true' then raise exception 'Synthetic instruction race quota failed';end if;
 a:=test_fixture.draft(f,(f->>'job')::uuid,(f->>'claim')::uuid);
 perform pg_temp.approved_source(f,'New approved instructions','Use the new service workflow.','business_instructions');
 select source_citations into citations from public.ai_usage_ledger where id=a;
 r:=public.whatsapp_stage_job_reply((f->>'job')::uuid,(f->>'claim')::uuid,a,citations);
 if r->>'code' is distinct from 'ANSWER_PROFILE_CHANGED' or exists(select 1 from public.whatsapp_send_intents where original_job_id=(f->>'job')::uuid)
 then raise exception 'Late approved instructions silently omitted from paid draft: %',r;end if;
end; $$;
select 'PASS|Instructions approved after generation prevent sending a draft that omitted them';

-- Catalog code changes exercise a genuine current-persona mismatch without forging
-- paid-through or changing immutable payment grants. Everything rolls back below.
do $$ declare f jsonb:=pg_temp.knowledge_fixture();k uuid;a uuid:=gen_random_uuid();r jsonb;plan uuid;begin
 k:=pg_temp.approved_source(f,'Espresso price','Espresso 1.200 OMR.');r:=pg_temp.knowledge_reserve(f,k,a);
 if r->>'ok' is distinct from 'true' then raise exception 'Synthetic profile reservation failed';end if;
 select plan_id into plan from public.billing_plan_versions where id=(f->>'plan_version')::uuid;
 update public.billing_plans set code='noncanonical-'||gen_random_uuid() where id=plan;
 if public.ai_start_whatsapp_attempt(a,(f->>'claim')::uuid) then raise exception 'Changed canonical paid identity dispatched';end if;
 if not public.ai_settle_whatsapp_attempt(a,(f->>'claim')::uuid,'rejected',0,0,'{}',null,null,null,null,'AUTHORIZATION_CHANGED_BEFORE_EXECUTION',0)
 then raise exception 'Known unstarted cost could not settle after plan change';end if;
end; $$;
select 'PASS|Plan identity drift prevents dispatch while known unstarted cost remains settleable';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();a uuid;r jsonb;citations jsonb;original_claim uuid:=(f->>'claim')::uuid;begin
 r:=public.whatsapp_reserve_job_usage((f->>'job')::uuid,original_claim);
 if r->>'ok' is distinct from 'true' then raise exception 'Synthetic recovery quota failed';end if;
 a:=test_fixture.draft(f,(f->>'job')::uuid,original_claim);
 update public.whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()-interval '1 second' where id=(f->>'job')::uuid;
 r:=public.claim_whatsapp_inbound_job((f->>'job')::uuid,120);
 if r->>'ok' is distinct from 'true' or (r->>'claim_token')::uuid=original_claim then raise exception 'Synthetic lease did not renew';end if;
 f:=f||jsonb_build_object('claim',r->>'claim_token');
 citations:=jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic knowledge','contentVersion',1));
 r:=public.whatsapp_stage_job_reply((f->>'job')::uuid,(f->>'claim')::uuid,a,citations);
 if r->>'ok' is distinct from 'true' or (select worker_claim_token from public.ai_usage_ledger where id=a) is distinct from original_claim
 or (select count(*) from public.ai_usage_ledger where worker_job_id=(f->>'job')::uuid)<>1
 then raise exception 'Renewed claim replaced or rejected valid paid draft snapshot: %',r;end if;
 r:=public.whatsapp_claim_assistant_job_send((f->>'job')::uuid,(f->>'claim')::uuid);
 if r->>'ok' is distinct from 'true' or r->>'claimed' is distinct from 'true' then raise exception 'Valid renewed lease could not claim stored reply: %',r;end if;
end; $$;
select 'PASS|Renewed job lease reuses one successful paid draft with original immutable claim and citations';

do $$ declare f jsonb:=pg_temp.knowledge_fixture();a uuid;r jsonb;citations jsonb;plan uuid;begin
 r:=public.whatsapp_reserve_job_usage((f->>'job')::uuid,(f->>'claim')::uuid);
 if r->>'ok' is distinct from 'true' then raise exception 'Synthetic draft quota failed';end if;
 a:=test_fixture.draft(f,(f->>'job')::uuid,(f->>'claim')::uuid);
 citations:=jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic knowledge','contentVersion',1));
 r:=public.whatsapp_stage_job_reply((f->>'job')::uuid,(f->>'claim')::uuid,a,citations);
 if r->>'ok' is distinct from 'true' then raise exception 'Valid profile draft did not stage: %',r;end if;
 select plan_id into plan from public.billing_plan_versions where id=(f->>'plan_version')::uuid;
 update public.billing_plans set code='noncanonical-'||gen_random_uuid() where id=plan;
 r:=public.whatsapp_claim_assistant_job_send((f->>'job')::uuid,(f->>'claim')::uuid);
 if r->>'code' is distinct from 'ANSWER_PROFILE_CHANGED' then raise exception 'Stored draft sent after plan/profile drift: %',r;end if;
 r:=public.whatsapp_stage_job_reply((f->>'job')::uuid,(f->>'claim')::uuid,a,citations);
 if r->>'code' is distinct from 'ANSWER_PROFILE_CHANGED' then raise exception 'Old paid draft restaged under new profile';end if;
end; $$;
select 'PASS|Stored paid replies cannot restage or claim a send after current profile changes';

reset role;
do $$ declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('whatsapp_read_answer_profile','whatsapp_retrieve_approved_knowledge','ai_reserve_whatsapp_profile_attempt') loop
 if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
 or not has_function_privilege('service_role',fn,'execute') then raise exception 'Invalid profile RPC ACL: %',fn;end if;
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
 and p.proname in ('whatsapp_answer_profile','whatsapp_attempt_profile_current','whatsapp_citations_include_current_instructions','wa_ai_reserve_pre_answer_profile','wa_ai_start_pre_answer_profile','wa_stage_pre_answer_profile','wa_send_pre_answer_profile') loop
 if has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute') or has_function_privilege('service_role',fn,'execute')
 then raise exception 'Chained private bypass remained callable: %',fn;end if;
 end loop;
end; $$;
select 'PASS|Company answer profile/retrieval RPCs are service-only and private wrapper bypasses are revoked';
rollback;
