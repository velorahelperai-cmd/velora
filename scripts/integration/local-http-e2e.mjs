// Test-only real local UI + Auth/REST orchestrator. No project env file or live provider.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localEnvironment,guardedEnvironment,assertPortsFree,assertNoEnvironmentFiles,assertOwnedListener} from './local-http-safety.mjs';
import {createClient} from '@supabase/supabase-js';
import {startStack,lit} from './local-http-stack.mjs';
import {runBrowserJourney,finishInboxJourney} from './local-http-browser-journey.mjs';
const root=resolve(import.meta.dirname,'../..'),appOrigin='http://127.0.0.1:3120';
const artifact=join(root,'artifacts/c1-http-e2e');
const keep=process.argv.includes('--keep-alive');
let stack,next,journey,adminBrowser,stopPromise;const privateValues=new Set(),children=new Set();
const clean=value=>{let out=stack?stack.redact(value):String(value);for(const value of privateValues)out=out.replaceAll(value,'[LOCAL_CREDENTIAL_REDACTED]');return out;};
const log=message=>console.log(clean(message));
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
async function terminate(p){if(!p?.pid||p.exitCode!==null)return;if(process.platform==='win32')await new Promise(ok=>{const killer=spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{env:localEnvironment(),windowsHide:true,stdio:'ignore'});killer.on('error',ok);killer.on('close',ok);});else p.kill('SIGTERM');}
async function child(args,env){return new Promise((ok,fail)=>{const p=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(p);let output='';const timer=setTimeout(()=>{void terminate(p);fail(Error('LOCAL_CHILD_TIMEOUT'));},240000);for(const s of [p.stdout,p.stderr])s.on('data',v=>{output+=clean(v.toString());});p.on('error',()=>{clearTimeout(timer);children.delete(p);fail(Error('LOCAL_CHILD_START_FAILED'));});p.on('close',code=>{clearTimeout(timer);children.delete(p);log(output);if(code===0)ok();else fail(Error('LOCAL_CHILD_CHECK_FAILED'));});});}
async function publishViaUi(){
 const {chromium}=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');
 adminBrowser=await chromium.launch({headless:true,channel:'chrome',env:localEnvironment()});const ctx=await adminBrowser.newContext({serviceWorkers:'block'});
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===appOrigin||u.origin===stack.url?r.continue():r.abort();});
 await ctx.addCookies([{name:'velora_locale',value:'en',url:appOrigin}]);const p=await ctx.newPage();p.setDefaultTimeout(60_000);
 await p.goto(appOrigin+'/login',{waitUntil:'networkidle',timeout:60_000});
 log('LOCAL_ADMIN_LOGIN_RENDERED');
 await p.screenshot({path:join(artifact,'admin-login-rendered.png'),fullPage:true});
 await p.getByLabel(/^Email address/).fill(stack.owner.email);await p.getByLabel(/^Password/).fill(stack.owner.password);
 await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForURL(u=>u.pathname==='/admin',{timeout:60_000});
 await p.goto(appOrigin+'/admin/catalog',{waitUntil:'networkidle',timeout:60_000});
 log('LOCAL_ADMIN_CATALOG_RENDERED');
 await p.screenshot({path:join(artifact,'admin-catalog-rendered.png'),fullPage:true});
 await p.getByLabel('Character & Tier',{exact:false}).selectOption('noor_basic');
 await p.getByLabel('Monthly Price (OMR)',{exact:false}).fill('45.000');
 await p.getByLabel('Successful automated outbound messages per month',{exact:false}).fill('31');
 await p.getByRole('button',{name:'Save Draft',exact:true}).click();await p.getByText('Server confirmed draft saved successfully.',{exact:true}).waitFor();
 await p.getByRole('button',{name:'Publish Version',exact:true}).click();
 await p.getByRole('button',{name:'Confirm Publication',exact:true}).click();await p.getByText('Server confirmed version published successfully.',{exact:true}).waitFor();
 const rows=await stack.rows("SELECT v.id,v.amount_baisa FROM public.billing_plan_versions v JOIN public.billing_plans p ON p.id=v.plan_id WHERE p.code='noor_basic' AND v.status='published' AND v.period_unit='month' AND v.period_count=1");
 if(rows.length!==1||Number(rows[0].amount_baisa)!==45000)throw Error('UI_CATALOG_PUBLICATION_NOT_PERSISTED');
 await p.screenshot({path:join(artifact,'platform-catalog-published.png'),fullPage:true});await ctx.close();await adminBrowser.close();adminBrowser=null;log('PASS|browser-platform-owner-published-real-local-catalog');return rows[0].id;
}
function safeEnvironment(){return guardedEnvironment(root,{NEXT_PUBLIC_SUPABASE_URL:stack.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.anonKey,SUPABASE_SERVICE_ROLE_KEY:stack.serviceRoleKey,NEXT_PUBLIC_SITE_URL:appOrigin,
 WHATSAPP_ROUTING_MODE:'tenant_registry',WHATSAPP_EMBEDDED_SIGNUP:'false',WHATSAPP_ALLOW_EXTERNAL_SEND:'false',WHATSAPP_WORKER_ENABLED:'false',BILLING_PAYMOB_CREATE_ENABLED:'false',BILLING_PAYMOB_WEBHOOK_ENABLED:'false',BILLING_PAYMOB_SETTLE_ENABLED:'false',BILLING_PAYMOB_LIVE_ENABLED:'false',PAYMOB_LIVE_ENABLED:'false',WHATSAPP_APP_SECRET:randomBytes(32).toString('hex')});}
async function runtimePhase(phase,base){await child(['node_modules/vitest/vitest.mjs','run','--config','scripts/integration/vitest.local-http.config.mts','--reporter=dot'],{...base,C1_HTTP_E2E_TESTS:'1',C1_HTTP_E2E_PHASE:phase});return JSON.parse(await readFile(join(artifact,'runtime-result.json'),'utf8'));}
async function stop(){if(stopPromise)return stopPromise;stopPromise=(async()=>{await journey?.close().catch(()=>{});if(adminBrowser)await adminBrowser.close().catch(()=>{});await Promise.all([...children,next].filter(Boolean).map(terminate));await stack?.close();})();return stopPromise;}
async function run(){
try{
 await assertNoEnvironmentFiles(root);await assertPortsFree([3120,3130,3140,3141]);await import('./local-http-network-guard.cjs');await mkdir(artifact,{recursive:true});
 process.once('SIGINT',()=>{void stop().finally(()=>process.exit(0));});process.once('SIGTERM',()=>{void stop().finally(()=>process.exit(0));});
 stack=await startStack({appOrigin,progress:log});for(const value of [stack.owner.password,stack.anonKey,stack.serviceRoleKey])privateValues.add(value);
 const env=safeEnvironment();privateValues.add(env.WHATSAPP_APP_SECRET);
 await assertPortsFree([3120]);next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3120'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let nextLog='',nextFailed=false;for(const s of [next.stdout,next.stderr])s.on('data',v=>{nextLog=clean(nextLog+v.toString()).slice(-10000);});next.on('error',()=>{nextFailed=true;});
 let ready=false;for(let i=0;i<90;i++){if(nextFailed||next.exitCode!==null||/EADDRINUSE/.test(nextLog)){log(nextLog);throw Error('LOCAL_NEXT_PROCESS_FAILED');}if(/Ready in/.test(nextLog)){await assertOwnedListener(next,3120);try{const r=await fetch(appOrigin+'/login',{signal:AbortSignal.timeout(5000),redirect:'error'});if(r.status<500){ready=true;break;}}catch{}}await wait(1000);}
 if(!ready){log(nextLog);throw Error('LOCAL_NEXT_NOT_READY');}log('LOCAL_NEXT_UI_READY');
 const planVersionId=await publishViaUi();
 journey=await runBrowserJourney(stack,{appOrigin,verifyCheckoutBlocked:true,recordSetupNavigationFailure:process.argv.includes('--record-setup-navigation-failure')});privateValues.add(journey.user.password);
 const customer=createClient(stack.url,stack.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await customer.auth.signInWithPassword({email:journey.user.email,password:journey.user.password});
 if(error||!data.session)throw Error('LOCAL_CUSTOMER_RUNTIME_LOGIN_FAILED');privateValues.add(data.session.access_token);privateValues.add(data.session.refresh_token);
 const sessionId=JSON.parse(Buffer.from(data.session.access_token.split('.')[1],'base64url').toString()).session_id;
 const checked=await customer.rpc('check_app_session',{p_touch:true});if(checked.error||checked.data?.ok!==true)throw Error('LOCAL_RUNTIME_SESSION_NOT_VALID');
 const platformOwner=createClient(stack.url,stack.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const platformSession=await platformOwner.auth.signInWithPassword({email:stack.owner.email,password:stack.owner.password});
 if(platformSession.error||!platformSession.data.session)throw Error('LOCAL_PLATFORM_FIXTURE_LOGIN_FAILED');
 privateValues.add(platformSession.data.session.access_token);privateValues.add(platformSession.data.session.refresh_token);
 const platformChecked=await platformOwner.rpc('check_app_session',{p_touch:true});if(platformChecked.error||platformChecked.data?.ok!==true)throw Error('LOCAL_PLATFORM_FIXTURE_SESSION_INVALID');
 const base={...env,C1_UI_TEST_STACK_URL:stack.url,C1_UI_TEST_SERVICE_JWT:stack.serviceRoleKey,C1_UI_TEST_ANON_JWT:stack.anonKey,C1_UI_TEST_CUSTOMER_JWT:data.session.access_token,
 C1_UI_TEST_PLATFORM_OWNER_JWT:platformSession.data.session.access_token,
 C1_UI_TEST_COMPANY_ID:journey.companyId,C1_UI_TEST_USER_ID:journey.user.id,C1_UI_TEST_SESSION_ID:sessionId,C1_UI_TEST_PLAN_VERSION_ID:planVersionId,
 C1_UI_TEST_DB_CONTAINER:stack.names.postgres,C1_UI_TEST_RUN_ID:stack.runId,C1_UI_TEST_NETWORK:stack.network,C1_UI_TEST_APP_URL:appOrigin,C1_UI_TEST_WEBHOOK_SECRET:env.WHATSAPP_APP_SECRET};
 let result=await runtimePhase('prepare',base);log('PASS|actual-http-meta-payment-ingress-fixtures-prepared');
 const paidOrders=await stack.rows(`SELECT id FROM public.billing_orders WHERE company_id=${lit(journey.companyId)}::uuid AND provider_environment='live' ORDER BY created_at DESC LIMIT 1`);
 const paymentStates=[...(result.paymentStates??[]),...(paidOrders.length?[{orderId:paidOrders[0].id,kind:'success',query:'?success=false'}]:[]),{orderId:crypto.randomUUID(),kind:'forbidden',query:'?success=true'}];
 for(const item of paymentStates){journey.stage=`browser-payment-${item.kind}`;await journey.page.goto(`${appOrigin}/app/subscription/orders/${item.orderId}${item.query??''}`,{waitUntil:'networkidle'});await journey.page.locator(`[data-payment-state="${item.kind}"]`).waitFor();journey.passedCases.push(`browser-payment-${item.kind}-query-not-proof`);}
 journey=await finishInboxJourney(stack,journey,{conversationId:result.conversationId,expectedReplyText:'Synthetic local answer from approved business knowledge.',afterResume:async()=>{result=await runtimePhase('answer',{...base,C1_UI_TEST_JOB_ID:result.jobId,C1_UI_TEST_CONVERSATION_ID:result.conversationId});}});
 const summary={appOrigin,backendOrigin:stack.url,migrations:stack.migrationCount,uiPassed:journey.passedCases,uiFailed:journey.failedCases,uiBlocked:journey.blockedCases,runtime:result,screenshots:journey.artifacts,productionProviders:'NOT_RUN',cloudParity:'NOT_RUN'};
 await writeFile(join(artifact,'journey-result.json'),JSON.stringify(summary,null,2));log(JSON.stringify({LOCAL_UI_HTTP_E2E:{passed:journey.passedCases.length,failed:journey.failedCases.length,blocked:journey.blockedCases,artifact:join(artifact,'journey-result.json')}}));
 if(journey.failedCases.length)process.exitCode=1;
 if(keep){log(`LOCAL_UI_TESTING_LISTENING:${appOrigin}`);await journey.close();journey=null;await new Promise(()=>{});}else await stop();
}catch(error){if(error.journey)journey=error.journey;log(`LOCAL_UI_HTTP_E2E_FAILURE:${error.message}`);if(journey)await writeFile(join(artifact,'journey-failed.json'),JSON.stringify({stage:journey.stage,passed:journey.passedCases,failed:journey.failedCases,blocked:journey.blockedCases,artifacts:journey.artifacts}));await stop().catch(e=>log(`LOCAL_CLEANUP_FAILED:${e.message}`));process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--help'))console.log('Opt-in local HTTP journey: node scripts/integration/local-http-e2e.mjs --run [--keep-alive] [--record-setup-navigation-failure]. Diagnostic mode retains the known navigation FAIL and exit 1 while testing independent worker paths. Requires Windows listener ownership checks, local Docker images and Chrome. No real providers.');
 else if(process.argv.includes('--run'))await run();
 else{console.error('LOCAL_HTTP_OPT_IN_REQUIRED: use --help or --run');process.exitCode=1;}
}
