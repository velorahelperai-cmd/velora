import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({broker:vi.fn(),thread:vi.fn(),scope:vi.fn(),cap:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[{name:'opaque',value:'fixture'}]})}));
vi.mock('@/lib/auth/broker',()=>({createBrokerUserClient:m.broker}));
vi.mock('@/lib/tenancy/access',()=>({runWithVerifiedCompanyRead:async<T,>(work:()=>Promise<T>)=>work()}));
vi.mock('@/lib/whatsapp/inbox-contracts',()=>({loadWhatsappThreadPage:m.thread}));
vi.mock('@/lib/access/conversation-scope',()=>({readSessionConversationScope:m.scope}));
vi.mock('@/lib/access/inbox-capability',()=>({readInboxCapability:m.cap}));
import {GET} from './route';
const companyId='11111111-1111-4111-8111-111111111111',conversationId='22222222-2222-4222-8222-222222222222';
const url=`https://velora.test/api/inbox/thread?${new URLSearchParams({companyId,conversationId})}`;
const bound=()=>({ok:true,client:{},resolve:{registryId:'registry',boundary:{userId:'actor',boundaryFingerprint:'same',generation:'same'}}});
beforeEach(()=>{vi.resetAllMocks();m.broker.mockImplementation(async()=>bound());m.scope.mockResolvedValue({ok:true,scope:'all_company'});m.cap.mockResolvedValue({ok:true,allowed:true});m.thread.mockResolvedValue({ok:true,data:{companyId,conversationId,messages:['private']}});});
it('uses native authorized reader and final broker fence with no-store responses',async()=>{
 const response=await GET(new Request(url));expect((await response.json()).ok).toBe(true);
 expect(m.thread).toHaveBeenCalledWith({companyId,conversationId,before:null,limit:undefined});expect(m.broker).toHaveBeenCalledTimes(2);
 expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
});
it('rejects malformed/ambiguous input and cross-origin before reading',async()=>{
 for(const request of [new Request(url+'&before=-1'),new Request(url+'&limit=0'),new Request(url+'&companyId='+companyId),new Request(url,{headers:{origin:'https://foreign.test'}})])expect((await GET(request)).status).toBeGreaterThanOrEqual(400);
 expect(m.thread).not.toHaveBeenCalled();expect(m.broker).not.toHaveBeenCalled();
});
it.each([{ok:false,code:'FORBIDDEN'},{ok:false,code:'UNAVAILABLE'},{ok:true,allowed:false}])('withholds rows after final capability failure %j',async cap=>{
 m.cap.mockResolvedValue(cap);const text=await (await GET(new Request(url))).text();expect(text).not.toContain('private');expect(JSON.parse(text).ok).toBe(false);
});
it('withholds rows after scope or payload identity changes',async()=>{
 m.scope.mockResolvedValueOnce({ok:true,scope:'all_company'}).mockResolvedValueOnce({ok:true,scope:'assigned_only'});
 expect(await (await GET(new Request(url))).json()).toEqual({ok:false,code:'SCOPE_CHANGED'});
 m.scope.mockResolvedValue({ok:true,scope:'all_company'});m.thread.mockResolvedValue({ok:true,data:{companyId:conversationId,conversationId,messages:['private']}});
 expect(await (await GET(new Request(url))).json()).toEqual({ok:false,code:'SCOPE_CHANGED'});
});
it('withholds rows when the final live session is revoked',async()=>{
 m.broker.mockResolvedValueOnce(bound()).mockResolvedValueOnce({ok:false,code:'UNAUTHENTICATED'});
 const response=await GET(new Request(url));expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,code:'UNAVAILABLE'});
});
it('returns native denial and hides internal exceptions',async()=>{
 m.thread.mockResolvedValue({ok:false,code:'FORBIDDEN'});expect(await (await GET(new Request(url))).json()).toEqual({ok:false,code:'FORBIDDEN'});
 m.thread.mockRejectedValue(Error('private detail'));expect(await (await GET(new Request(url))).text()).not.toContain('private');
});

it('withholds assigned-only content when the conversation is unassigned during the read',async()=>{
 m.scope.mockResolvedValue({ok:true,scope:'assigned_only'});
 m.thread.mockResolvedValueOnce({ok:true,data:{companyId,conversationId,messages:['private']}}).mockResolvedValueOnce({ok:false,code:'NOT_FOUND'});
 const response=await GET(new Request(url));expect(await response.json()).toEqual({ok:false,code:'NOT_FOUND'});expect(m.thread).toHaveBeenCalledTimes(2);
});

it('rechecks capability after the final assigned-only row read',async()=>{
 m.scope.mockResolvedValue({ok:true,scope:'assigned_only'});
 m.thread.mockImplementationOnce(async()=>({ok:true,data:{companyId,conversationId,messages:['private']}})).mockImplementationOnce(async()=>{m.cap.mockResolvedValue({ok:true,allowed:false});return {ok:true,data:{companyId,conversationId,messages:['private']}};});
 const result=await (await GET(new Request(url))).json();expect(result).toEqual({ok:false,code:'FORBIDDEN'});
});
