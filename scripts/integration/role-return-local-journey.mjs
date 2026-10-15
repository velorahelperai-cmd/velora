// FLOW-001/STAGE-003/TASK-002: actual role return/workspace UI, native local Auth.
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
const workspaceOnly=process.argv.length===3&&process.argv[2]==='--workspace-only';
if(process.argv.length!==2&&!workspaceOnly){logEvent('warn','test.arguments.rejected',{kind:'application',code:'INVALID_INPUT'});await flushLogs();process.exit(1);}
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3320',scratch=join(tmpdir(),'codex-velora-roles-'+randomUUID());
const results=[],pause=ms=>new Promise(done=>setTimeout(done,ms));
let stack,next,browser,stage='startup',log='',failure=false;
const check=(value,name)=>{assert.ok(value,name);results.push({name,passed:true});};
const enter=value=>{stage=value;logEvent('info','test.return.stage',{kind:'application',stage});};
try{
 await mkdir(scratch,{recursive:true});
 stack=await startStack({gatewayPort:3330,authPort:3340,restPort:3341,appOrigin:origin,throughMigration:'20261009215520_g03_verified_review.sql',canonicalSqlLineEndings:true,reuseUpstreamConnections:true,progress:value=>logEvent('info','test.stack.progress',{kind:'application',stage:value})});
 for(const method of ['sql','rows','adminCreateUser']){const original=stack[method].bind(stack);stack[method]=async(...args)=>{const started=performance.now();let outcome='failure';try{const receipt=await original(...args);outcome='success';return receipt;}finally{logEvent(outcome==='success'?'info':'warn','dependency.fixture.completed',{kind:'application',target:method==='adminCreateUser'?'local.auth':'local.postgres',duration_ms:Math.round(performance.now()-started),outcome});}};}
 for(const name of ['20261013225228_vel_verified_identity_authority.sql','20261013225246_vel_setup_drafts.sql'])await stack.sql(await readFile(join(root,'supabase/migrations',name),'utf8'));
 await stack.sql("notify pgrst,'reload schema';");
 const otherOwner=await stack.adminCreateUser({userMetadata:{full_name:'Synthetic second owner'}});
 const owner=await stack.adminCreateUser({userMetadata:{full_name:'Synthetic return owner'}}),staff=await stack.adminCreateUser({userMetadata:{full_name:'Synthetic return staff'}}),multi=await stack.adminCreateUser({userMetadata:{full_name:'Synthetic return chooser'}}),companyA=randomUUID(),companyB=randomUUID();
 await stack.sql(`insert into public.companies(id,display_name,status,created_by) values(${lit(companyA)}::uuid,'Synthetic setup company','setup',${lit(owner.id)}::uuid),(${lit(companyB)}::uuid,'Synthetic active company','active',${lit(otherOwner.id)}::uuid);insert into public.company_members(company_id,user_id,role,status) values(${lit(companyA)}::uuid,${lit(owner.id)}::uuid,'owner','active'),(${lit(companyB)}::uuid,${lit(staff.id)}::uuid,'staff','active'),(${lit(companyA)}::uuid,${lit(multi.id)}::uuid,'owner','active'),(${lit(companyB)}::uuid,${lit(multi.id)}::uuid,'staff','active'),(${lit(companyB)}::uuid,${lit(otherOwner.id)}::uuid,'owner','active');`);
 for(const name of ['src','public','package.json','package-lock.json','tsconfig.json','next.config.ts','postcss.config.mjs','.gitignore','scripts','supabase'])await cp(join(root,name),join(scratch,name),{recursive:true});
 await symlink(join(root,'node_modules'),join(scratch,'node_modules'),'junction');await assertNoEnvironmentFiles(scratch);await assertPortsFree([3320]);
 const env=guardedEnvironment(scratch,{NEXT_PUBLIC_SUPABASE_URL:stack.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.anonKey,SUPABASE_SERVICE_ROLE_KEY:stack.serviceRoleKey,NEXT_PUBLIC_SITE_URL:origin,VELORA_SMART_ONBOARDING_ENABLED:'false',VELORA_MASTER_JOURNEY_ENABLED:'false',VELORA_ENTERPRISE_LIFECYCLE_ENABLED:'false'});
 next=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3320'],{cwd:scratch,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 for(const stream of [next.stdout,next.stderr])stream.on('data',value=>{log=stack.redact(log+value.toString()).slice(-5000);});
 for(let n=0;n<180;n++){if(next.exitCode!==null)throw Error('LOCAL_NEXT_EXITED');if(log.includes('Ready in'))break;await pause(500);}await assertOwnedListener(next,3320);
 const {chromium}=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');browser=await chromium.launch({headless:true,channel:'chrome',env:localEnvironment()});
 async function context(){const ctx=await browser.newContext({viewport:{width:1440,height:950},serviceWorkers:'block',reducedMotion:'reduce'});ctx.setDefaultTimeout(90000);await ctx.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||url.origin===stack.url?route.continue():route.abort();});await ctx.addCookies([{name:'velora_locale',value:'en',url:origin}]);return ctx;}
 async function login(ctx,user,preferred,expected){const page=await ctx.newPage();await page.goto(origin+'/login?next='+encodeURIComponent(preferred),{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('form')).some(form=>Object.getOwnPropertyNames(form).filter(key=>key.startsWith('__reactProps$')).some(key=>typeof form[key]?.onSubmit==='function')));await page.getByLabel(/^Email address/).fill(user.email);await page.getByLabel(/^Password/).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(expected,{waitUntil:'domcontentloaded'});return page;}
 if(!workspaceOnly){enter('owner returns through required setup');
 const ownerContext=await context(),ownerPage=await login(ownerContext,owner,'/app',url=>url.pathname==='/setup');await ownerPage.getByRole('button',{name:'Synthetic return owner',exact:true}).waitFor();
 check(new URL(ownerPage.url()).searchParams.get('next')==='/app','setup owner keeps original app destination without bypassing setup');await ownerPage.reload({waitUntil:'domcontentloaded'});await ownerPage.getByRole('button',{name:'Synthetic return owner',exact:true}).waitFor();check(new URL(ownerPage.url()).pathname==='/setup','setup owner return survives reload');await ownerContext.close();
 enter('staff returns to authorised work');
 const staffContext=await context(),staffPage=await login(staffContext,staff,'/setup',url=>url.pathname==='/app/conversations');await staffPage.getByRole('button',{name:'Synthetic return staff',exact:true}).waitFor();check(true,'staff setup intent resolves to staff work home');await staffPage.reload({waitUntil:'domcontentloaded'});await staffPage.getByRole('button',{name:'Synthetic return staff',exact:true}).waitFor();check(new URL(staffPage.url()).pathname==='/app/conversations','staff work home survives reload');await staffContext.close();}
 enter('multiple memberships require explicit workspace');
 const multiContext=await context(),multiPage=await login(multiContext,multi,'/setup',url=>url.pathname==='/app');
 const picker=multiPage.locator('select').filter({has:multiPage.locator(`option[value="${companyA}"]`)});await picker.waitFor();
 const verifyChoice=workspaceOnly?assert.ok:check;
 verifyChoice(await picker.inputValue()===''&&await picker.locator('option').count()===3,'multiple memberships show both choices without selecting implicitly');
 verifyChoice(new URL(multiPage.url()).searchParams.get('next')==='/setup','workspace chooser preserves requested setup');await picker.selectOption(companyA);await multiPage.waitForURL(url=>url.pathname==='/setup',{waitUntil:'domcontentloaded'});await multiPage.getByRole('button',{name:'Synthetic return chooser',exact:true}).waitFor();
 const selected=(await multiContext.cookies()).find(cookie=>cookie.name==='velora_workspace_company');verifyChoice(selected&&decodeURIComponent(selected.value)===multi.id+':'+companyA,'selected workspace cookie is bound to the authenticated actor');
 enter('selected company survives reload');await multiPage.reload({waitUntil:'domcontentloaded'});await multiPage.getByRole('button',{name:'Synthetic return chooser',exact:true}).click();await multiPage.getByText('Synthetic setup company',{exact:true}).waitFor();check(true,'selected company data survives a server reload');
 await multiContext.close();
 enter('foreign actor cookie never selects a workspace');
 const foreignContext=await context();await foreignContext.addCookies([{name:'velora_workspace_company',value:owner.id+':'+companyB,url:origin}]);const foreignPage=await login(foreignContext,multi,'/setup',url=>url.pathname==='/app');const foreignPicker=foreignPage.locator('select').filter({has:foreignPage.locator(`option[value="${companyA}"]`)});await foreignPicker.waitFor();check(await foreignPicker.inputValue()==='','previous account workspace cookie cannot choose a company for another account');
 enter('reused upstream connections preserve actor isolation');
 async function nativeRequest(path,options){const started=performance.now();let outcome='failure';try{const response=await fetch(stack.url+path,{...options,signal:AbortSignal.timeout(15000)});outcome=response.ok?'success':'denied';return response;}finally{logEvent(outcome==='failure'?'warn':'info','dependency.fixture.completed',{kind:'application',target:path.startsWith('/auth/')?'local.auth':'local.rest',duration_ms:Math.round(performance.now()-started),outcome});}}
 for(const actor of [owner,staff]){
  const signedIn=await nativeRequest('/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:stack.anonKey,'content-type':'application/json'},body:JSON.stringify({email:actor.email,password:actor.password})});assert.equal(signedIn.ok,true);const credentials=await signedIn.json();const read=await nativeRequest('/rest/v1/profiles?select=user_id',{headers:{apikey:stack.anonKey,authorization:'Bearer '+credentials.access_token}});assert.equal(read.ok,true);const rows=await read.json();check(rows.length===1&&rows[0].user_id===actor.id,'reused upstream channel preserves native profile isolation for '+(actor.id===owner.id?'owner':'staff'));
 }
 logEvent('info','test.return.verified',{kind:'application',passed:results.length,scope:'native.local.legacy_flags',workspace_only:workspaceOnly});await writeFile(join(scratch,'acceptance.json'),JSON.stringify({passed:true,results},null,2));
}catch(error){failure=true;process.exitCode=1;
 const pages=[];for(const ctx of browser?.contexts()??[])for(const page of ctx.pages()){const text=await page.locator('body').innerText({timeout:3000}).catch(()=>'BODY_UNAVAILABLE');pages.push({path:new URL(page.url()).pathname,text:stack?.redact(text).slice(0,6000)??'UNAVAILABLE'});}
 await writeFile(join(scratch,'failure-page.json'),JSON.stringify({pages,serverLog:log},null,2));
 logEvent('error','test.return.failed',{kind:'application',stage,passed:results.length,error:{type:error.name,message:stack?.redact(error.message)??error.message,stack:stack?.redact(error.stack??'')??error.stack}});await writeFile(join(scratch,'acceptance.json'),JSON.stringify({passed:false,stage,results},null,2));}
finally{await browser?.close();if(next?.pid&&next.exitCode===null)await new Promise(done=>{const child=spawn('taskkill',['/PID',String(next.pid),'/T','/F'],{env:localEnvironment(),windowsHide:true,stdio:'ignore'});child.once('close',done);child.once('error',done);});await stack?.close();logEvent('info','test.return.finished',{kind:'application',outcome:failure?'failure':'success',artifact:scratch});await flushLogs();}
