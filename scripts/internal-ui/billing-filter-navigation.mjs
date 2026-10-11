// Isolated browser regression: real ledger + Next router, synthetic read-only data.
// Requires Playwright (PLAYWRIGHT_MODULE may point to an existing installation).
// CHROMIUM_EXECUTABLE may select an existing browser. No app credentials are used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp, mkdir, copyFile, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createRequire} from 'node:module';

const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=await mkdtemp(join(tmpdir(),'velora-billing-navigation-'));
async function put(path,content){const file=join(fixture,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,content);}
await symlink(join(root,'node_modules'),join(fixture,'node_modules'),'dir');
await put('package.json',JSON.stringify({private:true}));
await put('tsconfig.json',JSON.stringify({compilerOptions:{jsx:'react-jsx',baseUrl:'.',paths:{'@/*':['./src/*']}}}));
await put('next.config.mjs','export default {devIndicators:false};');
await put('src/app/layout.tsx','export default function Layout({children}) {return <html lang="ar"><body>{children}</body></html>;}');
await mkdir(join(fixture,'src/lib/auth'),{recursive:true});
await mkdir(join(fixture,'src/components/app'),{recursive:true});
await copyFile(join(root,'src/lib/auth/safe-next.ts'),join(fixture,'src/lib/auth/safe-next.ts'));
await copyFile(join(root,'src/components/app/admin-company-navigation.ts'),join(fixture,'src/components/app/admin-company-navigation.ts'));
await put('src/lib/demo-state.ts','export function useDemo(){return {locale:"ar"};}');
await put('src/components/app/subscription-offers-view.ts','export function formatOmrBaisa(){throw new Error("Empty fixture must not format amounts");}');
await mkdir(join(fixture,'src/components/admin'),{recursive:true});
for(const file of ['billing-ledger.tsx','billing-ledger.module.css'])await copyFile(join(root,'src/components/admin',file),join(fixture,'src/components/admin',file));
// Copy the actual page too; only its read boundary is replaced with synthetic data.
await mkdir(join(fixture,'src/app/admin/billing'),{recursive:true});
await copyFile(join(root,'src/app/admin/billing/page.tsx'),join(fixture,'src/app/admin/billing/page.tsx'));
await put('src/lib/billing/admin/actions.ts',`export async function readAdminBillingOrders(query){
 return {status:'empty',rows:[],total:0,hasMore:false,nextCursor:null,snapshot:'synthetic'};
}`);
// Extra links exercise client transitions without modifying the production view.
await put('src/app/admin/billing/layout.tsx',`import Link from 'next/link';
export default function Layout({children}) {return <><nav>
 <Link prefetch={false} href="/admin/billing?environment=live">Synthetic Live search</Link>
 </nav>{children}</>;}`);

const portProbe=createServer();portProbe.listen(0,'127.0.0.1');await once(portProbe,'listening');
const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
const origin=`http://127.0.0.1:${port}`;
// Allowlist: do not pass inherited provider credentials or application env files.
const env={PATH:process.env.PATH,HOME:fixture,TMPDIR:tmpdir(),NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'};
const server=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:fixture,env,stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',d=>{log+=d;});server.stderr.on('data',d=>{log+=d;});
let browser;
const failures=[];
try{
 const deadline=Date.now()+60000;
 while(!log.includes('Ready in')){if(server.exitCode!==null||Date.now()>deadline)throw Error('Fixture server did not start:\n'+log);await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,env});
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const input=name=>page.locator(`[name="${name}"]`);
 const blank={companyId:'',environment:'all',from:'',until:''};
 const companyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const filtered={companyId,environment:'test',from:'2026-10-01',until:'2026-10-11'};
 async function values(expected){
  await page.waitForFunction(expected=>Object.entries(expected).every(([name,value])=>document.querySelector(`[name="${name}"]`)?.value===value),expected,{timeout:4000});
 }
 async function apply(fields){
  for(const [name,value] of Object.entries(fields)){
   if(name==='environment')await input(name).selectOption(value);else await input(name).fill(value);
  }
  await Promise.all([page.waitForURL(url=>url.searchParams.get('environment')===fields.environment),page.locator('button[type="submit"]').click()]);
  await values(fields);
  for(const [name,value] of Object.entries(fields))assert.equal(new URL(page.url()).searchParams.get(name),value);
 }
 async function reset(){await page.getByRole('link',{name:'بحث جديد',exact:true}).click();await page.waitForURL(origin+'/admin/billing');await values(blank);}
 async function test(name,run){try{await run();console.log('PASS | '+name);}catch(error){failures.push(name);console.error('FAIL | '+name+' | '+error.message);}}
 await test('blank company: Apply Test then Arabic New Search clears environment',async()=>{
  await page.goto(origin+'/admin/billing');await apply({...blank,environment:'test'});
  await page.evaluate(()=>{window.billingDocumentMarker=true;});await reset();
  assert.equal(await page.evaluate(()=>window.billingDocumentMarker),true,'Reset must be client navigation, not reload');
 });
 await test('New Search clears company, environment and both dates; Apply remains reusable',async()=>{
  await page.goto(origin+'/admin/billing');await apply(filtered);await reset();await apply({...blank,environment:'live'});
 });
 await test('Back and Forward restore committed filters instead of dirty draft values',async()=>{
  await page.goto(origin+'/admin/billing?'+new URLSearchParams(filtered));await values(filtered);
  await input('companyId').fill('unsubmitted-draft');await input('environment').selectOption('unknown');
  await reset();await page.goBack();await values(filtered);
  await page.goForward();await values(blank);
 });
 await test('a different client-side query replaces dirty values',async()=>{
  await page.goto(origin+'/admin/billing?'+new URLSearchParams(filtered));await values(filtered);
  await input('companyId').fill('unsubmitted-draft');
  await page.getByRole('link',{name:'Synthetic Live search'}).click();
  await page.waitForURL(origin+'/admin/billing?environment=live');await values({...blank,environment:'live'});
 });
 await test('late superseded navigation cannot restore old filters after New Search',async()=>{
  await page.goto(origin+'/admin/billing?'+new URLSearchParams(filtered));await values(filtered);
  let release,intercepted;
  const blocked=new Promise(r=>{release=r;}),seen=new Promise(r=>{intercepted=r;});
  let released=false;
  await page.route('**/admin/billing?environment=live*',async route=>{
   const response=await route.fetch();intercepted();await blocked;
   try{await route.fulfill({response});}catch{/* A superseded request may already be cancelled. */}finally{released=true;}
  });
  try{
   await page.getByRole('link',{name:'Synthetic Live search'}).click();
   await Promise.race([seen,new Promise((_,reject)=>setTimeout(()=>reject(Error('Slow navigation was not intercepted')),10000))]);
   await reset();release();
   const limit=Date.now()+5000;while(!released&&Date.now()<limit)await new Promise(r=>setTimeout(r,50));
   assert.ok(released,'Late response was released');
   await page.waitForTimeout(300);await values(blank);assert.equal(page.url(),origin+'/admin/billing');
  }finally{release();await page.unroute('**/admin/billing?environment=live*');}
 });
 assert.deepEqual(errors,[],'No browser runtime errors');
 assert.deepEqual(failures,[],'Browser regressions');
 console.log('5 browser regressions passed (isolated Next fixture; not production acceptance).');
}finally{
 await browser?.close();
 if(server.exitCode===null&&server.signalCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}
 console.log('Fixture retained at '+fixture);
}
