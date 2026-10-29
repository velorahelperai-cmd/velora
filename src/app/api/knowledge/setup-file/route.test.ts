import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({access:vi.fn(),download:vi.fn(),client:vi.fn()}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:mock.access}));
vi.mock('@/lib/tenancy/setup-file-server',()=>({downloadSetupFile:mock.download}));
vi.mock('@/lib/supabase/server',()=>({createClient:mock.client}));
import {GET} from './route';
beforeEach(()=>vi.resetAllMocks());
it.each([['UNAUTHENTICATED',401],['FORBIDDEN',403],['UNAVAILABLE',503]])('returns the correct denial for %s',async(code,status)=>{
 mock.access.mockResolvedValue({ok:false,code});
 expect((await GET(new Request('https://example.test/api/knowledge/setup-file'))).status).toBe(status);
 expect(mock.download).not.toHaveBeenCalled();expect(mock.client).not.toHaveBeenCalled();
});
it('rejects a foreign company before storage access',async()=>{
 mock.access.mockResolvedValue({ok:true,context:{userId:'owner',company:{id:'own'}}});
 expect((await GET(new Request('https://example.test/api/knowledge/setup-file?companyId=foreign&sourceId=source'))).status).toBe(403);
 expect(mock.download).not.toHaveBeenCalled();
});
it('sanitizes unavailable authority and permits an authorized download',async()=>{
 mock.access.mockRejectedValueOnce(Error('private internal detail'));
 const denied=await GET(new Request('https://example.test/api/knowledge/setup-file'));
 expect(denied.status).toBe(503);expect(await denied.text()).toBe('');
 mock.access.mockResolvedValue({ok:true,context:{userId:'owner',company:{id:'own'}}});
 mock.download.mockResolvedValue({bytes:new Uint8Array([65]),binding:{fileName:'test.txt'}});
 const result=await GET(new Request('https://example.test/api/knowledge/setup-file?companyId=own&sourceId=source'));
 expect(result.status).toBe(200);expect(await result.text()).toBe('A');expect(result.headers.get('cache-control')).toContain('no-store');
});
