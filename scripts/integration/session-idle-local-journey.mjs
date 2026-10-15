// FLOW-001/STAGE-003/TASK-002. Native local Auth/API idle enforcement only.
// This advances fixture time, not real human idle acceptance or hosted settings.
import assert from 'node:assert/strict';
import {startStack,lit} from './local-http-stack.mjs';
import {logEvent,flushLogs,installProcessLogging} from '../../src/lib/logging/logger.mjs';
installProcessLogging();
await import('./local-http-network-guard.cjs');
if(process.argv.length!==2){logEvent('warn','test.arguments.rejected',{kind:'application',code:'INVALID_INPUT'});await flushLogs();process.exit(1);}
let stack,passed=0,stage='startup';
const check=(value,name)=>{assert.ok(value,name);passed++;};
const enter=value=>{stage=value;logEvent('info','test.idle.stage',{kind:'application',stage});};
try{
 stack=await startStack({gatewayPort:3330,authPort:3340,restPort:3341,appOrigin:'http://127.0.0.1:3320',throughMigration:'20261009215520_g03_verified_review.sql',canonicalSqlLineEndings:true,progress:value=>logEvent('info','test.stack.progress',{kind:'application',stage:value})});
 for(const method of ['sql','rows','adminCreateUser']){
  const original=stack[method].bind(stack);
  stack[method]=async(...args)=>{const started=performance.now();let outcome='failure';try{const receipt=await original(...args);outcome='success';return receipt;}finally{logEvent(outcome==='success'?'info':'warn','dependency.fixture.completed',{kind:'application',target:method==='adminCreateUser'?'local.auth':'local.postgres',duration_ms:Math.round(performance.now()-started),outcome});}};
 }
 async function request(path,{token,body,method=body?'POST':'GET'}={}){
  const started=performance.now();let outcome='failure';
  try{const response=await fetch(stack.url+path,{method,headers:{apikey:stack.anonKey,...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});outcome=response.ok?'success':'denied';return response;}
  finally{logEvent(outcome==='failure'?'warn':'info','dependency.fixture.completed',{kind:'application',target:path.startsWith('/auth/')?'local.auth':'local.rest',duration_ms:Math.round(performance.now()-started),outcome});}
 }
 enter('fresh native sessions');
 const user=await stack.adminCreateUser({userMetadata:{full_name:'Synthetic idle fixture'}});
 async function login(){const response=await request('/auth/v1/token?grant_type=password',{body:{email:user.email,password:user.password}});assert.equal(response.ok,true,'native fixture login');const session=await response.json();assert.equal(typeof session.access_token,'string');return session.access_token;}
 const tokenA=await login(),tokenB=await login();
 const idA=JSON.parse(Buffer.from(tokenA.split('.')[1],'base64url').toString()).session_id;
 const idB=JSON.parse(Buffer.from(tokenB.split('.')[1],'base64url').toString()).session_id;
 assert.match(idA,/^[a-f0-9-]{36}$/);assert.match(idB,/^[a-f0-9-]{36}$/);assert.notEqual(idA,idB);
 for(const token of [tokenA,tokenB]){const initialized=await request('/rest/v1/rpc/check_app_session',{token,body:{p_touch:true}});assert.equal(initialized.ok,true);assert.equal((await initialized.json()).ok,true);}
 const [fresh]=await stack.rows(`select count(*)::int total from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id where a.user_id=${lit(user.id)}::uuid and a.session_id in (${lit(idA)}::uuid,${lit(idB)}::uuid) and a.expired_at is null and a.last_activity_at between clock_timestamp()-interval '1 minute' and clock_timestamp()`);
 check(fresh.total===2,'both proofs start from fresh initialized native sessions');
 await stack.sql('update private.app_session_settings set enabled=true where singleton;');
 const profilePath='/rest/v1/profiles?select=user_id&user_id=eq.'+user.id;
 const active=await request(profilePath,{token:tokenA});check(active.ok&&(await active.json()).length===1,'fresh session reads its actual profile with idle policy enabled');
 enter('exact session clock aging');
 const changed=(await stack.sql(`with changed as (update private.app_session_activity set last_activity_at=clock_timestamp()-interval '3 hours' where session_id=${lit(idA)}::uuid and user_id=${lit(user.id)}::uuid and expired_at is null returning session_id) select session_id from changed`)).split(/\r?\n/).filter(Boolean);
 check(changed.length===1&&changed[0]===idA,'only the intended live session was aged');
 const authAlive=await request('/auth/v1/user',{token:tokenA});check(authAlive.ok,'native access JWT remains valid before app idle denial');
 const expired=await request(profilePath,{token:tokenA});const rejection=await expired.json();
 check(expired.status===403&&rejection.code==='42501'&&rejection.message==='APP_SESSION_EXPIRED','Data API denies idle session despite still-valid native JWT');
 const touch=await request('/rest/v1/rpc/check_app_session',{token:tokenA,body:{p_touch:true}});check(touch.status===403,'late activity cannot revive an expired session');
 const [aged]=await stack.rows(`select a.last_activity_at<clock_timestamp()-interval '2 hours' old,exists(select 1 from auth.sessions s where s.id=a.session_id and s.user_id=a.user_id) native_alive from private.app_session_activity a where a.session_id=${lit(idA)}::uuid and a.user_id=${lit(user.id)}::uuid`);
 check(aged?.old&&aged.native_alive,'denial is genuine idle enforcement without resetting activity or losing native session');
 const sibling=await request(profilePath,{token:tokenB});check(sibling.ok&&(await sibling.json()).length===1,'independent fresh session remains usable');
 logEvent('info','test.idle.verified',{kind:'application',passed,scope:'native.local.clock_fixture',human_idle_verified:false});
}catch(error){process.exitCode=1;logEvent('error','test.idle.failed',{kind:'application',stage,passed,error:{type:error.name,message:stack?.redact(error.message)??error.message,stack:stack?.redact(error.stack??'')??error.stack}});}
finally{await stack?.close();logEvent('info','test.idle.finished',{kind:'application',outcome:process.exitCode===1?'failure':'success'});await flushLogs();}
