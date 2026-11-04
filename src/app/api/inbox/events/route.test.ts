import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({bound:vi.fn(),access:vi.fn(),stream:vi.fn(),rpc:vi.fn(),setAuth:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createBrokerBoundClient:m.bound}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:m.access}));
vi.mock('@/lib/tenancy/branch-inbox-events',()=>({branchInboxEventStream:m.stream}));
import {GET} from './route';
const companyId='11111111-1111-4111-8111-111111111111',actorId='22222222-2222-4222-8222-222222222222';
const url=`https://velora.test/api/inbox/events?${new URLSearchParams({companyId,actorId})}`;
const bound=(fingerprint='same',userId=actorId)=>({bound:{ok:true,client:{rpc:m.rpc,realtime:{setAuth:m.setAuth}},resolve:{accessToken:'SERVER_ONLY',boundary:{userId,boundaryFingerprint:fingerprint}}}});
beforeEach(()=>{vi.resetAllMocks();m.access.mockResolvedValue({ok:true,context:{userId:actorId,company:{id:companyId}}});m.bound.mockResolvedValue(bound());m.rpc.mockResolvedValue({data:true,error:null});m.stream.mockReturnValue(new Response('safe'));});
it('uses only the authenticated token and scopes metadata to current company and granted channels',async()=>{
 m.rpc.mockImplementation(async(_name,args)=>({data:args.p_capability==='wa.conversations.read',error:null}));
 const response=await GET(new Request(url));expect(response.status).toBe(200);expect(await response.text()).not.toContain('SERVER_ONLY');
 expect(m.setAuth).toHaveBeenCalledWith('SERVER_ONLY');expect(m.stream.mock.calls[0][0].scope).toEqual({companyId,channels:['whatsapp']});
});
it('rejects malformed, duplicate, cross-origin and foreign actor or company scopes',async()=>{
 for(const request of [new Request(url+'&actorId='+actorId),new Request(url.replace(companyId,'bad')),new Request(url,{headers:{origin:'https://foreign.test'}})])expect((await GET(request)).status).toBeGreaterThanOrEqual(400);
 expect(m.bound).not.toHaveBeenCalled();m.access.mockResolvedValue({ok:true,context:{userId:companyId,company:{id:companyId}}});expect((await GET(new Request(url))).status).toBe(403);
 m.access.mockResolvedValue({ok:true,context:{userId:actorId,company:{id:actorId}}});expect((await GET(new Request(url))).status).toBe(403);expect(m.stream).not.toHaveBeenCalled();
});
it('denies a broker actor mismatch and missing read authority',async()=>{
 m.bound.mockResolvedValue(bound('same',companyId));expect((await GET(new Request(url))).status).toBe(403);
 m.bound.mockResolvedValue(bound());m.rpc.mockResolvedValue({data:false,error:null});expect((await GET(new Request(url))).status).toBe(403);expect(m.stream).not.toHaveBeenCalled();
});
it('rechecks fresh boundaries and every initially granted channel before signals',async()=>{
 await GET(new Request(url));const authorize=m.stream.mock.calls[0][0].authorize;
 expect(await authorize()).toBe(true);m.bound.mockResolvedValue(bound('different'));expect(await authorize()).toBe(false);
 m.bound.mockResolvedValue(bound());m.rpc.mockImplementation(async(_name,args)=>({data:args.p_capability==='wa.conversations.read',error:null}));expect(await authorize()).toBe(false);
 m.bound.mockResolvedValue({bound:{ok:false,code:'UNAVAILABLE'}});await expect(authorize()).rejects.toThrow('INBOX_WATCH_UNAVAILABLE');expect(m.bound.mock.calls.every(call=>call[0]?.fresh===true)).toBe(true);
});
it('fails closed on upstream errors without revealing details',async()=>{
 m.rpc.mockResolvedValue({data:true,error:{message:'SECRET_DETAIL'}});const response=await GET(new Request(url));expect(response.status).toBe(503);expect(await response.text()).not.toContain('SECRET_DETAIL');expect(m.stream).not.toHaveBeenCalled();
});
it('logs only a fixed failure stage and status for diagnostics',async()=>{
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{m.rpc.mockResolvedValue({data:null,error:{message:'SECRET_DETAIL'}});expect((await GET(new Request(url))).status).toBe(503);expect(warning).toHaveBeenCalledWith('inbox_event_refused',{status:503,stage:'capabilities'});expect(JSON.stringify(warning.mock.calls)).not.toContain('SECRET_DETAIL');expect(JSON.stringify(warning.mock.calls)).not.toContain(companyId);expect(JSON.stringify(warning.mock.calls)).not.toContain(actorId);}finally{warning.mockRestore();}
});

it('subtracts slow broker/access setup from the SSE lifetime',async()=>{
 const now=vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValue(25000);
 try{await GET(new Request(url));expect(m.stream.mock.calls[0][0].lifetimeMs).toBe(25000);}finally{now.mockRestore();}
});
it('does not start a stream after the safe request budget is exhausted',async()=>{
 const now=vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValue(50000);
 try{expect((await GET(new Request(url))).status).toBe(503);expect(m.stream).not.toHaveBeenCalled();}finally{now.mockRestore();}
});
