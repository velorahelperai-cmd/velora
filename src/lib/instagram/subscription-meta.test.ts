import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({config:vi.fn()}));vi.mock('./config',()=>({instagramConfig:f.config}));
import {subscribeInstagramMessages} from './subscription-meta';
const input={accountId:'178414000000001',accessToken:'synthetic-user-token'};
beforeEach(()=>f.config.mockReturnValue({connectEnabled:true,graphVersion:'v26.0'}));
it('makes one exact reviewed messages subscription POST',async()=>{
 const http=vi.fn(async()=>new Response('{"success":true}'));
 expect(await subscribeInstagramMessages(input,{fetch:http})).toBe('verified');expect(http).toHaveBeenCalledTimes(1);
 const [url,init]=http.mock.calls[0] as unknown as [string,RequestInit];const u=new URL(url);
 expect(u.origin).toBe('https://graph.instagram.com');expect(u.pathname).toBe('/v26.0/'+input.accountId+'/subscribed_apps');
 expect([...u.searchParams.keys()].sort()).toEqual(['access_token','subscribed_fields']);expect(u.searchParams.get('subscribed_fields')).toBe('messages');expect(u.searchParams.get('access_token')).toBe(input.accessToken);
 expect(init).toMatchObject({method:'POST',redirect:'error',cache:'no-store',credentials:'omit'});
});
it.each(['{"success":"true"}','{"success":false}','{"success":true,"unexpected":1}','[]','{}','not-json'])('does not invent success from %s',async body=>{
 const http=vi.fn(async()=>new Response(body));expect(await subscribeInstagramMessages(input,{fetch:http})).toBe('unknown');expect(http).toHaveBeenCalledTimes(1);
});
it('timeouts remain unknown and never retry',async()=>{const http=vi.fn(async()=>{throw Error(input.accessToken);});expect(await subscribeInstagramMessages(input,{fetch:http})).toBe('unknown');expect(http).toHaveBeenCalledTimes(1);});
it('definite graph rejection is bounded and carries no diagnostics',async()=>{const http=vi.fn(async()=>new Response(JSON.stringify({error:{code:190,message:input.accessToken}}),{status:400}));expect(await subscribeInstagramMessages(input,{fetch:http})).toBe('rejected');});
it('closed rollout causes no HTTP',async()=>{f.config.mockReturnValue({connectEnabled:false,graphVersion:'v26.0'});const http=vi.fn();expect(await subscribeInstagramMessages(input,{fetch:http})).toBe('unknown');expect(http).not.toHaveBeenCalled();});
