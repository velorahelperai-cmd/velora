import {beforeAll,expect,it} from 'vitest';
// @ts-expect-error External guarded SQL fixture, not a production client.
import {bootstrap,file,sql,lit} from '../../../scripts/instagram-connection/postgres.mjs';
const migration='supabase/migrations/20261012002415_vel_instagram_owner_lifecycle.sql';
const id=(n:number)=>`baabcdef-0000-4000-8000-${String(n).padStart(12,'0')}`;
let sequence=100;
beforeAll(async()=>{await bootstrap('supabase/migrations/20261011184625_vel_instagram_connection_store.sql');await file(migration);
 // Reuse the previously installed, explicitly labelled SQL Vault double. This
 // creates it only in this owned DB; no extension files or global ACLs change.
 await sql("create extension supabase_vault version '0.0.0-fixture'");},30000);
async function fixture(){
 const n=sequence+=100,c=id(n+1),u=id(n+2),sid=id(n+3),sid2=id(n+4),staff=id(n+5),ss=id(n+6),attempt=id(n+7),link=id(n+8);
 await sql(`insert into auth.users(id,email_confirmed_at) values('${u}',clock_timestamp()),('${staff}',clock_timestamp());
 insert into auth.sessions(id,user_id) values('${sid}','${u}'),('${sid2}','${u}'),('${ss}','${staff}');
 insert into public.companies values('${c}','Synthetic owner lifecycle','active');
 insert into public.company_members(company_id,user_id,role,status) values('${c}','${u}','owner','active'),('${c}','${staff}','staff','active');
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${sid}','${u}',clock_timestamp()),('${sid2}','${u}',clock_timestamp()),('${ss}','${staff}',clock_timestamp());
 insert into private.instagram_provider_contracts values('fixture-${n}','1000',array['instagram_business_basic','instagram_business_manage_messages'],false);
 insert into private.instagram_company_generations values('${c}',1);
 insert into private.instagram_oauth_attempts(id,company_id,user_id,session_id,generation,app_id,contract_id,nonce_hash,status,expires_at,stage_receipt,secret_id,stage_fingerprint,account_id,permissions,authorization_expires_at,link_id,bound_at)
 values('${attempt}','${c}','${u}','${sid}',1,'1000','fixture-${n}',repeat('a',64),'bound',clock_timestamp()+interval '10 minutes','${id(n+9)}','${id(n+10)}','synthetic','${n}',array['synthetic'],clock_timestamp()+interval '1 day','${link}',clock_timestamp());
 insert into private.instagram_company_links(id,company_id,generation,attempt_id,account_id,app_id,contract_id,secret_id,permissions,authorization_expires_at)
 values('${link}','${c}',1,'${attempt}','${n}','1000','fixture-${n}','${id(n+10)}',array['synthetic'],clock_timestamp()+interval '1 day');`);
 const run=async(name:string,args:string[],actor=u,session=sid)=>JSON.parse(await sql(`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:actor,session_id:session,role:'authenticated'}))};select public.${name}(${args.join(',')});`));
 return {n,c,u,sid,sid2,staff,ss,attempt,link,run,disconnect:(gen=1,actor=u,session=sid,l=link)=>run('instagram_disconnect_connection',[lit(c),lit(l),String(gen)],actor,session)};
}
it('owner status projects only public binding and blocks staff including global-admin claims',async()=>{
 const f=await fixture(),r=await f.run('instagram_owner_connection',[lit(f.c),"'1000'",lit(`fixture-${f.n}`)]);
 expect(r).toEqual({ok:true,generation:1,link:{linkId:f.link,accountId:String(f.n),generation:1},attemptKind:'bound',contractReady:false});
 expect(await f.run('instagram_owner_connection',[lit(f.c),'null','null'],f.staff,f.ss)).toEqual({ok:false,code:'FORBIDDEN'});
 expect(JSON.stringify(r)).not.toContain('secret');
});
it('native attempt lookup requires exact original user/session and company',async()=>{
 const f=await fixture();expect(await f.run('instagram_owner_attempt',[lit(f.c),lit(f.attempt)])).toMatchObject({ok:true,binding:{attemptId:f.attempt,sessionId:f.sid}});
 expect(await f.run('instagram_owner_attempt',[lit(f.c),lit(f.attempt)],f.u,f.sid2)).toEqual({ok:false,code:'FORBIDDEN'});
});
it('disconnect fences exactly once and preserves bound history and secret reference',async()=>{
 const f=await fixture();expect(await f.disconnect()).toEqual({ok:true,linkId:f.link,generation:2});
 expect(await f.disconnect()).toEqual({ok:true,linkId:f.link,generation:2});
 expect(await sql(`select status||':'||secret_id::text from private.instagram_company_links where id='${f.link}'`)).toBe(`retired:${id(f.n+10)}`);
 expect(await sql(`select status from private.instagram_oauth_attempts where id='${f.attempt}'`)).toBe('bound');
 expect(await sql(`select count(*) from public.admin_audit_logs where company_id='${f.c}' and action='instagram.connection_disconnected'`)).toBe('1');
});
it('current owner second session may disconnect, staff and revoked session may not',async()=>{
 const f=await fixture();expect(await f.disconnect(1,f.staff,f.ss)).toEqual({ok:false,code:'FORBIDDEN'});
 await sql(`update private.app_session_activity set expired_at=clock_timestamp() where session_id='${f.sid}'`);
 expect(await f.disconnect()).toEqual({ok:false,code:'FORBIDDEN'});
 expect((await f.disconnect(1,f.u,f.sid2)).ok).toBe(true);
});
it('stale generation and foreign link never retire a binding',async()=>{
 const f=await fixture();expect(await f.disconnect(0)).toEqual({ok:false,code:'CONFLICT'});
 expect(await f.disconnect(1,f.u,f.sid,id(99999))).toEqual({ok:false,code:'FORBIDDEN'});
 expect(await sql(`select status from private.instagram_company_links where id='${f.link}'`)).toBe('active');
});
it('pending reauthorization uses current company generation and is fenced on disconnect',async()=>{
 const f=await fixture(),a=id(f.n+20);
 await sql(`update private.instagram_company_generations set generation=2 where company_id='${f.c}';
 insert into private.instagram_oauth_attempts(id,company_id,user_id,session_id,generation,app_id,contract_id,nonce_hash,expires_at) values('${a}','${f.c}','${f.u}','${f.sid}',2,'1000','fixture-${f.n}',repeat('b',64),clock_timestamp()+interval '10 minutes');`);
 expect(await f.disconnect(2)).toEqual({ok:true,linkId:f.link,generation:3});
 expect(await sql(`select status from private.instagram_oauth_attempts where id='${a}'`)).toBe('cancelled');
});
it('retired replay cannot retire a later active link',async()=>{
 const f=await fixture();await f.disconnect();const a=id(f.n+20),l=id(f.n+21);
 await sql(`update private.instagram_company_generations set generation=3 where company_id='${f.c}';
 insert into private.instagram_oauth_attempts(id,company_id,user_id,session_id,generation,app_id,contract_id,nonce_hash,expires_at) values('${a}','${f.c}','${f.u}','${f.sid}',3,'1000','fixture-${f.n}',repeat('b',64),clock_timestamp()+interval '10 minutes');
 insert into private.instagram_company_links(id,company_id,generation,attempt_id,account_id,app_id,contract_id,secret_id,permissions,authorization_expires_at) values('${l}','${f.c}',3,'${a}','${f.n}','1000','fixture-${f.n}','${id(f.n+10)}',array['synthetic'],clock_timestamp()+interval '1 day');`);
 expect(await f.disconnect()).toEqual({ok:true,linkId:f.link,generation:3});
 expect(await sql(`select status from private.instagram_company_links where id='${l}'`)).toBe('active');
});
it('no public/anon/service execution or private table grants are introduced',async()=>{
 expect(await sql("select has_function_privilege('anon','public.instagram_disconnect_connection(uuid,uuid,bigint)','execute') or has_function_privilege('service_role','public.instagram_disconnect_connection(uuid,uuid,bigint)','execute') or has_table_privilege('authenticated','private.instagram_company_links','select')")).toBe('f');
});
it('a stale pending status followed by a committed claim cannot authorize a new start',async()=>{
 const f=await fixture(),a=id(f.n+20),b={companyId:f.c,userId:f.u,sessionId:f.sid,attemptId:a,generation:2,appId:'1000',contractId:`fixture-${f.n}`};
 await sql(`update private.instagram_provider_contracts set enabled=true where contract_id='fixture-${f.n}';update private.instagram_company_generations set generation=2 where company_id='${f.c}';
 insert into private.instagram_oauth_attempts(id,company_id,user_id,session_id,generation,app_id,contract_id,nonce_hash,expires_at) values('${a}','${f.c}','${f.u}','${f.sid}',2,'1000','fixture-${f.n}',encode(sha256(repeat('b',64)::bytea),'hex'),clock_timestamp()+interval '10 minutes');`);
 expect(await f.run('instagram_owner_connection',[lit(f.c),"'1000'",lit(`fixture-${f.n}`)])).toMatchObject({attemptKind:'pending',contractReady:true});
 expect(await f.run('instagram_claim_connection',[lit(JSON.stringify(b))+'::jsonb',lit('b'.repeat(64))])).toMatchObject({kind:'claimed',committed:true});
 expect(await f.run('instagram_start_connection',[lit(f.c),lit(id(f.n+21)),lit('c'.repeat(64)),"'1000'",lit(`fixture-${f.n}`),'2'])).toEqual({ok:false,code:'RECONCILIATION_REQUIRED'});
 expect(await sql(`select generation from private.instagram_company_generations where company_id='${f.c}'`)).toBe('2');
 expect(await sql(`select status from private.instagram_oauth_attempts where id='${a}'`)).toBe('claimed');
});
it('explicit disconnect fences unknown history and permits a fresh current-generation start',async()=>{
 const f=await fixture(),a=id(f.n+20);
 await sql(`update private.instagram_provider_contracts set enabled=true where contract_id='fixture-${f.n}';update private.instagram_company_generations set generation=2 where company_id='${f.c}';
 insert into private.instagram_oauth_attempts(id,company_id,user_id,session_id,generation,app_id,contract_id,nonce_hash,status,expires_at) values('${a}','${f.c}','${f.u}','${f.sid}',2,'1000','fixture-${f.n}',repeat('b',64),'unknown',clock_timestamp()+interval '10 minutes');`);
 expect(await f.disconnect(2)).toMatchObject({ok:true,generation:3});
 expect(await f.run('instagram_owner_connection',[lit(f.c),"'1000'",lit(`fixture-${f.n}`)])).toMatchObject({attemptKind:null,link:null,generation:3});
 expect(await f.run('instagram_start_connection',[lit(f.c),lit(id(f.n+21)),lit('c'.repeat(64)),"'1000'",lit(`fixture-${f.n}`),'3'])).toMatchObject({ok:true,binding:{generation:4}});
 expect(await sql(`select status from private.instagram_oauth_attempts where id='${a}'`)).toBe('unknown');
});
it.each(['native','idle'])('expiry during disconnect audit rolls back mutation and audit (%s deadline)',async kind=>{
 const f=await fixture(),name=`expiry_probe_${f.n}`;
 await sql(`create sequence private.${name};create function private.${name}() returns trigger language plpgsql set search_path='' as $$begin
 if new.company_id='${f.c}' and new.action='instagram.connection_disconnected' then perform nextval('private.${name}');perform pg_sleep(0.8);end if;return new;end;$$;
 create trigger ${name} before insert on public.admin_audit_logs for each row execute function private.${name}();
 ${kind==='native'?`update auth.sessions set not_after=clock_timestamp()+interval '0.5 seconds' where id='${f.sid}';`:`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '2 hours'+interval '0.5 seconds' where session_id='${f.sid}';`}`);
 expect(await f.disconnect()).toEqual({ok:false,code:'FORBIDDEN'});
 expect(await sql(`select is_called from private.${name}`)).toBe('t');
 expect(await sql(`select status from private.instagram_company_links where id='${f.link}'`)).toBe('active');
 expect(await sql(`select generation from private.instagram_company_generations where company_id='${f.c}'`)).toBe('1');
 expect(await sql(`select count(*) from public.admin_audit_logs where company_id='${f.c}' and action='instagram.connection_disconnected'`)).toBe('0');
});
// No teardown deletion: retain the isolated synthetic DB for evidence. No Vault
// real Auth/PostgREST/cryptographic Vault, provider calls or production access.
