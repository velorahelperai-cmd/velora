// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import React,{act,useState,type ComponentProps,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {appCopy} from '@/lib/app-copy';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({
 routerPush:vi.fn(),routerRefresh:vi.fn(),readServiceInbox:vi.fn(),refreshWhatsappInboxPage:vi.fn(),loadInstagramInboxPage:vi.fn(),
 searchParams:new URLSearchParams(),locale:'en',
 account:{status:'ready',identity:{userId:'22222222-2222-4222-8222-222222222222'},boundaryFingerprint:'verified-boundary'},
 workspaceCompany:'11111111-1111-4111-8111-111111111111',
}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:state.routerPush,refresh:state.routerRefresh}),useSearchParams:()=>state.searchParams}));
vi.mock('next/link',()=>({default:({children,href}:{children:ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:state.locale})}));
vi.mock('@/lib/customer/service-inbox-read',()=>({fetchServiceInbox:state.readServiceInbox}));
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
 state.account={status:'ready',identity:{userId:actor},boundaryFingerprint:'verified-boundary'};state.workspaceCompany=company;state.locale='en';route('');
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



describe('UnifiedInbox membership and page safety',()=>{
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
  await click(button('More WhatsApp'));expect(container.textContent).not.toContain('Stale Member Page');expect(container.textContent).toContain('The latest update could not be verified');
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
