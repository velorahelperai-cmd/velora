// Native isolated PostgreSQL + GoTrue + PostgREST. No project env or providers.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startStack} from './local-http-stack.mjs';

const enterpriseSql=await readFile(process.argv[2]??'supabase/migrations/20261014025849_enterprise_branch_authority.sql','utf8');
const operationsSql=await readFile(process.argv[3]&&process.argv[3]!=='--ui'?process.argv[3]:'supabase/migrations/20261014032142_enterprise_staff_operations.sql','utf8');
const lifecycleSql=await readFile(process.argv[4]&&process.argv[4]!=='--ui'?process.argv[4]:'supabase/migrations/20261014051045_enterprise_business_lifecycle_guard.sql','utf8');
const smartSql=await readFile('supabase/migrations/20261014031209_smart_progressive_onboarding.sql','utf8');
const stack=await startStack({gatewayPort:3330,authPort:3340,restPort:3341,appOrigin:'http://127.0.0.1:3320',throughMigration:'20261009215520_g03_verified_review.sql',progress:console.log});
let passed=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);passed++;};
try{
 await stack.sql('begin;'+await readFile('supabase/migrations/20261011160000_vel_staff_invitation_recovery.sql','utf8')+'commit;');
 eq((await stack.rows("select to_regprocedure('public.read_smart_branch_setup(uuid)')::text as rpc"))[0].rpc,null,'RED: smart setup absent on baseline');
 await stack.sql(enterpriseSql);await stack.sql(operationsSql);await stack.sql(smartSql);await stack.sql(lifecycleSql);
 await stack.sql("notify pgrst,'reload schema';");
 const owner=await stack.adminCreateUser(),staff=await stack.adminCreateUser(),stranger=await stack.adminCreateUser();
 const company=randomUUID(),other=randomUUID();
 await stack.sql(`insert into public.companies(id,display_name,status,created_by) values ('${company}','Fixture','setup','${owner.id}'),('${other}','Fixture','setup','${stranger.id}');
 insert into public.company_members(company_id,user_id,role,status) values ('${company}','${owner.id}','owner','active'),('${other}','${stranger.id}','owner','active'),('${company}','${staff.id}','staff','active');`);
 async function login(u){const r=await fetch(`${stack.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:stack.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password:u.password})});assert.equal(r.status,200);return (await r.json()).access_token;}
 const tokens=new Map();for(const user of [owner,staff,stranger])tokens.set(user.id,await login(user));
 async function rpc(user,name,args={},token=tokens.get(user.id)){
  const response=await fetch(`${stack.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:stack.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
  const result=await response.json();if(!response.ok)throw Error(`${name}: ${JSON.stringify(result)}`);return result;
 }
 for(const user of [owner,staff,stranger])eq((await rpc(user,'check_app_session',{p_touch:true})).ok,true,'native session');
 const read=()=>rpc(owner,'read_smart_branch_setup',{p_company_id:company});
 const save=(revision,mode,name,expectedName)=>rpc(owner,'save_smart_branch_setup',{p_company_id:company,p_expected_revision:revision,p_mode:mode,p_primary_name:name,p_expected_primary_name:expectedName});
 const initial=(await read()).data;
 eq(initial.mode,null,'branch mode requires explicit choice');eq(initial.branches.length,1,'one primary created');
 eq((await rpc(stranger,'read_smart_branch_setup',{p_company_id:company})).ok,false,'cross tenant read denied');
 eq((await rpc(staff,'save_smart_branch_setup',{p_company_id:company,p_expected_revision:0,p_mode:'single',p_primary_name:'Injected',p_expected_primary_name:'Fixture'})).ok,false,'staff write denied');
 const first=await save(0,'single','Main','Fixture');eq(first.ok,true,'single branch persisted');eq(first.data.revision,1,'revision receipt');
 eq(await save(0,'single','Main','Fixture'),first,'lost response retry idempotent');
 eq((await read()).data.branches.length,1,'retries never duplicate primary');
 const device=await login(owner);eq((await rpc(owner,'check_app_session',{p_touch:true},device)).ok,true,'second device session');
 eq((await rpc(owner,'read_smart_branch_setup',{p_company_id:company},device)).data,first.data,'cross device resume');
 // A key-share blocker allows both authorization reads but delays the company
 // update. This exposes a shared-lock upgrade deadlock deterministically.
 const casLock=stack.sql(`begin;select 1 from public.companies where id='${company}' for key share;select pg_sleep(4) /* SMART_CAS_LOCK */;commit;`);
 let casLocked=false;
 for(let attempt=0;attempt<20;attempt++){
  casLocked=(await stack.rows("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like '%SMART_CAS_LOCK%') as locked"))[0].locked;
  if(casLocked)break;await new Promise(r=>setTimeout(r,50));
 }
 assert.equal(casLocked,true,'concurrent fixture company lock acquired');
 const settled=await Promise.allSettled([save(1,'multiple','Main A','Main'),save(1,'multiple','Main B','Main')]);
 await casLock;
 eq(settled.filter(result=>result.status==='rejected').length,0,'concurrent writes return scoped receipts without lock-upgrade failures');
 const raced=settled.map(result=>result.value);
 eq(raced.filter(r=>r.ok).length,1,'one concurrent writer wins');eq(raced.filter(r=>r.code==='CONFLICT').length,1,'stale writer conflict');
 const state=(await read()).data;eq(state.mode,'multiple','multiple mode persisted');eq(state.revision,2,'one revision advance');
 eq((await save(state.revision,'multiple','\nInvalid',state.branches[0].name)).code,'INVALID_INPUT','unsafe branch name denied');
 eq((await read()).data.revision,state.revision,'invalid writes preserve state');
 const beforeName=state.branches.find(b=>b.primary).name;
 await stack.sql(`update public.company_branches set name='Organization edit' where company_id='${company}' and is_primary;`);
 eq((await save(state.revision,'multiple','Stale overwrite',beforeName)).code,'CONFLICT','organization rename prevents stale setup overwrite');
 eq((await read()).data.branches.find(b=>b.primary).name,'Organization edit','newer name survives');
 const branchOperation=randomUUID();
 const add=()=>rpc(owner,'enterprise_create_branch',{p_company_id:company,p_name:'Second',p_timezone:'UTC',p_operation_id:branchOperation});
 eq((await add()).ok,true,'secondary branch can be added later');await add();eq((await read()).data.branches.length,2,'secondary retry idempotent');
 eq((await stack.rows("select has_table_privilege('authenticated','private.smart_branch_setup','update') as allowed"))[0].allowed,false,'no raw persistence bypass');
 eq((await stack.rows("select has_function_privilege('anon','public.save_smart_branch_setup(uuid,integer,text,text,text)','execute') as allowed"))[0].allowed,false,'anonymous writes denied');
 const expiring=await stack.adminCreateUser(),expiryCompany=randomUUID();tokens.set(expiring.id,await login(expiring));
 eq((await rpc(expiring,'check_app_session',{p_touch:true})).ok,true,'expiring native session');
 const sid=JSON.parse(Buffer.from(tokens.get(expiring.id).split('.')[1],'base64url').toString()).session_id;
 await stack.sql(`insert into public.companies(id,display_name,status,created_by) values ('${expiryCompany}','Expiry fixture','setup','${expiring.id}');insert into public.company_members(company_id,user_id,role,status) values ('${expiryCompany}','${expiring.id}','owner','active');`);
 const lock=stack.sql(`begin;select 1 from public.companies where id='${expiryCompany}' for update;select pg_sleep(8) /* SMART_EXPIRY_LOCK */;commit;`);
 let locked=false;
 for(let attempt=0;attempt<20;attempt++){
  locked=(await stack.rows("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like '%SMART_EXPIRY_LOCK%') as locked"))[0].locked;
  if(locked)break;await new Promise(r=>setTimeout(r,50));
 }
 assert.equal(locked,true,'expiry fixture company lock acquired');
 await stack.sql(`update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='${sid}';`);
 const expiredWrite=rpc(expiring,'save_smart_branch_setup',{p_company_id:expiryCompany,p_expected_revision:0,p_mode:'single',p_primary_name:'Unauthorized rename',p_expected_primary_name:'Expiry fixture'});
 await lock;eq((await expiredWrite).code,'FORBIDDEN','expiry after lock wait rejects write');
 eq((await stack.rows(`select name from public.company_branches where company_id='${expiryCompany}' and is_primary`))[0].name,'Expiry fixture','expired write never commits branch rename');
 eq((await stack.rows(`select count(*)::int as n from private.smart_branch_setup where company_id='${expiryCompany}'`))[0].n,0,'expired write never commits preferences');
 if(process.argv.includes('--ui')){console.log(`LOCAL_SMART_DATABASE_READY_FOR_UI:${passed}`);await (await import('../internal-ui/smart-onboarding.mjs')).runSmartSetupUi(stack,owner,company);}
 // Optional-field fixture for the independent Master archive marker. This is
 // an authority regression, not an end-to-end business archive test.
 const beforeArchive=(await read()).data,archivePrimary=beforeArchive.branches.find(branch=>branch.primary);
 await stack.sql(`alter table public.companies add column archived_at timestamptz;update public.companies set archived_at=clock_timestamp() where id='${company}';`);
 eq((await save(beforeArchive.revision,'multiple','Archived overwrite',archivePrimary.name)).code,'FORBIDDEN','archive blocks smart setup writes');
 eq((await read()).code,'FORBIDDEN','archive blocks operational setup receipts');
 eq((await stack.rows(`select name from public.company_branches where company_id='${company}' and is_primary`))[0].name,archivePrimary.name,'archive rejection preserves branch name');
 await stack.sql(`update public.companies set archived_at=null where id='${company}';`);
 await stack.sql(`update public.company_members set status='disabled' where company_id='${company}' and user_id='${owner.id}';`);
 eq((await read()).ok,false,'old session denied after membership removal');
 console.log(`SMART_ONBOARDING_DATABASE_PASS:${passed}`);
}finally{await stack.close();}
