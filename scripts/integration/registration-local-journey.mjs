// FLOW-001 / STAGE-002. Real disposable Auth/PostgREST; no cloud data/providers.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startStack,lit} from './local-http-stack.mjs';
import {registrationSessionChecks,runRegistrationJourney} from '../internal-ui/registration-journey.mjs';
import {flushLogs,installProcessLogging,logEvent} from '../../src/lib/logging/logger.mjs';
installProcessLogging();
await import('./local-http-network-guard.cjs');
let sessionChecks;
try {sessionChecks=registrationSessionChecks(process.argv.slice(2));}
catch {logEvent('warn','test.arguments.rejected',{kind:'application',code:'INVALID_INPUT'});await flushLogs();process.exit(1);}
const baseline='20261009215520_g03_verified_review.sql';
const started=performance.now();
logEvent('info','test.registration.started',{kind:'application',session_checks:sessionChecks});
const stack=await startStack({gatewayPort:3330,authPort:3340,restPort:3341,appOrigin:'http://127.0.0.1:3320',throughMigration:baseline,canonicalSqlLineEndings:true,emailConfirmation:true,progress:stage=>logEvent('info','test.stack.progress',{kind:'application',stage})});
for(const method of ['sql','rows']){
 const original=stack[method].bind(stack);
 stack[method]=async(...args)=>{const start=performance.now();let outcome='failure';try{const result=await original(...args);outcome='success';return result;}finally{logEvent(outcome==='failure'?'warn':'info','dependency.database.completed',{kind:'application',target:'local.postgres',duration_ms:Math.round(performance.now()-start),outcome});}};
}
async function localRequest(url,options){
 const start=performance.now();let outcome='failure';
 try{const result=await fetch(url,options);outcome=result.ok?'success':'failure';return result;}
 finally{logEvent(outcome==='failure'?'warn':'info','dependency.auth.completed',{kind:'application',target:'local.auth',duration_ms:Math.round(performance.now()-start),outcome});}
}
try {
 await stack.sql(await readFile(new URL('../../supabase/migrations/20261013225228_vel_verified_identity_authority.sql',import.meta.url),'utf8'));
 // Setup pages read this contract before rendering the authenticated header.
 // The historical baseline precedes it; install only on this disposable stack.
 await stack.sql(await readFile(new URL('../../supabase/migrations/20261013225246_vel_setup_drafts.sql',import.meta.url),'utf8'));
 await stack.sql("notify pgrst,'reload schema';");
 const email=`registration-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url')+'aA7!';
 const response=await localRequest(stack.url+'/auth/v1/signup',{method:'POST',headers:{apikey:stack.anonKey,'content-type':'application/json'},body:JSON.stringify({email,password,data:{full_name:'Synthetic native signup'}})});
 assert.equal(response.ok,true,'native signup must succeed');
 const data=await response.json();
 assert.equal(Boolean(data.access_token),false,'confirmation fixture must not issue a session before email proof');
 assert.equal(Boolean((data.user??data).email_confirmed_at),false,'native identity must remain unconfirmed until proof');
 const otp=await stack.readEmailOtp(email);
 const verify=token=>localRequest(stack.url+'/auth/v1/verify',{method:'POST',headers:{apikey:stack.anonKey,'content-type':'application/json'},body:JSON.stringify({email,token,type:'email'})});
 assert.equal((await verify(otp==='000000'?'999999':'000000')).ok,false,'wrong native proof must deny');
 await stack.sql(`update auth.users set confirmation_sent_at=clock_timestamp()-interval '2 days' where id=${lit((data.user??data).id)}::uuid`);
 assert.equal((await verify(otp)).ok,false,'expired native proof must deny');
 await assert.rejects(()=>stack.sql("set role anon;select local_auth_fixture.capture_email('{}'::jsonb);"),/permission denied/);
 logEvent('info','test.confirmation.verified',{kind:'application'});
 await runRegistrationJourney(stack,{sessionChecks});
} catch(error) { logEvent('error','test.registration.failed',{kind:'application',error:{type:error.name,stack:stack.redact(error.stack??error.message),message:stack.redact(error.message)}});process.exitCode=1; }
finally {await stack.close();logEvent('info','test.registration.finished',{kind:'application',duration_ms:Math.round(performance.now()-started),outcome:process.exitCode===1?'failure':'success'});await flushLogs();}
