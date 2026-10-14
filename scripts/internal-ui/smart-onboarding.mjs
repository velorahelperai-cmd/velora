// Optional browser phase of the native local integration runner. Never uses project env.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {localEnvironment,guardedEnvironment,assertNoEnvironmentFiles,assertPortsFree,assertOwnedListener} from '../integration/local-http-safety.mjs';
import {lit} from '../integration/local-http-stack.mjs';

export async function runSmartSetupUi(stack,user,company){
 const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3320';
 await assertNoEnvironmentFiles(root);await assertPortsFree([3320]);
 await stack.sql(await readFile(join(root,'supabase/migrations/20261013225246_vel_setup_drafts.sql'),'utf8'));
 await stack.sql(`insert into public.profiles(user_id,full_name) values (${lit(user.id)},'Synthetic setup owner') on conflict(user_id) do update set full_name=excluded.full_name;`);
 await stack.sql("notify pgrst,'reload schema';");
 const auth=await fetch(`${stack.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:stack.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})});
 assert.equal(auth.status,200);const token=(await auth.json()).access_token;
 const headers={apikey:stack.anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 for(const [name,path,body] of [
  ['session','rpc/check_app_session',{p_touch:true}],['platform','rpc/is_platform_admin',{}],
  ['profile',`profiles?select=full_name,support_code&user_id=eq.${user.id}`,null],
  ['memberships',`company_members?select=company_id,user_id,role,status,member_name,created_at&user_id=eq.${user.id}&status=eq.active`,null],
  ['company',`companies?select=id,display_name,status,business_type,reply_language,country,city,hours,contact_phone,contact_email,created_by,created_at,updated_at&id=eq.${company}`,null],
 ]){
  const response=await fetch(`${stack.url}/rest/v1/${path}`,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();assert.equal(response.ok,true,`LOCAL_UI_AUTH_PREFLIGHT_${name}:${stack.redact(JSON.stringify(value))}`);
  if(['profile','memberships','company'].includes(name))assert.equal(value.length,1,`LOCAL_UI_AUTH_PREFLIGHT_${name}_ROW`);
 }
 console.log('LOCAL_UI_AUTH_PREFLIGHT_PASS');
 const env=guardedEnvironment(root,{NEXT_PUBLIC_SUPABASE_URL:stack.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.anonKey,SUPABASE_SERVICE_ROLE_KEY:stack.serviceRoleKey,NEXT_PUBLIC_SITE_URL:origin,VELORA_SMART_ONBOARDING_ENABLED:'true',VELORA_MASTER_JOURNEY_ENABLED:'true',WHATSAPP_ALLOW_EXTERNAL_SEND:'false',WHATSAPP_WORKER_ENABLED:'false',WHATSAPP_EMBEDDED_SIGNUP:'false',BILLING_PAYMOB_CREATE_ENABLED:'false',BILLING_PAYMOB_WEBHOOK_ENABLED:'false',BILLING_PAYMOB_SETTLE_ENABLED:'false',BILLING_PAYMOB_LIVE_ENABLED:'false',PAYMOB_LIVE_ENABLED:'false'});
 const next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','3320'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let log='';for(const stream of [next.stdout,next.stderr])stream.on('data',v=>{log=stack.redact(log+v.toString()).slice(-4000);});
 let browser,page;let browserLog='';
 try{
  for(let n=0;n<180;n++){if(next.exitCode!==null)throw Error(`LOCAL_NEXT_EXITED:${log}`);if(log.includes('Ready in'))break;await new Promise(r=>setTimeout(r,500));}
  await assertOwnedListener(next,3320);
  console.log('LOCAL_SMART_UI_NEXT_READY');
  const {chromium}=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');
  browser=await chromium.launch({headless:true,channel:'chrome',env:localEnvironment()});
  const context=await browser.newContext({viewport:{width:1280,height:950},serviceWorkers:'block',reducedMotion:'reduce'});context.setDefaultTimeout(90000);
  await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||u.origin===stack.url?r.continue():r.abort();});
  await context.addCookies([{name:'velora_locale',value:'en',url:origin}]);
  page=await context.newPage();
  page.on('console',message=>{if(message.type()==='error'||message.text().includes('"reference"'))browserLog=stack.redact(browserLog+'\n'+message.text()).slice(-1500);});
  page.on('pageerror',error=>{browserLog=stack.redact(browserLog+'\n'+error.message).slice(-1500);});
  await page.goto(origin+'/login',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('form')).some(form=>Object.getOwnPropertyNames(form).filter(key=>key.startsWith('__reactProps$')).some(key=>typeof form[key]?.onSubmit==='function')));
  await page.getByLabel(/^Email address/).fill(user.email);await page.getByLabel(/^Password/).fill(user.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>['/app','/setup'].includes(u.pathname));
  await page.goto(origin+'/setup',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Prepare your business at your pace'}).waitFor();
  console.log('LOCAL_SMART_UI_CARDS_READY');
  assert.equal(await page.locator('article').count(),9,'all nine cards available');
  const artifacts=join(root,'artifacts/smart-onboarding');await mkdir(artifacts,{recursive:true});
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:950});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`no overflow at ${width}`);
   if(width===390||width===1280)await page.screenshot({path:join(artifacts,`setup-en-${width}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Open settings: Working hours',exact:true}).click();
  await page.getByRole('button',{name:'Return to setup cards',exact:true}).click();
  await page.getByRole('button',{name:'Open settings: Manage branches',exact:true}).click();
  await page.getByLabel('Several branches',{exact:true}).check();
  await page.getByLabel('Main branch name',{exact:true}).fill('Browser main branch');
  await page.getByRole('button',{name:'Save and return to setup',exact:true}).click();
  await page.getByRole('button',{name:'Return to setup cards',exact:true}).waitFor({state:'hidden'});
  assert.equal((await stack.rows(`select name from public.company_branches where company_id=${lit(company)} and is_primary`))[0].name,'Browser main branch','UI writes the authorized company');
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Open settings: Manage branches',exact:true}).click();
  assert.equal(await page.getByLabel('Main branch name',{exact:true}).inputValue(),'Browser main branch','server resume after refresh');
  await page.getByRole('button',{name:'Continue later',exact:true}).click();
  await page.getByRole('button',{name:'Switch to Arabic',exact:true}).click();
  await page.getByRole('heading',{name:'جهّز نشاطك على راحتك'}).waitFor();
  await page.setViewportSize({width:390,height:950});
  assert.equal(await page.locator('main').getAttribute('dir'),'rtl');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'RTL mobile does not overflow');
  await page.screenshot({path:join(artifacts,'setup-ar-390.png'),fullPage:true});
  assert.equal(await page.getByRole('progressbar').evaluate(e=>getComputedStyle(e.firstElementChild).transitionDuration),'0s','reduced motion');
  console.log('SMART_ONBOARDING_UI_PASS: nine cards, independent hours, branch save/resume, 320/390/768/1280px, Arabic RTL, reduced motion');
 }catch(error){
  const controls=page?await page.locator('form').allTextContents().catch(()=>[]):[];
  throw Error(stack.redact(`${error.message}\n${page?.url()??''}\n${controls.join('\n')}\n${browserLog}\n${log}`));
 }
 finally{
  await browser?.close();
  if(next.pid&&next.exitCode===null)await new Promise(r=>{const stop=spawn('taskkill',['/PID',String(next.pid),'/T','/F'],{env:localEnvironment(),windowsHide:true,stdio:'ignore'});stop.once('close',r);stop.once('error',r);});
 }
}
