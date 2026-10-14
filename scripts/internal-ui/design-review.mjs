// Opt-in LOCAL presentation review. Uses the real components with labelled,
// in-memory server-action fixtures; never reads .env or contacts a provider.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {localEnvironment,assertPortsFree} from '../integration/local-http-safety.mjs';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const root=resolve(import.meta.dirname,'../..'),out=join(root,'artifacts/design-review'),work=join(root,'tmp/design-review');
const origin='http://127.0.0.1:3120';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await assertPortsFree([3120]);await mkdir(out,{recursive:true});await mkdir(work,{recursive:true});
const navigation=`import React,{useSyncExternalStore} from 'react';
function move(href,replace=false){history[replace?'replaceState':'pushState']({},'',href);window.dispatchEvent(new Event('popstate'));}
const subscribe=f=>{window.addEventListener('popstate',f);return()=>window.removeEventListener('popstate',f);};
export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname);}
export function useSearchParams(){const s=useSyncExternalStore(subscribe,()=>location.search);return new URLSearchParams(s);}
export function useRouter(){return {push:h=>move(h),replace:h=>move(h,true),refresh:()=>window.dispatchEvent(new Event('popstate'))};}
export function redirect(h){move(h,true);}
export default function Link({href,children,...props}){return <a {...props} href={href} onClick={e=>{props.onClick?.(e);if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.shiftKey||String(href).startsWith('#'))return;e.preventDefault();move(href);}}>{children}</a>;}`;
const account=`import React from 'react';export function AccountMenu(){return <a href="/account">{document.documentElement.lang==='ar'?'حسابي':'My account'}</a>;}export const useOptionalAccountSession=()=>null;export const AccountSessionProvider=({children})=>children;export const accountInitials=()=> 'V';export const AppTopBar=({children})=><header>{children}</header>;`;
await writeFile(join(work,'navigation.jsx'),navigation);await writeFile(join(work,'account.jsx'),account);
const fixture=`
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const company={id:id(1),display_name:'استوديو مدار للخدمات',business_type:'other',status:'active',hours:'09:00–18:00',reply_language:'both',country:'OM',city:'Muscat',contact_phone:'+96800000000',contact_email:'test@example.invalid',created_by:id(2),created_at:'2026-10-01T08:00:00Z',updated_at:'2026-10-01T08:00:00Z'};
let controls={},saved={};
const waRows=()=>[3,4,5].map((n,i)=>({id:id(n),inboxSequence:String(n),unreadCount:i===0?2:0,intervention:{reasons:[]},customer:['سارة أحمد','فريق النور','خالد محمد'][i],phone:'+9680000000'+n,topic:'WhatsApp',summary:'طلب تفاصيل الخدمات',status:controls[id(n)]?.status??'open',owner:'assistant',assistantPaused:controls[id(n)]?.assistantPaused??false,automationAllowed:controls[id(n)]?.automationAllowed??true,automationGeneration:1,revision:controls[id(n)]?.revision??1,leadRevision:1,assignedTo:null,leadStage:'new',followUpStatus:'none',internalNote:'',messages:[{id:id(n+20),direction:'inbound',arrivalSequence:String(n),from:'customer',text:['ممكن تفاصيل الخدمات المتاحة؟','هل يمكن تحديد موعد الأسبوع القادم؟','شكرًا، بانتظار التفاصيل'][i],at:1791951000000+i*60000}]}));
const igRows=()=>[6,7].map((n,i)=>({id:id(n),inboxSequence:String(n),accountId:'17841400000000000',counterpartyId:['17800000101','17800000102'][i],assignedTo:null,revision:1,unreadCount:1,lastReceivedAt:'2026-10-14T08:40:00Z',latestMessage:{id:id(n+20),arrivalSequence:'1',direction:'inbound',content:{kind:'text',text:'أرغب بمعرفة طريقة الحجز'},receivedAt:'2026-10-14T08:40:00Z',readObservedAt:null}}));
const waPage=()=>({kind:'partial',companyId:id(1),conversationScope:'all_company',ordering:'newest_created',membershipFingerprint:'a'.repeat(32),conversations:waRows(),total:3,unreadTotal:2,interventionTotal:0,nextCursor:null,hasMore:false});
const igPage=()=>({companyId:id(1),actorId:id(2),conversationScope:'all_company',conversations:igRows(),total:2,unreadTotal:2,nextCursor:null,hasMore:false});
const meta=()=>({companyId:id(1),conversationScope:'all_company',timezone:'Asia/Muscat',timezoneAnnouncedUtc:false,canReply:new URLSearchParams(location.search).get('role')!=='staff',canAssign:true,canTakeOver:new URLSearchParams(location.search).get('role')!=='staff',canResume:true,canClose:true,assignees:[{userId:id(2),name:'صاحب النشاط'}],counts:{all:3,awaiting_staff:0,follow_up_today:0,overdue:0,trial_or_quote:0}});
const readiness={companyId:id(1),role:'owner',companyStatus:'active',reviewStatus:null,items:[],completedCount:0,totalCount:8,canRequestReview:false};
const contract=()=>{const single=new URLSearchParams(location.search).get('single');return {companyId:id(1),planVersionId:id(50),plan_entitlements:new URLSearchParams(location.search).has('unconfigured')?{status:'UNCONFIGURED'}:{status:'approved',channelCount:single?1:2},selected_channels:{planVersionId:id(50),revision:1,channels:single?[single]:['whatsapp','instagram']},subscription:{state:'active',expiresAt:'2026-11-01T00:00:00Z'}};};
const result=()=>({channelContract:contract(),channel_access:{whatsapp:true,instagram:true},ok:true,companyId:id(1),actorId:id(2),owner:true,companyInSetup:false,igAssignAllowed:true,waAllowed:new URLSearchParams(location.search).get('single')!=='instagram',igAllowed:new URLSearchParams(location.search).get('single')!=='whatsapp',wa:{ok:true,conversations:waRows(),page:waPage(),meta:meta()},ig:{ok:true,data:igPage()}});
window.reviewFixtures={company,readiness,result,waRows,meta};
window.reviewApi=async(module,name,args)=>{
 const input=args[0]??{};
 if(name==='readServiceInbox')return result();
 if(name==='getWorkspaceView')return {ok:true,data:{workspace:{needsContext:false,selectedCompanyId:id(1),isPlatformAdmin:false,choices:[{companyId:id(1),displayName:company.display_name,role:'owner'}]},identity:{companyId:id(1),role:'owner',fullName:'مالك نشاط تجريبي',email:'owner@example.invalid'},knowledgeAllowed:true}};
 if(name==='refreshWhatsappInboxInitialPage')return result().wa;
 if(name==='refreshWhatsappInboxPage')return {ok:true,data:waPage()};
 if(name==='refreshWhatsappThreadPage'){const c=waRows().find(c=>c.id===input.conversationId);return {ok:true,data:{...waPage(),conversationId:c.id,conversation:c,messages:[{id:id(30),arrivalSequence:'1',direction:'inbound',from:'customer',text:'مرحبًا، أريد معرفة الخدمات وطريقة تحديد موعد.',at:1791950000000},...c.messages],displayedInboundMessageId:null,unreadCount:0}};}
 if(name==='refreshWhatsappControlAuditPage')return {ok:true,data:{...waPage(),conversationId:input.conversationId,events:[]}};
 if(name==='refreshWhatsappConnectionStatus')return {ok:true,data:{companyId:id(1),status:'verified',authorizationStatus:'verified',receiveReady:true,sendReady:true,displayNumber:'+96800000000',inboundTestedAt:null,outboundTestedAt:null}};
 if(name==='controlWhatsappConversation'){const c=waRows().find(c=>c.id===input.conversationId);const action=input.action;const state={id:c.id,status:action==='close'?'resolved':'handed_over',automationAllowed:action==='resume',assistantPaused:action!=='resume',revision:c.revision+1,automationGeneration:2,owner:action==='resume'?'assistant':'staff'};controls[c.id]=state;return {ok:true,state};}
 if(name==='loadInstagramInboxPage')return {ok:true,data:igPage()};
 if(name==='loadInstagramThreadPage'){const c=igRows().find(c=>c.id===input.conversationId);return {ok:true,data:{...igPage(),conversationId:c.id,conversation:c,messages:[c.latestMessage],readReceipt:null,unreadCount:0}};}
 if(name==='assignInstagramConversation')return {ok:true,data:{companyId:id(1),actorId:id(2),conversationScope:'all_company',conversationId:input.conversationId,assignedTo:input.assignedTo,revision:input.expectedRevision+1}};
 if(name==='loadInstagramSendReadiness')return {ok:true,data:{blockers:['ROLLOUT_DISABLED'],ready:false}};
 if(name==='loadInstagramOwnerConnection')return {ok:true,generation:1,link:null,attemptKind:null,contractReady:false,connectEnabled:false};
 if(name==='getCustomerReadiness')return {ok:true,data:readiness};
 if(name==='getCompanyReviewRequest')return {ok:true,data:null};
 if(name==='listCompanyReviewEvents')return {ok:true,data:[]};
 if(name==='getWhatsappCompanyLink')return {ok:true,data:null};
 if(name==='readDashboardBilling')return {status:'empty',companyId:id(1)};
 if(name==='getChannelAIDraftAccess')return {ok:false,code:'FORBIDDEN'};
 if(name==='readChannelAIDraft')return {ok:false,code:'OWNER_REQUIRED'};
 if(name==='markWhatsappThreadSeen'||name==='markInstagramThreadRead')return {ok:true,data:{unreadCount:0}};
 return {ok:false,code:'UNAVAILABLE'};
};
`;
await writeFile(join(work,'fixtures.js'),fixture);
const entry=`import React,{useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';
import {DemoProvider} from '@/lib/demo-state';import {UnifiedInbox} from '@/components/app/unified-inbox';
import {SignupPage,LoginPage,VerifyEmailPage,CompleteProfilePage} from '@/components/app/auth-pages';
import {SetupWizard} from '@/components/app/setup-wizard';import {SettingsPage} from '@/components/app/settings';
import {DashboardPage} from '@/components/app/dashboard';import {AdminShell} from '@/components/admin/admin-shell';
import {LandingPage} from '@/components/landing/landing-page';
import {usePathname} from './navigation';
const initial=window.reviewFixtures.result();
function Review(){const path=usePathname(),locale=document.documentElement.lang;const f=window.reviewFixtures;
 const emptyOffers={status:'error',offers:[],errors:[]};
 return <>{path!=='/'&&<div style={{position:'fixed',insetInlineEnd:8,bottom:4,zIndex:2000,fontSize:11,background:'#172d43',color:'white',padding:'4px 8px',pointerEvents:'none'}}>اختبار محلي · بيانات محاكاة · Local fixtures</div>}
 {path==='/app/conversations'?<UnifiedInbox initial={initial}/>:path==='/signup'?<SignupPage/>:path==='/login'?<LoginPage/>:path==='/verify-email'?<VerifyEmailPage/>:path==='/complete-profile'?<CompleteProfilePage/>:path==='/setup'?<SetupWizard userId={f.company.created_by} initialCompany={{...f.company,status:'setup'}}/>:path==='/app/settings'?<SettingsPage initialAccess={{email:'owner@example.invalid',companyId:f.company.id,companyName:f.company.display_name,role:'owner',needsCompanyContext:false,isPlatformAdmin:false,choices:[]}} initialCompany={f.company} initialSubscription={{state:'empty',currentTier:null,cycle:null,paidThrough:null}} initialOffersView={emptyOffers}/>:path==='/app'?<DashboardPage initialLeads={initial.wa} initialReadiness={f.readiness}/>:path==='/admin'?<AdminShell><div className="app-panel rounded-xl p-6"><h1>إدارة الأنشطة</h1><p>الأدوات حسب الدور · اختبار المظهر دون صلاحيات حقيقية</p></div></AdminShell>:<LandingPage initialLocale={locale} authHref="/signup" offersView={emptyOffers} subscriptionDestination={{href:'/signup',label:'Start'}}/>}
 </>;}
createRoot(document.getElementById('root')).render(<DemoProvider initialLocale={document.documentElement.lang}><Review/></DemoProvider>);`;
await writeFile(join(work,'entry.jsx'),entry);
const plugin={name:'local-action-fixtures',setup(b){
 b.onResolve({filter:/^next\/(navigation|link|image|headers)$/},args=>({path:args.path,namespace:'next-fixture'}));
 b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({contents:args.path==='next/image'?`import React from 'react';export default function Image({fill,priority,unoptimized,quality,sizes,...p}){return <img {...p} style={{...p.style,...(fill?{position:'absolute',inset:0,height:'100%',width:'100%'}:{})}}/>}`:navigation,loader:'tsx',resolveDir:root}));
 b.onLoad({filter:/account-chrome\.tsx$/},()=>({contents:account,loader:'tsx',resolveDir:root}));
 b.onLoad({filter:/src[\\/]lib[\\/].*\.[tj]sx?$/},async args=>{
  const source=await readFile(args.path,'utf8');if(!/^\s*["']use server["']/.test(source)&&!source.includes("import 'server-only'")&&!source.includes('import "server-only"'))return;
  const names=[...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>m[1]);
  return {contents:names.map(n=>`export async function ${n}(...args){return window.reviewApi(${JSON.stringify(args.path)},${JSON.stringify(n)},args);}`).join('\n'),loader:'js'};
 });
}};
await build({absWorkingDir:root,entryPoints:[join(work,'entry.jsx')],outfile:join(work,'app.js'),bundle:true,format:'iife',jsx:'automatic',platform:'browser',tsconfig:join(root,'tsconfig.json'),plugins:[plugin],define:{'process.env.NODE_ENV':'"development"'},loader:{'.png':'file','.jpg':'file','.woff2':'file'},logLevel:'warning'});
const current=(await postcss([tailwind({base:root})]).process(await readFile(join(root,'src/app/globals.css'),'utf8'),{from:join(root,'src/app/globals.css')})).css;
const original=execFileSync('git',['show','HEAD:src/app/globals.css'],{cwd:root,encoding:'utf8'});
const baseline=(await postcss([tailwind({base:root})]).process(original,{from:join(root,'src/app/globals.css')})).css;
await writeFile(join(work,'current.css'),current);await writeFile(join(work,'baseline.css'),baseline);
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,origin);if(url.pathname.endsWith('.js')||url.pathname.endsWith('.css')||url.pathname.startsWith('/fonts/')||url.pathname.startsWith('/assets/')){const target=url.pathname.startsWith('/fonts/')||url.pathname.startsWith('/assets/')?join(root,'public',url.pathname):join(work,url.pathname);const base=target.startsWith(work)?work:join(root,'public');if(!target.startsWith(base+'\\')&&!target.startsWith(base+'/'))throw Error('OUTSIDE_REVIEW_ROOT');const bytes=await readFile(target);const mime={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}[extname(target)]??'application/octet-stream';res.writeHead(200,{'Content-Type':mime});res.end(bytes);return;}const ar=url.searchParams.get('lang')!=='en';res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="'+(ar?'ar':'en')+'" dir="'+(ar?'rtl':'ltr')+'"><meta name="viewport" content="width=device-width,initial-scale=1"><link id="global-style" rel="stylesheet" href="/current.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/fixtures.js"></script><script src="/app.js"></script></body></html>');}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(r=>server.listen(3120,'127.0.0.1',r));
let browser;const records=[];
try{
 const {chromium}=createRequire(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json'))('playwright');
 browser=await chromium.launch({headless:true,channel:'chrome',env:localEnvironment()});const context=await browser.newContext({reducedMotion:'reduce',serviceWorkers:'block'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function capture(path,label,width,locale='ar') {await page.setViewportSize({width,height:900});await page.goto(origin+path+(path.includes('?')?'&':'?')+'lang='+locale,{waitUntil:'networkidle'});await page.waitForTimeout(350);await page.evaluate(()=>document.fonts.ready);if(label==='inbox-instagram'){const box=await page.getByRole('button',{name:locale==='ar'?'حفظ الرد':'Save reply',exact:true}).boundingBox();if(!box||box.y+box.height>900||box.y<0)throw Error('INSTAGRAM_COMPOSER_OUTSIDE_VIEWPORT '+width);}
 await page.screenshot({path:join(out,`${label}-${locale}-${width}.png`),fullPage:true});const metric=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelector('h1')?.textContent,dir:document.documentElement.dir}));if(metric.scrollWidth>width)throw Error('REVIEW_PAGE_OVERFLOW '+label+' '+width);records.push({label,locale,...metric});console.log('CAPTURE',label,locale,width);}
 if(process.argv.includes('--composer-only')){for(const width of [390,820,1600])await capture('/app/conversations?source=instagram&thread='+id(6),'inbox-instagram',width,'ar');console.log('COMPOSER_VIEWPORT_CHECK_PASSED');process.exitCode=0;}else {
 if(!process.argv.includes('--interactions-only')&&!process.argv.includes('--composer-only'))for(const locale of ['ar','en'])for(const width of [390,820,1600]){await capture('/app/conversations','inbox-list',width,locale);await capture('/app/conversations?source=whatsapp&c='+id(3),'inbox-whatsapp',width,locale);await capture('/app/conversations?source=instagram&thread='+id(6),'inbox-instagram',width,locale);}
 if(!process.argv.includes('--interactions-only'))for(const path of ['/signup','/login','/verify-email','/complete-profile','/setup','/app','/app/settings','/app/settings?tab=plan','/admin'])for(const width of [390,820,1600])await capture(path,path.replaceAll('/','-').replaceAll('?','-').replaceAll('=','-'),width);
 // Real rendering, local action doubles. Keyboard takeover changes returned server state.
 await capture('/app/conversations?source=whatsapp&c='+id(3),'before-takeover',390,'en');
 const composer=page.getByRole('textbox',{name:'Write your reply…',exact:true});if(!await composer.isDisabled())throw Error('COMPOSER_ENABLED_BEFORE_TAKEOVER');
 const takeover=page.locator('button[title="Take over from Velora"]');await takeover.first().focus();await page.keyboard.press('Enter');await page.waitForTimeout(300);if(await composer.isDisabled())throw Error('TAKEOVER_DID_NOT_ENABLE_COMPOSER');
 await composer.fill('Draft retained between channels');await page.getByRole('button',{name:'Back to conversations',exact:true}).click();await page.getByRole('button').filter({hasText:'Instagram'}).last().click();await page.getByRole('button',{name:'Back to conversations',exact:true}).click();await page.getByRole('button').filter({hasText:'سارة أحمد'}).click();if(await page.getByRole('textbox',{name:'Write your reply…',exact:true}).inputValue()!=='Draft retained between channels')throw Error('WA_DRAFT_LOST');
 await page.getByRole('button',{name:'Refresh conversation',exact:true}).click();await page.waitForTimeout(200);if(await page.getByRole('textbox',{name:'Write your reply…',exact:true}).inputValue()!=='Draft retained between channels')throw Error('WA_DRAFT_LOST_ON_REFRESH');

 // A failed aggregate read hides private content but preserves recovery state.
 await page.evaluate(()=>{window.reviewOriginalApi=window.reviewApi;window.reviewApi=async(m,n,a)=>n==='readServiceInbox'?{ok:false,code:'UNAVAILABLE'}:window.reviewOriginalApi(m,n,a);});
 await page.getByRole('button',{name:'Refresh conversation',exact:true}).click();await page.waitForTimeout(100);
 if(await page.getByRole('textbox',{name:'Write your reply…',exact:true}).isVisible())throw Error('UNVERIFIED_SNAPSHOT_VISIBLE');
 await page.evaluate(()=>{window.reviewApi=window.reviewOriginalApi;});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForTimeout(200);
 if(await page.getByRole('textbox',{name:'Write your reply…',exact:true}).inputValue()!=='Draft retained between channels')throw Error('DRAFT_LOST_AFTER_OUTAGE');
 await page.evaluate(()=>{const base=window.reviewApi;window.reviewApi=async(m,n,a)=>{const r=await base(m,n,a);if(n==='refreshWhatsappThreadPage'&&r.ok)r.data.messages.push({id:'00000000-0000-4000-8000-000000000099',arrivalSequence:'99',direction:'inbound',from:'customer',text:'New inbound fixture after refresh',at:1791958000000});return r;};});
 await page.getByRole('button',{name:'Refresh conversation',exact:true}).click();await page.waitForTimeout(200);if(!await page.getByText('New inbound fixture after refresh',{exact:true}).isVisible())throw Error('THREAD_NOT_REFRESHED');
 await page.setViewportSize({width:1280,height:900});const details=page.getByRole('button',{name:'Customer Details',exact:true});await details.focus();await page.keyboard.press('Enter');
 if(!await page.getByRole('dialog').isVisible())throw Error('DETAILS_BREAKPOINT_GAP');await page.keyboard.press('Escape');if(!await details.evaluate(e=>e===document.activeElement))throw Error('DETAILS_FOCUS_NOT_RESTORED');
 console.log('PASS takeover, drafts, outages, transcript refresh, details keyboard');
 await capture('/app/conversations?single=instagram','single-channel',390,'en');if(await page.getByRole('button',{name:'All',exact:true}).count())throw Error('SINGLE_CHANNEL_FILTER_SHOWN');
 await capture('/app/conversations?source=whatsapp&c='+id(3)+'&role=staff','staff-read-only',390,'en');if(await page.getByRole('textbox',{name:'Write your reply…',exact:true}).count()&&!await page.getByRole('textbox',{name:'Write your reply…',exact:true}).isDisabled())throw Error('STAFF_COMPOSER_ENABLED');
 await capture('/app/conversations','text-zoom',390,'ar');await page.evaluate(()=>document.documentElement.style.fontSize='200%');if(await page.evaluate(()=>document.documentElement.scrollWidth)>390)throw Error('TEXT_ZOOM_OVERFLOW');await page.screenshot({path:join(out,'text-zoom-ar-390.png'),fullPage:true});
 await capture('/','homepage',1600,'ar');const state=()=>page.evaluate(()=>{const root=document.documentElement,hero=document.querySelector('.hero-shell');return {rootColor:getComputedStyle(root).color,rootBackground:getComputedStyle(root).backgroundColor,heroColor:hero&&getComputedStyle(hero).color,heroBackground:hero&&getComputedStyle(hero).backgroundColor};});
 const after=await state();await page.evaluate(()=>document.getElementById('global-style').href='/baseline.css');await page.waitForTimeout(500);const before=await state();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('LANDING_THEME_LEAK');await page.screenshot({path:join(out,'homepage-baseline-ar-1600.png'),fullPage:true});
 if(errors.length)throw Error('REVIEW_RUNTIME_ERRORS '+errors.slice(0,3).join(' | '));
 await capture('/app/conversations?unconfigured=true','inbox-unconfigured',390,'ar');if(!await page.getByText(/UNCONFIGURED/).isVisible()||!await page.getByRole('button',{name:/17800000101/}).isVisible())throw Error('UNCONFIGURED_WITHDREW_NATIVE_ACCESS');
 await capture('/app/conversations?source=instagram&thread='+id(6),'instagram-details-start',390,'en');const igDetails=page.getByRole('button',{name:'Details',exact:true});await igDetails.focus();await page.keyboard.press('Enter');if(!await page.getByRole('dialog').isVisible())throw Error('INSTAGRAM_DETAILS_NOT_REACHABLE');await page.screenshot({path:join(out,'instagram-details-en-390.png')});await page.keyboard.press('Escape');if(!await igDetails.evaluate(e=>e===document.activeElement))throw Error('INSTAGRAM_DETAILS_FOCUS_NOT_RESTORED');
 const result={fixtureOnly:true,productionVerified:false,referenceHtmlAvailable:process.argv.includes('--reference'),referenceSha256:process.argv.includes('--reference')?createHash('sha256').update(await readFile(process.argv[process.argv.indexOf('--reference')+1])).digest('hex'):null,passed:[records.length+' responsive captures','RTL/LTR','no page-wide overflow','200% text','native-state fixture takeover','drafts across channel navigation and refresh','staff read-only','single-channel filter','landing CSS isolation'],records,publicComputedStyles:{before,after},workingTreeState:'local-uncommitted',baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),cssSha256:createHash('sha256').update(current).digest('hex')};await writeFile(join(out,'verification.json'),JSON.stringify(result,null,2));console.log('DESIGN_REVIEW_COMPLETE',records.length,'captures');}

}finally{await browser?.close();await new Promise(r=>server.close(r));}
