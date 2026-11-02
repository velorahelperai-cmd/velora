import {beforeEach, expect, it, vi} from 'vitest';
vi.mock('server-only',()=>({}));
const s=vi.hoisted(()=>({resolve:vi.fn(),cookies:[{name:'opaque',value:'A'}],duringRead:async()=>{},clients:[] as unknown[]}));
vi.mock('react',()=>({cache:(fn:unknown)=>fn}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>s.cookies})}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/auth/broker',()=>({createBrokerUserClient:s.resolve}));
vi.mock('@/lib/auth/broker/provider',()=>({createProviderAuthClient:()=>{throw Error('unexpected guest fallback');}}));
vi.mock('@/lib/tenancy/access',async()=>({
 ...await vi.importActual<typeof import('./access')>('./access'),
 getCompanyAccess:async()=>{
  const {createClient}=await import('@/lib/supabase/server');
  const client=await createClient();s.clients.push(client);
  await s.duringRead();
  return {ok:true,context:{userId:'actor',email:'actor@synthetic.invalid',phone:'',fullName:'Saved name',supportCode:'SYNTHETIC',needsProfileName:false,emailConfirmed:true,identityVerified:true,isPlatformAdmin:false,company:null,membership:null,needsCompanyContext:false,workspaceChoices:[]}};
 },
}));
import {getAccountProfile} from './actions';
import {readAttestedAccountProfile} from './account-profile-read';
import {readAccountSession} from '@/lib/auth/account-session-read';
const boundary={boundaryFingerprint:'fingerprint',userId:'actor',nativeSessionId:'sid',cookieName:'opaque',generation:'generation',authOrdinal:1,contextGeneration:1,browserLineageId:'lineage'};
const client=()=>({
 auth:{getUser:vi.fn(async()=>({data:{user:{id:'actor',email:'actor@synthetic.invalid',email_confirmed_at:'confirmed',user_metadata:{full_name:'Name'}}},error:null}))},
 rpc:vi.fn(async()=>({data:{ok:true,expires_at:'2099-01-01T00:00:00Z'},error:null})),
 from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),
});
const bound=(change={})=>({ok:true,client:client(),resolve:{registryId:'registry',boundary:{...boundary,...change}}});
beforeEach(()=>{vi.clearAllMocks();s.clients=[];s.cookies=[{name:'opaque',value:'A'}];s.duringRead=async()=>{};s.resolve.mockImplementation(async()=>bound());});
it('composes the actual profile action and identity reader with only initial and final broker resolutions',async()=>{
 const result=await getAccountProfile();
 expect(result).toMatchObject({ok:true,data:{userId:'actor',fullName:'Saved name'}});
 expect(s.resolve).toHaveBeenCalledTimes(2);
 expect(s.clients[0]).toBe((await s.resolve.mock.results[0].value).client);
});
it.each(['UNAUTHENTICATED','UNAVAILABLE'])('preserves initial broker failure %s',async code=>{
 s.resolve.mockResolvedValue({ok:false,code});expect(await getAccountProfile()).toEqual({ok:false,code});expect(s.clients).toHaveLength(0);
});
it.each(['UNAUTHENTICATED','UNAVAILABLE'])('discards the profile after final broker failure %s',async code=>{
 s.resolve.mockResolvedValueOnce(bound()).mockResolvedValueOnce({ok:false,code});
 expect(await getAccountProfile()).toEqual({ok:false,code});
});
it.each(Object.keys(boundary))('rejects a changed final %s',async field=>{
 s.resolve.mockResolvedValueOnce(bound()).mockResolvedValueOnce(bound({[field]:'changed'}));
 expect(await getAccountProfile()).toMatchObject({ok:false});
});
it('fails closed when final broker resolution throws',async()=>{
 s.resolve.mockResolvedValueOnce(bound()).mockRejectedValueOnce(Error('synthetic outage'));
 expect(await getAccountProfile()).toEqual({ok:false,code:'UNAVAILABLE'});
});
it('discards a cookie switch during the profile read',async()=>{
 s.duringRead=async()=>{s.cookies=[{name:'opaque',value:'B'}];};
 expect(await getAccountProfile()).toMatchObject({ok:false});
});
const expected={userId:'actor',boundaryFingerprint:'fingerprint',generation:'generation'};
it('independent session GET preserves native user, idle, and two broker checks without profile reads',async()=>{
 const initial=bound();s.resolve.mockResolvedValueOnce(initial).mockResolvedValueOnce(bound());
 expect(await readAccountSession()).toEqual({ok:true,...expected,nativeSessionId:'sid',contextGeneration:1});
 expect(initial.client.auth.getUser).toHaveBeenCalledOnce();expect(initial.client.rpc).toHaveBeenCalledExactlyOnceWith('check_app_session',{p_touch:false});expect(s.resolve).toHaveBeenCalledTimes(2);expect(s.clients).toHaveLength(0);
});
it.each(['SESSION_EXPIRED','UNAUTHENTICATED'])('session GET rejects native %s',async code=>{
 const initial=bound();initial.client.rpc.mockResolvedValue({data:{ok:false,code},error:null} as never);s.resolve.mockResolvedValueOnce(initial).mockResolvedValueOnce(bound());
 expect(await readAccountSession()).toEqual({ok:false,code:'UNAUTHENTICATED'});
});
it.each(Object.keys(boundary))('session GET rejects final %s drift',async field=>{
 s.resolve.mockResolvedValueOnce(bound()).mockResolvedValueOnce(bound({[field]:'changed'}));expect(await readAccountSession()).toEqual({ok:false,code:'CONFLICT'});
});
it('session GET rejects cookie switching during native identity validation',async()=>{
 const initial=bound();initial.client.auth.getUser.mockImplementation(async()=>{s.cookies=[{name:'opaque',value:'B'}];return {data:{user:{id:'actor',email:'actor@synthetic.invalid',email_confirmed_at:'confirmed',user_metadata:{full_name:'Name'}}},error:null};});s.resolve.mockResolvedValueOnce(initial);
 expect(await readAccountSession()).toEqual({ok:false,code:'CONFLICT'});
});
it('session GET rejects a native user differing from the broker actor',async()=>{
 const initial=bound();initial.client.auth.getUser.mockResolvedValue({data:{user:{id:'other'}},error:null} as never);s.resolve.mockResolvedValueOnce(initial).mockResolvedValueOnce(bound());
 expect(await readAccountSession()).toEqual({ok:false,code:'UNAUTHENTICATED'});
});
it('attests the GET after the final native session and broker checks',async()=>{
 const initial=bound();s.resolve.mockResolvedValueOnce(initial).mockResolvedValueOnce(bound());
 expect(await readAttestedAccountProfile(expected)).toMatchObject({ok:true,data:{userId:'actor'},attestation:{...expected,ok:true,nativeSessionId:'sid',contextGeneration:1}});
 expect(initial.client.rpc.mock.calls).toHaveLength(2);
 expect(s.resolve).toHaveBeenCalledTimes(2);
});
it.each(['userId','boundaryFingerprint','generation'])('rejects wrong expected %s before private profile reads',async field=>{
 expect(await readAttestedAccountProfile({...expected,[field]:'other'})).toEqual({ok:false,code:'CONFLICT'});
 expect(s.clients).toHaveLength(0);
});
it('discards the GET profile when the native session expires during profile reads',async()=>{
 const initial=bound();s.resolve.mockResolvedValueOnce(initial).mockResolvedValueOnce(bound());
 s.duringRead=async()=>{initial.client.rpc.mockResolvedValue({data:{ok:false,code:'SESSION_EXPIRED'},error:null} as never);};
 expect(await readAttestedAccountProfile(expected)).toEqual({ok:false,code:'UNAUTHENTICATED',sessionExpired:true});
});
it('does not mistake a switched cookie for a logout of the new account',async()=>{
 s.duringRead=async()=>{s.cookies=[{name:'opaque',value:'B'}];};
 expect(await readAttestedAccountProfile(expected)).toEqual({ok:false,code:'CONFLICT'});
});
it.each(Object.keys(boundary))('withholds GET data after final %s drift',async field=>{
 s.resolve.mockResolvedValueOnce(bound()).mockResolvedValueOnce(bound({[field]:'changed'}));
 expect(await readAttestedAccountProfile(expected)).toEqual({ok:false,code:'CONFLICT'});
});
