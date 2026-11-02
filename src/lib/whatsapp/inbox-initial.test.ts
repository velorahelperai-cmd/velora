import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({access:vi.fn(),scope:vi.fn(),cap:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:s.access}));
vi.mock('@/lib/access/conversation-scope',()=>({readSessionConversationScope:s.scope}));
vi.mock('@/lib/access/actions',()=>({sessionHasCompanyCapability:s.cap,sessionConversationScope:s.scope}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:s.rpc,from:s.from})}));
// Keep the native page reader real: tests cover its gates and final composition.
import {loadWhatsappInboxInitialPage} from './inbox';
const company='11111111-1111-4111-8111-111111111111';
const access={ok:true,context:{company:{id:company},membership:{role:'owner'}}};
beforeEach(()=>{
 vi.resetAllMocks();s.access.mockResolvedValue(access);s.scope.mockResolvedValue({ok:true,scope:'all_company'});
 s.cap.mockImplementation(async(_:string,c:string)=>c==='wa.conversations.read');
 s.rpc.mockResolvedValue({data:{ok:true,company_id:company,conversation_scope:'all_company',conversations:[],has_more:true,next_cursor:'99',total:80,unread_total:3,intervention_total:2,membership_fingerprint:'7a78f383d95b3f8842dfd95eb6efb4b5'},error:null});
 s.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:{timezone:'Asia/Muscat'},error:null})})})});
});
afterEach(()=>vi.restoreAllMocks());
describe('initial inbox native composition',()=>{
 it('loads a bounded page with one initial gate and one final gate',async()=>{
  const r=await loadWhatsappInboxInitialPage();expect(r.ok).toBe(true);if(!r.ok)return;
  expect(r.page).toMatchObject({kind:'partial',total:80,hasMore:true});expect(r.meta.counts.all).toBe(0);
  expect(s.rpc).toHaveBeenCalledExactlyOnceWith('whatsapp_inbox_page',{p_company_id:company,p_limit:40,p_before:null});
  expect(s.access).toHaveBeenCalledTimes(2);expect(s.scope).toHaveBeenCalledTimes(2);
  expect(s.cap.mock.calls.filter(call=>call[1]==='wa.conversations.read')).toHaveLength(2);
  expect(r.meta).toMatchObject({canReply:false,canAssign:false,canTakeOver:false,canResume:false,canClose:false});
 });
 it.each([false,null])('does not fetch rows for unconfirmed capability %s',async value=>{
  s.cap.mockResolvedValue(value);expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'UNAVAILABLE'});expect(s.rpc).not.toHaveBeenCalled();
 });
 it.each(['FORBIDDEN','UNAVAILABLE'])('preserves missing scope %s before data or capability reads',async code=>{
  s.scope.mockResolvedValue({ok:false,code});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code});expect(s.cap).not.toHaveBeenCalled();expect(s.rpc).not.toHaveBeenCalled();
 });
 it('requires operational membership',async()=>{
  s.access.mockResolvedValue({ok:true,context:{company:{id:company},membership:null}});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'NO_COMPANY'});expect(s.rpc).not.toHaveBeenCalled();
 });
 it('preserves native RPC denial without metadata queries',async()=>{
  s.rpc.mockResolvedValue({data:{ok:false,code:'forbidden'},error:null});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'FORBIDDEN'});expect(s.from).not.toHaveBeenCalled();
 });
 it('rejects foreign company responses',async()=>{
  s.rpc.mockResolvedValue({data:{ok:true,company_id:'other'},error:null});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'UNAVAILABLE'});expect(s.from).not.toHaveBeenCalled();
 });
 it('discards rows after company switch',async()=>{
  s.access.mockResolvedValueOnce(access).mockResolvedValueOnce({ok:true,context:{company:{id:'other'},membership:{role:'owner'}}});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'UNAVAILABLE'});
 });
 it.each(['UNAVAILABLE','UNAUTHENTICATED'])('discards rows after final session failure %s',async code=>{
  s.access.mockResolvedValueOnce(access).mockResolvedValueOnce({ok:false,code});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'UNAVAILABLE'});
 });
 it('discards rows after scope revocation',async()=>{
  s.scope.mockResolvedValueOnce({ok:true,scope:'all_company'}).mockResolvedValueOnce({ok:false,code:'FORBIDDEN'});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'FORBIDDEN'});
 });
 it('discards rows after scope narrowing',async()=>{
  s.scope.mockResolvedValueOnce({ok:true,scope:'all_company'}).mockResolvedValueOnce({ok:true,scope:'assigned_only'});expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'UNAVAILABLE'});
 });
 it('discards rows after read capability revocation',async()=>{
  let reads=0;s.cap.mockImplementation(async(_:string,c:string)=>c==='wa.conversations.read'&&++reads===1);expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'UNAVAILABLE'});
 });
 it('reports sanitized timezone failure',async()=>{
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  s.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:{code:'42703',message:'PRIVATE',details:company}})})})});
  expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'UNAVAILABLE'});
  expect(log).toHaveBeenCalledWith('whatsapp.inbox_read_failed',{stage:'initial_timezone',code:'QUERY_ERROR',error_code:'42703'});
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');expect(JSON.stringify(log.mock.calls)).not.toContain(company);
 });
 it('fails closed when assignees throw with a distinct stage',async()=>{
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});s.cap.mockResolvedValue(true);
  s.from.mockImplementation((table:string)=>table==='companies'?{select:()=>({eq:()=>({maybeSingle:async()=>({data:{timezone:'Asia/Muscat'},error:null})})})}:{select:()=>({eq:()=>({eq:()=>({in:()=>({order:async()=>{throw new Error('PRIVATE');}})})})})});
  expect(await loadWhatsappInboxInitialPage()).toEqual({ok:false,code:'UNAVAILABLE'});
  expect(log).toHaveBeenCalledWith('whatsapp.inbox_read_failed',{stage:'initial_assignees',code:'EXCEPTION',error_code:'OTHER'});
 });
});
