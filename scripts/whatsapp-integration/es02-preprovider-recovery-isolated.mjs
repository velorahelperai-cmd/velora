// Expired lease safety: synthetic data in a disposable local PostgreSQL only.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile),name=`velora-recovery-${randomUUID().slice(0,8)}`;
let id;
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',z=>o+=z);p.stderr.on('data',z=>e+=z);p.on('close',n=>n?reject(Error(e)):resolve(o.trim()));p.stdin.end(q)});}
const company='11111111-1111-4111-8111-111111111111',conv='22222222-2222-4222-8222-222222222222',msg='33333333-3333-4333-8333-333333333333',job='44444444-4444-4444-8444-444444444444',claim='55555555-5555-4555-8555-555555555555';
try{
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=preprovider-recovery','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();
 for(let n=0;n<60;n++){try{await sql('select 1');await new Promise(r=>setTimeout(r,1500));await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
 await sql(`create role anon;create role authenticated;create role service_role;create schema private;create schema extensions;create extension pgcrypto with schema extensions;
 create table public.companies(id uuid primary key);
 create table public.whatsapp_conversations(id uuid primary key,company_id uuid,status text,automation_allowed boolean,automation_generation integer);
 create table public.whatsapp_messages(id uuid primary key,company_id uuid,conversation_id uuid);
 create table private.es02_activation_foundation(company_id uuid,ai_auto_start_at timestamptz);
 create table public.ai_usage_ledger(worker_job_id uuid);create table public.whatsapp_send_intents(original_job_id uuid);create table private.es02_reply_credit_holds(job_id uuid);
 create table public.whatsapp_inbound_jobs(id uuid primary key,company_id uuid,message_id uuid,status text,claim_token uuid,claim_expires_at timestamptz,
  expected_automation_generation integer,attempt_count integer,send_intent_id uuid,staged_ai_attempt_id uuid,staged_reply text,staged_citations jsonb,usage_status text,response_kind text,completed_at timestamptz,usage_period_start timestamptz,usage_subscription_id uuid,updated_at timestamptz default now());
 create function private.wa_claim_job_pre_accepted_usage(uuid,integer) returns jsonb language plpgsql as $$declare j public.whatsapp_inbound_jobs;begin
 select * into j from public.whatsapp_inbound_jobs where id=$1 for update;
 if j.attempt_count>=5 then return jsonb_build_object('ok',false,'code','attempts_exhausted');end if;
 if j.attempt_count>=5 then return jsonb_build_object('ok',false,'code','not_claimable');end if;
 update public.whatsapp_inbound_jobs set attempt_count=attempt_count+1,claim_token=gen_random_uuid(),claim_expires_at=clock_timestamp()+interval '2 minutes' where id=$1;
 return jsonb_build_object('ok',true);end$$;
 create function public.claim_whatsapp_inbound_job(uuid,integer) returns jsonb language sql as $$select private.wa_claim_job_pre_accepted_usage($1,$2)$$;
 create function public.whatsapp_claim_inbound_batch(integer) returns jsonb language plpgsql as $$declare candidate record;r jsonb;begin for candidate in select id from public.whatsapp_inbound_jobs loop
 r:=public.claim_whatsapp_inbound_job(candidate.id,120);
 end loop;return r;end$$;
 insert into public.companies values('${company}');insert into public.whatsapp_conversations values('${conv}','${company}','open',true,3);
 insert into public.whatsapp_messages values('${msg}','${company}','${conv}');insert into private.es02_activation_foundation values('${company}',clock_timestamp());
 insert into public.whatsapp_inbound_jobs(id,company_id,message_id,status,claim_token,claim_expires_at,expected_automation_generation,attempt_count)
  values('${job}','${company}','${msg}','claimed','${claim}',clock_timestamp()-interval '1 minute',3,5);`);
 await sql(await readFile('supabase/migrations/20261102134118_es02_recover_preprovider_claim.sql','utf8'));
 const concurrent=await Promise.all(Array.from({length:2},()=>sql(`select private.es02_record_preprovider_expiry('${job}')`)));
 assert.equal(concurrent.filter(x=>x==='t').length,1,'same expired claim is counted once, including concurrent recovery');
 assert.equal(await sql(`select attempt_count||':'||preprovider_transport_recoveries from public.whatsapp_inbound_jobs where id='${job}'`),'5:1');
 assert.equal(await sql('select public.whatsapp_claim_inbound_batch(1)->>\'ok\''),'true');
 assert.equal(await sql(`select attempt_count||':'||preprovider_transport_recoveries from public.whatsapp_inbound_jobs where id='${job}'`),'6:1');
 for(const [label,change] of [
  ['send intent',`insert into public.whatsapp_send_intents values('${job}')`],
  ['credit hold',`insert into private.es02_reply_credit_holds values('${job}')`],
  ['staged reply',`update public.whatsapp_inbound_jobs set staged_reply='synthetic' where id='${job}'`],
  ['unknown accounting',`update public.whatsapp_inbound_jobs set usage_status='unknown' where id='${job}'`],
  ['completed evidence',`update public.whatsapp_inbound_jobs set completed_at=clock_timestamp() where id='${job}'`],
  ['billing binding',`update public.whatsapp_inbound_jobs set usage_subscription_id=gen_random_uuid() where id='${job}'`],
  ['handover',`update public.whatsapp_conversations set status='handed_over',automation_allowed=false where id='${conv}'`],
  ['generation change',`update public.whatsapp_conversations set automation_generation=4 where id='${conv}'`],
  ['unexpired lease',`update public.whatsapp_inbound_jobs set claim_expires_at=clock_timestamp()+interval '1 minute' where id='${job}'`],
 ]) assert.equal(await sql(`begin;update public.whatsapp_inbound_jobs set claim_token=gen_random_uuid(),claim_expires_at=clock_timestamp()-interval '1 second' where id='${job}';${change};select private.es02_record_preprovider_expiry('${job}');rollback`),'f',label+' blocks pre-provider recovery');
 await sql(`update public.whatsapp_inbound_jobs set claim_token='${claim}',claim_expires_at=clock_timestamp()-interval '1 second' where id='${job}';insert into public.ai_usage_ledger values('${job}')`);
 assert.equal(await sql(`select private.es02_record_preprovider_expiry('${job}')`),'f','any model evidence blocks transport-only recovery');
 assert.equal(await sql(`select has_function_privilege('service_role','private.es02_record_preprovider_expiry(uuid)','execute')`),'f');
 console.log('PASS: expired claim recovery preserves history, deduplicates concurrency and refuses model evidence');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
