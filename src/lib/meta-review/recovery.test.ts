import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({native:vi.fn(),server:vi.fn(),grant:vi.fn(),send:vi.fn(),outcome:'unknown'}));
const company='7c5e429d-2be3-4578-bf15-8db2fdb5647f';
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:async()=>({ok:true,context:{company:{id:company,status:'active'},membership:{role:'owner'},userId:'owner'}})}));
vi.mock('@/lib/access/actions',()=>({sessionHasCompanyCapability:async()=>true}));
vi.mock('@/lib/meta-review/actions',()=>({readChannelReviewAccess:f.grant}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:f.native,from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'conv',company_id:company,phone_number_id:'1261345677073276',customer_wa_id:'96876351423'},error:null})};return q;}})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:f.server})}));
vi.mock('@/lib/whatsapp/send',()=>({sendWhatsappText:f.send}));
import {replyWhatsappConversation} from '@/lib/whatsapp/actions';
const input={conversationId:'conv',body:'Review reply',clientOpId:'review-op-0001'};
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('WHATSAPP_CONFIGURATION_MODE','meta_test');vi.stubEnv('WHATSAPP_TEST_ALLOW_EXTERNAL_SEND','true');vi.stubEnv('WHATSAPP_TEST_PHONE_NUMBER_ID','1261345677073276');vi.stubEnv('WHATSAPP_TEST_COMPANY_ID',company);
 f.grant.mockResolvedValue({ok:false,code:'REVIEW_UNAVAILABLE'});f.server.mockResolvedValue({data:null,error:null});
 f.native.mockImplementation(async()=>({data:{ok:true,intent:{id:'intent',company_id:company,conversation_id:'conv',sender_kind:'staff',client_op_id:input.clientOpId,outcome:f.outcome,wa_message_id:f.outcome==='accepted'?'wamid.accepted':null,message_id:null,body:input.body,phone_number_id:'1261345677073276',recipient_wa_id:'96876351423',link_id:null,link_generation:null}},error:null}));
});
afterEach(()=>vi.unstubAllEnvs());
it.each(['unknown','attempting','accepted'])('keeps the original operation and recovery for %s after grant cap, expiry or revocation',async outcome=>{
 f.outcome=outcome;const result=await replyWhatsappConversation(input);
 expect(result).toMatchObject({ok:false,clientOpId:input.clientOpId});
 expect(result).not.toHaveProperty('notAttempted',true);expect(f.grant).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
 if(outcome==='accepted')expect(f.server).toHaveBeenCalledWith('retry_whatsapp_send_persist',expect.objectContaining({p_intent_id:'intent'}));
});
it('retains the operation when a concurrent final-slot claim invalidates a previously ready grant lookup',async()=>{
 f.outcome='ready';const result=await replyWhatsappConversation(input);expect(result).toMatchObject({ok:false,code:'SAVE_FAILED',clientOpId:input.clientOpId});expect(result).not.toHaveProperty('notAttempted',true);
 expect(f.native.mock.invocationCallOrder[0]).toBeLessThan(f.grant.mock.invocationCallOrder[0]);expect(f.send).not.toHaveBeenCalled();
});
