// Opt-in real local Supabase Auth. Mail is received by the isolated send-email
// hook, never external SMTP. No tokens, codes, credentials or payloads are logged.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { startStack, lit } from './local-http-stack.mjs';
import { assertNoEnvironmentFiles, assertPortsFree } from './local-http-safety.mjs';

await assertNoEnvironmentFiles(process.cwd());
await assertPortsFree([3830,3840,3841]);
let stack;
const check=(condition,name)=>{if(!condition)throw Error(name);console.log(`PASS ${name}`);};
try {
  stack=await startStack({gatewayPort:3830,authPort:3840,restPort:3841,appOrigin:'http://127.0.0.1:3820',migrationScope:'wp01a-auth',canonicalSqlLineEndings:true,emailConfirmation:true,
    progress:message=>{if(!message.startsWith('AUTH_SCOPE_NOT_APPLIED:'))console.log(message);}});
  const client=()=>createClient(stack.url,stack.anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const a=client(),b=client();
  const email='auth-audit-a@example.test',other='auth-audit-b@example.test';
  const password=randomBytes(24).toString('base64url')+'aA7!';
  const signup=await a.auth.signUp({email,password});
  check(!signup.error&&!!signup.data.user&&!signup.data.session,'signup_requires_confirmation');
  const otp=await stack.readEmailOtp(email);
  check(/^[0-9]{6}$/.test(otp),'local_mail_hook_received_code');
  const wrong=otp==='000000'?'000001':'000000';
  check(!!(await a.auth.verifyOtp({email,token:wrong,type:'email'})).error,'wrong_otp_denied');
  const valid=await a.auth.verifyOtp({email,token:otp,type:'email'});
  check(!valid.error&&!!valid.data.session&&!!valid.data.user.email_confirmed_at,'valid_otp_verified');
  check(!!(await client().auth.verifyOtp({email,token:otp,type:'email'})).error,'consumed_otp_denied');
  const refresh=await a.auth.refreshSession();
  check(!refresh.error&&refresh.data.user?.id===valid.data.user.id,'refresh_preserves_identity');
  const signupB=await b.auth.signUp({email:other,password});
  check(!signupB.error,'second_signup');
  const otpB=await stack.readEmailOtp(other);
  await stack.sql(`update auth.users set confirmation_sent_at=now()-interval '2 days' where email=${lit(other)}`);
  check(!!(await b.auth.verifyOtp({email:other,token:otpB,type:'email'})).error,'expired_otp_denied');
  check((await a.auth.getUser()).data.user?.id===valid.data.user.id,'other_account_failure_does_not_replace_session');
  check(!(await a.auth.signOut()).error,'logout');
  check(!(await a.auth.getSession()).data.session,'logout_clears_client_session');
  const login=await a.auth.signInWithPassword({email,password});
  check(!login.error&&login.data.user?.id===valid.data.user.id,'password_relogin');
  console.log('LOCAL_NATIVE_AUTH_PASS; app broker/browser and Production provider acceptance are separate');
} catch(error) {
  // Deliberately do not print provider errors or assertion payloads.
  console.error('LOCAL_NATIVE_AUTH_FAILED',error instanceof Error&&/^[A-Za-z0-9_: -]+$/.test(error.message)?error.message:'REDACTED_ERROR');
  process.exitCode=1;
} finally {await stack?.close();}
