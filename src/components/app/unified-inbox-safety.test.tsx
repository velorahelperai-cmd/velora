// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import React,{act,useState,type ComponentProps,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {appCopy} from '@/lib/app-copy';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({
 routerPush:vi.fn(),routerRefresh:vi.fn(),readServiceInbox:vi.fn(),refreshWhatsappInboxPage:vi.fn(),loadInstagramInboxPage:vi.fn(),
 searchParams:new URLSearchParams(),locale:'en',starred:[] as string[],starDenied:false,
 account:{status:'ready',identity:{userId:'22222222-2222-4222-8222-222222222222'},boundaryFingerprint:'verified-boundary'},
 workspaceCompany:'11111111-1111-4111-8111-111111111111',
}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:state.routerPush,refresh:state.routerRefresh}),useSearchParams:()=>state.searchParams}));
vi.mock('next/link',()=>({default:({children,href}:{children:ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:state.locale})}));
vi.mock('@/lib/customer/service-inbox-read',()=>({fetchServiceInbox:state.readServiceInbox}));
vi.mock('@/lib/customer/inbox-extension-actions',()=>({
 listInboxStars:vi.fn(async({channel,conversationIds}:{channel:string;conversationIds:string[]})=>state.starDenied?{ok:false,code:'FORBIDDEN'}:{ok:true,data:conversationIds.filter(id=>state.starred.includes(`${channel}:${id}`))}),
 runInboxExtension:vi.fn(async({channel,conversationId,action}:{channel:string;conversationId:string;action:string})=>{
  const key=`${channel}:${conversationId}`;state.starred=action==='star'?[...new Set([...state.starred,key])]:state.starred.filter(value=>value!==key);return {ok:true,data:null};
 }),
}));
vi.mock('@/lib/whatsapp/inbox-actions',()=>({refreshWhatsappInboxPage:state.refreshWhatsappInboxPage}));
vi.mock('@/lib/instagram/inbox-actions',()=>({loadInstagramInboxPage:state.loadInstagramInboxPage}));
vi.mock('./account-chrome',()=>({useOptionalAccountSession:()=>state.account}));
vi.mock('./branch-inbox-realtime',()=>({CompanyInboxRealtime:()=>null}));
vi.mock('./workspace-shell',()=>({WorkspaceShell:({children,actions}:{children:ReactNode;actions:ReactNode})=><main>{actions}{children}</main>}));
vi.mock('./ui',()=>({
 Button:({children,onClick,disabled,busy,...rest}:{children:ReactNode;onClick?:()=>void;disabled?:boolean;busy?:boolean;'aria-label'?:string})=><button onClick={onClick} disabled={disabled||busy} aria-label={rest['aria-label']}>{children}</button>,
 Notice:({children}:{children:ReactNode})=><aside>{children}</aside>,
 EmptyState:({title,body}:{title:string;body:string})=><section data-empty-state><h3>{title}</h3><p>{body}</p></section>,useAppCopy:()=>appCopy('en'),
}));
vi.mock('./conversations',()=>({ConversationsPage:({selectedConversationId}:{selectedConversationId?:string|null})=>{
 const [draft,setDraft]=useState('');return <section data-pane="conversations" data-selected={selectedConversationId??''}><textarea aria-label="WhatsApp draft" value={draft} onChange={e=>setDraft(e.target.value)}/></section>;
}}));
vi.mock('./instagram-inbox',()=>({InstagramInbox:({onSelectConversation}:{onSelectConversation?:(id:string)=>void})=><section data-pane="instagram"><button onClick={()=>onSelectConversation?.('ig-thread-1')}>Select Instagram thread</button></section>}));
import {UnifiedInbox} from './unified-inbox';
import {listInboxStars} from '@/lib/customer/inbox-extension-actions';
import {WorkspaceBootstrapProvider,type WorkspaceBootstrap} from './workspace-bootstrap';
type ReadableSnapshot=Extract<ComponentProps<typeof UnifiedInbox>['initial'],{ok:true}>;
type WhatsappSnapshot=Extract<ReadableSnapshot['wa'],{ok:true}>;
type InstagramSnapshot=Extract<ReadableSnapshot['ig'],{ok:true}>;
type Fixture=ReadableSnapshot&{wa:WhatsappSnapshot;ig:InstagramSnapshot};
const company='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
function conversation(id:string,customer:string,phone:string,inboxSequence:string,text:string,at:number):WhatsappSnapshot['page']['conversations'][number]{
 return {id,customer,phone,inboxSequence,unreadCount:0,assignedTo:null,status:'open',owner:'assistant',assistantPaused:false,topic:'WhatsApp',summary:'',intervention:{reasons:[]},messages:[{id:`message-${id}`,from:'customer',text,at}]};
}
let root:Root,container:HTMLDivElement;
// Mount the exported component, including its real identity/scoped child wrapper.
// Only external account evidence and native channel panes are fixtures. React
// hooks, reconciliation, workspace context and view-only navigation stay real.
function render(props:ComponentProps<typeof UnifiedInbox>){
 const value={identity:{userId:actor,fullName:'Synthetic owner',email:'owner@example.invalid'},workspace:{needsContext:false,selectedCompanyId:state.workspaceCompany,isPlatformAdmin:false,choices:[]},knowledgeAllowed:false} satisfies WorkspaceBootstrap;
 act(()=>root.render(<WorkspaceBootstrapProvider value={value}><UnifiedInbox {...props}/></WorkspaceBootstrapProvider>));return container;
}
function button(text:string){const found=[...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);expect(found,`button ${text}`).toBeDefined();return found!;}
async function click(target:HTMLElement){await act(async()=>{target.click();});}
function route(search:string){state.searchParams=new URLSearchParams(search);window.history.replaceState(null,'','/app/conversations'+(search?'?'+search:''));}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 state.account={status:'ready',identity:{userId:actor},boundaryFingerprint:'verified-boundary'};state.workspaceCompany=company;state.locale='en';state.starred=[];state.starDenied=false;route('');
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

  function makeInitial(membershipFp = "fp-initial"): Fixture {
    return {
      ok: true as const,
      companyId: company,
      actorId: actor,
      owner: false,
      companyInSetup: false,
      waAllowed: true,
      igAllowed: true,
      igAssignAllowed: false,
      channelContract: {
        plan_entitlements: {
          status: "UNCONFIGURED" as const,
        },
      } as ReadableSnapshot["channelContract"],
      channel_access: { whatsapp: true, instagram: true },
      wa: {
        ok: true as const,
        conversations: [
          conversation("c1", "Customer 1", "+9681", "100", "Msg 1", 1000),
        ],
        page: {
          companyId: company,
          conversationScope: "all_company" as const,
          kind: "partial" as const,
          ordering: "newest_created" as const,
          conversations: [
            conversation("c1", "Customer 1", "+9681", "100", "Msg 1", 1000),
          ],
          hasMore: true,
          nextCursor: "cursor-2",
          total: 10,
          unreadTotal: 0,
          interventionTotal: 0,
          membershipFingerprint: membershipFp,
        },
        meta: {
          companyId: company, conversationScope: "all_company", timezone: null, timezoneAnnouncedUtc: true,
          canReply: false, canAssign: false, assignees: [],
          counts: { all: 0, awaiting_staff: 0, follow_up_today: 0, overdue: 0, trial_or_quote: 0 },
        },
      },
      ig: {
        ok: true as const,
        data: {
          companyId: company,
          actorId: actor,
          conversationScope: "all_company" as const,
          conversations: [],
          total: 0,
          unreadTotal: 0,
          hasMore: false,
          nextCursor: null,
        },
      },
    };
  }



function requireVisible<T extends Element>(el: T | null, message = 'Element must be visible'): T {
 expect(el, message).not.toBeNull();
 let current: Element | null = el;
 while (current && current !== document.body) {
  expect(current.hasAttribute('hidden'), `element has hidden ancestor <${current.tagName.toLowerCase()}>`).toBe(false);
  expect(current.hasAttribute('inert'), `element has inert ancestor <${current.tagName.toLowerCase()}>`).toBe(false);
  expect(current.getAttribute('aria-hidden')).not.toBe('true');
  current = current.parentElement;
 }
 return el!;
}

function visibleButton(text: string) {
 const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(b => b.textContent?.trim() === text || b.textContent === text);
 const visible = buttons.filter(b => {
  let curr: Element | null = b;
  while (curr && curr !== document.body) {
   if (curr.hasAttribute('hidden') || curr.hasAttribute('inert') || curr.getAttribute('aria-hidden') === 'true') return false;
   curr = curr.parentElement;
  }
  return true;
 });
 expect(visible.length, `Expected visible button with text "${text}"`).toBeGreaterThanOrEqual(1);
 return requireVisible(visible[0]);
}

function visibleStarBtn(label: string) {
 const buttons = [...container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)];
 const visible = buttons.filter(b => {
  let curr: Element | null = b;
  while (curr && curr !== document.body) {
   if (curr.hasAttribute('hidden') || curr.hasAttribute('inert') || curr.getAttribute('aria-hidden') === 'true') return false;
   curr = curr.parentElement;
  }
  return true;
 });
 expect(visible.length, `Expected visible button with aria-label "${label}"`).toBe(1);
 return requireVisible(visible[0]);
}

describe('UnifiedInbox membership and page safety',()=>{
 it('reads and updates durable stars only for the loaded authorized rows',async()=>{
  const media={matches:true,addEventListener:vi.fn((_type:string,_callback:()=>void)=>undefined),removeEventListener:vi.fn()};vi.stubGlobal('matchMedia',vi.fn(()=>media));
  const initial=makeInitial();initial.wa.page.conversations.push(conversation('c2','Customer 2','+9682','101','Second message',2000));
  await act(async()=>{render({initial});});
  const names=()=>{
   const desktopItems = [...container.querySelectorAll('[data-inbox-panel="list"] .vdi-row-top strong')];
   const mobileItems = [...container.querySelectorAll('[aria-label="Conversation list"] strong')];
   const all = [...desktopItems, ...mobileItems].filter(el => {
    let curr: Element | null = el;
    while (curr && curr !== document.body) {
     if (curr.hasAttribute('hidden') || curr.hasAttribute('inert') || curr.getAttribute('aria-hidden') === 'true') return false;
     curr = curr.parentElement;
    }
    return true;
   });
   return all.map(e => e.textContent);
  };
  expect(names()).toEqual(['Customer 2','Customer 1']);
  await click(visibleStarBtn('Star Customer 1'));
  expect(names()[0]).toBe('Customer 1');
  await click(visibleButton('Starred 1'));
  expect(names()).toEqual(['Customer 1']);
  expect(state.readServiceInbox).not.toHaveBeenCalled();expect(state.routerPush).not.toHaveBeenCalled();
  const change=media.addEventListener.mock.calls[0]?.[1] as (()=>void)|undefined;
  media.matches=false;act(()=>change?.());expect(names()).toEqual(['Customer 2','Customer 1']);
  media.matches=true;await act(async()=>change?.());expect(names()).toEqual(['Customer 1']);
  await act(async()=>{render({initial:makeInitial('new-membership')});});
  expect(visibleButton('Starred 1').getAttribute('aria-pressed')).toBe('false');
  visibleStarBtn('Unstar Customer 1');
 });
 it('does not display or mutate stars when the database denies the list read',async()=>{
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
  state.starred=['whatsapp:c1'];state.starDenied=true;
  await act(async()=>{render({initial:makeInitial()});});
  const star=visibleStarBtn('Star Customer 1');
  expect(star.disabled).toBe(true);
  expect(container.querySelectorAll('button[aria-label="Unstar Customer 1"]').length).toBe(0);
  expect(container.textContent).toContain('Starred conversations could not be loaded.');
 });
 it('reads a large loaded list in bounded channel-specific batches',async()=>{
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
  const initial=makeInitial();
  for(let i=0;i<40;i++)initial.wa.page.conversations.push(conversation(`row-${i}`,`Customer ${i}`,'+9682',`${101+i}`,'Message',2000+i));
  await act(async()=>{render({initial});});
  const calls=vi.mocked(listInboxStars).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls.map(([input])=>input.conversationIds.length)).toEqual([40,1]);
  expect(calls.every(([input])=>input.channel==='whatsapp'&&input.companyId===company)).toBe(true);
 });
 it('follows the visible viewport for the phone keyboard and removes listeners on scope loss',()=>{
  const viewport=Object.assign(new EventTarget(),{height:500,offsetTop:0});vi.stubGlobal('visualViewport',viewport);
  const remove=vi.spyOn(viewport,'removeEventListener');route('channel=whatsapp&source=whatsapp&c=c1');render({initial:makeInitial()});
  const pane=container.querySelector<HTMLElement>('[data-open="true"]')!;expect(pane.style.getPropertyValue('--inbox-viewport-height')).toBe('500px');
  viewport.height=320;viewport.offsetTop=16;act(()=>viewport.dispatchEvent(new Event('resize')));
  expect(pane.style.getPropertyValue('--inbox-viewport-height')).toBe('320px');expect(pane.style.getPropertyValue('--inbox-viewport-top')).toBe('16px');
  render({initial:{ok:false,code:'SCOPE_CHANGED'}});expect(container.querySelector('[data-pane]')).toBeNull();
  expect(remove).toHaveBeenCalledWith('resize',expect.any(Function));expect(remove).toHaveBeenCalledWith('scroll',expect.any(Function));
  expect(state.readServiceInbox).not.toHaveBeenCalled();
 });
 it('keeps native phone search and lead worklists available without fetching another inbox',async()=>{
  const initial=makeInitial();initial.wa.page.conversations.push({...conversation('quote','Quote customer','+9689999','102','Quotation',3000),leadStage:'trial_or_quote_requested'});
  route('channel=whatsapp');render({initial});
  const search=container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'+9689999');search.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(container.textContent).toContain('Quote customer');expect(container.textContent).not.toContain('Customer 1');
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}));});
  const leads=container.querySelector<HTMLSelectElement>('select')!;
  await act(async()=>{leads.value='trial_or_quote';leads.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.textContent).toContain('Quote customer');expect(container.textContent).not.toContain('Customer 1');
  await act(async()=>{leads.value='overdue';leads.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.textContent).toContain('No matches in loaded conversations');expect(container.textContent).not.toContain('No conversations yet');
  expect(state.readServiceInbox).not.toHaveBeenCalled();expect(state.refreshWhatsappInboxPage).not.toHaveBeenCalled();
 });
 it('applies the dashboard attention filter and retains it while opening a thread',async()=>{
  const initial=makeInitial();const attention={...conversation('needs-human','Needs human','+9682','101','Please help',2000),intervention:{reasons:['send_unknown' as const]}};initial.wa.page.conversations.push(attention);
  route('channel=whatsapp&filter=staff');const historyPush=vi.spyOn(window.history,'pushState');render({initial});
  expect(container.textContent).not.toContain('Customer 1');expect(container.textContent).toContain('Needs human');
  await click([...container.querySelectorAll('button')].find(b=>b.textContent?.includes('Needs human'))!);
  expect(historyPush).toHaveBeenCalledWith(null,'','/app/conversations?channel=whatsapp&source=whatsapp&c=needs-human&filter=staff');expect(state.routerPush).not.toHaveBeenCalled();
  expect(container.querySelector('[data-pane="conversations"]')?.getAttribute('data-selected')).toBe('needs-human');
  await click(button('Clear filter'));expect(historyPush).toHaveBeenLastCalledWith(null,'','/app/conversations?channel=whatsapp');expect(state.readServiceInbox).not.toHaveBeenCalled();
 });
 it('does not describe an unmatched worklist as an empty inbox',()=>{
  route('channel=whatsapp&filter=staff');render({initial:makeInitial()});expect(container.textContent).toContain('No matches in loaded conversations');expect(container.textContent).not.toContain('No conversations yet');
 });
 it('prevents regression of old membership results when refresh detects membership change',async()=>{
  const initial=makeInitial('fp-old');render({initial});const fresh=conversation('c-new-member','New Member Cust','+96899','200','New',2000);
  state.readServiceInbox.mockResolvedValue({...initial,wa:{...initial.wa,conversations:[fresh],page:{...initial.wa.page,conversations:[fresh],membershipFingerprint:'fp-new'}}});
  await click(button('Refresh'));expect(container.textContent).not.toContain('Customer 1');expect(container.textContent).toContain('New Member Cust');
 });
 it('rejects more() pagination if returned membershipFingerprint does not match active membership',async()=>{
  const initial=makeInitial('fp-active');render({initial});state.refreshWhatsappInboxPage.mockResolvedValue({ok:true,data:{...initial.wa.page,conversations:[conversation('c2-stale','Stale Member Page','+9682','50','Stale',500)],membershipFingerprint:'fp-stale-different'}});
  await click(button('More WhatsApp'));expect(container.textContent).not.toContain('Stale Member Page');expect(container.textContent).toContain('The session or workspace changed');
 });
 it('preserves loaded pages and native panes across re-renders and channel navigation to prevent draft loss',async()=>{
  route('channel=whatsapp&source=whatsapp&c=c1');const initial=makeInitial('fp-1');render({initial});const pane=container.querySelector('[data-pane="conversations"]'),draft=container.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;setter.call(draft,'Unsaved private draft');draft.dispatchEvent(new Event('input',{bubbles:true}));});
  state.refreshWhatsappInboxPage.mockResolvedValue({ok:true,data:{...initial.wa.page,conversations:[conversation('c2','Customer 2','+9682','90','Msg 2',900)],membershipFingerprint:'fp-1',hasMore:false}});
  await click(button('More WhatsApp'));expect(container.textContent).toContain('Customer 1');expect(container.textContent).toContain('Customer 2');
  await click(button('Select Instagram thread'));expect(container.querySelector('[data-pane="conversations"]')).toBe(pane);expect(container.querySelector('textarea')).toBe(draft);expect(draft.value).toBe('Unsaved private draft');
  expect(pane?.parentElement?.hidden).toBe(true);expect(pane?.parentElement?.hasAttribute('inert')).toBe(true);expect(container.querySelector('[data-pane="instagram"]')).not.toBeNull();
  render({initial});expect(container.querySelector('textarea')).toBe(draft);
 });
 it('calculates search empty state for an allowed page and erases all channels on unavailability',async()=>{
  const initial=makeInitial('fp-1');render({initial});expect(container.textContent).toContain('Customer 1');
  const input=container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,'nonexistent');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(container.textContent).toContain('No matches in loaded conversations');expect(container.textContent).toContain('No conversations matched your search in loaded conversations.');
  render({initial:{...initial,ig:{ok:false as const,code:'UNAVAILABLE' as const}}});
  expect(container.textContent).not.toContain('Customer 1');expect(container.querySelector('[data-pane]')).toBeNull();expect(container.querySelector('textarea')).toBeNull();expect(button('Retry').disabled).toBe(false);
 });
 it('disables refresh during pagination and retry while unavailable recovery is pending',async()=>{
  route('channel=whatsapp&source=whatsapp&c=c1');const initial=makeInitial('fp-1');let resolveMore!:(value:{ok:true;data:WhatsappSnapshot['page']})=>void;
  state.refreshWhatsappInboxPage.mockImplementation(()=>new Promise(resolve=>{resolveMore=resolve;}));render({initial});await click(button('More WhatsApp'));
  expect(button('Refresh').disabled).toBe(true);expect(container.querySelector<HTMLButtonElement>('[aria-label="Refresh conversation"]')?.disabled).toBe(true);
  await act(async()=>resolveMore({ok:true,data:{...initial.wa.page,conversations:[],membershipFingerprint:'fp-1'}}));expect(button('Refresh').disabled).toBe(false);
  state.readServiceInbox.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});await click(button('Refresh'));
  expect(container.querySelector('[data-pane]')).toBeNull();expect(button('Retry').disabled).toBe(false);
  let recover!:(value:typeof initial)=>void;state.readServiceInbox.mockImplementationOnce(()=>new Promise(resolve=>{recover=resolve;}));
  await click(button('Retry'));expect(button('Retry').disabled).toBe(true);expect(container.querySelector('textarea')).toBeNull();
  await act(async()=>recover(initial));expect(container.querySelector('[data-pane]')).not.toBeNull();expect(button('Refresh').disabled).toBe(false);
 });
 it.each(['actor','company','locked'])('removes cached content and native panes when the wrapper detects %s change',async kind=>{
  const initial=makeInitial();render({initial});expect(container.textContent).toContain('Customer 1');
  if(kind==='actor')state.account={...state.account,identity:{userId:'other-actor'}};
  if(kind==='company')state.workspaceCompany='other-company';
  if(kind==='locked')state.account={...state.account,status:'locked'};
  render({initial});expect(container.textContent).not.toContain('Customer 1');expect(container.querySelector('[data-pane]')).toBeNull();expect(container.textContent).toContain('The session or workspace changed');
  state.readServiceInbox.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await click(button('Refresh'));expect(state.readServiceInbox).not.toHaveBeenCalled();expect(container.querySelector('[data-pane]')).toBeNull();
 });
});
