// Test-only actual Next + native GoTrue/PostgREST/Broker. No provider calls or real handoff.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import fs from 'node:fs';
import {startPaymobSandboxTestRunner,SANDBOX_REQUIRED_FIELD_NAMES,assertPortsFree,localEnvironment} from './local-http-safety.mjs';
import {createLocalGatewayHandler} from './local-http-stack.mjs';
const require=createRequire(import.meta.url),task=resolve(import.meta.dirname,'../../..');
const db=require(join(task,'es02-b3-fresh-db.cjs'));
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3320',url='http://127.0.0.1:3330';
const receipt={at:new Date().toISOString(),kind:'ACTUAL_NEXT_NATIVE_OWNER_RETURN',providerCalls:0,tunnel:false,realPaymobConfigConsumed:false,checks:[],syntheticRecords:[]};
const mark=(name)=>{receipt.checks.push(name);console.log('PASS '+name);};
const lit=x=>"'"+String(x).replaceAll("'","''")+"'";
let runner,gateway,browser;const nativeProxies=[];const privateValues=[];
const clean=x=>{let s=String(x);for(const value of privateValues)if(value)s=s.replaceAll(value,'[SYNTHETIC_PRIVATE]');return s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[LOCAL_JWT]');};
try{
 await assertPortsFree([3320,3330,3340,3341,3725]);db.verify();
 const auth=JSON.parse(db.dk(['inspect',db.fixture.names.auth]))[0];
 const rest=JSON.parse(db.dk(['inspect',db.fixture.names.rest]))[0];
 const env=Object.fromEntries(auth.Config.Env.map(s=>{const p=s.indexOf('=');return[s.slice(0,p),s.slice(p+1)]}));
 const restEnv=Object.fromEntries(rest.Config.Env.map(s=>{const p=s.indexOf('=');return[s.slice(0,p),s.slice(p+1)]}));
 const secret=env.GOTRUE_JWT_SECRET;assert(secret);privateValues.push(secret);
 const sign=role=>{const now=Math.floor(Date.now()/1000),h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:url+'/auth/v1',iat:now,exp:now+3600})).toString('base64url'),b=h+'.'+p;return b+'.'+createHmac('sha256',secret).update(b).digest('base64url')};
 const anonKey=sign('anon'),serviceRoleKey=sign('service_role');privateValues.push(anonKey,serviceRoleKey);
 async function verify(){const proof=db.verify();for(const raw of [env.GOTRUE_DB_DATABASE_URL,restEnv.PGRST_DB_URI]){const u=new URL(raw);assert.equal(u.hostname,db.fixture.names.postgres);assert.equal(u.pathname,'/c1_ui_integration');}return{...proof,url,network:db.fixture.names.network,postgresContainer:db.fixture.names.postgres};}
 await verify();
 // Windows Docker host bindings are unavailable in this retained fixture. Own
 // loopback-only transports into the already verified internal Auth/REST containers.
 for(const [port,target,targetPort] of [[3340,db.fixture.names.auth,9999],[3341,db.fixture.names.rest,3000]]){
  const sockets=new Set();
  const server=tcpServer(socket=>{sockets.add(socket);const child=spawn('C:/Users/DELL/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe',['--config',join(task,'wp01a-docker-empty'),'exec','-i',db.fixture.names.postgres,'nc','-w','20',target,String(targetPort)],{env:localEnvironment(),windowsHide:true,stdio:['pipe','pipe','pipe']});socket.setTimeout(25000,()=>socket.destroy());child.stderr.on('data',()=>{});child.stdin.on('error',()=>socket.destroy());child.stdout.on('error',()=>socket.destroy());child.on('error',()=>socket.destroy());child.on('close',()=>{if(!socket.destroyed)socket.end()});socket.on('error',()=>{});socket.once('close',()=>{sockets.delete(socket);child.stdin.end();child.kill()});socket.pipe(child.stdin);child.stdout.pipe(socket)});
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok)});nativeProxies.push({server,sockets});
 }
 gateway=createServer(createLocalGatewayHandler({gatewayPort:3330,appOrigin:origin,url,anonKey,serviceRoleKey,authPort:3340,restPort:3341}));
 await new Promise((ok,fail)=>{gateway.once('error',fail);gateway.listen(3330,'127.0.0.1',ok)});
 const synthetic={PAYMOB_SECRET_KEY_TEST:'om_sk_test_SYNTHETIC_LOCAL_ONLY',PAYMOB_PUBLIC_KEY_TEST:'om_pk_test_SYNTHETIC_LOCAL_ONLY',PAYMOB_HMAC_SECRET:'SYNTHETIC_NOT_PROVIDER_SECRET',PAYMOB_INTEGRATION_ID_TEST:'71610',PAYMOB_MERCHANT_OWNER_ID:'1',PAYMOB_OMR_UNITS_PER_OMR:'1000'};
 let consumed=0;
 console.log("NATIVE_STARTING_OWNED_NEXT");
 runner=await startPaymobSandboxTestRunner({root,appPort:3320,listenPort:3725,allowPaymobOutbound:false,localStack:{url,anonKey,serviceRoleKey,verify},databaseIdentity:{dockerConfig:join(task,'wp01a-docker-empty'),postgresContainer:db.fixture.names.postgres,networkName:db.fixture.names.network},consumer:{purpose:'CALLBACK_TEST_45_OMR_USER_TEST_CARD',statusSnapshot:{state:'READY_FOR_LOCAL_PRIVATE_CONSUMER',operatorTestOmrVerified:true,confirmedPurpose:'CALLBACK_TEST_45_OMR_USER_TEST_CARD',environment:'Test',currency:'OMR',pipeName:'velora-paymob-test-'+'a'.repeat(32),expiresAt:new Date(Date.now()+600000).toISOString(),requiredNames:[...SANDBOX_REQUIRED_FIELD_NAMES]},consumePipe:async()=>{consumed++;return synthetic}},onLog:()=>{}});
 assert.equal(consumed,1);assert(runner.app.pid);receipt.app={pid:runner.app.pid,origin:runner.app.origin};mark('runner_started_owned_actual_next_with_same_native_db');
 const {chromium}=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const accounts=[];
 for(let i=0;i<2;i++){
  const email='runner-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url')+'aA7!',name='Synthetic runner owner '+i;privateValues.push(email,password);
  const r=await fetch('http://127.0.0.1:3340/admin/users',{method:'POST',headers:{Authorization:'Bearer '+serviceRoleKey,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true,user_metadata:{full_name:name}})});assert(r.ok,'native synthetic user creation');const user=await r.json();const companyId=randomUUID();
  db.sql('begin;insert into public.companies(id,display_name,status,created_by) values('+lit(companyId)+','+lit(name)+",'active',"+lit(user.id)+');insert into public.company_members(company_id,user_id,role,status) values('+lit(companyId)+','+lit(user.id)+",'owner','active');commit;");
  receipt.syntheticRecords.push({userId:user.id,companyId});accounts.push({email,password,name,userId:user.id,companyId});
 }
 async function login(account){const ctx=await browser.newContext({serviceWorkers:'block'});await ctx.route('**/*',r=>{const u=new URL(r.request().url());return [origin,url].includes(u.origin)?r.continue():r.abort()});await ctx.addCookies([{name:'velora_locale',value:'en',url:origin}]);const p=await ctx.newPage();p.setDefaultTimeout(60000);await p.goto(origin+'/login',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>{const f=document.querySelector('form');return f&&Object.keys(f).some(k=>k.startsWith('__reactProps$')&&typeof f[k]?.onSubmit==='function')});await p.getByLabel(/^Email address/).fill(account.email);await p.getByLabel(/^Password/).fill(account.password);const pendingResponse=p.waitForResponse(r=>r.request().method()==='POST'&&!!r.request().headers()['next-action']&&!!r.request().postData()?.includes(account.email),{timeout:60000});await p.getByRole('button',{name:'Sign in',exact:true}).click();const actionResponse=await pendingResponse;receipt.loginAction={status:actionResponse.status(),bodyRead:false};assert(actionResponse.status()<400,'native sign-in action HTTP status');await p.waitForURL(u=>u.pathname!=='/login',{timeout:60000});assert(!new URL(p.url()).pathname.includes('verify-email'));return{ctx,p};}
 const owner=await login(accounts[0]);mark('actual_owner_native_login_and_broker');
 const foreign=await login(accounts[1]);mark('actual_foreign_owner_native_login_and_broker');
 const session=JSON.parse(db.sql('select json_build_object(\'id\',id) from auth.sessions where user_id='+lit(accounts[0].userId)+' order by created_at desc limit 1;')).id;
 const operation=randomUUID(),reference='runner_native_'+operation;
 const orderInput={p_company_id:accounts[0].companyId,p_product_code:'velora_ai_staff',p_purchase_purpose:'initial',p_client_op_id:operation,p_input_fingerprint:'synthetic-runner-proof',p_special_reference:reference,p_amount_baisa:45000,p_currency:'OMR',p_period_unit:'month',p_period_count:1,p_provider_account_ref:'71610',p_provider_environment:'test',p_created_by:accounts[0].userId};
 const sql="do $test$ declare v public.billing_plan_versions%rowtype;r jsonb;input jsonb;begin select * into strict v from public.billing_plan_versions where status='published' and amount_baisa=45000 and period_unit='month' and period_count=1 order by id limit 1;input:="+lit(JSON.stringify(orderInput))+"::jsonb||jsonb_build_object('p_plan_version_id',v.id,'p_requested_plan_id',v.plan_id,'p_period_days',v.period_days);set local role service_role;r:=public.billing_create_public_test_subscription_order(input,1000,"+lit(session)+"::uuid);if r->>'ok' is distinct from 'true' then raise exception 'RUNNER_ORDER_CREATE_%',r->>'code';end if;end $test$;";
 db.sql(sql);
 const order=JSON.parse(db.sql('select json_build_object(\'id\',id) from public.billing_orders where company_id='+lit(accounts[0].companyId)+' and special_reference='+lit(reference)+';'));assert(order.id);receipt.orderId=order.id;runner.ingress.setPinnedOrderId(order.id);
 const apiReturn='/api/billing/paymob/return?order_id='+order.id,ingress='http://127.0.0.1:'+runner.ingress.port;
 const redirected=await fetch(ingress+apiReturn+'&success=true&hmac=SYNTHETIC_SIGNATURE&id=123',{redirect:'manual',headers:{cookie:'foreign_tunnel_cookie=not_trusted'}});assert.equal(redirected.status,303);assert.equal(redirected.headers.get('location'),origin+apiReturn);mark('actual_ingress_303_strips_all_provider_claims');
 const noAuth=await fetch(origin+apiReturn,{redirect:'manual'});assert.equal(noAuth.status,401);mark('actual_next_unauth_return_denied');
 const ownerResponse=await owner.ctx.request.get(origin+apiReturn);assert.equal(ownerResponse.status(),200);const display=await ownerResponse.json();assert.equal(display.orderId,order.id);assert.equal(display.kind,'unresolved');assert.equal(display.grantsEntitlement,false);receipt.ownerDisplay={kind:display.kind,orderId:display.orderId,grantsEntitlement:display.grantsEntitlement};mark('actual_owner_pinned_order_visible_no_return_grant');
 const foreignResponse=await foreign.ctx.request.get(origin+apiReturn);const denied=await foreignResponse.json();assert.equal(denied.kind,'forbidden');assert.equal(denied.orderId,null);assert.equal(denied.grantsEntitlement,false);mark('actual_foreign_owner_order_hidden');
 const pageRedirect=await fetch(ingress+'/app/subscription/orders/'+order.id+'?hmac=SYNTHETIC&success=true',{redirect:'manual'});assert.equal(pageRedirect.status,303);assert.equal(pageRedirect.headers.get('location'),origin+'/app/subscription/orders/'+order.id);await owner.p.goto(pageRedirect.headers.get('location'),{waitUntil:'domcontentloaded'});assert.equal(new URL(owner.p.url()).hostname,'127.0.0.1');assert.equal(new URL(owner.p.url()).pathname,'/app/subscription/orders/'+order.id);mark('actual_browser_return_uses_local_owner_cookie');
 receipt.status='PASS';receipt.nativeFinancialState='locked_unpaid_no_provider_intention';receipt.factorMeaning='synthetic local arithmetic only; no provider conversion verification';
}catch(error){receipt.status='FAIL';receipt.error=clean(error.message);receipt.errorCode=error.cause?.code??error.name;console.log('FAIL '+receipt.error);process.exitCode=1;}finally{await browser?.close();await runner?.close();if(gateway){gateway.closeAllConnections();await new Promise(ok=>gateway.close(ok))}for(const {server,sockets} of nativeProxies){for(const socket of sockets)socket.destroy();await new Promise(ok=>server.close(ok))}try{const old=JSON.parse(fs.readFileSync(join(task,'es02-paymob-owned-next-native-receipt.json'),'utf8'));receipt.previousAttempts=[...(old.previousAttempts??[]),{at:old.at,status:old.status,error:old.error,checks:old.checks,syntheticRecords:old.syntheticRecords}];}catch{}await writeFile(join(task,'es02-paymob-owned-next-native-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log('NATIVE_RECEIPT_SAVED_'+receipt.status);}
