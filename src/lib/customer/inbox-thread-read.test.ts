import {afterEach,expect,it,vi} from 'vitest';
import {fetchInboxThread} from './inbox-thread-read';
afterEach(()=>vi.unstubAllGlobals());
it('uses independent private GET and fences the returned company and conversation',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({ok:true,data:{companyId:'company',conversationId:'thread'}})).mockResolvedValueOnce(Response.json({ok:true,data:{companyId:'other',conversationId:'thread'}}));vi.stubGlobal('fetch',fetch);
 expect((await fetchInboxThread({companyId:'company',conversationId:'thread'})).ok).toBe(true);
 expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'same-origin',cache:'no-store'});
 expect(await fetchInboxThread({companyId:'company',conversationId:'thread'})).toEqual({ok:false,code:'SCOPE_CHANGED'});
});
it('fails closed on network errors, denied responses and malformed bodies',async()=>{
 const fetch=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(new Response('',{status:403})).mockResolvedValueOnce(Response.json({}));vi.stubGlobal('fetch',fetch);
 expect(await fetchInboxThread({companyId:'c',conversationId:'t'})).toEqual({ok:false,code:'UNAVAILABLE',transportUnavailable:true});
 for(const code of ['FORBIDDEN','UNAVAILABLE'])expect(await fetchInboxThread({companyId:'c',conversationId:'t'})).toEqual({ok:false,code});
});

it('classifies platform timeouts as transport loss while forged body flags stay unclassified',async()=>{
 for(const status of [503,504,408]){
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status})));
  expect(await fetchInboxThread({companyId:'c',conversationId:'t'})).toEqual({ok:false,code:'UNAVAILABLE',transportUnavailable:true});
 }
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ok:false,code:'UNAVAILABLE',transportUnavailable:true})));
 expect(await fetchInboxThread({companyId:'c',conversationId:'t'})).toEqual({ok:false,code:'UNAVAILABLE'});
});
