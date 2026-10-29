import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({bound:vi.fn(),stream:vi.fn(),rpc:vi.fn(),setAuth:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createBrokerBoundClient:m.bound}));
vi.mock('@/lib/tenancy/branch-inbox-events',async original=>({...await original<typeof import('@/lib/tenancy/branch-inbox-events')>(),branchInboxEventStream:m.stream}));
import {GET} from './route';
const company='10000000-0000-4000-8000-000000000021',branch='10000000-0000-4000-8000-000000000031';
const url=`https://www.velorahelper.com/api/branch/inbox-events?company=${company}&branch=${branch}&channel=whatsapp`;
const bound=(fingerprint='original')=>({bound:{ok:true,client:{rpc:m.rpc,realtime:{setAuth:m.setAuth}},resolve:{accessToken:'SERVER_ONLY_TOKEN',boundary:{boundaryFingerprint:fingerprint}}}});
beforeEach(()=>{vi.clearAllMocks();m.bound.mockResolvedValue(bound());m.rpc.mockResolvedValue({data:true,error:null});m.stream.mockReturnValue(new Response('safe'));});
it('rejects invalid and cross-origin requests before accessing credentials',async()=>{
 expect((await GET(new Request(url.replace(branch,'bad')))).status).toBe(400);
 expect((await GET(new Request(url,{headers:{origin:'https://evil.invalid'}}))).status).toBe(403);
 expect((await GET(new Request(url,{headers:{'sec-fetch-site':'cross-site'}}))).status).toBe(403);
 expect(m.bound).not.toHaveBeenCalled();
});
it('denies anonymous, revoked and unavailable sessions and false/RPC-error branch authorization',async()=>{
 for(const [code,status] of [['UNAUTHENTICATED',401],['UNAVAILABLE',503]] as const){m.bound.mockResolvedValue({bound:{ok:false,code}});expect((await GET(new Request(url))).status).toBe(status);}
 m.bound.mockResolvedValue(bound());
 for(const result of [{data:false,error:null},{data:true,error:{message:'INTERNAL_SECRET'}}]){m.rpc.mockResolvedValue(result);const r=await GET(new Request(url));expect(r.status).toBe(result.error?503:403);expect(await r.text()).not.toContain('INTERNAL_SECRET');}
 expect(m.stream).not.toHaveBeenCalled();
});
it('keeps the token server-only and checks the fresh boundary and exact branch for every signal',async()=>{
 expect((await GET(new Request(url))).status).toBe(200);
 expect(m.setAuth).toHaveBeenCalledWith('SERVER_ONLY_TOKEN');
 expect(m.rpc).toHaveBeenCalledWith('es02_can_watch_branch_inbox',{cid:company,bid:branch,ch:'whatsapp'});
 const args=m.stream.mock.calls[0][0];expect(args.scope).toEqual({companyId:company,branchId:branch,channel:'whatsapp'});
 expect(await args.authorize()).toBe(true);
 m.bound.mockResolvedValue(bound('different-session'));expect(await args.authorize()).toBe(false);
 m.bound.mockResolvedValue(bound());m.rpc.mockResolvedValue({data:false,error:null});expect(await args.authorize()).toBe(false);
 m.bound.mockResolvedValue({bound:{ok:false,code:'UNAVAILABLE'}});await expect(args.authorize()).rejects.toThrow('BRANCH_WATCH_UNAVAILABLE');
 expect(m.bound.mock.calls.every(c=>c[0]?.fresh===true)).toBe(true);
});
