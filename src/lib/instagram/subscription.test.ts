import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const scope=vi.hoisted(()=>vi.fn());vi.mock('./connect-scope',()=>({instagramOwnerConnectScope:scope}));
vi.mock('./config',()=>({instagramConfig:()=>({connectEnabled:true,graphVersion:'v26.0'})}));
import {ensureInstagramSubscription} from './subscription';
const id=(n:number)=>`abcdefab-0000-4000-8000-${String(n).padStart(12,'0')}`;
const binding={companyId:id(1),userId:id(11),sessionId:id(21),attemptId:id(31),generation:1,appId:'1000',contractId:'reviewed-instagram-login-v26'};
const receipt=id(51),claimReceipt=id(61),token='synthetic-staged-token';
const checkpoint=(state:string)=>({binding,stageReceipt:receipt,accountId:'100',fields:['messages'],state});
const fresh=()=>({...checkpoint('claimed'),kind:'claimed',committed:true,claimReceipt,accessToken:token,notAfter:new Date(Date.now()+10000).toISOString()});
const transport=vi.fn();beforeEach(()=>{vi.clearAllMocks();scope.mockReturnValue(true);transport.mockResolvedValue('verified');});
function fixture(initial='unstarted'){
 let state=initial;const events:string[]=[];
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  events.push(name);
  if(name==='instagram_claim_subscription'){if(state!=='unstarted')return {error:null,data:{...checkpoint(state),kind:'existing'}};state='claimed';return {error:null,data:fresh()};}
  if(name==='instagram_settle_subscription'){if(state==='claimed')state=String(args.p_outcome);return {error:null,data:checkpoint(state)};}
  return {error:null,data:checkpoint(state)};
 });
 return {server:{rpc},rpc,events,state:()=>state,set:(value:string)=>{state=value;}};
}
const run=(f:ReturnType<typeof fixture>)=>ensureInstagramSubscription(binding,receipt,f.server,{transport});
it('commits the claim before its sole provider call then persists exact success',async()=>{
 const f=fixture();transport.mockImplementation(async()=>{expect(f.state()).toBe('claimed');return 'verified';});
 expect(await run(f)).toEqual({ok:true});expect(f.events).toEqual(['instagram_claim_subscription','instagram_settle_subscription']);expect(transport).toHaveBeenCalledTimes(1);
 expect(transport).toHaveBeenCalledWith({accountId:'100',accessToken:token});expect(f.rpc.mock.calls[1][1]).toMatchObject({p_binding:binding,p_stage_receipt:receipt,p_claim_receipt:claimReceipt,p_outcome:'verified'});
});
it.each(['claimed','unknown','rejected'])('existing %s never POSTs again',async state=>{const f=fixture(state);const r=await run(f);expect(r.ok).toBe(false);expect(transport).not.toHaveBeenCalled();});
it('lost claim response reads durable state without provider execution',async()=>{
 const f=fixture();const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation(async(name,args)=>{if(name==='instagram_claim_subscription'){f.set('claimed');throw Error(token);}return original(name,args);});
 expect(await run(f)).toEqual({ok:false,code:'RECONCILIATION_REQUIRED'});expect(f.events).toEqual(['instagram_read_subscription']);expect(transport).not.toHaveBeenCalled();
});
it('lost verified settlement response recovers only the persisted checkpoint',async()=>{
 const f=fixture();const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation(async(name,args)=>{const value=await original(name,args);if(name==='instagram_settle_subscription')throw Error(token);return value;});
 expect(await run(f)).toEqual({ok:true});expect(f.events).toEqual(['instagram_claim_subscription','instagram_settle_subscription','instagram_read_subscription']);expect(transport).toHaveBeenCalledTimes(1);
});
it('provider throw records unknown and subsequent replay cannot retry',async()=>{const f=fixture();transport.mockRejectedValue(Error(token));expect((await run(f)).ok).toBe(false);expect(f.state()).toBe('unknown');expect((await run(f)).ok).toBe(false);expect(transport).toHaveBeenCalledTimes(1);});
it('cross-generation claim proof does not reach provider or settlement',async()=>{const f=fixture();f.rpc.mockResolvedValue({error:null,data:{...fresh(),binding:{...binding,generation:2}}});expect((await run(f)).ok).toBe(false);expect(transport).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1);});
it('expired dispatch deadline creates no provider request',async()=>{const f=fixture();expect((await ensureInstagramSubscription(binding,receipt,f.server,{transport,now:()=>Date.now()+60000})).ok).toBe(false);expect(transport).not.toHaveBeenCalled();expect(f.state()).toBe('unknown');});

it('unscoped subscription cannot claim or call provider',async()=>{scope.mockReturnValue(false);const f=fixture();expect(await run(f)).toEqual({ok:false,code:'FORBIDDEN'});expect(f.rpc).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();});
it('scope expiry after commit records unknown without provider execution',async()=>{const f=fixture();const original=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async(name,args)=>{const result=await original(name,args);if(name==='instagram_claim_subscription')scope.mockReturnValue(false);return result;});expect(await run(f)).toEqual({ok:false,code:'RECONCILIATION_REQUIRED'});expect(f.state()).toBe('unknown');expect(transport).not.toHaveBeenCalled();});
