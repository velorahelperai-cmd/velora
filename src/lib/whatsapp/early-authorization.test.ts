import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('./embedded-signup-meta',()=>({exchangeEarlyMetaAuthorization:vi.fn()}));
import {exchangeEarlyMetaAuthorization} from './embedded-signup-meta';
import {captureEarlyAuthorization} from './early-authorization';
const config={enabled:true,appId:'111',appSecret:'synthetic',graphVersion:'v26.0'};
it('reserves once across concurrent callers before exchanging and persists without FINISH',async()=>{
 vi.mocked(exchangeEarlyMetaAuthorization).mockReset().mockResolvedValue({ok:true,token:'synthetic-token'});let claimed=false;const calls:unknown[]=[];
 const rpc=vi.fn(async(_name:string,args:Record<string,unknown>)=>{calls.push(args);if(args.p_operation==='reserve'){const acquired=!claimed;claimed=true;return {data:{ok:true,acquired,stored:false},error:null};}return {data:{ok:true},error:null};});
 const results=await Promise.all(Array.from({length:4},()=>captureEarlyAuthorization({rpc},{attemptId:'synthetic'},'synthetic-code',config)));expect(results.filter(Boolean)).toHaveLength(1);expect(exchangeEarlyMetaAuthorization).toHaveBeenCalledTimes(1);expect(JSON.stringify(calls)).not.toContain('synthetic-code');expect(rpc.mock.calls.filter(c=>c[1].p_operation==='save')).toHaveLength(1);
});
it('retries only the same token save after an unknown storage result',async()=>{vi.mocked(exchangeEarlyMetaAuthorization).mockReset().mockResolvedValue({ok:true,token:'synthetic-token'});let saves=0;const args:Record<string,unknown>[]=[];const rpc=vi.fn(async(_name:string,p:Record<string,unknown>)=>{args.push(p);return {data:p.p_operation==='reserve'?{ok:true,acquired:true}:++saves===1?null:{ok:true},error:null};});expect(await captureEarlyAuthorization({rpc},{},'code',config)).toBe(true);expect(exchangeEarlyMetaAuthorization).toHaveBeenCalledTimes(1);expect(args[1]).toEqual(args[2]);});
it.each(['reserved','stored','promoted','denied'] as const)('never re-exchanges a prior %s reservation',async state=>{vi.mocked(exchangeEarlyMetaAuthorization).mockReset();const rpc=vi.fn(async()=>({data:{ok:state!=='denied',acquired:false,stored:state==='stored',promoted:state==='promoted'},error:null}));expect(await captureEarlyAuthorization({rpc},{},'code',config)).toBe(state==='stored'||state==='promoted');expect(exchangeEarlyMetaAuthorization).not.toHaveBeenCalled();});
it('leaves a failed exchange reserved and unknown',async()=>{vi.mocked(exchangeEarlyMetaAuthorization).mockReset().mockResolvedValue({ok:false});const rpc=vi.fn(async()=>({data:{ok:true,acquired:true},error:null}));expect(await captureEarlyAuthorization({rpc},{},'code',config)).toBe(false);expect(rpc).toHaveBeenCalledTimes(1);});
it('returns unknown on storage outage without leaking or repeating exchange',async()=>{vi.mocked(exchangeEarlyMetaAuthorization).mockReset().mockResolvedValue({ok:true,token:'synthetic-token'});const rpc=vi.fn(async(_n:string,p:Record<string,unknown>)=>{if(p.p_operation==='save')throw Error('vault unavailable');return {data:{ok:true,acquired:true},error:null};});expect(await captureEarlyAuthorization({rpc},{},'code',config)).toBe(false);expect(exchangeEarlyMetaAuthorization).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledTimes(3);});

it('reports fixed stages only and preserves held/unknown without retrying exchange',async()=>{
 vi.mocked(exchangeEarlyMetaAuthorization).mockReset().mockResolvedValue({ok:true,token:'private-token-canary'});
 const diagnostic=vi.fn();const rpc=vi.fn(async(_n:string,p:Record<string,unknown>)=>({data:{ok:true,acquired:p.p_operation==='reserve'},error:null}));
 expect(await captureEarlyAuthorization({rpc},{sessionId:'private-session-canary'},'private-code-canary',config,undefined,diagnostic)).toBe(true);
 expect(diagnostic.mock.calls.map(c=>c.slice(0,2))).toEqual([['reservation','started'],['reservation','confirmed'],['exchange','started'],['exchange','confirmed'],['save','started'],['save','confirmed']]);
 expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/private-|synthetic/);
 const held=vi.fn(async()=>({data:{ok:true,acquired:false},error:null}));diagnostic.mockClear();expect(await captureEarlyAuthorization({rpc:held},{},'private-code-canary',config,undefined,diagnostic)).toBe(false);expect(diagnostic.mock.calls[1][1]).toBe('held');expect(exchangeEarlyMetaAuthorization).toHaveBeenCalledTimes(1);
});
it('does not let a failing diagnostic sink change token save',async()=>{vi.mocked(exchangeEarlyMetaAuthorization).mockResolvedValue({ok:true,token:'synthetic-token'});const rpc=vi.fn(async()=>({data:{ok:true,acquired:true},error:null}));expect(await captureEarlyAuthorization({rpc},{},'code',config,undefined,()=>{throw Error('sink failure');})).toBe(true);});
