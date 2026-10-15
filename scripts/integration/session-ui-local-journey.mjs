// FLOW-001 / STAGE-003 / TASK-002. Real browser, native local Auth/RLS.
// Expiry uses fixture timestamps; this is not hosted or two-hour human-idle proof.
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
installProcessLogging();await import('./local-http-network-guard.cjs');
if(process.argv.length!==2){logEvent('warn','test.arguments.rejected',{kind:'application',code:'INVALID_INPUT'});await flushLogs();process.exit(1);}
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3320';
const scratch=join(tmpdir(),'codex-velora-session-ui-'+randomUUID());
const results=[],pause=ms=>new Promise(done=>setTimeout(done,ms));
let stack,next,browser,stage='startup',serverLog='',failed=false;
const check=(value,name)=>{assert.ok(value,name);results.push({name,passed:true});};
const enter=value=>{stage=value;logEvent('info','test.session_ui.stage',{kind:'application',stage});};
try{
 await mkdir(scratch,{recursive:true});
 stack=await startStack({gatewayPort:3330,authPort:3340,restPort:3341,appOrigin:origin,throughMigration:'20261009215520_g03_verified_review.sql',canonicalSqlLineEndings:true,reuseUpstreamConnections:true,progress:value=>logEvent('info','test.stack.progress',{kind:'application',stage:value})});
 for(const method of ['sql','rows','adminCreateUser']){
  const original=stack[method].bind(stack);
  stack[method]=async(...args)=>{const started=performance.now();let outcome='failure';try{const receipt=await original(...args);outcome='success';return receipt;}finally{logEvent(outcome==='failure'?'warn':'info','dependency.fixture.completed',{kind:'application',target:method==='adminCreateUser'?'local.auth':'local.postgres',duration_ms:Math.round(performance.now()-started),outcome});}};
 }
 for(const name of ['20261013225228_vel_verified_identity_authority.sql','20261013225246_vel_setup_drafts.sql'])await stack.sql(await readFile(join(root,'supabase/migrations',name),'utf8'));
 await stack.sql("update private.app_session_settings set enabled=true where singleton;notify pgrst,'reload schema';");
 const user=await stack.adminCreateUser({userMetadata:{full_name:'Synthetic browser session'}});
 for(const name of ['src','public','package.json','package-lock.json','tsconfig.json','next.config.ts','postcss.config.mjs','.gitignore','scripts','supabase'])await cp(join(root,name),join(scratch,name),{recursive:true});
 await symlink(join(root,'node_modules'),join(scratch,'node_modules'),'junction');
 await assertNoEnvironmentFiles(scratch);await assertPortsFree([3320]);
 // No company/checkout fixture; /account is the real shared identity surface.
 const env=guardedEnvironment(scratch,{NEXT_PUBLIC_SUPABASE_URL:stack.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.anonKey,SUPABASE_SERVICE_ROLE_KEY:stack.serviceRoleKey,NEXT_PUBLIC_SITE_URL:origin,VELORA_SMART_ONBOARDING_ENABLED:'true',VELORA_MASTER_JOURNEY_ENABLED:'false',VELORA_ENTERPRISE_LIFECYCLE_ENABLED:'false'});
 next=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3320'],{cwd:scratch,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [next.stdout,next.stderr])stream.on('data',value=>{serverLog=stack.redact(serverLog+value.toString()).slice(-5000);});
 for(let n=0;n<180;n++){if(next.exitCode!==null)throw Error('LOCAL_NEXT_EXITED');if(serverLog.includes('Ready in'))break;await pause(500);}await assertOwnedListener(next,3320);
 const {chromium}=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');
 browser=await chromium.launch({headless:true,channel:'chrome',env:localEnvironment()});
 async function context(){const ctx=await browser.newContext({viewport:{width:390,height:950},serviceWorkers:'block',reducedMotion:'reduce'});ctx.setDefaultTimeout(45000);await ctx.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||url.origin===stack.url?route.continue():route.abort();});await ctx.addCookies([{name:'velora_locale',value:'en',url:origin}]);return ctx;}
 async function login(ctx){const page=await ctx.newPage();await page.goto(origin+'/login?next=%2Faccount',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('form')).some(form=>Object.getOwnPropertyNames(form).filter(key=>key.startsWith('__reactProps$')).some(key=>typeof form[key]?.onSubmit==='function')));await page.getByLabel(/^Email address/).fill(user.email);await page.getByLabel(/^Password/).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(url=>url.pathname==='/setup',{waitUntil:'domcontentloaded'});await page.goto(origin+'/account',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Synthetic browser session',exact:true}).waitFor();return page;}
 async function activity(){const rows=await stack.rows(`select session_id,last_activity_at from private.app_session_activity where user_id=${lit(user.id)}::uuid order by session_id`);return rows;}
 async function waitForState(read,accept,name){for(let n=0;n<40;n++){const value=await read();if(accept(value))return value;await pause(250);}throw Error(name);}
 enter('trusted browser activity reaches native session');
 const ctx=await context(),page=await login(ctx);
 const [initial]=await activity();assert.ok(initial?.session_id,'login initializes native activity');
 // Reload installs a fresh tracker throttle; the fixture row remains native.
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Synthetic browser session',exact:true}).waitFor();
 await stack.sql(`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '1 minute' where session_id=${lit(initial.session_id)}::uuid`);
 const [before]=await activity();
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})));
 await pause(1000);
 const [synthetic]=await activity();check(synthetic.last_activity_at===before.last_activity_at,'synthetic keyboard input cannot keep native session alive');
 await page.keyboard.press('Tab');
 await waitForState(activity,rows=>Date.parse(rows[0].last_activity_at)>Date.parse(before.last_activity_at),'TRUSTED_ACTIVITY_NOT_PERSISTED');
 check(true,'trusted browser keyboard activity updates native server timestamp');
 const [touched]=await activity();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await pause(1000);
 const [focused]=await activity();check(focused.last_activity_at===touched.last_activity_at,'focus rechecks do not extend native idle activity');
 enter('expired native session closes browser access');
 await stack.sql(`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '3 hours' where session_id=${lit(initial.session_id)}::uuid`);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 // Native sign-out can make the server Account route redirect first; both
 // routes are valid. Prove revocation below rather than trusting query copy.
 await page.waitForURL(url=>url.pathname==='/login',{waitUntil:'domcontentloaded'});
 check(true,'expired server session redirects actual UI to login');
 const [revoked]=await stack.rows(`select count(*)::int total from auth.sessions where id=${lit(initial.session_id)}::uuid`);
 check(revoked.total===0,'expiry UI revokes its actual native session');
 await page.goto(origin+'/account',{waitUntil:'domcontentloaded'});await page.waitForURL(url=>url.pathname==='/login',{waitUntil:'domcontentloaded'});
 check(true,'expired browser cannot reopen protected account');await ctx.close();
 enter('logout revocation and cross-tab propagation');
 const active=await context(),activePage=await login(active),peer=await active.newPage();
 await peer.goto(origin+'/account',{waitUntil:'domcontentloaded'});await peer.getByRole('button',{name:'Synthetic browser session',exact:true}).waitFor();
 const independent=await context(),independentPage=await login(independent);
 const [sessionsBefore]=await stack.rows(`select count(*)::int total from auth.sessions where user_id=${lit(user.id)}::uuid`);assert.equal(sessionsBefore.total,2);
 await activePage.getByRole('button',{name:'Synthetic browser session',exact:true}).click();const started=performance.now();await activePage.getByRole('menuitem',{name:'Sign out',exact:true}).click();
 await activePage.waitForURL(url=>url.pathname==='/login',{waitUntil:'domcontentloaded'});await activePage.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 logEvent('info','test.logout.measured',{kind:'application',duration_ms:Math.round(performance.now()-started),scope:'native.local.dev'});
 await peer.waitForURL(url=>url.pathname==='/login',{waitUntil:'domcontentloaded'});check(true,'confirmed logout propagates to sibling browser tab');
 const [sessionsAfter]=await stack.rows(`select count(*)::int total from auth.sessions where user_id=${lit(user.id)}::uuid`);check(sessionsAfter.total===1,'logout revokes exactly one native session');
 await independentPage.reload({waitUntil:'domcontentloaded'});await independentPage.getByRole('button',{name:'Synthetic browser session',exact:true}).waitFor();check(true,'independent same-user session remains usable');
 await activePage.goto(origin+'/account',{waitUntil:'domcontentloaded'});await activePage.waitForURL(url=>url.pathname==='/login',{waitUntil:'domcontentloaded'});check(true,'logged-out cookies cannot reopen account');
 await active.close();await independent.close();
 logEvent('info','test.session_ui.verified',{kind:'application',passed:results.length,scope:'native.local.smart_flags',hosted_verified:false});
}catch(error){failed=true;process.exitCode=1;logEvent('error','test.session_ui.failed',{kind:'application',stage,passed:results.length,error:{type:error.name,message:stack?.redact(error.message)??error.message,stack:stack?.redact(error.stack??'')??error.stack}});}
finally{
 await browser?.close();
 if(next?.pid&&next.exitCode===null)await new Promise(done=>{const child=spawn('taskkill',['/PID',String(next.pid),'/T','/F'],{env:localEnvironment(),windowsHide:true,stdio:'ignore'});child.once('close',done);child.once('error',done);});
 try{await stack?.close();}catch(error){failed=true;process.exitCode=1;logEvent('error','test.cleanup.failed',{kind:'application',error});}
 await writeFile(join(scratch,'acceptance.json'),JSON.stringify({passed:!failed,stage,results,scope:'native.local.smart_flags',hosted_verified:false},null,2));
 if(failed)await writeFile(join(scratch,'server-log.txt'),serverLog);
 logEvent('info','test.session_ui.finished',{kind:'application',outcome:failed?'failure':'success',artifact:scratch});await flushLogs();
}
