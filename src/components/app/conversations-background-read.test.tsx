import {beforeEach,expect,it,vi} from 'vitest';
import type {ComponentProps} from 'react';
import {appCopy} from '@/lib/app-copy';
type Slot={value?:unknown;deps?:unknown[]};
const state=vi.hoisted(()=>({slots:[] as Slot[],cursor:0,effects:[] as Array<()=>void>,thread:vi.fn(),audit:vi.fn(),connection:vi.fn(),send:vi.fn()}));
vi.mock('react',async()=>{
 const actual=await vi.importActual<typeof import('react')>('react');
 const slot=()=>state.slots[state.cursor++]??(state.slots[state.cursor-1]={});
 const changed=(a:unknown[]|undefined,b:unknown[])=>!a||a.length!==b.length||b.some((v,i)=>!Object.is(a[i],v));
 const memo=(fn:()=>unknown,deps:unknown[])=>{const s=slot();if(changed(s.deps,deps)){s.value=fn();s.deps=deps;}return s.value;};
 const effect=(fn:()=>void,deps:unknown[])=>{const s=slot();if(changed(s.deps,deps)){s.deps=deps;state.effects.push(fn);}};
 return {...actual,useState(initial:unknown){const s=slot();if(!('value'in s))s.value=typeof initial==='function'?(initial as ()=>unknown)():initial;return[s.value,(v:unknown)=>{s.value=typeof v==='function'?(v as(x:unknown)=>unknown)(s.value):v;}];},
 useRef(value:unknown){const s=slot();if(!s.value)s.value={current:value};return s.value;},useMemo:memo,useCallback:(fn:()=>unknown,deps:unknown[])=>memo(()=>fn,deps),useEffect:effect,useLayoutEffect:effect,
 useTransition(){const s=slot();s.value??=0;return[Number(s.value)>0,(fn:()=>Promise<void>)=>{s.value=Number(s.value)+1;void fn().finally(()=>{s.value=Number(s.value)-1;});}];}};
});
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('./ui',()=>({Button:'button',Notice:'aside',EmptyState:'section',useAppCopy:()=>appCopy('en')}));
vi.mock('./workspace-shell',()=>({WorkspaceShell:'main'}));
vi.mock('./channel-ai-draft',()=>({ChannelAIDraft:()=>null}));
vi.mock('./channel-review',()=>({ChannelReviewStatus:()=>null}));
vi.mock('@/lib/whatsapp/actions',()=>({controlWhatsappConversation:vi.fn(),replyWhatsappConversation:state.send,upsertConversationLeadState:vi.fn()}));
vi.mock('@/lib/whatsapp/inbox-actions',()=>({refreshWhatsappInboxInitialPage:vi.fn(),refreshWhatsappInboxPage:vi.fn(),refreshWhatsappThreadPage:state.thread,refreshWhatsappControlAuditPage:state.audit,refreshWhatsappConnectionStatus:state.connection,markWhatsappThreadSeen:vi.fn()}));
import {ConversationsPage} from './conversations';
type Node={type:unknown;props:Record<string,unknown>};
function nodes(v:unknown):Node[]{if(Array.isArray(v))return v.flatMap(nodes);if(!v||typeof v!=='object'||!('props'in v))return[];const n=v as Node;return[n,...nodes(n.props.children),...nodes(n.props.actions)];}
function render(p:ComponentProps<typeof ConversationsPage>){state.cursor=0;let tree=ConversationsPage(p);let runs=0;while(state.effects.length){if(++runs>20)throw Error('effect loop');state.effects.splice(0).forEach(fn=>fn());state.cursor=0;tree=ConversationsPage(p);}return tree;}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function deferred(){let resolve!:(v:unknown)=>void;return {promise:new Promise(ok=>{resolve=ok;}),resolve:(v:unknown)=>resolve(v)};}
const item={id:'thread',inboxSequence:'1',unreadCount:0,intervention:{reasons:[]},customer:'Synthetic',phone:'synthetic',topic:'WhatsApp',summary:'',status:'open' as const,owner:'staff' as const,assistantPaused:true,automationAllowed:false,revision:1,messages:[]};
function props():ComponentProps<typeof ConversationsPage>{return{embedded:true,selectedConversationId:'thread',inbox:[item],meta:{companyId:'company',conversationScope:'all_company',timezone:null,timezoneAnnouncedUtc:true,canReply:true,canAssign:false,assignees:[],counts:{all:1,awaiting_staff:1,follow_up_today:0,overdue:0,trial_or_quote:0}},page:{companyId:'company',conversationScope:'all_company',kind:'partial',ordering:'newest_created',conversations:[item],hasMore:false,nextCursor:null,total:1,unreadTotal:0,interventionTotal:1,membershipFingerprint:'d41d8cd98f00b204e9800998ecf8427e'}};}
const reply=(tree:unknown)=>nodes(tree).find(n=>n.type==='textarea'&&typeof n.props.onKeyDown==='function')!;
beforeEach(()=>{state.slots=[];state.cursor=0;state.effects=[];vi.clearAllMocks();vi.stubGlobal('window',{setInterval:vi.fn(),clearInterval:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),requestAnimationFrame:vi.fn(),cancelAnimationFrame:vi.fn()});vi.stubGlobal('document',{visibilityState:'hidden',addEventListener:vi.fn(),removeEventListener:vi.fn()});});
it('allows drafting after thread verification while audit and connection reads are pending, but blocks an unresolved thread and a pending send',async()=>{
 const thread=deferred(),audit=deferred(),connection=deferred(),send=deferred();
 state.thread.mockReturnValue(thread.promise);state.audit.mockReturnValue(audit.promise);state.connection.mockReturnValue(connection.promise);state.send.mockReturnValue(send.promise);
 const p=props();let tree=render(p);expect(reply(tree).props.disabled).toBe(true);
 p.refreshVersion=1;render(p);p.refreshVersion=2;render(p);
 expect(state.thread).toHaveBeenCalledTimes(1);
 thread.resolve({ok:true,data:{kind:'partial',companyId:'company',conversationId:'thread',conversation:item,messages:[],displayedInboundMessageId:null,unreadCount:0,nextCursor:null,hasMore:false}});await flush();tree=render(p);
 expect(state.audit).toHaveBeenCalledTimes(1);expect(reply(tree).props.disabled).toBe(false);
 (reply(tree).props.onChange as(e:unknown)=>void)({target:{value:'Synthetic test reply'}});tree=render(p);
 (reply(tree).props.onKeyDown as(e:unknown)=>void)({key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){}});await flush();tree=render(p);
 expect(state.send).toHaveBeenCalledTimes(1);expect(reply(tree).props.disabled).toBe(true);
 send.resolve({ok:false,code:'SEND_DISABLED'});await flush();tree=render(p);expect(reply(tree).props.disabled).toBe(false);
 audit.resolve({ok:false,code:'UNAVAILABLE'});connection.resolve({ok:false,code:'UNAVAILABLE'});await flush();render(p);
});
