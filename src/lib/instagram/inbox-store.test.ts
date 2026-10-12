import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createInstagramInboxStore} from './inbox-store';
const company='00000000-0000-4000-8000-000000000001', conversation='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003',token='00000000-0000-4000-8000-000000000004';
const scope={company_id:company,actor_id:actor,conversation_scope:'assigned_only'};
const item={id:conversation,inbox_sequence:'1',account_id:'100',counterparty_id:'200',assigned_to:actor,revision:1,unread_count:2,last_received_at:'2026-10-11T00:00:00Z',latest_message:{id:token,arrival_sequence:'2',direction:'inbound',content_kind:'non_text',content_text:null,received_at:'2026-10-11T00:00:00Z',read_observed_at:null}};
const page={ok:true,...scope,conversations:[item],total:1,unread_total:2,has_more:false,next_cursor:null};
const thread={ok:true,...scope,conversation_id:conversation,conversation:item,messages:[item.latest_message],has_more:false,next_cursor:null,read_receipt:token,unread_count:2};
function fixture(data:unknown=page,error:unknown=null){const rpc=vi.fn(async()=>({data,error}));return {rpc,store:createInstagramInboxStore({rpc})};}
it('uses session RPC with only allowlisted company/limit/opaque cursor input',async()=>{
 const f=fixture();const r=await f.store.inbox({companyId:company,limit:10,cursor:token,scope:'all_company',actorId:'forged'} as never);
 expect(r).toMatchObject({ok:true,data:{companyId:company,actorId:actor,conversationScope:'assigned_only',total:1,unreadTotal:2,hasMore:false,nextCursor:null}});
 expect(f.rpc).toHaveBeenCalledWith('instagram_inbox_page',{p_company_id:company,p_limit:10,p_cursor:token});
});
it('returns typed non-text markers without fabricating URLs or delivery/window state',async()=>{
 const f=fixture(thread);const r=await f.store.thread({companyId:company,conversationId:conversation});
 expect(r).toMatchObject({ok:true,data:{readReceipt:token,messages:[{content:{kind:'non_text'},direction:'inbound'}]}});
 if(r.ok)expect(r.data.messages[0]).not.toHaveProperty('deliveryState');
});
it('forwards displayed receipt only, never accepts an arbitrary message read boundary',async()=>{
 const f=fixture({ok:true,...scope,conversation_id:conversation,last_read_sequence:'2',unread_count:0});
 expect(await f.store.markRead({companyId:company,conversationId:conversation,readReceipt:token,displayedInboundMessageId:actor} as never)).toMatchObject({ok:true,data:{lastReadSequence:'2',unreadCount:0}});
 expect(f.rpc).toHaveBeenCalledWith('instagram_mark_thread_read',{p_company_id:company,p_conversation_id:conversation,p_read_receipt:token});
});
it('uses revision-checked assignment and exact target echo',async()=>{
 const f=fixture({ok:true,...scope,conversation_id:conversation,assigned_to:null,revision:2});
 expect(await f.store.assign({companyId:company,conversationId:conversation,assignedTo:null,expectedRevision:1})).toMatchObject({ok:true,data:{assignedTo:null,revision:2}});
 expect(f.rpc).toHaveBeenCalledWith('instagram_assign_conversation',{p_company_id:company,p_conversation_id:conversation,p_assigned_to:null,p_expected_revision:1});
});
it.each(['FORBIDDEN','NOT_FOUND','SCOPE_CHANGED','INVALID_INPUT','CONFLICT','UNAVAILABLE'] as const)('preserves explicit denial %s without data',async code=>{const f=fixture({ok:false,code,content_text:'discard'});expect(await f.store.inbox({companyId:company})).toEqual({ok:false,code});});
it.each([null,{}, {...page,total:null},{...page,unread_total:-1},{...page,has_more:true,next_cursor:null},{...page,conversation_scope:'unknown'},{...page,company_id:conversation},{...page,actor_id:'invalid'},{...page,conversations:[{...item,unread_count:null}]},{...page,conversations:[{...item,latest_message:{...item.latest_message,content_text:'hidden'}}]}])('fails closed for unavailable or malformed page; never zero-fills counts',async data=>{const f=fixture(data);expect(await f.store.inbox({companyId:company})).toEqual({ok:false,code:'UNAVAILABLE'});});
it('rejects foreign thread/receipt data',async()=>{const f=fixture({...thread,conversation_id:actor});expect(await f.store.thread({companyId:company,conversationId:conversation})).toEqual({ok:false,code:'UNAVAILABLE'});});
it('never retries or logs an RPC error',async()=>{const f=fixture(page,{detail:'synthetic private fault'});expect(await f.store.inbox({companyId:company})).toEqual({ok:false,code:'UNAVAILABLE'});expect(f.rpc).toHaveBeenCalledTimes(1);f.rpc.mockRejectedValueOnce(Error('synthetic'));expect(await f.store.inbox({companyId:company})).toEqual({ok:false,code:'UNAVAILABLE'});});
it.each([{companyId:'invalid'},{companyId:company,limit:0},{companyId:company,limit:101},{companyId:company,cursor:'1'},{companyId:company,cursor:'forged'}])('rejects malformed input before contacting RPC',async input=>{const f=fixture();expect(await f.store.inbox(input)).toEqual({ok:false,code:'INVALID_INPUT'});expect(f.rpc).not.toHaveBeenCalled();});
it('does not expose forged successful assignment target/revision',async()=>{const f=fixture({ok:true,...scope,conversation_id:conversation,assigned_to:actor,revision:1});expect(await f.store.assign({companyId:company,conversationId:conversation,assignedTo:null,expectedRevision:1})).toEqual({ok:false,code:'UNAVAILABLE'});});
it('normalizes valid UUID representations before read and assignment dispatch/echo validation',async()=>{
 const c='abcd0000-0000-4000-8000-00000000000a',v='abcd0000-0000-4000-8000-00000000000b',u='abcd0000-0000-4000-8000-00000000000c',receipt='abcd0000-0000-4000-8000-00000000000d';
 const f=fixture({ok:true,...scope,company_id:c,conversation_id:v,assigned_to:u,revision:2});
 expect(await f.store.assign({companyId:c.toUpperCase(),conversationId:v.toUpperCase(),assignedTo:u.toUpperCase(),expectedRevision:1})).toMatchObject({ok:true,data:{companyId:c,conversationId:v,assignedTo:u,revision:2}});
 expect(f.rpc).toHaveBeenLastCalledWith('instagram_assign_conversation',{p_company_id:c,p_conversation_id:v,p_assigned_to:u,p_expected_revision:1});
 f.rpc.mockResolvedValueOnce({data:{...page,company_id:c},error:null});expect((await f.store.inbox({companyId:c.toUpperCase(),cursor:receipt.toUpperCase()})).ok).toBe(true);expect(f.rpc).toHaveBeenLastCalledWith('instagram_inbox_page',{p_company_id:c,p_limit:50,p_cursor:receipt});
 f.rpc.mockResolvedValueOnce({data:{...thread,company_id:c,conversation_id:v,conversation:{...item,id:v}},error:null});expect((await f.store.thread({companyId:c.toUpperCase(),conversationId:v.toUpperCase()})).ok).toBe(true);expect(f.rpc).toHaveBeenLastCalledWith('instagram_thread_page',{p_company_id:c,p_conversation_id:v,p_limit:50,p_cursor:null});
 f.rpc.mockResolvedValueOnce({data:{ok:true,...scope,company_id:c,conversation_id:v,last_read_sequence:'2',unread_count:0},error:null});expect((await f.store.markRead({companyId:c.toUpperCase(),conversationId:v.toUpperCase(),readReceipt:receipt.toUpperCase()})).ok).toBe(true);expect(f.rpc).toHaveBeenLastCalledWith('instagram_mark_thread_read',{p_company_id:c,p_conversation_id:v,p_read_receipt:receipt});
});
