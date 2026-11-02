// Native PostgreSQL tests for the production migration and real quota/dispatch SQL.
// Session, signed-window and historical claim kernel dependencies are explicit contract doubles.
import {readFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const container='velora-f42-'+randomUUID().slice(0,8);
const env=Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','SystemDrive','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','DOCKER_CONFIG'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
const run=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,env});
const id=n=>`abcdefab-0000-4000-8000-${String(n).padStart(12,'0')}`;
const lit=s=>`'${s.replaceAll("'","''")}'`;
if(run(['run','--detach','--pull=never','--name',container,'--network','none','--memory','512m','--cpus','1','--log-driver','none','-e','POSTGRES_PASSWORD=local-fixture-only','postgres:17.6-alpine','postgres','-c','shared_buffers=32MB']).status!==0)throw Error('CONTAINER_FAILED');
try{
 const deadline=Date.now()+60000;while(run(['exec',container,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres']).status!==0){if(Date.now()>deadline)throw Error('POSTGRES_NOT_READY');await new Promise(r=>setTimeout(r,400));}
 if(run(['exec',container,'createdb','-U','postgres','f42_fixture']).status!==0)throw Error('FIXTURE_DATABASE_FAILED');
 const sql=s=>{const r=run(['exec','-i',container,'psql','-U','postgres','-d','f42_fixture','-X','-Atq','-v','ON_ERROR_STOP=1'],s);if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout.trim();};
 sql(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
 create schema private;create schema if not exists auth;create table auth.users(id uuid primary key);
 create or replace function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create or replace function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth to authenticated;
 create table public.companies(id uuid primary key,status text);create table public.company_members(company_id uuid,user_id uuid,role text,status text);
 create table public.whatsapp_company_links(id uuid primary key,provider_waba_id text);
 create table public.whatsapp_conversations(id uuid primary key,company_id uuid,phone_number_id text,customer_wa_id text,assigned_to uuid);
 create table public.whatsapp_send_intents(id uuid primary key,company_id uuid,conversation_id uuid,phone_number_id text,recipient_wa_id text,sender_kind text,actor_user_id uuid,staff_actor_session_id uuid,link_id uuid,link_generation bigint,body text,outcome text,attempt_token uuid,attempt_expires_at timestamptz,staff_dispatch_token uuid,staff_dispatch_authorized_at timestamptz,staff_claim_plan_version_id uuid,staff_claim_paid_through timestamptz,staff_review_grant_id uuid);
 create function private.whatsapp_intent_link_current(public.whatsapp_send_intents) returns boolean language sql as $$select coalesce(current_setting('fixture.link',true),'true')='true'$$;
 create function private.wa_f5_number_unconfirmed(uuid,bigint) returns boolean language sql as $$select coalesce(current_setting('fixture.unconfirmed',true),'false')='true'$$;
 create function private.whatsapp_service_window(uuid,uuid,text,text) returns jsonb language sql as $$select jsonb_build_object('ok',coalesce(current_setting('fixture.window_open',true),'true')='true','valid_until',clock_timestamp()+interval '1 hour')$$;
 create function private.wa_staff_session_authority(uuid,uuid,uuid,uuid) returns boolean language sql as $$select coalesce(current_setting('fixture.session_valid',true),'true')='true'$$;
 create function private.wa_claim_pre_fixed_ack(i uuid,u uuid,s int) returns jsonb language plpgsql as $$declare r public.whatsapp_send_intents%rowtype;begin update public.whatsapp_send_intents set outcome='attempting',attempt_token=gen_random_uuid(),attempt_expires_at=clock_timestamp()+interval '90 seconds' where id=i and outcome='ready' returning * into r;if not found then return jsonb_build_object('ok',true,'claimed',false);end if;return jsonb_build_object('ok',true,'claimed',true,'attempt_token',r.attempt_token,'intent',to_jsonb(r));end$$;
 insert into auth.users(id) values('${id(2)}');insert into public.companies values('${id(1)}','active');insert into public.company_members values('${id(1)}','${id(2)}','owner','active');
 insert into public.whatsapp_company_links values('${id(3)}','600');insert into public.whatsapp_conversations values('${id(4)}','${id(1)}','500','96890000420',null);`);
 const authority=readFileSync('supabase/migrations/20261013162534_meta_review_manual_authority.sql','utf8');
 sql(authority);
 sql(readFileSync('supabase/migrations/20261102050244_whatsapp_bounded_manual_review.sql','utf8'));
 // CREATE OR REPLACE preserves existing RPC ACLs in production; fixture starts absent.
 sql(`revoke all on function public.claim_whatsapp_review_send(uuid,uuid,uuid),public.whatsapp_authorize_review_dispatch(uuid,uuid,uuid) from public,anon,authenticated,service_role;
 grant execute on function public.claim_whatsapp_review_send(uuid,uuid,uuid) to service_role;
 grant execute on function public.whatsapp_authorize_review_dispatch(uuid,uuid,uuid) to authenticated;
 insert into private.channel_review_grants(id,company_id,owner_id,channel,app_id,asset_id,source_account_id,recipient_ids,webhook_secret_sha256,send_limit,created_by,expires_at,review_conversation_id,review_link_id,review_link_generation,review_body_sha256)
 values('${id(5)}','${id(1)}','${id(2)}','whatsapp','100','500','600',array['96890000420'],null,1,'${id(2)}',clock_timestamp()+interval '30 minutes','${id(4)}','${id(3)}',7,encode(sha256(convert_to('approved','UTF8')),'hex'));
 insert into public.whatsapp_send_intents(id,company_id,conversation_id,phone_number_id,recipient_wa_id,sender_kind,actor_user_id,staff_actor_session_id,link_id,link_generation,body,outcome)
 select ('abcdefab-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(1)}','${id(4)}','500','96890000420','staff','${id(2)}','${id(6)}','${id(3)}',7,'approved','ready' from generate_series(10,35)n;`);
 const claim=(n=10,prefix='')=>JSON.parse(sql(`${prefix}set role service_role;select public.claim_whatsapp_review_send('${id(n)}','${id(2)}','${id(5)}');`));
 let cases=0;
 for(const [field,value] of [['body',"'different'"],['recipient_wa_id',"'96890000421'"],['phone_number_id',"'501'"],['link_generation','8'],['link_id','null'],['sender_kind',"'assistant'"],['company_id',`'${id(8)}'`],['actor_user_id',`'${id(8)}'`]]){
  const before=sql(`select ${field} from public.whatsapp_send_intents where id='${id(10)}'`);
  sql(`update public.whatsapp_send_intents set ${field}=${value} where id='${id(10)}'`);assert.notEqual(claim().claimed,true,field);sql(`update public.whatsapp_send_intents set ${field}=${lit(before)} where id='${id(10)}'`);cases++;
 }
 for(const prefix of ["set fixture.window_open='false';","set fixture.link='false';","set fixture.unconfirmed='true';"]){assert.notEqual(claim(10,prefix).claimed,true);cases++;}
 assert.equal(sql(`select used_count from private.channel_review_grants where id='${id(5)}'`),'0');
 const concurrent=n=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','f42_fixture','-X','-Atq','-v','ON_ERROR_STOP=1'],{env,windowsHide:true});let out='',err='';
  child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve({n,result:JSON.parse(out.trim())}));
  child.stdin.end(`set role service_role;select public.claim_whatsapp_review_send('${id(n)}','${id(2)}','${id(5)}');`);
 });
 const races=await Promise.all([concurrent(10),concurrent(11)]);assert.equal(races.filter(r=>r.result.claimed===true).length,1);
 const winner=races.find(r=>r.result.claimed===true);const first=winner.result;const winnerId=id(winner.n);
 assert.equal(first.review_entitlement.grant_id,id(5));cases++;
 assert.notEqual(claim(winner.n).claimed,true);assert.equal(claim(12).code,'subscription_inactive');cases+=2;
 assert.equal(sql(`select outcome from public.whatsapp_send_intents where id='${id(12)}'`),'ready');
 const dispatch=(prefix='')=>JSON.parse(sql(`${prefix}set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:id(2),session_id:id(6)}))};select public.whatsapp_authorize_review_dispatch('${winnerId}','${first.attempt_token}','${id(5)}');`));
 assert.notEqual(dispatch("set fixture.session_valid='false';").authorized,true);assert.notEqual(dispatch("set fixture.link='false';").authorized,true);cases+=2;
 sql(`update private.channel_review_grants set revoked_at=clock_timestamp() where id='${id(5)}'`);assert.notEqual(dispatch().authorized,true);sql(`update private.channel_review_grants set revoked_at=null where id='${id(5)}'`);cases++;
 assert.equal(dispatch().authorized,true);assert.notEqual(dispatch().authorized,true);cases+=2;
 assert.equal(sql(`select used_count from private.channel_review_grants where id='${id(5)}'`),'1');
 assert.equal(sql(`select count(*) from private.channel_review_uses`),'1');
 assert.equal(sql(`select has_function_privilege('authenticated','private.wa_review_binding_current(private.channel_review_grants,public.whatsapp_send_intents)','EXECUTE')`),'f');
 console.log('PASS '+cases+' native bounded review cases; exact binding, quota rollback, idempotency, revocation, final dispatch, ACL. Dependency doubles; not live delivery.');
}finally{run(['stop','-t','1',container]);console.log('Stopped '+container);}
