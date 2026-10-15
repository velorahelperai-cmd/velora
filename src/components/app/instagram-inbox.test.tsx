import {Children,isValidElement,type ReactElement} from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
type Slot={value?:unknown;deps?:unknown[];cleanup?:()=>void};
const f=vi.hoisted(()=>({slots:[] as Slot[],cursor:0,effects:[] as (()=>void)[],url:'',push:vi.fn(),replace:vi.fn(),inbox:vi.fn(),thread:vi.fn(),read:vi.fn(),load:vi.fn(),ready:vi.fn(),save:vi.fn(),send:vi.fn()}));
vi.mock('react',async()=>{const actual=await vi.importActual<typeof import('react')>('react');const slot=()=>f.slots[f.cursor++]??(f.slots[f.cursor-1]={});return {...actual,
 useState(initial:unknown){const s=slot();if(!('value' in s))s.value=typeof initial==='function'?(initial as ()=>unknown)():initial;return [s.value,(v:unknown)=>{s.value=typeof v==='function'?(v as (p:unknown)=>unknown)(s.value):v;}];},
 useRef(initial:unknown){const s=slot();return s.value??(s.value={current:initial});},
 useEffect(fn:()=>void|(()=>void),deps:unknown[]){const s=slot();if(!s.deps||deps.some((v,i)=>!Object.is(v,s.deps![i]))){f.effects.push(()=>{s.cleanup?.();s.cleanup=fn()||undefined;});s.deps=deps;}}
};});
vi.mock('next/navigation',()=>({useRouter:()=>({push:f.push,replace:f.replace}),useSearchParams:()=>new URLSearchParams(f.url)}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('./workspace-shell',()=>({WorkspaceShell:()=>null}));
vi.mock('./instagram-owner-connection',()=>({InstagramOwnerConnection:()=>null}));
vi.mock('./ui',()=>({Button:()=>null,Notice:()=>null}));
vi.mock('@/lib/instagram/inbox-actions',()=>({loadInstagramInboxPage:f.inbox,loadInstagramThreadPage:f.thread,markInstagramThreadRead:f.read}));
vi.mock('@/lib/instagram/manual-actions',()=>({loadInstagramReply:f.load,loadInstagramSendReadiness:f.ready,saveInstagramReply:f.save,sendSavedInstagramReply:f.send}));
vi.mock('./channel-ai-draft',()=>({ChannelAIDraft:()=>null}));
import {InstagramInbox} from './instagram-inbox';
import {Button} from './ui';
import {ChannelAIDraft} from './channel-ai-draft';
const id=(n:number)=>`abcdefab-0000-4000-8000-${String(n).padStart(12,'0')}`;
const conversation={id:id(2),counterpartyId:'200',unreadCount:1};
const page={companyId:id(1),actorId:id(11),conversationScope:'all_company',conversations:[conversation,{...conversation,id:id(4),counterpartyId:'201'}],hasMore:false,nextCursor:null};
const thread={...page,conversationId:id(2),conversation,messages:[],readReceipt:null};
const saved={text:' exact saved text ',state:'ready',binding:{companyId:id(1),conversationId:id(2),intentId:id(3)}};
let setupOwner=false;
let review=false;
function render(company=id(1)){f.cursor=0;const tree=InstagramInbox({companyId:company,owner:setupOwner,companyInSetup:setupOwner,reviewMode:review});f.effects.splice(0).forEach(fn=>fn());return tree;}
function nodes(tree:ReactElement):ReactElement<Record<string,unknown>>[]{return [tree as ReactElement<Record<string,unknown>>,...Children.toArray((tree.props as {children?:ReactElement[]}).children).filter(isValidElement).flatMap(n=>nodes(n))];}
const button=(label:string)=>nodes(render()).find(n=>n.type===Button&&n.props.children===label)!;
const textarea=()=>nodes(render()).find(n=>n.type==='textarea')!;
const click=async(label:string)=>{const b=button(label);expect(b.props.disabled).not.toBe(true);await (b.props.onClick as ()=>void)();};
async function settle(company=id(1)){for(let n=0;n<20;n++)await Promise.resolve();render(company);}
beforeEach(()=>{setupOwner=false;for(const s of f.slots)s.cleanup?.();f.slots=[];f.cursor=0;f.effects=[];f.url='thread='+id(2);vi.clearAllMocks();f.inbox.mockResolvedValue({ok:true,data:page});f.thread.mockResolvedValue({ok:true,data:thread});f.read.mockResolvedValue({ok:true});f.ready.mockResolvedValue({ok:true,data:{blockers:['ROLLOUT_DISABLED'],ready:false}});f.load.mockResolvedValue({ok:true,data:saved});f.save.mockResolvedValue({ok:true,data:saved});});
it('explains setup for the native owner without granting inbox access or changing staff denial',async()=>{
 f.url='';f.inbox.mockResolvedValue({ok:false,code:'FORBIDDEN'});setupOwner=true;render();await settle();
 expect(nodes(render()).some(n=>String(n.props.children).includes('Company activation must be approved'))).toBe(true);
 expect(f.thread).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
 setupOwner=false;
 expect(nodes(render()).some(n=>n.props.children==='You do not have access to this Instagram conversation.')).toBe(true);
});
it('rejects oversized UTF-8 draft before reservation, allowing correction',async()=>{
 render();await settle();(textarea().props.onChange as (e:unknown)=>void)({target:{value:'ع'.repeat(501)}});await click('Save reply');await settle();
 expect(f.save).not.toHaveBeenCalled();expect(textarea().props.readOnly).toBe(false);
 (textarea().props.onChange as (e:unknown)=>void)({target:{value:'corrected'}});await click('Save reply');await settle();expect(f.save).toHaveBeenCalledWith(expect.objectContaining({text:'corrected'}));
});
it('URL reload and Back/Forward restore only the server saved text; rollout disables send',async()=>{
 f.url+='&intent='+id(3);render();await settle();expect(textarea().props.value).toBe(' exact saved text ');expect(textarea().props.readOnly).toBe(true);expect(button('Send saved reply').props.disabled).toBe(true);
 f.url='thread='+id(4);render();await settle();expect(textarea().props.value).toBe('');
 f.url='thread='+id(2)+'&intent='+id(3);render();await settle();expect(textarea().props.value).toBe(' exact saved text ');expect(f.send).not.toHaveBeenCalled();
});
it('late save response after navigation cannot restore another thread or replace its URL',async()=>{
 let resolve!:(r:unknown)=>void;f.save.mockImplementation(()=>new Promise(r=>{resolve=r;}));render();await settle();
 (textarea().props.onChange as (e:unknown)=>void)({target:{value:'old thread draft'}});await click('Save reply');
 f.url='thread='+id(4);render();await settle();resolve({ok:true,data:saved});await settle();expect(f.replace).not.toHaveBeenCalled();expect(textarea().props.value).toBe('');
});
it('ambiguous save retry uses the same UUID and exact locked text',async()=>{
 f.save.mockResolvedValue({ok:false,code:'UNAVAILABLE'});render();await settle();(textarea().props.onChange as (e:unknown)=>void)({target:{value:' exact pending '}});
 await click('Save reply');await settle();expect(textarea().props.readOnly).toBe(true);await click('Save reply');await settle();expect(f.save.mock.calls[0][0]).toEqual(f.save.mock.calls[1][0]);
});
it('inbox and older-message controls consume native cursors',async()=>{
 f.inbox.mockResolvedValueOnce({ok:true,data:{...page,hasMore:true,nextCursor:'inbox-token'}});f.thread.mockResolvedValueOnce({ok:true,data:{...thread,hasMore:true,nextCursor:'thread-token'}});
 render();await settle();await click('More conversations');await settle();expect(f.inbox).toHaveBeenCalledWith({companyId:id(1),cursor:'inbox-token'});
 await click('Older messages');await settle();expect(f.thread).toHaveBeenCalledWith({companyId:id(1),conversationId:id(2),cursor:'thread-token'});expect(f.read).not.toHaveBeenCalled();
});
it('selecting the current thread explicitly reloads instead of staying empty and loading',async()=>{
 render();await settle();const current=nodes(render()).find(n=>n.type==='button'&&n.props['aria-current']==='page')!;
 (current.props.onClick as ()=>void)();render();await settle();expect(f.thread).toHaveBeenCalledTimes(2);expect(textarea()).toBeDefined();expect(button('Save reply').props.disabled).toBe(true);
});
it('readiness failure keeps saved reply visible but prevents dispatch until explicit refresh succeeds',async()=>{
 f.url+='&intent='+id(3);f.ready.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});
 render();await settle();expect(textarea().props.value).toBe(saved.text);
 expect(button('Send saved reply').props.disabled).toBe(true);
 f.ready.mockResolvedValue({ok:true,data:{blockers:[],ready:true}});
 await click('Refresh conversations');render();await settle();
 expect(button('Send saved reply').props.disabled).toBe(false);expect(f.send).not.toHaveBeenCalled();
});
it('empty inbox is distinguished from a failed inbox read',async()=>{
 f.url='';f.inbox.mockResolvedValue({ok:true,data:{...page,conversations:[]}});
 render();await settle();expect(nodes(render()).some(n=>n.props.children==='No Instagram conversations yet.')).toBe(true);
 f.inbox.mockResolvedValue({ok:false,code:'UNAVAILABLE'});await click('Refresh conversations');render();await settle();
 expect(nodes(render()).some(n=>n.props.children==='No Instagram conversations yet.')).toBe(false);
});
it('keeps review messaging manual while preserving administrative draft UI outside review',async()=>{
 review=false;render();await settle();expect(nodes(render()).some(n=>n.type===ChannelAIDraft)).toBe(true);
 review=true;expect(nodes(render()).some(n=>n.type===ChannelAIDraft)).toBe(false);
 expect(nodes(render()).some(n=>n.props.children==='Meta review workspace · test account')).toBe(true);
 expect(f.send).not.toHaveBeenCalled();review=false;
});
it('preserves unsaved text across thread navigation and refresh, without leaking it into another company',async()=>{
 render();await settle();(textarea().props.onChange as (e:unknown)=>void)({target:{value:'my unsent draft'}});
 f.url='thread='+id(4);render();await settle();expect(textarea().props.value).toBe('');
 f.url='thread='+id(2);render();await settle();expect(textarea().props.value).toBe('my unsent draft');
 await click('Refresh conversations');await settle();expect(textarea().props.value).toBe('my unsent draft');
 f.inbox.mockResolvedValue({ok:true,data:{...page,companyId:id(5)}});f.thread.mockResolvedValue({ok:true,data:{...thread,companyId:id(5)}});
 render(id(5));await settle(id(5));const tree=render(id(5));expect(nodes(tree).find(n=>n.type==='textarea')?.props.value).toBe('');
});
it('retains an ambiguous save reservation across navigation instead of reserving a second operation',async()=>{
 f.load.mockResolvedValue({ok:false,code:'NOT_FOUND'});f.save.mockResolvedValueOnce({ok:false,code:'UNAVAILABLE'});
 render();await settle();(textarea().props.onChange as (e:unknown)=>void)({target:{value:'reserved body'}});await click('Save reply');await settle();
 const first=f.save.mock.calls[0][0];f.url='thread='+id(4);render();await settle();f.url='thread='+id(2);render();await settle();
 expect(textarea().props.value).toBe('reserved body');await click('Save reply');await settle();expect(f.save.mock.calls[1][0]).toEqual(first);
});
