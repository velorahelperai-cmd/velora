// Actual teams/admin components in an isolated Next browser fixture. Synthetic
// identity and data boundaries; no credentials, SQL, network services or writes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,copyFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=await mkdtemp(join(tmpdir(),'velora-teams-presentation-'));
async function put(path,text){await mkdir(dirname(join(fixture,path)),{recursive:true});await writeFile(join(fixture,path),text);}
async function copy(path){await mkdir(dirname(join(fixture,path)),{recursive:true});const source=process.env.TEAMS_PRESENTATION_SOURCE_ROOT&&['src/components/admin/admin-shell.tsx','src/components/teams/teams-page.tsx','src/components/teams/teams-route.tsx','src/components/teams/team-owner-editor.tsx'].includes(path)?process.env.TEAMS_PRESENTATION_SOURCE_ROOT:root;await copyFile(join(source,path),join(fixture,path));}
await symlink(join(root,'node_modules'),join(fixture,'node_modules'),'dir');
await put('package.json','{"private":true}');
await put('tsconfig.json',JSON.stringify({compilerOptions:{jsx:'react-jsx',baseUrl:'.',paths:{'@/*':['./src/*']}}}));
await put('next.config.mjs','export default {devIndicators:false};');
for(const path of ['postcss.config.mjs','src/app/globals.css','src/components/admin/admin-shell.tsx','src/components/admin/admin-icons.tsx','src/components/admin/admin-theme.module.css','src/components/app/ui.tsx','src/components/app/account-chrome.tsx','src/lib/app-copy.ts','src/lib/company-draft.ts','src/lib/auth/session-presence.ts','src/components/teams/teams-page.tsx','src/components/teams/team-owner-editor.tsx','src/components/teams/copy.ts','src/lib/platform-teams/contracts.ts','src/lib/platform-teams/ui-state.ts','src/lib/platform-teams/ui-routing.ts'])await copy(path);
for(const weight of ['Regular','Medium','Bold'])await copy(`public/fonts/velora/Tajawal-admin-${weight}-v1.woff2`);
await put('src/app/layout.tsx',`import './globals.css';export default function Layout({children}){return <html><body>{children}</body></html>;}`);
await put('src/lib/auth/auth-journey.ts','export function clearPendingSignup(){}');
await put('src/lib/supabase/client.ts','export function tryCreateClient(){return null;} export function createClient(){throw Error("No Auth client in offline presentation fixture");}');
await put('src/lib/demo-state.ts',`'use client';import {useSearchParams} from 'next/navigation';export const emptyBusiness={};export function useDemo(){return {locale:useSearchParams().get('locale')==='ar'?'ar':'en',setLocale(){},update(){}};}`);
await put('src/lib/tenancy/actions.ts',`export const actor='00000000-0000-4000-8000-000000000001';export const profile={userId:actor,fullName:'Synthetic owner with a long display name',email:'owner@synthetic.invalid',emailConfirmed:true,platformIdentity:{role:'owner',status:'active',unavailable:false},isPlatformAdmin:true,adminHref:'/admin',workspaceHref:null};export async function getAccountProfile(){if(new URLSearchParams(window.location.search).has('loading'))return new Promise(()=>{});return {ok:true,data:profile};}export async function adminSearchAccounts(){throw Error('Account lookup outside presentation fixture');}export async function signOut(){throw Error('No Auth writes');}`);
await put('src/lib/access/actions.ts',`export async function accessGetUserSnapshot(){throw Error('Role lookup outside presentation fixture');}`);
await put('src/lib/platform-teams/actions.ts',`export const teamId='00000000-0000-4000-8000-000000000002',manager='00000000-0000-4000-8000-000000000003';export const team={id:teamId,name:'Synthetic team',status:'active',revision:8,managerUserId:manager};export const member={teamId,userId:manager,fullName:'Synthetic manager',role:'manager',status:'active',specialty:'Support',revision:3};const employee={...member,userId:'00000000-0000-4000-8000-000000000004',role:'employee',fullName:'Synthetic employee'};const destination={...team,id:'00000000-0000-4000-8000-000000000005',name:'Synthetic destination',revision:5};export async function readPlatformTeamDirectory(request){return {ok:true,data:request.teamId?{kind:'members',team:request.teamId===teamId?team:destination,rows:request.teamId===teamId?[member,employee]:[{...member,teamId:destination.id}],total:request.teamId===teamId?2:1,nextCursor:null}:{kind:'teams',team:null,rows:[{...destination,memberCount:1}],total:1,nextCursor:null}};}export async function previewPlatformTeamTransfer(){window.presentationPreviewPending=true;return new Promise(resolve=>{window.releasePresentationPreview=()=>resolve({ok:true,data:{sourceTeam:team,destinationTeam:destination,sourceMember:employee,destinationMember:null,managerBefore:manager,managerAfter:manager}});});}export async function mutatePlatformTeam(){window.presentationWrites++;throw Error('Presentation regression must never confirm a mutation');}`);
await put('src/app/admin/teams/page.tsx',`'use client';import {Suspense} from 'react';import {useSearchParams} from 'next/navigation';import {AdminShell} from '@/components/admin/admin-shell';import {AccountSessionProvider} from '@/components/app/account-chrome';import {TeamsPage,TeamsFailure} from '@/components/teams/teams-page';import {actor,profile} from '@/lib/tenancy/actions';function View(){const q=useSearchParams();return <AccountSessionProvider initial={q.has('loading')?undefined:profile}><AdminShell>{q.has('failure')?<TeamsFailure code="UNAVAILABLE" embedded/>:<TeamsPage actorId={actor} editor/>}</AdminShell></AccountSessionProvider>;}export default function Page(){return <Suspense><View/></Suspense>;}`);
await put('src/app/account/teams/page.tsx',`'use client';import {Suspense} from 'react';import {AccountSessionProvider} from '@/components/app/account-chrome';import {TeamsPage} from '@/components/teams/teams-page';import {actor,profile} from '@/lib/tenancy/actions';export default function Page(){return <Suspense><AccountSessionProvider initial={profile}><TeamsPage actorId={actor} editor={false}/></AccountSessionProvider></Suspense>;}`);
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`;
const env={PATH:process.env.PATH,HOME:fixture,TMPDIR:tmpdir(),NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'};
const server=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:fixture,env,stdio:['ignore','pipe','pipe']});
let log='',browser,passes=0;server.stdout.on('data',d=>{log+=d;});server.stderr.on('data',d=>{log+=d;});const failures=[],errors=[],evidence=[];
try{
 const deadline=Date.now()+60000;while(!log.includes('Ready in')){if(server.exitCode!==null||Date.now()>deadline)throw Error(log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,env});
 const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 async function start(locale='en',width=390,path='/admin/teams'){
  await page.setViewportSize({width,height:844});await page.goto(origin+path+'?locale='+locale+'&team=00000000-0000-4000-8000-000000000002',{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('input[maxlength="120"]'));await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{window.presentationWrites=0;});
 }
 async function test(name,fn){try{await fn();passes++;console.log('PASS | '+name);}catch(e){failures.push(name);console.error('FAIL | '+name+' | '+e.message);await writeFile(join(fixture,'failure-'+failures.length+'.html'),await page.content());}}
 async function fits(){
  const bounds=await page.evaluate(()=>{const h=document.querySelector('header');const elements=[...document.querySelectorAll('header button,header nav,header nav a,header nav span,[data-internal-ui] p,[data-internal-ui] h1,[data-internal-ui] h2,[data-internal-ui] button,[data-internal-ui] input,[data-internal-ui] textarea,[data-internal-ui] select,[data-internal-ui] dd')];const outside=elements.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left<-.5||r.right>innerWidth+.5);}).map(el=>({tag:el.tagName,text:el.textContent?.slice(0,60),left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}));return {width:innerWidth,scroll:document.documentElement.scrollWidth,headerWidth:h.getBoundingClientRect().width,headerScroll:h.scrollWidth,outside};});
  evidence.push(bounds);assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));assert.ok(bounds.headerScroll<=bounds.headerWidth+1,JSON.stringify(bounds));assert.deepEqual(bounds.outside,[],'Visible product controls and text stay inside viewport');assert.ok(await page.locator('header').evaluate(el=>el.getBoundingClientRect().height<=160),'Mobile breadcrumb must remain readable, not a vertical stack of letters');
 }
 async function review(locale='en'){
  const name=locale==='ar'?'اسم الفريق':'Team name',reason=locale==='ar'?'سبب هذا التغيير':'Reason for this change';
  await page.getByLabel(name).fill('Retained team draft');
  // Copy wording can differ across locales; actual form textarea is unambiguous.
  const form=page.getByLabel(name).locator('xpath=ancestor::form');
  await form.locator('textarea').fill('Retained review reason');
  const trigger=form.locator('button[type="submit"]');await trigger.focus();await trigger.click();
  await page.waitForFunction(()=>!!document.querySelector('fieldset[disabled]'));
  return {form,trigger,reason};
 }
 for(const locale of ['en','ar']){
  await test(locale+' owner route has exactly one main landmark',async()=>{await start(locale,1280);assert.equal(await page.getByRole('main').count(),1);});
  await test(locale+' mobile header and review fit 390px without concealed content',async()=>{
   await start(locale);await review(locale);
   await fits();const image=await page.screenshot({path:join(fixture,'review-'+locale+'-390.png'),fullPage:true});assert.equal(image.readUInt32BE(16),390,'Full-page screenshot width matches viewport');
  });
  await test(locale+' closed mobile sidebar excludes programmatic and keyboard focus',async()=>{
   await start(locale);const sidebar=page.locator('aside').first();
   assert.equal(await sidebar.evaluate(el=>{el.querySelector('a').focus();return el.contains(document.activeElement);}),false);
   await page.getByRole('button',{name:'Open navigation'}).focus();
   for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert.equal(await sidebar.evaluate(el=>el.contains(document.activeElement)),false);}
   await page.getByRole('button',{name:'Open navigation'}).click();const close=page.getByRole('button',{name:'Close menu'});assert.equal(await close.evaluate(el=>el===document.activeElement),true,'Drawer close receives initial focus');await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Open navigation'}).evaluate(el=>el===document.activeElement),true,'Escape restores menu trigger');
   await page.getByRole('button',{name:'Open navigation'}).click();await close.click();assert.equal(await page.getByRole('button',{name:'Open navigation'}).evaluate(el=>el===document.activeElement),true);
   assert.equal(await sidebar.evaluate(el=>{el.querySelector('a').focus();return el.contains(document.activeElement);}),false);
  });
  await test(locale+' review receives focus; Escape cancels and restores unchanged draft without a write',async()=>{
   await start(locale);const {form,trigger}=await review(locale);
   assert.equal(await page.evaluate(()=>{const active=document.activeElement;return !!active&&active.closest('[aria-labelledby]')?.textContent.includes('Retained review reason');}),true,'Focus must enter the labelled review');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('fieldset[disabled]'));
   assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Focus returns to Review');
   assert.equal(await form.locator('textarea').inputValue(),'Retained review reason');assert.equal(await page.evaluate(()=>window.presentationWrites),0);
  });
  await test(locale+' Cancel remains reachable by keyboard and returns focus to Review',async()=>{
   await start(locale);const {form,trigger}=await review(locale);
   const cancel=page.getByRole('button',{name:locale==='ar'?'إلغاء':'Cancel',exact:true}).first();
   for(let i=0;i<5&&!(await cancel.evaluate(el=>el===document.activeElement));i++)await page.keyboard.press('Tab');
   assert.equal(await cancel.evaluate(el=>el===document.activeElement),true,'Cancel reached with Tab');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>!document.querySelector('fieldset[disabled]'));assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);assert.equal(await form.locator('textarea').inputValue(),'Retained review reason');assert.equal(await page.evaluate(()=>window.presentationWrites),0);
  });
  await test(locale+' delayed transfer preview focuses review and Escape restores its trigger',async()=>{
   await start(locale);await page.getByRole('button',{name:locale==='ar'?'نقل العضوية':'Transfer membership',exact:true}).last().click();
   const transfer=page.locator('form').filter({has:page.getByLabel(locale==='ar'?'ابحث عن الفرق واختر فريقًا مستقبِلًا نشطًا':'Search teams and choose an active destination')});
   await transfer.getByRole('button',{name:locale==='ar'?'بحث':'Search',exact:true}).click();await transfer.getByRole('button',{name:locale==='ar'?'اختيار':'Select',exact:true}).click();
   await transfer.locator('textarea').fill('Retained transfer reason');const trigger=transfer.locator('button[type="submit"]');await trigger.focus();await trigger.click();await page.waitForFunction(()=>window.presentationPreviewPending===true);await page.evaluate(()=>window.releasePresentationPreview());
   await page.waitForFunction(()=>document.activeElement?.closest('[aria-labelledby]')?.textContent.includes('Retained transfer reason'));
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('fieldset[disabled]'));assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);assert.equal(await transfer.locator('textarea').inputValue(),'Retained transfer reason');assert.equal(await page.evaluate(()=>window.presentationWrites),0);
  });
  await test(locale+' long unbroken review text stays readable at 320px',async()=>{
   await start(locale,320);const name=page.getByLabel(locale==='ar'?'اسم الفريق':'Team name'),form=name.locator('xpath=ancestor::form');await name.fill('N'.repeat(120));await form.locator('textarea').fill('R'.repeat(240));await form.locator('button[type="submit"]').click();await page.waitForFunction(()=>!!document.querySelector('fieldset[disabled]'));await fits();
  });
 }
 await test('owner initial loading retains a single main landmark',async()=>{await page.goto(origin+'/admin/teams?loading=1');await page.getByText('Loading…',{exact:true}).waitFor();assert.equal(await page.getByRole('main').count(),1);});
 await test('owner failure presentation has one main landmark',async()=>{await page.goto(origin+'/admin/teams?failure=1');assert.equal(await page.getByRole('main').count(),1);});
 await test('account roster keeps its standalone main landmark',async()=>{await start('en',390,'/account/teams');assert.equal(await page.getByRole('main').count(),1);});
 await test('desktop sidebar remains visible and keyboard accessible',async()=>{await start('en',1280);const link=page.locator('aside a').first();await link.focus();assert.equal(await link.evaluate(el=>el===document.activeElement&&el.getBoundingClientRect().right>0),true);});
 await writeFile(join(fixture,'presentation-evidence.json'),JSON.stringify({passes,failures,evidence,errors},null,2));assert.deepEqual(errors,[],'No runtime errors');assert.deepEqual(failures,[],'Browser regressions');console.log(passes+' teams presentation regressions passed (offline fixture, not genuine production acceptance).');
}finally{await browser?.close();if(server.exitCode===null&&server.signalCode===null){const stop=once(server,'exit');server.kill('SIGTERM');await stop;}console.log('Fixture retained at '+fixture);}
