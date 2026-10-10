// LOCAL ONLY: actual Next UI + isolated synthetic Auth/REST. No provider calls.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { startStack,lit } from '../integration/local-http-stack.mjs';
import { localEnvironment,guardedEnvironment,assertNoEnvironmentFiles,assertPortsFree,assertOwnedListener } from '../integration/local-http-safety.mjs';
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3120',artifacts=join(root,'artifacts/internal-ui');
const pause=ms=>new Promise(r=>setTimeout(r,ms));let stack,next,browser,context,page;
async function stop(){await browser?.close().catch(()=>{});if(next?.pid&&next.exitCode===null)await new Promise(r=>{const k=spawn('taskkill',['/PID',String(next.pid),'/T','/F'],{env:localEnvironment(),windowsHide:true,stdio:'ignore'});k.on('close',r);k.on('error',r);});await stack?.close();}
function assert(v,code){if(!v)throw Error(code);}
async function capture(phase){
 const records=[];
 for(const locale of ['en','ar']){
  await context.addCookies([{name:'velora_locale',value:locale,url:origin}]);
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:950});
   for(const path of ['/setup','/app/settings']){
    await page.goto(origin+path,{waitUntil:'networkidle'});await page.waitForTimeout(400);
    await page.screenshot({path:join(artifacts,`${phase}-${locale}-${width}-${path==='/setup'?'setup':'workspace'}.png`),fullPage:true});
    const r=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dir:document.documentElement.dir,title:document.querySelector('h1')?.textContent,step:document.querySelector('[aria-current="step"]')?.textContent?.trim()}));
    records.push({locale,path,...r});console.log(`CAPTURE|${phase}|${locale}|${width}|${path}|${r.scrollWidth}`);
   }
  }
 }
 await page.setViewportSize({width:1280,height:950});await context.addCookies([{name:'velora_locale',value:'en',url:origin}]);
 await page.goto(origin,{waitUntil:'networkidle'});await page.screenshot({path:join(artifacts,`${phase}-homepage-1280.png`),fullPage:true});
 await writeFile(join(artifacts,`${phase}-metrics.json`),JSON.stringify(records,null,2));console.log(`${phase.toUpperCase()}_SCREENSHOTS_READY`);
 return records;
}
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
 if (!process.argv.includes('--after-only') && !process.argv.includes('--interactions-only') && !process.argv.includes('--keyboard-only')) {
 await capture('before');await page.goto(origin+'/setup',{waitUntil:'networkidle'});
 console.log('BEFORE_RELOAD_STEP',await page.locator('[aria-current="step"]').textContent());
 console.log('UI_HARNESS_WAITING_FOR_AFTER_SIGNAL');
 while(true){try{const flag=await readFile(join(artifacts,'after-signal.json'),'utf8');if(JSON.parse(flag).run===true)break;}catch{}await pause(1000);}
 }
 // Re-seed navigation only; this never supplies completion, approval or activation.
 await page.evaluate(({user,company})=>{const key=`velora_company_draft_v1:${user}`;const d=JSON.parse(localStorage.getItem(key)||'{}');localStorage.setItem(key,JSON.stringify({...d,version:1,userId:user,companyId:company,setupStep:3}));},{user:user.id,company});
 const results=(process.argv.includes('--interactions-only') || process.argv.includes('--keyboard-only')) ? JSON.parse(await readFile(join(artifacts,'after-metrics.json'),'utf8')) : await capture('after');assert(results.every(r=>r.scrollWidth<=r.width),'PAGE_WIDE_OVERFLOW');
 await page.goto(origin+'/setup',{waitUntil:'networkidle'});await page.waitForTimeout(300);assert((await page.locator('[aria-current="step"]').getAttribute('aria-label')).includes('Products'),'RELOAD_MUST_KEEP_KNOWLEDGE_STEP');
 console.log('PASS|reload preserves scoped navigation without marking steps complete');
 await context.addCookies([{name:'velora_locale',value:'en',url:origin}]);
 await page.setViewportSize({width:390,height:950});await page.goto(origin+'/setup',{waitUntil:'networkidle'});
 async function choose(step){await page.getByRole('combobox',{name:/^Go to milestone/}).selectOption(String(step));await page.waitForTimeout(150);}
 if (!process.argv.includes('--keyboard-only')) {
 await choose(2);const hours=page.locator('section input').first();await hours.fill('Synthetic hours 10:00-17:00');
 let rejected=0;const dismiss=d=>{rejected++;void d.dismiss();};page.on('dialog',dismiss);await choose(3);await page.waitForTimeout(150);
 assert(await hours.inputValue()==='Synthetic hours 10:00-17:00' && await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='2','HOURS_CANCEL_PRESERVES_EDITS');page.off('dialog',dismiss);
 await page.locator('section form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector("nav select")?.value==="3");console.log("PASS|hours saved and advanced");
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='3','HOURS_SAVE_ADVANCES');await page.reload({waitUntil:'networkidle'});await page.waitForTimeout(300);
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='3','HOURS_SAVE_RELOAD_STAYS');
 await choose(4);await page.locator('section form select').selectOption('both');page.on('dialog',dismiss);await choose(3);await page.waitForTimeout(150);
 assert(await page.locator('section form select').inputValue()==='both' && await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='4','LANGUAGE_CANCEL_PRESERVES_EDITS');page.off('dialog',dismiss);
 await page.locator('section form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector("nav select")?.value==="5");console.log("PASS|language saved and advanced");
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='5','LANGUAGE_SAVE_ADVANCES');await page.reload({waitUntil:'networkidle'});await page.waitForTimeout(300);
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='5','LANGUAGE_RELOAD_STAYS');assert(rejected===2,'DIRTY_GUARD_DIALOGS');console.log('PASS|hours/language cancel and reload');
 await choose(3);await page.getByRole('button',{name:'Add information',exact:true}).click();
 await page.getByLabel(/^Title/).fill('Synthetic UI return policy');await page.getByLabel(/^Details/).fill('Synthetic return policy: unused items may be returned within seven days.');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForTimeout(1500);
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='3','KNOWLEDGE_SAVE_STAYS');await page.reload({waitUntil:'networkidle'});await page.waitForTimeout(300);
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='3','KNOWLEDGE_SAVE_RELOAD_STAYS');await page.getByRole('button',{name:'Edit',exact:true}).click();
 await page.getByLabel(/^Details/).fill('Synthetic return policy: unused items may be returned within ten days.');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForTimeout(1500);
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='3','KNOWLEDGE_EDIT_STAYS');await page.reload({waitUntil:'networkidle'});await page.waitForTimeout(300);
 assert(await page.getByRole('combobox',{name:/^Go to milestone/}).inputValue()==='3','KNOWLEDGE_EDIT_RELOAD_STAYS');await page.screenshot({path:join(artifacts,'final-en-390-knowledge.png'),fullPage:true});
 const persisted=await stack.sql(`SELECT count(*) FROM knowledge_sources WHERE company_id=${lit(company)} AND title='Synthetic UI return policy' AND content_version=2 AND approved_for_answers=false;`);
 assert(String(persisted).trim()==='1','KNOWLEDGE_VERSION_PERSISTED');console.log('PASS|knowledge create/edit persists version 2, remains unapproved, navigation survives refresh');
 }
 await page.goto(origin+'/app/settings',{waitUntil:'networkidle'});const menu=page.getByRole('button',{name:'Workspace menu',exact:true});
 assert(await menu.getAttribute('aria-expanded')==='false','MOBILE_MENU_INIT_CLOSED');assert(!await page.getByRole('link',{name:'Business info',exact:true}).isVisible(),'CLOSED_NAV_HIDDEN');
 await menu.focus();await page.keyboard.press('Enter');assert(await menu.getAttribute('aria-expanded')==='true','MENU_KEYBOARD_OPEN');
 await page.screenshot({path:join(artifacts,'final-en-390-menu.png'),fullPage:true});await page.getByRole('link',{name:'Business info',exact:true}).focus();await page.keyboard.press('Escape');assert(await menu.getAttribute('aria-expanded')==='false','MENU_ESCAPE_CLOSE');assert(await menu.evaluate(e=>e===document.activeElement),'MENU_ESCAPE_FOCUS');
 await page.setViewportSize({width:1280,height:950});await page.waitForTimeout(150);assert(await page.getByRole('link',{name:'Business info',exact:true}).isVisible(),'DESKTOP_NAV_ALWAYS_VISIBLE');
 await page.screenshot({path:join(artifacts,'final-en-1280-workspace.png'),fullPage:true});
 console.log('PASS|keyboard menu, Escape focus and responsive navigation');
 await writeFile(join(artifacts,'result.json'),JSON.stringify({passed:['viewport/RTL screenshots','no page-wide overflow','scope-bound reload navigation','hours/language dirty cancel and saved reload','keyboard menu and Escape focus','desktop responsive navigation','real knowledge create/edit version 2 and reload'],evidence:'Combined with preceding isolated interaction run; no live acceptance',live:false,baselineThrough:'20261009215520_g03_verified_review.sql'},null,2));
 console.log('INTERNAL_UI_BROWSER_COMPLETE');
}catch(error){console.error(stack?stack.redact(error.message):error.message);process.exitCode=1;}finally{await stop();}
