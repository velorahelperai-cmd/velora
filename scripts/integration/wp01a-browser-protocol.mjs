// Native local Auth and actual Next UI only. Fixture credentials stay in child memory.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const key="velora:wp01a:continuity:v1";
function local(value){const u=new URL(value);assert.equal(u.protocol,"http:");assert.ok(["127.0.0.1","localhost"].includes(u.hostname));assert.equal(u.username+u.password,"");return u.origin;}
export async function runProtocol(fixture){
 const origin=local(fixture.origin),gateway=local(fixture.gateway);
 assert.equal(fixture.accounts.length,2);
 for(const a of fixture.accounts){assert.ok(a.email.endsWith(".invalid"),"synthetic fixture accounts required");assert.ok(a.password&&a.name);}
 const [a,b]=fixture.accounts;
 const {chromium,request:apiRequest}=require(join(process.env.USERPROFILE,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json").replace(/package\.json$/,""));
 const env={};for(const n of ["PATH","Path","SystemRoot","TEMP","TMP","USERPROFILE","LOCALAPPDATA"])if(process.env[n])env[n]=process.env[n];
 const browser=await chromium.launch({headless:true,channel:"chrome",env});
 const transports=[];const results=[];const mark=result=>{results.push(result);console.log(JSON.stringify({status:"case_pass",result}));};
 async function context(){const c=await browser.newContext({serviceWorkers:"block",reducedMotion:"reduce"});c.setDefaultTimeout(45000);await c.route("**/*",route=>{const u=new URL(route.request().url());return [origin,gateway].includes(u.origin)?route.continue():route.abort();});await c.addCookies([{name:"velora_locale",value:"en",url:origin}]);return c;}
 async function form(page,account){await page.goto(origin+"/login?next=%2Faccount",{waitUntil:"networkidle"});await page.waitForFunction(()=>{const f=document.querySelector("form");return !!f&&Object.keys(f).some(k=>k.startsWith("__reactProps$")&&typeof f[k]?.onSubmit==="function");});await page.getByLabel(/^Email address/).fill(account.email);await page.getByLabel(/^Password/).fill(account.password);}
 async function submit(page){await page.getByRole("button",{name:"Sign in",exact:true}).click();}
 async function loginAndOpen(page,account){await form(page,account);const response=page.waitForResponse(r=>r.request().method()==="POST"&&!!r.request().headers()["next-action"]&&!!r.request().postData()?.includes(account.email));await submit(page);await (await response).finished();await page.waitForURL(u=>u.pathname!=="/login");await actor(page,account);}
 async function actor(page,account){await page.goto(origin+"/account",{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:account.name,exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,"/account");}
 async function anchor(page){await page.waitForFunction(k=>!!localStorage.getItem(k),key);const raw=await page.evaluate(k=>localStorage.getItem(k),key);assert.ok(raw);const v=JSON.parse(raw);assert.equal(v.v,2);assert.ok(v.anchor.length>=40);return v.anchor;}
  const loginAction=(req,account)=>req.method()==="POST"&&!!req.headers()["next-action"]&&!!req.postData()?.includes(account.email);
  const actionResponse=(p,account)=>p.waitForResponse(r=>loginAction(r.request(),account));
 const selected=new Set(fixture.cases??["A1","A2","A3","A4","A5","A6","A7"]);for(const name of selected)assert.ok(["A1","A2","A3","A4","A5","A6","A7","F1","U1"].includes(name));
 try{
  if(selected.has("A1")){
  // A1: both pages execute their real submit handlers concurrently, not a status-GET substitute.
  const c=await context(),pa=await c.newPage(),pb=await c.newPage();
  await Promise.all([form(pa,a),form(pb,b)]);
  const completed=[actionResponse(pa,a),actionResponse(pb,b)];await Promise.all([submit(pa),submit(pb)]);
  for(const response of await Promise.all(completed))assert.ok(response.status()<500,"actual concurrent Auth response must complete");
  const [aa,ab]=await Promise.all([anchor(pa),anchor(pb)]);assert.equal(aa,ab);
  const mirrors=(await c.cookies(origin)).filter(x=>x.name==="vel_bc");assert.equal(mirrors.length,1);assert.equal(mirrors[0].value,aa);
  await pa.goto(origin+"/account",{waitUntil:"domcontentloaded"});
  await pa.getByRole("button",{name:/^Synthetic WP01A [AB]$/}).waitFor();
  let winner=null;for(const account of [a,b])if(await pa.getByRole("button",{name:account.name,exact:true}).isVisible())winner=account;
  assert.ok(winner,"one real admission must become current");await actor(pb,winner);
  mark("R4-A1 completed concurrent Auth responses share anchor and final actor");await c.close();
  }
  if(selected.has("A2")){
  // A2: hold an already-executed A response; allow B to commit and deliver first.
  const shared=await context(),pA=await shared.newPage(),pB=await shared.newPage();
  await form(pA,a);await form(pB,b);
  let releaseA,observedA,deliveredA,delayedCookieName;const delivered=new Promise(ok=>deliveredA=ok);const held=new Promise(ok=>observedA=ok),release=new Promise(ok=>releaseA=ok);
  await pA.route(origin+"/login**",async route=>{
   const req=route.request();if(!loginAction(req,a))return route.fallback();
   // A separate API cookie jar keeps the executed response from installing
   // browser cookies before delivery. The server receives the original request.
   const transport=await apiRequest.newContext();transports.push(transport);
   const response=await transport.fetch(req.url(),{method:req.method(),headers:await req.allHeaders(),data:req.postDataBuffer(),maxRedirects:0});
   assert.ok(response.headersArray().some(h=>h.name.toLowerCase()==="set-cookie"&&h.value.startsWith("vel_sh_")),"A must actually receive broker Set-Cookie");
   delayedCookieName=response.headersArray().find(h=>h.name.toLowerCase()==="set-cookie"&&h.value.startsWith("vel_sh_")).value.split("=")[0];
   observedA();await release;await route.fulfill({response});await transport.dispose();deliveredA();
  });
  await submit(pA);await Promise.race([held,new Promise((_,bad)=>setTimeout(()=>bad(Error("A_ADMISSION_RESPONSE_NOT_CAPTURED")),45000))]);
  const beforeB=(await shared.cookies(origin)).filter(x=>x.name.startsWith("vel_sh_")).map(x=>x.name);
  assert.equal(beforeB.length,0,"held A response must not have installed a browser handle");
  console.log(JSON.stringify({status:"case_step",result:"A2 executed A response held without browser cookie"}));
  const completedB=actionResponse(pB,b);await submit(pB);const responseB=await completedB;
  await responseB.finished();await pB.waitForURL(u=>u.pathname!=="/login");
  console.log(JSON.stringify({status:"case_step",result:"A2 actual B response and navigation completed",httpStatus:responseB.status()}));await actor(pB,b);
  const bCookies=(await shared.cookies(origin)).filter(x=>x.name.startsWith("vel_sh_")&&!beforeB.includes(x.name));assert.equal(bCookies.length,1,"B must issue one distinct versioned handle");
  releaseA();await delivered;assert.ok((await shared.cookies(origin)).some(c=>c.name===delayedCookieName),"delayed A handle cookie must actually reach Chrome");await pA.unroute(origin+"/login**");await pA.waitForURL(u=>u.pathname!=="/login");await actor(pA,b);await actor(pB,b);
  // Lost newest cookie must not fall back to delayed A's remaining active-looking artifact.
  await shared.clearCookies({name:bCookies[0].name});await pA.goto(origin+"/account",{waitUntil:"domcontentloaded"});
  assert.notEqual(new URL(pA.url()).pathname,"/account");assert.equal(await pA.getByRole("button",{name:a.name,exact:true}).count(),0);
  mark("R4-A2 reversed response delivery keeps B; missing B never resurrects A");await shared.close();
  }
  if(selected.has("A3")){
  // A3: actual B session in another browser root survives changes in an independent root.
  const x=await context(),y=await context(),px=await x.newPage(),py=await y.newPage();
  await loginAndOpen(px,a);await loginAndOpen(py,b);
  assert.notEqual(await anchor(px),await anchor(py));await px.evaluate(k=>localStorage.removeItem(k),key);await actor(py,b);
  mark("R4-A3 authenticated independent root remains B after other root wipe");await x.close();await y.close();
  }
  if(selected.has("A4")){
  // A4: real submit with corrupt storage/missing WebLocks must not call server Auth action.
  for(const failure of ["corrupt","locks"]){const z=await context();if(failure==="locks")await z.addInitScript(()=>Object.defineProperty(navigator,"locks",{value:undefined}));const p=await z.newPage();await form(p,a);if(failure==="corrupt")await p.evaluate(k=>localStorage.setItem(k,"{bad"),key);let calls=0;p.on("request",r=>{if(loginAction(r,a))calls++;});await submit(p);await p.waitForTimeout(500);assert.equal(calls,0);assert.equal(new URL(p.url()).pathname,"/login");if(failure==="corrupt")assert.equal(await p.evaluate(k=>localStorage.getItem(k),key),"{bad");mark("R4-A4 actual UI blocks Auth with "+failure);await z.close();}
  }
  if(selected.has("A5")){
  // A5: actual UI logout and reload revoke this browser, preserving another root.
  const lc=await context(),independent=await context(),lp=await lc.newPage(),ip=await independent.newPage();
  await loginAndOpen(lp,a);await loginAndOpen(ip,b);
  await lp.getByRole("button",{name:a.name,exact:true}).click();
  await lp.getByRole("menuitem",{name:/^(Log out|Sign out)$/i}).click();
  await lp.waitForURL(u=>u.pathname==="/login");await lp.goto(origin+"/account",{waitUntil:"domcontentloaded"});assert.notEqual(new URL(lp.url()).pathname,"/account");await actor(ip,b);
  mark("R4-A5 real UI logout survives reload and preserves independent actor");await lc.close();await independent.close();
  }
  if(selected.has("F1")){
  const ca=await context(),cb=await context(),pa=await ca.newPage(),pb=await cb.newPage();const originalCalls=new Map();
  pa.on('request',req=>{const body=req.postData(),id=req.headers()['next-action'];if(id&&body?.includes('"operationKey"')&&!body.includes('"email"'))originalCalls.set(id,{id,body});});
  pa.on('response',async reply=>{const req=reply.request();if(!req.headers()['next-action']||!req.postData()?.includes('"operationKey"'))return;try{for(const line of(await reply.text()).split('\n')){if(!/^[0-9a-f]+:\{/.test(line))continue;const value=JSON.parse(line.slice(line.indexOf(':')+1));if(typeof value.ok==='boolean')console.log(JSON.stringify({status:'case_step',result:'Original operation safe receipt',ok:value.ok,code:value.code,statusCode:value.status,message:value.message}));}}catch{}});
  await loginAndOpen(pa,a);await loginAndOpen(pb,b);assert.ok(a.id,"captured synthetic actor id");let calls=0,finish;const delivered=new Promise(r=>finish=r);await pa.route(origin+"/account**",async route=>{const req=route.request();if(req.method()==="POST"&&req.headers()["next-action"]&&req.postData()?.includes(a.id)){calls++;await route.fetch();await pa.getByRole("region",{name:"Operation recovery"}).waitFor();assert.equal(await pa.getByRole("button",{name:a.name,exact:true}).count(),0);await new Promise(resolve=>setTimeout(resolve,1000));await route.abort("failed");finish();return;}await route.continue();});await pa.getByRole("button",{name:a.name,exact:true}).click();await pa.getByRole("menuitem",{name:/^(Log out|Sign out)$/i}).click();await delivered;
  await pa.getByRole("region",{name:"Operation recovery"}).waitFor();
  for(const locale of ["en","ar"]){
    if(locale==="ar")await pa.locator("main > button").click();
    for(const width of [390,1280]){
      await pa.setViewportSize({width,height:844});
      const recovery=pa.getByRole("region",{name:locale==="ar"?"التحقق من العملية":"Operation recovery"});
      assert.ok(await recovery.isVisible(),"UNKNOWN recovery stays visible");
      assert.ok(await pa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"recovery viewport does not overflow");
      assert.equal(await pa.locator('main [aria-busy="true"]').count(),0,"UNKNOWN is not an indefinite busy state");
      const safe=pa.locator('main a[href="/login"]');await safe.focus();
      assert.equal(await safe.evaluate(el=>el===document.activeElement),true,"safe return reachable by keyboard focus");
      assert.equal(await pa.locator('main input').count(),0,"lost response cannot replay original mutation");
      mark("M07/M32 honest UNKNOWN safe return "+locale+" "+width+"px after dropped response");
    }
  }
  assert.equal(calls,1,"lost logout response cannot trigger blind mutation replay");
  assert.equal(await pa.getByRole("button",{name:a.name,exact:true}).count(),0,"captured identity hidden after uncertain result");
  await pa.unroute(origin+"/account**");
  const denied=await ca.request.get(origin+"/account",{maxRedirects:0});
  assert.ok([302,303,307,308].includes(denied.status()),"revoked captured session denied before reauthentication");
  const disabled=await ca.newPage();await disabled.addInitScript(()=>{for(const method of ['getItem','setItem','removeItem'])Object.defineProperty(Storage.prototype,method,{configurable:true,value(){throw new DOMException('Synthetic storage disabled','SecurityError');}});});
  await disabled.goto(origin+"/account",{waitUntil:"domcontentloaded"});assert.notEqual(new URL(disabled.url()).pathname,"/account");assert.equal(await disabled.getByRole("button",{name:a.name,exact:true}).count(),0);await disabled.reload({waitUntil:"domcontentloaded"});assert.notEqual(new URL(disabled.url()).pathname,"/account");assert.equal(await disabled.getByRole("button",{name:a.name,exact:true}).count(),0);await disabled.close();mark("M08 actual revoked capture reload with disabled storage cannot recover authority");

  await pa.locator("main > button").click();
  const check=pa.getByRole("button",{name:"Check original operation",exact:true});await check.click();
  await pa.getByLabel("Same account email").waitFor();
  for(const locale of ['en','ar']){if(locale==='ar')await pa.locator('main > button').click();for(const width of [390,1280]){await pa.setViewportSize({width,height:844});const email=pa.locator('main input[type="email"]');await email.focus();await pa.keyboard.press('Tab');assert.equal(await pa.evaluate(()=>document.activeElement?.getAttribute('type')),'password');assert.ok(await pa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await pa.getByRole('button',{name:a.name,exact:true}).count(),0);mark('M32 actual reconcile keyboard '+locale+' '+width+'px');}}
  await pa.locator('main > button').click();

  await pa.getByLabel("Same account email").fill(b.email);await pa.getByLabel(/^Current password/).fill(b.password);
  let authReply=pa.waitForResponse(r=>loginAction(r.request(),b));await check.click();await (await authReply).finished();
  await pa.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Check original operation');return b&&!b.disabled;});
  assert.equal(await pa.getByText("The operation and cleanup are confirmed. The previous session remains locked.",{exact:true}).count(),0,"foreign recovery cannot confirm original receipt");
  await actor(pb,b);
  await pa.getByLabel("Same account email").fill(a.email);await pa.getByLabel(/^Current password/).fill(a.password);
  authReply=pa.waitForResponse(r=>loginAction(r.request(),a));await check.click();await (await authReply).finished();
  await pa.getByText("The operation and cleanup are confirmed. The previous session remains locked.",{exact:true}).waitFor();
  assert.equal(await pa.getByRole("button",{name:a.name,exact:true}).count(),0,"reauthenticated receipt never unlocks original mounted capture");
  assert.equal(calls,1,"reconciliation does not repeat original logout mutation");
  await actor(pb,b);
  assert.equal(originalCalls.size,2,'actual resume and ACK action identities captured');
  const capture=await pa.evaluate(()=>{const key=Object.keys(sessionStorage).find(key=>key.startsWith('velora:wp01a:operation:'));return JSON.parse(sessionStorage.getItem(key));});
  for(const call of originalCalls.values()){
    const headers={'next-action':call.id,'content-type':'text/plain;charset=UTF-8',origin};
    const foreign=await cb.request.post(origin+'/account',{headers,data:call.body});assert.equal(foreign.status(),200);const text=await foreign.text();assert.ok(text.includes('"ok":false'),'foreign app actor cannot read/resume/ACK original receipt');
    const captured=JSON.parse(call.body);captured[0].expectedBoundaryFingerprint=capture.boundaryFingerprint;
    const wrongCapture=await cb.request.post(origin+'/account',{headers,data:JSON.stringify(captured)});assert.equal(wrongCapture.status(),200);assert.ok((await wrongCapture.text()).includes('"ok":false'),'foreign supplied capture is not operation authority');
  }
  mark("M06/M07/M11/M12/M13 actual lost-response original receipt, foreign actor rejected, same actor reattested, durable ACK confirmed, original capture locked");
  for(const hint of [{userId:a.id,boundaryFingerprint:'1111111111111111'},{userId:b.id,boundaryFingerprint:'2222222222222222'}]){
    const checked=pb.waitForResponse(r=>r.request().method()==='POST'&&!!r.request().headers()['next-action']);
    await pb.evaluate(hint=>{const key='velora_session_context_v1',value=JSON.stringify({version:1,type:'quarantine',...hint,nonce:crypto.randomUUID()});localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value,storageArea:localStorage}));window.dispatchEvent(new Event('focus'));},hint);
    await (await checked).finished();await pb.getByRole('button',{name:b.name,exact:true}).waitFor();assert.equal(await pb.getByRole('button',{name:a.name,exact:true}).count(),0);
  }
  mark("M09 actual foreign/stale storage and focus hints do not replace or quarantine verified B");

  await ca.close();await cb.close();
  }
  if(selected.has("F1")){
    const c=await context(),p=await c.newPage();await loginAndOpen(p,a);
    const old=(await c.cookies(origin)).find(cookie=>cookie.name.startsWith('vel_sh_'));assert.ok(old);
    await c.clearCookies({name:old.name});await loginAndOpen(p,b);
    const newest=(await c.cookies(origin)).find(cookie=>cookie.name.startsWith('vel_sh_'));assert.ok(newest&&newest.name!==old.name);
    await c.addCookies([old]);const cdp=await c.newCDPSession(p);
    const kept=(await c.cookies(origin)).filter(cookie=>cookie.name!==newest.name);
    await cdp.send('Network.setCookies',{cookies:kept.map(cookie=>({name:cookie.name,value:cookie.value,url:origin,path:cookie.path,httpOnly:cookie.httpOnly,secure:cookie.secure,sameSite:cookie.sameSite,priority:'High'}))});
    const additions=[];for(let i=0;i<20;i++)additions.push({name:'wp01a_quota_high_'+i,value:'synthetic',url:origin,priority:'High'});for(let i=0;i<200;i++)additions.push({name:'wp01a_quota_medium_'+i,value:'synthetic',url:origin,priority:'Medium'});
    await cdp.send('Network.setCookies',{cookies:additions});const after=await c.cookies(origin);
    assert.ok(after.some(cookie=>cookie.name===old.name),'old A artifact must actually remain');assert.ok(!after.some(cookie=>cookie.name===newest.name),'Chrome quota must actually evict newest B handle');
    await p.goto(origin+'/account',{waitUntil:'domcontentloaded'});assert.notEqual(new URL(p.url()).pathname,'/account');assert.equal(await p.getByRole('button',{name:a.name,exact:true}).count(),0);
    mark('M05 actual Chrome quota eviction of B with A artifact retained denies fallback');await c.close();
  }
  if(selected.has("U1")){
  for(const locale of["ar","en"])for(const width of[390,1280]){const c=await context();await c.addCookies([{name:"velora_locale",value:locale,url:origin}]);const p=await c.newPage();await p.setViewportSize({width,height:844});await p.goto(origin+"/login",{waitUntil:"networkidle"});await p.waitForFunction(()=>{const f=document.querySelector("form");return !!f&&Object.keys(f).some(k=>k.startsWith("__reactProps$")&&typeof f[k]?.onSubmit==="function");});assert.equal(await p.locator("html").getAttribute("lang"),locale);assert.equal(await p.locator("html").getAttribute("dir"),locale==="ar"?"rtl":"ltr");assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"auth viewport must not overflow horizontally");const email=p.locator('input[type="email"]');await email.focus();await p.keyboard.press("Tab");assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute("type")),"password");mark("U1 actual hydrated login keyboard and "+locale+" layout at "+width+"px");await c.close();}
  }
  if(selected.has("A6")){
  const current=await context(),otherDevice=await context(),otherActor=await context();
  const p=await current.newPage(),d=await otherDevice.newPage(),q=await otherActor.newPage();
  await loginAndOpen(p,a);await loginAndOpen(d,a);await loginAndOpen(q,b);
  await p.goto(origin+"/reset-password",{waitUntil:"networkidle"});
  const submitPassword=p.getByRole("button",{name:"Set password",exact:true});await submitPassword.waitFor();
  await p.waitForFunction(()=>{const f=document.querySelector("form");return !!f&&Object.keys(f).some(k=>k.startsWith("__reactProps$")&&typeof f[k]?.onSubmit==="function");});
  const changedPassword=a.password+"Changed42!";
  await p.getByLabel(/^New password/).fill(changedPassword);await p.getByLabel(/^Confirm password/).fill(changedPassword);
  const completed=p.waitForResponse(r=>r.request().method()==="POST"&&!!r.request().headers()["next-action"]&&!!r.request().postData()?.includes(changedPassword));
  await submitPassword.click();await (await completed).finished();
  console.log(JSON.stringify({status:"case_step",result:"A6 actual password mutation response completed"}));
  for(const oldPage of [p,d]){await oldPage.goto(origin+"/account",{waitUntil:"domcontentloaded"});assert.notEqual(new URL(oldPage.url()).pathname,"/account","old same-user sessions must be revoked");}
  await otherDevice.close();await actor(q,b);
  await loginAndOpen(p,{...a,password:changedPassword});
  mark("R4-A6 actual UI password update revokes both old user roots; new password and other actor survive");
  a.password=changedPassword;for(const c of [current,otherActor])await c.close();
  }
  if(selected.has("A7")){
  assert.equal(typeof process.send,"function","native fixture memory IPC required");
  const old=await context(),other=await context(),recovery=await context();const op=await old.newPage(),bp=await other.newPage(),rp=await recovery.newPage();
  await loginAndOpen(op,a);await loginAndOpen(bp,b);
  await rp.goto(origin+"/forgot-password",{waitUntil:"networkidle"});await rp.waitForFunction(()=>{const f=document.querySelector("form");return !!f&&Object.keys(f).some(k=>k.startsWith("__reactProps$")&&typeof f[k]?.onSubmit==="function");});
  await rp.getByLabel(/^Email address/).fill(a.email);
  const sent=actionResponse(rp,a);await rp.getByRole("button",{name:"Send reset link",exact:true}).click();await (await sent).finished();await rp.getByText("If an account exists for this email, a reset link will arrive. Check inbox and spam.",{exact:true}).waitFor();
  const id="recovery-"+Date.now();const link=await new Promise((ok,bad)=>{const timer=setTimeout(()=>{process.off("message",handler);bad(Error("SYNTHETIC_RECOVERY_LINK_TIMEOUT"));},10000);function handler(message){if(message?.kind!=="synthetic_recovery_link"||message.id!==id)return;clearTimeout(timer);process.off("message",handler);if(message.error){bad(Error(message.error));}else{ok(message.link);}}process.on("message",handler);process.send({kind:"synthetic_recovery_link",id,email:a.email});});
  assert.equal(new URL(link).origin,gateway);await rp.goto(link,{waitUntil:"networkidle"});assert.equal(new URL(rp.url()).origin,origin,"native callback must retain browser origin");assert.equal(new URL(rp.url()).pathname,"/reset-password","native mail link must complete bound callback");
  const button=rp.getByRole("button",{name:"Set password",exact:true});try{await button.waitFor();}catch(error){console.log(JSON.stringify({status:"case_step",result:"A7 reset page diagnostic",body:await rp.locator("body").innerText()}));throw error;}await rp.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Set password');return b&&!b.disabled;});
  console.log(JSON.stringify({status:"case_step",result:"A7 native captured mail link completed real bound PKCE callback"}));
  const password=a.password+"Recovered42!";await rp.getByLabel(/^New password/).fill(password);await rp.getByLabel(/^Confirm password/).fill(password);
  const changed=rp.waitForResponse(r=>r.request().method()==="POST"&&!!r.request().headers()["next-action"]&&!!r.request().postData()?.includes(password));await button.click();await (await changed).finished();
  for(const p of [op,rp]){await p.goto(origin+"/account",{waitUntil:"domcontentloaded"});assert.notEqual(new URL(p.url()).pathname,"/account");}await old.close();await actor(bp,b);
  await loginAndOpen(rp,{...a,password});a.password=password;
  mark("R4-A7 real forgot-password UI and native mail PKCE callback update password, revoke old A and preserve B");for(const c of [other,recovery])await c.close();
  }
  return results;
 }finally{for(const transport of transports)await transport.dispose().catch(()=>{});await browser.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const fixture=JSON.parse(process.env.VELORA_WP01A_BROWSER_FIXTURE_JSON||"null");assert.ok(fixture,"memory-only synthetic local fixture required");const results=await runProtocol(fixture);console.log(JSON.stringify({status:"pass",results}));}
 catch(error){console.error(JSON.stringify({status:"fail",code:error?.code||"WP01A_BROWSER_FAILED",message:String(error?.message||error).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED]")}));process.exitCode=1;}
}
