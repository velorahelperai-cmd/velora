import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const exec=promisify(execFile),name=`velora-active-ingress-${randomUUID().slice(0,8)}`;let id;
function sql(q){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let o='',e='';p.stdout.on('data',z=>o+=z);p.stderr.on('data',z=>e+=z);p.on('close',n=>n?reject(Error(e)):resolve(o.trim()));p.stdin.end(q);});}
const A='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333',G='44444444-4444-4444-8444-444444444444',B='55555555-5555-4555-8555-555555555555',T='66666666-6666-4666-8666-666666666666';
try{id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=active-ingress','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine'],{windowsHide:true})).stdout.trim();for(let i=0;i<60;i++){try{await sql('select 1');break}catch{await new Promise(r=>setTimeout(r,200));}}
await sql(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;
create table auth.users(id uuid,email_confirmed_at timestamptz,deleted_at timestamptz);
create table public.companies(id uuid,status text);create table public.company_branches(id uuid,company_id uuid,status text);
create table private.es02_activation_foundation(company_id uuid,account_id uuid,order_id uuid,order_group_id uuid,clock_state text,paid_through_at timestamptz);
create table private.es02_account_orders(id uuid,provisioned_company_id uuid,account_id uuid,original_order_group_id uuid,status text,environment text,settlement_authority text,settled_at timestamptz,provider_transaction_id text,amount_baisa int,currency text);
create table private.es02_account_settlement_events(order_id uuid,account_id uuid,provider_transaction_id text,outcome text,amount_baisa int,evidence_marker text,currency text);
create table public.billing_subscriptions(id uuid,company_id uuid,environment text,plan_version_id uuid,status text,paid_through timestamptz);
create table private.es02_branch_slot_rights(company_id uuid,branch_id uuid,order_id uuid);
create table private.es02_branch_channel_selections(company_id uuid,branch_id uuid,account_id uuid,channels jsonb);
create table private.es02_b3_connection_attempts(id uuid,status text);
create table private.es02_b3_connection_links(company_id uuid,branch_id uuid,channel text,status text,revoked_at timestamptz,verified boolean,attempt_id uuid);
create function private.es02_verified_live_catalog_order(private.es02_account_orders) returns boolean language sql as $$select false$$;
create function private.whatsapp_resolve_conversation_branch(uuid,text,timestamptz) returns uuid language sql as $$select case when $1='${A}'::uuid and $2='123' then '${B}'::uuid else null end$$;
create function private.es02_b3_current_binding(uuid,uuid,uuid,text) returns jsonb language sql as $$select '{"ok":true}'::jsonb$$;
create function private.es02_b3_pin_matches(private.es02_b3_connection_attempts,jsonb) returns boolean language sql as $$select true$$;
create function private.billing_chat_access(uuid,text) returns boolean language sql as $$select false$$;
create function private.whatsapp_meta_asset_binding(text,text) returns jsonb language plpgsql security definer set search_path='' as $body$ declare gate jsonb; p_phone_number_id alias for $2; begin gate:=jsonb_build_object('ok',true,'company_id','${A}'); if not private.billing_chat_access((gate->>'company_id')::uuid,'whatsapp') then return jsonb_build_object('ok',false,'code','subscription_link_grace_elapsed');end if;return gate;end; $body$;
insert into auth.users values('${U}',now(),null);insert into public.companies values('${A}','active');insert into public.company_branches values('${B}','${A}','active');
insert into private.es02_activation_foundation values('${A}','${U}','${O}','${G}','active','2030-01-01');
insert into private.es02_account_orders values('${O}','${A}','${U}','${G}','provisioned','live','paymob_hmac',now(),'fixture',45000,'OMR');
insert into private.es02_account_settlement_events values('${O}','${U}','fixture','applied',45000,null,'OMR');
insert into public.billing_subscriptions values(gen_random_uuid(),'${A}','live',null,'active','2030-01-01');
insert into private.es02_branch_slot_rights values('${A}','${B}','${O}');insert into private.es02_branch_channel_selections values('${A}','${B}','${U}','["whatsapp"]');
insert into private.es02_b3_connection_attempts values('${T}','bound');insert into private.es02_b3_connection_links values('${A}','${B}','whatsapp','active',null,true,'${T}');`);
assert.equal(await sql("select private.whatsapp_meta_asset_binding('waba','123')->>'code'"),'subscription_link_grace_elapsed','reproduces post-activation refusal');
await sql((await readFile('supabase/migrations/20261102152045_es02_active_whatsapp_ingress.sql','utf8')).replaceAll('\r\n','\n'));
assert.equal(await sql("select private.whatsapp_meta_asset_binding('waba','123')->>'ok'"),'true','paid active binding accepted');
assert.equal(await sql(`select private.es02_active_whatsapp_ingress('${A}','wrong')`),'f','wrong phone denied');
await sql("update private.es02_account_settlement_events set outcome='rejected'");assert.equal(await sql(`select private.es02_active_whatsapp_ingress('${A}','123')`),'f','unverified settlement denied');await sql("update private.es02_account_settlement_events set outcome='applied'");
await sql("update public.billing_subscriptions set paid_through='2020-01-01'");assert.equal(await sql(`select private.es02_active_whatsapp_ingress('${A}','123')`),'f','changed subscription denied');await sql("update public.billing_subscriptions set paid_through='2030-01-01'");
await sql("update private.es02_b3_connection_links set revoked_at=now()");assert.equal(await sql(`select private.es02_active_whatsapp_ingress('${A}','123')`),'f','revoked binding denied');
assert.equal(await sql("select has_function_privilege('authenticated','private.es02_active_whatsapp_ingress(uuid,text)','execute')"),'f');
console.log('PASS: post-activation ingress, exact phone, verified payment, active subscription, revoked binding and ACL');
}finally{if(id)await exec('docker',['rm','-f',id],{windowsHide:true}).catch(()=>{});}
