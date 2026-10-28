import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/auth/server-identity',()=>({readSessionIdentity:m.identity}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:m.rpc})}));
import {listMyBranchAccess,readBranchInbox} from './branch-inbox';
const companyId='11111111-1111-4111-8111-111111111111',branchId='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const input={companyId,branchId,channel:'whatsapp'};
const response={ok:true,...input,conversations:[{id,customer_name:'Customer',latest_message:null,secret:'omit'}],conversation:null,messages:null,has_more:false,next_cursor:null};
beforeEach(()=>{vi.clearAllMocks();m.identity.mockResolvedValue({ok:true,emailConfirmed:true});m.rpc.mockResolvedValue({data:response,error:null});});
it('rejects malformed scope, cursor, channel and unauthenticated reads before RPC',async()=>{
 for(const patch of [{companyId:'bad'},{channel:'email'},{conversationId:'bad'},{before:'-1'},{before:'9223372036854775808'}])expect(await readBranchInbox({...input,...patch})).toBeNull();
 m.identity.mockResolvedValue({ok:false});expect(await readBranchInbox(input)).toBeNull();expect(await listMyBranchAccess()).toBeNull();expect(m.rpc).not.toHaveBeenCalled();
});
it('allowlists inbox fields and rejects a foreign scope',async()=>{
 expect(await readBranchInbox(input)).toEqual({conversations:[{id,label:'Customer',latest:null}],conversation:null,messages:[],nextCursor:null});
 m.rpc.mockResolvedValue({data:{...response,branchId:companyId},error:null});expect(await readBranchInbox(input)).toBeNull();
});
it('requires the requested conversation and keeps only safe message fields',async()=>{
 const conversation={id,customer_name:'Customer',latest_message:null};
 m.rpc.mockResolvedValue({data:{...response,conversations:null,conversation,messages:[{id,body:'Hello',direction:'inbound',received_at:'2026-10-29T00:00:00Z',secret:'omit'}]},error:null});
 expect(await readBranchInbox({...input,conversationId:id})).toMatchObject({messages:[{id,text:'Hello',direction:'inbound',receivedAt:'2026-10-29T00:00:00Z'}]});
 expect(await readBranchInbox({...input,conversationId:companyId})).toBeNull();
});
it('lists only validated branch projections and fails closed on transport errors',async()=>{
 m.rpc.mockResolvedValue({data:{ok:true,branches:[{companyId,branchId,branchLabel:'Branch',capabilities:['wa.conversations.read'],secret:'omit'}]},error:null});
 expect(await listMyBranchAccess()).toEqual([{companyId,branchId,branchLabel:'Branch',capabilities:['wa.conversations.read']}]);
 m.rpc.mockRejectedValue(Error('transport'));expect(await listMyBranchAccess()).toBeNull();expect(await readBranchInbox(input)).toBeNull();
});
