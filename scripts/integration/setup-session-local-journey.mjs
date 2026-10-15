// FLOW-001 / STAGE-003 / TASK-002: disposable persistence/logout acceptance only.
import assert from 'node:assert/strict';
import {readFile,cp,mkdir,symlink,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startStack,lit} from './local-http-stack.mjs';
import {localEnvironment,guardedEnvironment,assertNoEnvironmentFiles,assertPortsFree,assertOwnedListener} from './local-http-safety.mjs';
import {logEvent,flushLogs,installProcessLogging} from '../../src/lib/logging/logger.mjs';
installProcessLogging();
await import('./local-http-network-guard.cjs');
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3320';
const resumeOnly=process.argv.slice(2).join(' ')==='--resume-only';
if(process.argv.length>2&&!resumeOnly){logEvent('warn','test.arguments.rejected',{kind:'application',code:'INVALID_INPUT'});await flushLogs();process.exit(1);}
const scratch=join(tmpdir(),'codex-velora-session-'+randomUUID());
const results=[],pause=ms=>new Promise(resolvePause=>setTimeout(resolvePause,ms));
let stack,next,browser,stage='startup',log='',failure=false;
const check=(value,name)=>{assert.ok(value,name);results.push({name,passed:true});};
const enter=value=>{stage=value;logEvent('info','test.session.stage',{kind:'application',stage});};
try{
 await mkdir(scratch,{recursive:true});
 stack=await startStack({gatewayPort:3330,authPort:3340,restPort:3341,appOrigin:origin,throughMigration:'20261009215520_g03_verified_review.sql',canonicalSqlLineEndings:true,progress:value=>logEvent('info','test.stack.progress',{kind:'application',stage:value})});
 for(const method of ['sql','rows','adminCreateUser']){
  const original=stack[method].bind(stack);
  stack[method]=async(...args)=>{const start=performance.now();let outcome='failure';try{const receipt=await original(...args);outcome='success';return receipt;}finally{logEvent(outcome==='success'?'info':'warn','dependency.fixture.completed',{kind:'application',target:method==='adminCreateUser'?'local.auth':'local.postgres',duration_ms:Math.round(performance.now()-start),outcome});}};
 }
 for(const name of ['20261013225228_vel_verified_identity_authority.sql','20261013225246_vel_setup_drafts.sql'])await stack.sql(await readFile(join(root,'supabase/migrations',name),'utf8'));
 await stack.sql("notify pgrst,'reload schema';");
 const user=await stack.adminCreateUser({userMetadata:{full_name:'Synthetic session owner'}});
 for(const name of ['src','public','package.json','package-lock.json','tsconfig.json','next.config.ts','postcss.config.mjs','.gitignore','scripts','supabase'])await cp(join(root,name),join(scratch,name),{recursive:true});
 await symlink(join(root,'node_modules'),join(scratch,'node_modules'),'junction');
 await assertNoEnvironmentFiles(scratch);await assertPortsFree([3320]);
 const env=guardedEnvironment(scratch,{NEXT_PUBLIC_SUPABASE_URL:stack.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.anonKey,SUPABASE_SERVICE_ROLE_KEY:stack.serviceRoleKey,NEXT_PUBLIC_SITE_URL:origin,VELORA_SMART_ONBOARDING_ENABLED:'false',VELORA_MASTER_JOURNEY_ENABLED:'false',VELORA_ENTERPRISE_LIFECYCLE_ENABLED:'false'});
 next=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3320'],{cwd:scratch,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [next.stdout,next.stderr])stream.on('data',value=>{log=stack.redact(log+value.toString()).slice(-5000);});
 for(let n=0;n<180;n++){if(next.exitCode!==null)throw Error('LOCAL_NEXT_EXITED');if(log.includes('Ready in'))break;await pause(500);}await assertOwnedListener(next,3320);
 const {chromium}=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');
 browser=await chromium.launch({headless:true,channel:'chrome',env:localEnvironment()});
 const ctx=await browser.newContext({viewport:{width:390,height:950},serviceWorkers:'block',reducedMotion:'reduce'});ctx.setDefaultTimeout(90000);
 await ctx.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin||u.origin===stack.url?route.continue():route.abort();});
 await ctx.addCookies([{name:'velora_locale',value:'en',url:origin}]);
 const page=await ctx.newPage();
 async function login(){await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('form')).some(form=>Object.getOwnPropertyNames(form).filter(key=>key.startsWith('__reactProps$')).some(key=>typeof form[key]?.onSubmit==='function')));await page.getByLabel(/^Email address/).fill(user.email);await page.getByLabel(/^Password/).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(url=>url.pathname==='/setup',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Synthetic session owner',exact:true}).waitFor();}
 let saved,duration_ms=null;
 if(resumeOnly){
  const business={name:'Synthetic persisted draft',type:'',replyLanguage:'ar',country:'',city:'',hours:'',contactPhone:'',contactEmail:''};
  const payload={business,businessBaseline:{...business,name:''},setupStep:0};
  await stack.sql(`insert into public.company_setup_drafts(user_id,payload,revision) values(${lit(user.id)}::uuid,${lit(JSON.stringify(payload))}::jsonb,1)`);saved={revision:1};
 }else{
 enter('real edit persists');await login();
 const name=page.locator('input[autocomplete="organization"]');await name.waitFor();await name.fill('Synthetic persisted draft');
 await page.getByText('Setup draft saved to your account.',{exact:true}).waitFor();
 [saved]=await stack.rows(`select revision,payload->'business'->>'name' name from public.company_setup_drafts where user_id=${lit(user.id)}::uuid and company_id is null`);
 check(saved?.name==='Synthetic persisted draft'&&saved.revision>=1,'edited business name persists on server');
 enter('logout timing and revocation');
 const [before]=await stack.rows(`select count(*)::int total from auth.sessions where user_id=${lit(user.id)}::uuid`);
 await page.getByRole('button',{name:'Synthetic session owner',exact:true}).click();const started=performance.now();
 await page.getByRole('menuitem',{name:'Sign out',exact:true}).click();await page.waitForURL(url=>url.pathname==='/login',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 duration_ms=Math.round(performance.now()-started);
 logEvent('info','test.logout.measured',{kind:'application',duration_ms,environment:'disposable.local.dev'});
 const [after]=await stack.rows(`select count(*)::int total from auth.sessions where user_id=${lit(user.id)}::uuid`);
 check(after.total===before.total-1,'logout revokes native session');
 await page.goto(origin+'/setup',{waitUntil:'domcontentloaded'});await page.waitForURL(url=>url.pathname==='/login',{waitUntil:'domcontentloaded'});check(true,'logged out cookies cannot reopen setup');
 }
 enter('server draft survives fresh browser');await ctx.close();
 const fresh=await browser.newContext({serviceWorkers:'block'});fresh.setDefaultTimeout(90000);await fresh.addCookies([{name:'velora_locale',value:'en',url:origin}]);await fresh.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||url.origin===stack.url?route.continue():route.abort();});
 // Use a genuinely empty browser storage context for return login.
 const returned=await fresh.newPage();await returned.goto(origin+'/login',{waitUntil:'domcontentloaded'});await returned.waitForFunction(()=>Array.from(document.querySelectorAll('form')).some(form=>Object.getOwnPropertyNames(form).filter(key=>key.startsWith('__reactProps$')).some(key=>typeof form[key]?.onSubmit==='function')));await returned.getByLabel(/^Email address/).fill(user.email);await returned.getByLabel(/^Password/).fill(user.password);await returned.getByRole('button',{name:'Sign in',exact:true}).click();await returned.waitForURL(url=>url.pathname==='/setup',{waitUntil:'domcontentloaded'});await returned.locator('input[autocomplete="organization"]').waitFor();
 await returned.waitForFunction(()=>document.querySelector('input[autocomplete="organization"]')?.value==='Synthetic persisted draft');check(true,resumeOnly?'seeded server draft restores with empty browser storage':'server draft restores after logout with empty browser storage');
 const [restored]=await stack.rows(`select revision from public.company_setup_drafts where user_id=${lit(user.id)}::uuid and company_id is null`);check(restored.revision===saved.revision,'restoring saved draft does not create a duplicate revision');
 logEvent('info','test.session.verified',{kind:'application',passed:results.length,duration_ms});
 await writeFile(join(scratch,'acceptance.json'),JSON.stringify({results,logout_duration_ms:duration_ms,scope:'local.dev',passed:true},null,2));
}catch(error){failure=true;process.exitCode=1;logEvent('error','test.session.failed',{kind:'application',stage,error:{type:error.name,message:stack?.redact(error.message)??error.message,stack:stack?.redact(error.stack??'')??error.stack}});await writeFile(join(scratch,'acceptance.json'),JSON.stringify({results,stage,passed:false},null,2));}
finally{await browser?.close();if(next?.pid&&next.exitCode===null)await new Promise(done=>{const child=spawn('taskkill',['/PID',String(next.pid),'/T','/F'],{env:localEnvironment(),windowsHide:true,stdio:'ignore'});child.once('close',done);child.once('error',done);});await stack?.close();logEvent('info','test.session.finished',{kind:'application',outcome:failure?'failure':'success',artifact:scratch});await flushLogs();}
