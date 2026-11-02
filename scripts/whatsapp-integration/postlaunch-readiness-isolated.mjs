import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const exec=promisify(execFile),name=`velora-readiness-${randomUUID().slice(0,8)}`;let id;const company='22222222-2222-4222-8222-222222222222',branch='33333333-3333-4333-8333-333333333333',owner='11111111-1111-4111-8111-111111111111',order='44444444-4444-4444-8444-444444444444',grp='55555555-5555-4555-8555-555555555555',trial='66666666-6666-4666-8666-666666666666';
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',x=>o+=x);p.stderr.on('data',x=>e+=x);p.on('close',c=>c?reject(Error(e)):resolve(o.trim()));p.stdin.end(q)});}
const gate=async()=>JSON.parse(await sql(`select private.es02_paid_branch_readiness('${company}','${branch}')`));
try{
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=postlaunch-readiness','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();for(let n=0;n<40;n++){try{await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
 await sql(`create schema private;create schema auth;
 create table private.es02_activation_foundation(company_id uuid,order_id uuid,account_id uuid,order_group_id uuid,clock_state text,paid_through_at timestamptz);
 create table private.es02_account_orders(id uuid,provisioned_company_id uuid,account_id uuid,original_order_group_id uuid,status text,environment text,settlement_authority text,settled_at timestamptz,provider_transaction_id text,amount_baisa int,currency text);
 create table private.es02_account_settlement_events(order_id uuid,account_id uuid,provider_transaction_id text,outcome text,amount_baisa int,currency text,evidence_marker text);
 create table auth.users(id uuid,email_confirmed_at timestamptz,deleted_at timestamptz);create table public.companies(id uuid,status text,reply_language text);create table public.company_branches(id uuid,company_id uuid,status text);
 create table private.es02_branch_slot_rights(id uuid,company_id uuid,branch_id uuid,order_id uuid,persona text,slot_index int);
 create table private.es02_branch_channel_selections(id uuid,company_id uuid,branch_id uuid,account_id uuid,channels jsonb);
 create table private.es02_b3_connection_links(company_id uuid,branch_id uuid,channel text,status text,revoked_at timestamptz,verified bool,attempt_id uuid);
 create table private.es02_b3_connection_attempts(id uuid,status text);
 create table private.es02_branch_hours(company_id uuid,branch_id uuid,revision bigint);create table private.es02_branch_reply_language_confirmations(company_id uuid,branch_id uuid,reply_language text,revision bigint default 1,confirmed_at timestamptz,unique(company_id,branch_id));
 create table private.es02_branch_launch_confirmations(company_id uuid,branch_id uuid,confirmed bool,confirmed_at timestamptz);
 create table private.es02_branch_assistant_trials(company_id uuid,branch_id uuid,origin text,persona text,hours_revision bigint,language_code text,knowledge_revision text,execution_id uuid,created_at timestamptz);
 create table public.ai_usage_ledger(id uuid,company_id uuid,usage_mode text,status text,persona text);
 create table public.billing_subscriptions(id uuid,company_id uuid,environment text,plan_version_id uuid,status text,paid_through timestamptz);
 create table public.knowledge_sources(id uuid,company_id uuid,status text,approved_for_answers bool,approved_version int,content_version int,content text,title text);
 create table private.es02_branch_website_pages(id uuid default gen_random_uuid(),company_id uuid,branch_id uuid,status text,extracted_text text,version int default 1,title text,url text,error text,indexed_at timestamptz,updated_at timestamptz,unique(branch_id,url));
 create function auth.uid() returns uuid language sql as $$select '${owner}'::uuid$$;
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select case when $1='${owner}'::uuid and $2='${company}'::uuid and $3='${branch}'::uuid then '{"ok":true,"data":{"package":"basic"}}'::jsonb else '{"ok":false,"code":"NOT_OWNED"}'::jsonb end$$;
 create function public.es02_read_owned_branch_knowledge(uuid,uuid,uuid) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
 create function public.es02_read_owned_branch_reply_language(uuid,uuid,uuid) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
 create function private.whatsapp_citations_include_current_instructions(uuid,jsonb) returns boolean language sql as $$select true$$;
 create table private.fixture_knowledge(value text);insert into private.fixture_knowledge values('knowledge-v1');
 create function private.es02_branch_knowledge_revision(uuid,uuid) returns text language sql as $$select value from private.fixture_knowledge$$;
 create function private.es02_verified_live_catalog_order(private.es02_account_orders) returns boolean language sql as $$select false$$;
 create function private.es02_b3_current_binding(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{"ok":true,"paidFingerprint":"fixture"}'::jsonb$$;
 create function private.es02_b3_project(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{"sourceStatus":"ready","connection":{"state":"connected","verified":true}}'::jsonb$$;
 create function private.es02_b3_pin_matches(private.es02_b3_connection_attempts,jsonb) returns boolean language sql as $$select true$$;
 create function private.wa_worker_month() returns timestamptz language sql as $$select date_trunc('month',now())$$;
 insert into private.es02_activation_foundation values('${company}','${order}','${owner}','${grp}','active',now()+interval '30 days');
 insert into private.es02_account_orders values('${order}','${company}','${owner}','${grp}','provisioned','live','paymob_hmac',now(),'fixture',100,'OMR');
 insert into private.es02_account_settlement_events values('${order}','${owner}','fixture','applied',100,'OMR',null);
 insert into auth.users values('${owner}',now(),null);insert into public.companies values('${company}','active');insert into public.company_branches values('${branch}','${company}','active');
 insert into private.es02_branch_slot_rights values(gen_random_uuid(),'${company}','${branch}','${order}','level_1',1);insert into private.es02_branch_channel_selections values(gen_random_uuid(),'${company}','${branch}','${owner}','["whatsapp"]');
 insert into private.es02_b3_connection_attempts values('${trial}','bound');insert into private.es02_b3_connection_links values('${company}','${branch}','whatsapp','active',null,true,'${trial}');
 insert into private.es02_branch_hours values('${company}','${branch}',1);insert into private.es02_branch_reply_language_confirmations values('${company}','${branch}','ar');
 insert into private.es02_branch_launch_confirmations values('${company}','${branch}',true,now());
 insert into private.es02_branch_assistant_trials values('${company}','${branch}','engine','noura',1,'ar','knowledge-v1','${trial}',now()-interval '1 minute');
 insert into public.ai_usage_ledger values('${trial}','${company}','setup_trial','success','noura');
 insert into public.billing_subscriptions select gen_random_uuid(),'${company}','live',null,'active',paid_through_at from private.es02_activation_foundation;
 `);
 await sql(`
 create function public.es02_confirm_owned_branch_reply_language(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_expected_version bigint,p_reply_language text) returns void language plpgsql as $$begin delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id; end$$;
 create function public.es02_add_owned_branch_website(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_expected_version integer,p_url text) returns void language plpgsql as $$begin delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id; end$$;
 create function public.es02_index_branch_website_page(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_page_id uuid,p_title text,p_extracted_text text,p_status text,p_error text,p_expected_version integer,p_expected_url text) returns void language plpgsql as $$begin delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id; end$$;
 create function public.es02_page_action_owned_branch_knowledge(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_page_id uuid,p_action text,p_expected_page_version integer) returns void language plpgsql as $$begin DELETE FROM private.es02_branch_launch_confirmations where company_id=p_company_id and branch_id=p_branch_id; end$$;
 `);
 if(process.argv.includes('--installed-actions')){
  await sql(`drop function public.es02_confirm_owned_branch_reply_language(uuid,uuid,uuid,bigint,text);drop function public.es02_add_owned_branch_website(uuid,uuid,uuid,integer,text);drop function public.es02_index_branch_website_page(uuid,uuid,uuid,uuid,text,text,text,text,integer,text);drop function public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text,integer);`);
  await sql(await readFile('scripts/whatsapp-integration/fixtures/hosted-branch-edit-functions.sql','utf8'));
 }
 await sql(await readFile('scripts/whatsapp-integration/fixtures/hosted-readiness-before-persona.sql','utf8'));await sql(await readFile('supabase/migrations/20261102095529_whatsapp_readiness_persona_ambiguity.sql','utf8'));
 await sql(`create table private.fixture_function_snapshots as select p.oid::regprocedure::text as signature,md5(pg_get_functiondef(p.oid)) as fingerprint,p.proacl::text as acl,p.prosecdef as is_definer,p.proconfig::text as config from pg_proc p where p.oid in ('public.es02_confirm_owned_branch_reply_language(uuid,uuid,uuid,bigint,text)'::regprocedure,'public.es02_add_owned_branch_website(uuid,uuid,uuid,integer,text)'::regprocedure,'public.es02_index_branch_website_page(uuid,uuid,uuid,uuid,text,text,text,text,integer,text)'::regprocedure,'public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text,integer)'::regprocedure)`);
 await sql(await readFile('supabase/migrations/20261102110756_whatsapp_postlaunch_readiness.sql','utf8'));
 await sql(await readFile('scripts/whatsapp-integration/fixtures/hosted-citation-verifier.sql','utf8'));
 assert.equal(await sql(`select count(*) from private.fixture_function_snapshots s join pg_proc p on p.oid=s.signature::regprocedure where s.fingerprint=md5(replace(case when p.prokind='f' then pg_get_functiondef(p.oid) end,' and not exists(select 1 from public.company_branches postlaunch_branch where postlaunch_branch.company_id=p_company_id and postlaunch_branch.id=p_branch_id and postlaunch_branch.status=''active'')','')) and s.acl is not distinct from p.proacl::text and s.is_definer=p.prosecdef and s.config is not distinct from p.proconfig::text`),'4','edit functions retain original source except active-state condition and keep privileges');
 const edits=[`public.es02_confirm_owned_branch_reply_language('${owner}','${company}','${branch}',1,'en')`,`public.es02_add_owned_branch_website('${owner}','${company}','${branch}',1,'https://example.invalid')`,`public.es02_index_branch_website_page('${owner}','${company}','${branch}','${trial}','t','x','indexed',null,1,'https://example.invalid')`,`public.es02_page_action_owned_branch_knowledge('${owner}','${company}','${branch}','${trial}','retry',1)`];
 if(!process.argv.includes('--installed-actions')) {
 for(const edit of edits){await sql(`select ${edit}`);assert.equal(await sql('select count(*) from private.es02_branch_launch_confirmations'),'1','active branch retains launch proof after '+edit);}
 await sql("update public.company_branches set status='setup'");
 for(const edit of edits){await sql(`select ${edit}`);assert.equal(await sql('select count(*) from private.es02_branch_launch_confirmations'),'0','setup change invalidates unlaunched proof');await sql(`insert into private.es02_branch_launch_confirmations values('${company}','${branch}',true,now())`);}
 await sql("update public.company_branches set status='active'");
 } else {
  assert.equal(await sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('es02_confirm_owned_branch_reply_language','es02_add_owned_branch_website','es02_index_branch_website_page','es02_page_action_owned_branch_knowledge') and position('postlaunch_branch.status=''active''' in pg_get_functiondef(p.oid))>0"),'4','all four captured installed functions are patched');
  const changedLanguage=JSON.parse(await sql(`select public.es02_confirm_owned_branch_reply_language('${owner}','${company}','${branch}',1,'en')`));assert.equal(changedLanguage.ok,true,'real language update succeeds');
  assert.equal(await sql("select reply_language from public.companies limit 1"),'en');
  const added=JSON.parse(await sql(`select public.es02_add_owned_branch_website('${owner}','${company}','${branch}',1,'https://example.invalid')`));assert.equal(added.ok,true,'real website addition succeeds');
  const page=await sql('select id from private.es02_branch_website_pages limit 1');
  const indexed=JSON.parse(await sql(`select public.es02_index_branch_website_page('${owner}','${company}','${branch}','${page}','Fixture','Text','indexed',null,1,'https://example.invalid')`));assert.equal(indexed.ok,true,'real website indexing succeeds');
  const retrained=JSON.parse(await sql(`select public.es02_page_action_owned_branch_knowledge('${owner}','${company}','${branch}','${page}','retrain',2)`));assert.equal(retrained.ok,true,'real website retrain succeeds');
  assert.equal(await sql('select count(*) from private.es02_branch_launch_confirmations'),'1','real active branch edits preserve launch proof');
  const unauthorized=JSON.parse(await sql(`select public.es02_add_owned_branch_website(gen_random_uuid(),'${company}','${branch}',1,'https://unauthorized.invalid')`));assert.equal(unauthorized.code,'NOT_OWNED','owner fixture rejects unauthorized addition');
  await sql("update public.company_branches set status='setup'");
  const setupChange=JSON.parse(await sql(`select public.es02_confirm_owned_branch_reply_language('${owner}','${company}','${branch}',2,'ar')`));assert.equal(setupChange.ok,true);
  assert.equal(await sql('select count(*) from private.es02_branch_launch_confirmations'),'0','real setup edit invalidates launch proof');
  await sql(`insert into private.es02_branch_launch_confirmations values('${company}','${branch}',true,now());update public.company_branches set status='active';update private.es02_branch_reply_language_confirmations set reply_language='ar';`);
 }
 assert.equal((await gate()).ok,true,'baseline launched branch must be ready');
 await sql("update private.es02_account_orders set settled_at=null");assert.equal((await gate()).code,'VERIFIED_LIVE_ES02_PAYMENT_REQUIRED','unpaid order remains blocked');
 await sql("update private.es02_account_orders set settled_at=now();update private.es02_activation_foundation set clock_state='ended'");assert.equal((await gate()).code,'SUBSCRIPTION_INACTIVE','ended subscription remains blocked');
 await sql("update private.es02_activation_foundation set clock_state='active';update private.es02_branch_slot_rights set persona='level_2'");assert.equal((await gate()).code,'CURRENT_BRANCH_READINESS_REQUIRED','trial evidence for another persona must not unlock');
 await sql("update private.es02_branch_slot_rights set persona='level_1';update private.es02_branch_hours set revision=0");assert.equal((await gate()).code,'CURRENT_BRANCH_READINESS_REQUIRED','missing current hours remains blocked');
 await sql("update private.es02_branch_hours set revision=1;update private.es02_branch_reply_language_confirmations set reply_language=null");assert.equal((await gate()).code,'CURRENT_BRANCH_READINESS_REQUIRED','missing current language remains blocked');
 await sql("update private.es02_branch_reply_language_confirmations set reply_language='ar'");assert.equal((await gate()).ok,true,'restored branch readiness succeeds');
 assert.equal((await sql(`select private.es02_paid_branch_readiness('${company}',gen_random_uuid())->>'ok'`)),'false','another branch cannot borrow launch evidence');
 await sql("update private.es02_branch_hours set revision=2;update private.es02_branch_reply_language_confirmations set reply_language='en';update private.fixture_knowledge set value='knowledge-v2'");
 assert.equal((await gate()).ok,true,'ordinary post-launch settings changes must not require a new setup trial');
 const citations=`[{"sourceId":"hours-${branch}","contentVersion":2,"title":"Working Hours"}]`;
 const verify=`select private.es02_whatsapp_citations_current('${company}','${branch}','${citations}'::jsonb)`;
 assert.equal(await sql(verify),'t','current hours citation is accepted');
 const holder=sql(`set application_name='velora_citation_holder';begin;${verify};select pg_sleep(4);commit`);
 let holding=false;for(let n=0;n<40;n++){if(await sql("select count(*) from pg_stat_activity where application_name='velora_citation_holder' and wait_event='PgSleep'")==='1'){holding=true;break}await new Promise(r=>setTimeout(r,100));}assert(holding,'citation share lock acquired');
 const writer=sql("set application_name='velora_hours_writer';update private.es02_branch_hours set revision=3");
 let blocked=false;for(let n=0;n<30;n++){if(await sql("select count(*) from pg_stat_activity where application_name='velora_hours_writer' and wait_event_type='Lock'")==='1'){blocked=true;break}await new Promise(r=>setTimeout(r,100));}assert(blocked,'hours writer waits for citation verification transaction');
 await holder;await writer;assert.equal(await sql(verify),'f','stale hours citation is rejected after update');
 await sql("update private.fixture_knowledge set value='no_knowledge'");assert.equal((await gate()).code,'CURRENT_BRANCH_READINESS_REQUIRED','missing current knowledge fails closed');
 await sql("update private.fixture_knowledge set value='knowledge-v2'; update private.es02_branch_launch_confirmations set confirmed=false");assert.equal((await gate()).code,'CURRENT_BRANCH_READINESS_REQUIRED','launch proof remains mandatory');
 await sql("update private.es02_branch_launch_confirmations set confirmed=true;update private.es02_branch_assistant_trials set created_at=now()+interval '1 day'");assert.equal((await gate()).code,'CURRENT_BRANCH_READINESS_REQUIRED','trial after launch cannot fabricate launch evidence');
 await sql("update private.es02_branch_assistant_trials set created_at=now()-interval '1 minute';update public.ai_usage_ledger set status='uncertain'");assert.equal((await gate()).code,'CURRENT_BRANCH_READINESS_REQUIRED','unknown-cost trial is not successful proof');
 await sql("update public.ai_usage_ledger set status='success';update private.es02_b3_connection_links set verified=false");assert.equal((await gate()).code,'CHANNEL_PROOF_CHANGED','unverified link still blocks');
 await sql("update private.es02_b3_connection_links set verified=true;update public.company_branches set status='setup'");assert.equal((await gate()).code,'BRANCH_NOT_LAUNCHED','inactive branch still blocks');
 console.log('PASS: post-launch revisions with actual function and fixture dependencies; launch, trial, knowledge, channel and active-state fences retained');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
