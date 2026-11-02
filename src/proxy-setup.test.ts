import {NextRequest,NextResponse} from 'next/server';
import {beforeEach,expect,it,vi} from 'vitest';
const update=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/supabase/middleware',()=>({updateSession:update}));
import {proxy} from './proxy';
beforeEach(()=>{update.mockReset();update.mockImplementation(async(request:NextRequest)=>({response:NextResponse.next({request}),session:'authenticated'}));});
it.each(['GET','HEAD'])('serves public setup %s without waiting for session I/O',async method=>{
 update.mockReturnValue(new Promise(()=>{}));
 const request=new NextRequest('https://velora.test/setup?next=%2Faccount',{method,headers:{'x-velora-return-path':'/admin'}});
 expect((await proxy(request)).status).toBe(200);
 expect(update).not.toHaveBeenCalled();expect(request.headers.get('x-velora-return-path')).toBe('/setup?next=%2Faccount');
});
it.each([['POST','/setup'],['GET','/setup/branches'],['GET','/setup/branches/10000000-0000-4000-8000-000000000001/whatsapp'],['GET','/account'],['GET','/app']])('retains native guard for %s %s',async(method,path)=>{
 const request=new NextRequest(`https://velora.test${path}`,{method,headers:{'x-velora-return-path':'/setup'}});
 await proxy(request);expect(update).toHaveBeenCalledExactlyOnceWith(request);
 expect(request.headers.get('x-velora-return-path')).toBe(path);
});
it('keeps server action posts closed when native access is unavailable',async()=>{
 update.mockResolvedValue({response:NextResponse.next(),session:'unavailable'});
 const response=await proxy(new NextRequest('https://velora.test/setup',{method:'POST',headers:{'next-action':'untrusted'}}));
 expect(response.status).toBe(307);expect(response.headers.get('location')).toBe('https://velora.test/access?code=UNAVAILABLE');
});
