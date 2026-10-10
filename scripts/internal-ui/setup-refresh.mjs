// LOCAL ONLY: actual Next UI + isolated synthetic Auth/REST. No provider calls.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { startStack,lit } from '../integration/local-http-stack.mjs';
import { localEnvironment,guardedEnvironment,assertNoEnvironmentFiles,assertPortsFree,assertOwnedListener } from '../integration/local-http-safety.mjs';
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3120',artifacts=join(root,'artifacts/internal-ui');
const pause=ms=>new Promise(r=>setTimeout(r,ms));let stack,next,browser,context,page;
async function stop(){await browser?.close().catch(()=>{});if(next?.pid&&next.exitCode===null)await new Promise(r=>{const k=spawn('taskkill',['/PID',String(next.pid),'/T','/F'],{env:localEnvironment(),windowsHide:true,stdio:'ignore'});k.on('close',r);k.on('error',r);});await stack?.close();}
function assert(v,code){if(!v)throw Error(code);}
try{
 await assertNoEnvironmentFiles(root);await assertPortsFree([3120,3130,3140,3141]);await import('../integration/local-http-network-guard.cjs');await mkdir(artifacts,{recursive:true});
 stack=await startStack({appOrigin:origin,throughMigration:'20261009215520_g03_verified_review.sql',progress:m=>console.log(m)});
 const env=guardedEnvironment(root,{NEXT_PUBLIC_SUPABASE_URL:stack.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.anonKey,SUPABASE_SERVICE_ROLE_KEY:stack.serviceRoleKey,NEXT_PUBLIC_SITE_URL:origin,WHATSAPP_ALLOW_EXTERNAL_SEND:'false',WHATSAPP_WORKER_ENABLED:'false',WHATSAPP_EMBEDDED_SIGNUP:'false',BILLING_PAYMOB_CREATE_ENABLED:'false',BILLING_PAYMOB_WEBHOOK_ENABLED:'false',BILLING_PAYMOB_SETTLE_ENABLED:'false',BILLING_PAYMOB_LIVE_ENABLED:'false',PAYMOB_LIVE_ENABLED:'false'});
 next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3120'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';for(const s of [next.stdout,next.stderr])s.on('data',v=>{log=stack.redact(log+v.toString()).slice(-3000);});
 for(let n=0;n<120;n++){if(next.exitCode!==null)throw Error('LOCAL_NEXT_EXITED');if(log.includes('Ready in'))break;await pause(500);}await assertOwnedListener(next,3120);
 const user=await stack.adminCreateUser({userMetadata:{full_name:'Synthetic UI Owner'}}),company=randomUUID();
 await stack.sql(`INSERT INTO profiles(user_id,full_name) VALUES(${lit(user.id)},'Synthetic UI Owner') ON CONFLICT(user_id) DO UPDATE SET full_name=excluded.full_name;INSERT INTO companies(id,display_name,business_type,status,hours,reply_language,country,city,created_by) VALUES(${lit(company)},'Synthetic workshop','retail','setup','Sunday-Thursday 09:00-18:00','en','OM','Muscat',${lit(user.id)});INSERT INTO company_members(company_id,user_id,role,status) VALUES(${lit(company)},${lit(user.id)},'owner','active');`);
 const {chromium}=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');browser=await chromium.launch({headless:true,channel:'chrome',env:localEnvironment()});context=await browser.newContext({viewport:{width:1280,height:950},serviceWorkers:'block',reducedMotion:'reduce'});context.setDefaultTimeout(60000);
 await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||u.origin===stack.url?r.continue():r.abort();});await context.addCookies([{name:'velora_locale',value:'en',url:origin}]);page=await context.newPage();
 await page.goto(origin+'/login',{waitUntil:'networkidle'});await page.getByLabel(/^Email address/).fill(user.email);await page.getByLabel(/^Password/).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>['/app','/setup'].includes(u.pathname));
 await page.evaluate(({user,company})=>localStorage.setItem(`velora_company_draft_v1:${user}`,JSON.stringify({version:1,userId:user,companyId:company,setupStep:3,setupDone:Array(8).fill(true),businessSaved:true,business:{}})),{user:user.id,company});

 await page.setViewportSize({width:390,height:950});await page.goto(origin+'/setup',{waitUntil:'networkidle'});
 async function choose(step){await page.getByRole('combobox',{name:/^Go to milestone/}).selectOption(String(step));}
 async function refresh(){const response=page.waitForResponse(r=>r.url().includes('/setup')&&r.request().headers()['rsc']==='1');await page.evaluate(()=>window.nd.router.refresh());await (await response).text();await page.waitForTimeout(500);}
 const name=page.getByLabel(/^Business name/),city=page.getByLabel(/^City/),hours=page.getByLabel(/^Working hours/);
 await choose(0);await page.waitForTimeout(500);
 await stack.sql(`UPDATE companies SET display_name='Updated workshop',hours='10-17' WHERE id=${lit(company)};`);await refresh();
 assert(await name.inputValue()==='Updated workshop'&&await hours.inputValue()==='10-17','PRISTINE_REFRESH');
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='0','REFRESH_NAV_STAYS');console.log('PASS|pristine same-company refresh and navigation');
 await name.fill('Owner edit');await stack.sql(`UPDATE companies SET city='Salalah',hours='11-16' WHERE id=${lit(company)};`);await refresh();
 assert(await name.inputValue()==='Owner edit'&&await city.inputValue()==='Salalah'&&await hours.inputValue()==='11-16','DIRTY_UNRELATED_REFRESH');
 await stack.sql(`UPDATE companies SET display_name='Concurrent save' WHERE id=${lit(company)};`);await refresh();
 assert(await name.inputValue()==='Owner edit'&&await page.locator('section form button[type="submit"]').isDisabled(),'CONFLICT_BLOCKS');
 await page.getByRole('button',{name:'Use latest conflicting values',exact:true}).click();assert(await name.inputValue()==='Concurrent save','CONFLICT_RESOLVED');
 await name.fill('Owner confirmed');await page.locator('section form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('nav select')?.value==='1');
 const saved=await stack.sql(`SELECT display_name||'|'||city||'|'||hours FROM companies WHERE id=${lit(company)};`);assert(String(saved).trim()==='Owner confirmed|Salalah|11-16','NO_STALE_OVERWRITE');
 await page.reload({waitUntil:'networkidle'});assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='1','SAVE_RELOAD_NAV');console.log('PASS|dirty merge, conflict guard, confirmed save and reload');
 await choose(2);await stack.sql(`UPDATE companies SET hours='12-15' WHERE id=${lit(company)};`);await refresh();assert(await hours.inputValue()==='12-15','PRISTINE_HOURS');
 await hours.fill('13-14');await stack.sql(`UPDATE companies SET hours='08-20' WHERE id=${lit(company)};`);await refresh();assert(await hours.inputValue()==='13-14'&&await page.locator('section form button[type="submit"]').isDisabled(),'DIRTY_HOURS_CONFLICT');
 await page.getByRole('button',{name:'Use latest conflicting values',exact:true}).click();await page.locator('section form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('nav select')?.value==='3');
 await choose(4);const language=page.locator('section form select');await stack.sql(`UPDATE companies SET reply_language='ar' WHERE id=${lit(company)};`);await refresh();assert(await language.inputValue()==='ar','PRISTINE_LANGUAGE');
 await language.selectOption('en');await stack.sql(`UPDATE companies SET reply_language='both' WHERE id=${lit(company)};`);await refresh();assert(await language.inputValue()==='en'&&await page.locator('section form button[type="submit"]').isDisabled(),'DIRTY_LANGUAGE_CONFLICT');
 await page.getByRole('button',{name:'Use latest conflicting values',exact:true}).click();await page.locator('section form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('nav select')?.value==='5');console.log('PASS|hours and language refresh and overlapping edits');
 await writeFile(join(artifacts,'refresh-result.json'),JSON.stringify({live:false,passed:['pristine same-company refresh','dirty fields retained and untouched server fields merged','overlapping edits block submit until resolution','confirmed save retains latest unrelated fields','save/reload navigation unchanged','hours and language pristine/dirty refresh'],baselineThrough:'20261009215520_g03_verified_review.sql'},null,2));console.log('SETUP_REFRESH_BROWSER_COMPLETE');
}catch(error){console.error(stack?stack.redact(error.message):error.message);process.exitCode=1;}finally{await stop();}
