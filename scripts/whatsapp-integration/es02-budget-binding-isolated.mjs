// Isolated database contract tests. No provider or production connection.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-budget-${randomUUID().slice(0,8)}`;
let id;
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',z=>o+=z);p.stderr.on('data',z=>e+=z);p.on('close',n=>n?reject(Error(e)):resolve(o.trim()));p.stdin.end(q)});}
const company='11111111-1111-4111-8111-111111111111', order='22222222-2222-4222-8222-222222222222', branch='33333333-3333-4333-8333-333333333333', sub='44444444-4444-4444-8444-444444444444', job='55555555-5555-4555-8555-555555555555', token='66666666-6666-4666-8666-666666666666', attempt='77777777-7777-4777-8777-777777777777', fp='a'.repeat(64);
const invoke=(expected=order)=>`select public.es02_reserve_whatsapp_capacity_cost_attempt('${attempt}','${job}','${token}',1,'gemini-3.8-flash','google',1,'v','{}','[]','noura','${expected}','${branch}',0,'${fp}')->>'code'`;
try{
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=budget-bind','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();
 for(let n=0;n<60;n++){try{await sql('select 1');await new Promise(r=>setTimeout(r,1500));await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
 await sql(`create role anon;create role authenticated;create role service_role;create schema private;
 create table public.companies(id uuid primary key);create table private.es02_account_orders(id uuid primary key);
 create table public.billing_subscriptions(id uuid primary key,company_id uuid,environment text,plan_version_id uuid);
 create table private.ai_plan_budget_policies(plan_version_id uuid,monthly_limit_baisa numeric);
 create table private.es02_activation_foundation(company_id uuid,order_id uuid);
 create table public.whatsapp_conversations(company_id uuid,phone_number_id text,customer_wa_id text,status text,automation_allowed boolean,branch_id uuid default '${branch}',unique(company_id,phone_number_id,customer_wa_id));
 create table public.whatsapp_inbound_jobs(company_id uuid,next_attempt_at timestamptz);
 create function public.whatsapp_claim_inbound_batch(integer) returns boolean language sql as $$select exists(select 1 from public.whatsapp_inbound_jobs j join public.whatsapp_conversations c on c.company_id=j.company_id where true and j.next_attempt_at<=clock_timestamp())$$;
 create function private.whatsapp_resolve_conversation_branch(uuid,text,timestamptz) returns uuid language sql as $$select case when $1='${company}'::uuid and $2 in ('live','coex') then '${branch}'::uuid else null end$$;
 create function private.whatsapp_coexistence_ai_allowed(uuid,text) returns boolean language sql as $$select $2<>'coex'$$;
 create table private.test_readiness(ok boolean);insert into private.test_readiness values(true);
 create function private.es02_paid_branch_readiness(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',ok,'order_id','${order}','subscription_id','${sub}') from private.test_readiness$$;
 create function private.wa_save_inbound_pre_coexistence(p_company_id uuid,p_phone_number_id text,p_customer_wa_id text,p_customer_name text,p_wa_message_id text,p_body text,p_message_type text,p_received_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$declare v_phone text:=p_phone_number_id;begin
 insert into public.whatsapp_conversations (company_id,phone_number_id,customer_wa_id,status,automation_allowed) values (p_company_id,v_phone,p_customer_wa_id,
      'open',
      false
    )
 on conflict(company_id,phone_number_id,customer_wa_id) do update set customer_wa_id=excluded.customer_wa_id;
 return jsonb_build_object('ok',true);end$$;
 create function private.ai_budget_period(timestamptz) returns date language sql immutable as $$select date_trunc('month',$1 at time zone 'Asia/Muscat')::date$$;
 create table public.ai_budget_accounts(id uuid primary key default gen_random_uuid(),scope text,company_id uuid,subscription_id uuid,plan_version_id uuid,limit_baisa numeric,enabled boolean,period_start date,created_at timestamptz default now());
 alter table public.ai_budget_accounts add constraint ai_budget_version_binding check((scope='admin_test' and subscription_id is null and plan_version_id is null) or (scope='company_live' and ((subscription_id is null and plan_version_id is null) or (subscription_id is not null and plan_version_id is not null))));
 -- Exact production conflict domains, including nullable plan version.
 create unique index ai_budget_company_legacy_unique on public.ai_budget_accounts(company_id,period_start) where scope='company_live' and subscription_id is null;
 create unique index ai_budget_company_version_unique on public.ai_budget_accounts(company_id,period_start,subscription_id,plan_version_id) where scope='company_live' and subscription_id is not null;
 create function private.ai_budget_account_binding() returns trigger language plpgsql as $$begin return new;end$$;
 create trigger ai_budget_account_binding before insert or update on public.ai_budget_accounts for each row execute function private.ai_budget_account_binding();
 create function private.es02_claimed_reply_authority(uuid,uuid) returns jsonb language sql as $$select case when $1='${job}'::uuid and $2='${token}'::uuid then jsonb_build_object('ok',true,'company_id','${company}','order_id','${order}','branch_id','${branch}','slot_index',0,'paid_fingerprint','${fp}','persona','noura','subscription_id','${sub}') else jsonb_build_object('ok',false,'code','CLAIM_REJECTED') end$$;
 create function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) returns jsonb language sql as $$select case when exists(select 1 from public.ai_budget_accounts where company_id='${company}' and enabled and period_start=date_trunc('month',clock_timestamp())::date) then jsonb_build_object('code','ORIGINAL_RESERVATION_CALLED') else jsonb_build_object('code','BUDGET_DISABLED') end$$;
 create function private.es02_start_whatsapp_attempt(uuid,uuid) returns boolean language sql as $$select date_trunc('month',clock_timestamp())::date is not null$$;
 insert into public.companies values('${company}');insert into private.es02_account_orders values('${order}');insert into public.billing_subscriptions values('${sub}','${company}','live',null);insert into private.es02_activation_foundation values('${company}','${order}');`);
 await sql(await readFile('supabase/migrations/20261102123735_es02_reply_budget_binding.sql','utf8'));
 await sql(await readFile('supabase/migrations/20261102131427_es02_native_budget_index.sql','utf8'));
 await sql(await readFile('supabase/migrations/20261102132251_es02_native_budget_constraint.sql','utf8'));
 await sql('grant usage on schema private to service_role;grant select,insert,update on private.es02_activation_foundation to service_role');
 await assert.rejects(sql(`set role service_role;update private.es02_activation_foundation set ai_cost_order_id='${order}',ai_cost_subscription_id='${sub}',ai_cost_monthly_limit_baisa=99999,ai_cost_enabled=true where company_id='${company}'`),/ES02_COST_POLICY_REQUIRES_OWNER/);
 assert.equal(await sql(`set role service_role;${invoke()}`),'BUDGET_DISABLED');
 await assert.rejects(sql(`insert into public.ai_budget_accounts(scope,company_id,subscription_id,limit_baisa,enabled,period_start) values('company_live','${company}','${sub}',1000,true,private.ai_budget_period(now()))`),/AI_BUDGET_BINDING_REQUIRED/);
 await sql(`update private.es02_activation_foundation set ai_cost_order_id='${order}',ai_cost_subscription_id='${sub}',ai_cost_monthly_limit_baisa=1000,ai_cost_enabled=true where company_id='${company}'`);
 assert.equal(await sql(`set role service_role;${invoke('88888888-8888-4888-8888-888888888888')}`),'ANSWER_PROFILE_CHANGED');
 assert.equal(await sql('select count(*) from public.ai_budget_accounts'),'0');
 assert.equal(await sql(`set role service_role;${invoke()}`),'ORIGINAL_RESERVATION_CALLED');
 const concurrent=await Promise.all(Array.from({length:8},()=>sql(`set role service_role;${invoke()}`)));
 assert(concurrent.every(result=>result==='ORIGINAL_RESERVATION_CALLED'),'concurrent requests preserve one bound account');
 assert.equal(await sql('select count(*) from public.ai_budget_accounts where enabled and limit_baisa=1000'),'1');
 const legacySub='99999999-9999-4999-8999-999999999999',legacyPlan='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await sql(`insert into public.billing_subscriptions values('${legacySub}','${company}','live','${legacyPlan}');insert into private.ai_plan_budget_policies values('${legacyPlan}',200);insert into public.ai_budget_accounts(scope,company_id,subscription_id,plan_version_id,limit_baisa,enabled,period_start) values('company_live','${company}','${legacySub}','${legacyPlan}',200,true,private.ai_budget_period(now()))`);
 assert.equal(await sql(`set role service_role;${invoke()}`),'BUDGET_BINDING_CHANGED','ambiguous month never picks an arbitrary account');
 await assert.rejects(sql('update public.ai_budget_accounts set limit_baisa=2000'),/AI_BUDGET_BINDING_IMMUTABLE/);
 assert.equal(await sql("select private.ai_budget_period('2026-10-31 21:00:00+00'::timestamptz)"),'2026-11-01');
 assert.equal(await sql("select position('private.ai_budget_period(clock_timestamp())' in pg_get_functiondef('private.es02_start_whatsapp_attempt(uuid,uuid)'::regprocedure))>0"),'t');
 await sql(await readFile('supabase/migrations/20261102124937_es02_new_conversation_auto_start.sql','utf8'));
 await assert.rejects(sql(`set role service_role;update private.es02_activation_foundation set ai_auto_start_at=clock_timestamp()`),/ES02_AUTO_START_REQUIRES_OWNER/);
 await sql("update private.es02_activation_foundation set ai_auto_start_at=clock_timestamp()-interval '1 minute'");
 await sql(`insert into public.whatsapp_conversations(company_id,phone_number_id,customer_wa_id,status,automation_allowed) values('${company}','live','existing','handed_over',false)`);
 for(const [phone,customer,age] of [['live','fresh','1 second'],['live','existing','1 second'],['live','stale','2 minutes'],['coex','app','1 second'],['unknown','unknown','1 second']])
  await sql(`select private.wa_save_inbound_pre_coexistence('${company}','${phone}','${customer}','','id','x','text',clock_timestamp()-interval '${age}')`);
 assert.equal(await sql("select automation_allowed from public.whatsapp_conversations where customer_wa_id='fresh'"),'t');
 assert.equal(await sql("select count(*) from public.whatsapp_conversations where customer_wa_id in ('existing','stale','app','unknown') and not automation_allowed"),'4');
 await sql('insert into public.whatsapp_inbound_jobs values(\''+company+'\',clock_timestamp());update private.test_readiness set ok=false');
 assert.equal(await sql('select public.whatsapp_claim_inbound_batch(1)'),'f','temporary unready state leaves messages pending');
 await sql('update private.test_readiness set ok=true');
 assert.equal(await sql('select public.whatsapp_claim_inbound_batch(1)'),'t','ready branch resumes processing');
 await sql('update private.es02_activation_foundation set ai_cost_enabled=false');
 assert.equal(await sql(`select enabled from public.ai_budget_accounts where subscription_id='${sub}'`),'f');
 assert.equal(await sql(`set role service_role;${invoke()}`),'BUDGET_DISABLED');
 await assert.rejects(sql('update private.es02_activation_foundation set ai_cost_monthly_limit_baisa=2000'),/ES02_COST_POLICY_IMMUTABLE/);
 assert.equal(await sql(`select has_function_privilege('service_role','private.es02_live_cost_policy_guard()','execute')`),'f');
 assert.equal(await sql(`select has_function_privilege('anon','public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text)','execute')`),'f');
 console.log('PASS: native budget binding, disabled default, scope rejection, immutable limit and role isolation');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
