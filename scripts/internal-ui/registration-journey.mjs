// Actual registration UI against a caller-owned native local backend.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {cp,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {lit} from '../integration/local-http-stack.mjs';
import {localEnvironment,guardedEnvironment,assertNoEnvironmentFiles,assertPortsFree,assertOwnedListener} from '../integration/local-http-safety.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function redactRegistrationOutput(value,stack,secrets=[]){
 let result=stack.redact(value);
 for(const secret of secrets)result=result.replaceAll(secret,'[LOCAL_CREDENTIAL_REDACTED]');
 return result;
}
export async function runRegistrationJourney(stack){
 assert.equal(typeof stack.readEmailOtp,'function','native confirmation fixture required');await stack.verify();
 const root=resolve(import.meta.dirname,'../..'),scratch=join(tmpdir(),'codex-velora-registration-'+randomUUID()),origin='http://127.0.0.1:3320';
 await mkdir(scratch,{recursive:true});
 for(const name of ['src','public','package.json','package-lock.json','tsconfig.json','next.config.ts','postcss.config.mjs','.gitignore','scripts','supabase'])await cp(join(root,name),join(scratch,name),{recursive:true});
 await symlink(join(root,'node_modules'),join(scratch,'node_modules'),'junction');await assertNoEnvironmentFiles(scratch);await assertPortsFree([3320]);
 const env=guardedEnvironment(scratch,{NEXT_PUBLIC_SUPABASE_URL:stack.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.anonKey,SUPABASE_SERVICE_ROLE_KEY:stack.serviceRoleKey,NEXT_PUBLIC_SITE_URL:origin,VELORA_SMART_ONBOARDING_ENABLED:'false',VELORA_MASTER_JOURNEY_ENABLED:'false',VELORA_ENTERPRISE_LIFECYCLE_ENABLED:'false',WHATSAPP_ALLOW_EXTERNAL_SEND:'false',WHATSAPP_WORKER_ENABLED:'false',WHATSAPP_EMBEDDED_SIGNUP:'false',INSTAGRAM_CONNECT_ENABLED:'false',INSTAGRAM_RECEIVE_ENABLED:'false',INSTAGRAM_ALLOW_EXTERNAL_SEND:'false',BILLING_PAYMOB_CREATE_ENABLED:'false',BILLING_PAYMOB_WEBHOOK_ENABLED:'false',BILLING_PAYMOB_SETTLE_ENABLED:'false',SUBSCRIPTION_LIFECYCLE_WORKER_ENABLED:'false'});
 let next,browser,stage='startup',log='',passed=0;
 const fixtureSecrets=new Set(),redact=value=>redactRegistrationOutput(value,stack,fixtureSecrets);
 const check=(value,message)=>{assert.equal(value,true,message);passed++;};
 try{
  next=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3320'],{cwd:scratch,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  for(const stream of [next.stdout,next.stderr])stream.on('data',v=>{log=redact(log+v.toString()).slice(-5000);});
  for(let n=0;n<180;n++){if(next.exitCode!==null)throw Error('LOCAL_REGISTRATION_NEXT_EXITED');if(log.includes('Ready in'))break;await pause(500);}await assertOwnedListener(next,3320);
  const {chromium}=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');
  browser=await chromium.launch({headless:true,channel:'chrome',env:localEnvironment()});
  async function context(){const ctx=await browser.newContext({viewport:{width:390,height:950},serviceWorkers:'block',reducedMotion:'reduce'});ctx.setDefaultTimeout(90000);await ctx.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin||u.origin===stack.url?route.continue():route.abort();});await ctx.addCookies([{name:'velora_locale',value:'en',url:origin}]);return ctx;}
  async function hydrated(page){await page.waitForFunction(()=>Array.from(document.querySelectorAll('form')).some(form=>Object.getOwnPropertyNames(form).filter(k=>k.startsWith('__reactProps$')).some(k=>typeof form[k]?.onSubmit==='function')));}
  async function submitLogin(page,user){await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});await hydrated(page);await page.getByLabel(/^Email address/).fill(user.email);await page.getByLabel(/^Password/).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();}
  const first=await context(),page=await first.newPage(),email=`registration-ui-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url')+'aA7!';
  fixtureSecrets.add(password);
  stage='signup awaiting native confirmation';await page.goto(origin+'/signup?next=%2Fsetup',{waitUntil:'domcontentloaded'});await hydrated(page);
  await page.getByLabel(/^Full name/).fill('Synthetic registered owner');await page.getByLabel(/^Email address/).fill(email);await page.getByLabel(/^Password/).fill(password);await page.getByLabel(/^Confirm password/).fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click();await page.waitForURL(u=>u.pathname==='/verify-email');
  const [user]=await stack.rows(`select id,email_confirmed_at from auth.users where email=${lit(email)}`);check(Boolean(user?.id)&&!user.email_confirmed_at,'new identity remains unconfirmed');
  const [before]=await stack.rows(`select (select count(*)::int from public.profiles where user_id=${lit(user.id)}) profiles,(select count(*)::int from public.company_members where user_id=${lit(user.id)}) memberships`);check(before.profiles===0&&before.memberships===0,'unconfirmed signup does not mint profile/business authority');
  const otp=await stack.readEmailOtp(email);await first.close();
  stage='fresh browser confirmation';const second=await context(),confirmedPage=await second.newPage();await confirmedPage.goto(origin+'/verify-email?email='+encodeURIComponent(email)+'&next=%2Fsetup',{waitUntil:'domcontentloaded'});await hydrated(confirmedPage);
  await confirmedPage.getByLabel(/^Email confirmation code/).fill(otp);await confirmedPage.getByRole('button',{name:'Confirm code and continue',exact:true}).click();await confirmedPage.waitForURL(u=>u.pathname==='/setup');
  const [receipt]=await stack.rows(`select u.id,u.email_confirmed_at,(select count(*)::int from auth.sessions where user_id=u.id) sessions,(select count(*)::int from public.profiles where user_id=u.id) profiles,(select full_name from public.profiles where user_id=u.id) full_name from auth.users u where u.id=${lit(user.id)}`);
  check(Boolean(receipt.email_confirmed_at)&&receipt.sessions>0,'native confirmation persists identity/session');check(receipt.profiles===1&&receipt.full_name==='Synthetic registered owner','profile uses same native identity and one persisted row');
  const replay=await fetch(stack.url+'/auth/v1/verify',{method:'POST',headers:{apikey:stack.anonKey,'content-type':'application/json'},body:JSON.stringify({email,token:otp,type:'email'})});check(!replay.ok,'consumed native proof cannot be replayed');await second.close();
  stage='existing account completes missing profile';const existing=await stack.adminCreateUser({email:`registration-existing-${randomUUID()}@example.invalid`}),third=await context(),existingPage=await third.newPage();await submitLogin(existingPage,existing);await existingPage.waitForURL(u=>u.pathname==='/complete-profile');await hydrated(existingPage);await existingPage.getByLabel(/^Full name/).fill('Synthetic completed profile');await existingPage.getByRole('button',{name:'Save and continue',exact:true}).click();await existingPage.waitForURL(u=>u.pathname==='/setup');
  const [profile]=await stack.rows(`select count(*)::int total,min(full_name) full_name from public.profiles where user_id=${lit(existing.id)}`);check(profile.total===1&&profile.full_name==='Synthetic completed profile','existing account completion persists one scoped profile');await third.close();
  stage='existing identity reload without new signup';const fourth=await context(),returnPage=await fourth.newPage();await submitLogin(returnPage,{email,password});await returnPage.waitForURL(u=>u.pathname==='/setup');
  const [returned]=await stack.rows(`select count(*)::int total from auth.users where email=${lit(email)}`);check(returned.total===1,'return login reuses original identity');check((await stack.rows(`select full_name from public.profiles where user_id=${lit(user.id)}`))[0].full_name==='Synthetic registered owner','another account never replaces original profile');
  console.log(`REGISTRATION_LOCAL_JOURNEY_PASS:${passed}; real signup/OTP/fresh-browser/profile/return; isolated only`);
 }catch(error){throw Error(redact(`REGISTRATION_LOCAL_JOURNEY_FAILURE:${stage}:passed=${passed}:${error.message}\n${log}`));}
 finally{await browser?.close();if(next?.pid&&next.exitCode===null)await new Promise(resolveClose=>{const child=spawn('taskkill',['/PID',String(next.pid),'/T','/F'],{env:localEnvironment(),windowsHide:true,stdio:'ignore'});child.once('close',resolveClose);child.once('error',resolveClose);});}
}
