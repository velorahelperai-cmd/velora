import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile),name=`velora-owner-balance-${randomUUID().slice(0,8)}`;let id;
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',z=>o+=z);p.stderr.on('data',z=>e+=z);p.on('close',n=>n?reject(Error(e)):resolve(o.trim()));p.stdin.end(q);});}
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333',G='44444444-4444-4444-8444-444444444444',S='55555555-5555-4555-8555-555555555555',C='66666666-6666-4666-8666-666666666666';
try {
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=owner-balance','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();
 for(let i=0;i<60;i++){try{await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
 await sql(`create role anon;create role authenticated;create role service_role;create schema private;
 create table private.es02_activation_foundation(company_id uuid,order_id uuid,order_group_id uuid,ai_cost_subscription_id uuid,clock_state text,paid_through_at timestamptz);
 create table private.es02_account_orders(id uuid,provisioned_company_id uuid,original_order_group_id uuid,status text,environment text,settled_at timestamptz);
 create table public.billing_subscriptions(id uuid,company_id uuid,environment text,plan_version_id uuid,status text,paid_through timestamptz);
 create table private.es02_credit_balances(id uuid,company_id uuid,kind text,order_group_id uuid,ordinary_expiry timestamptz,granted int,remaining int);
 create table private.es02_reply_credit_holds(balance_id uuid,company_id uuid,state text);
 create function public.billing_read_company_display_evidence(p uuid) returns jsonb language sql as $$select case when p='${A}'::uuid and current_setting('request.test_owner',true)='yes' then jsonb_build_object('ok',true,'data',jsonb_build_object('company_id',p)) else jsonb_build_object('ok',false,'code','forbidden') end$$;
 insert into private.es02_activation_foundation values('${A}','${O}','${G}','${S}','active','2030-01-01');
 insert into private.es02_account_orders values('${O}','${A}','${G}','provisioned','live',now());
 insert into public.billing_subscriptions values('${S}','${A}','live',null,'active','2030-01-01');
 insert into private.es02_credit_balances values('${C}','${A}','base','${G}',null,1000,999), (gen_random_uuid(),'${A}','base',gen_random_uuid(),null,1000,1000);
 `);
 await sql(await readFile('supabase/migrations/20261102150556_es02_owner_reply_balance.sql','utf8'));
 const read=async(company,owner='yes')=>JSON.parse(await sql(`set role authenticated;set request.test_owner='${owner}';select public.es02_read_owner_reply_balance('${company}');`));
 assert.deepEqual(await read(A),{ok:true,data:{company_id:A,granted:1000,remaining:999,held:0,paid_through:'2030-01-01T00:00:00+00:00'}});
 assert.equal((await read(B)).code,'forbidden');assert.equal((await read(A,'no')).code,'forbidden');
 await sql(`insert into private.es02_reply_credit_holds values('${C}','${A}','held')`);assert.equal((await read(A)).data.held,1);
 await sql(`insert into private.es02_credit_balances values(gen_random_uuid(),'${A}','purchased',null,null,50,40)`);assert.equal((await read(A)).data.remaining,1039);
 await sql(`insert into private.es02_credit_balances values(gen_random_uuid(),'${A}','base','${G}',null,1,1)`);
 assert.equal((await read(A)).code,'unavailable','ambiguous base balances are rejected');
 await sql(`update private.es02_credit_balances set order_group_id=gen_random_uuid() where company_id='${A}' and kind='base' and granted=1`);
 assert.equal((await read(A)).ok,true,'balance becomes readable when ambiguity is resolved');
 await sql(`update private.es02_activation_foundation set clock_state='waiting_readiness'`);assert.equal((await read(A)).code,'unavailable');
 assert.equal(await sql("select has_function_privilege('anon','public.es02_read_owner_reply_balance(uuid)','execute')"),'f');
 console.log('PASS: scoped owner balance, old order exclusion, purchased credits, held credits, invalid ownership and inactive clock');
} finally {if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
