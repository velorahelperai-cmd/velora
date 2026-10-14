// FLOW-001 / STAGE-002. Real disposable Auth/PostgREST; no cloud data/providers.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startStack,lit} from './local-http-stack.mjs';
await import('./local-http-network-guard.cjs');
const baseline='20261009215520_g03_verified_review.sql';
const stack=await startStack({gatewayPort:3330,authPort:3340,restPort:3341,appOrigin:'http://127.0.0.1:3320',throughMigration:baseline,canonicalSqlLineEndings:true,emailConfirmation:true,progress:console.log});
try {
 await stack.sql(await readFile(new URL('../../supabase/migrations/20261013225228_vel_verified_identity_authority.sql',import.meta.url),'utf8'));
 await stack.sql("notify pgrst,'reload schema';");
 const email=`registration-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url')+'aA7!';
 const response=await fetch(stack.url+'/auth/v1/signup',{method:'POST',headers:{apikey:stack.anonKey,'content-type':'application/json'},body:JSON.stringify({email,password,data:{full_name:'Synthetic native signup'}})});
 assert.equal(response.ok,true,'native signup must succeed');
 const data=await response.json();
 assert.equal(Boolean(data.access_token),false,'confirmation fixture must not issue a session before email proof');
 assert.equal(Boolean((data.user??data).email_confirmed_at),false,'native identity must remain unconfirmed until proof');
 const otp=await stack.readEmailOtp(email);
 const verify=token=>fetch(stack.url+'/auth/v1/verify',{method:'POST',headers:{apikey:stack.anonKey,'content-type':'application/json'},body:JSON.stringify({email,token,type:'email'})});
 assert.equal((await verify(otp==='000000'?'999999':'000000')).ok,false,'wrong native proof must deny');
 await stack.sql(`update auth.users set confirmation_sent_at=clock_timestamp()-interval '2 days' where id=${lit((data.user??data).id)}::uuid`);
 assert.equal((await verify(otp)).ok,false,'expired native proof must deny');
 await assert.rejects(()=>stack.sql("set role anon;select local_auth_fixture.capture_email('{}'::jsonb);"),/permission denied/);
 console.log('REGISTRATION_NATIVE_CONFIRMATION_REQUIRED_PASS');
 const {runRegistrationJourney}=await import('../internal-ui/registration-journey.mjs');
 await runRegistrationJourney(stack);
} catch(error) { console.error(stack.redact(error.message));process.exitCode=1; }
finally {await stack.close();}
