import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({resolve:vi.fn(),cookies:[] as {name:string;value:string}[]}));
vi.mock('react',()=>({cache:(fn:unknown)=>fn}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>state.cookies})}));
vi.mock('@/lib/auth/broker',()=>({createBrokerUserClient:state.resolve}));
vi.mock('@/lib/auth/broker/provider',()=>({createProviderAuthClient:()=>({client:{guest:true}})}));
import {createClient,createBrokerBoundClient} from './server';
import {runWithReadScope} from './read-scope';
beforeEach(()=>{vi.resetAllMocks();state.cookies=[{name:'opaque',value:'A'}];});

it('joins simultaneous identical resolutions but rereads authority after completion',async()=>{
 let release!:(value:unknown)=>void;
 const client={actor:'A'};
 state.resolve.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 await runWithReadScope(async()=>{
  const first=createClient(),second=createClient();
  await vi.waitFor(()=>expect(state.resolve).toHaveBeenCalledOnce());
  release({ok:true,client});
  expect(await first).toBe(client);expect(await second).toBe(client);
  state.resolve.mockResolvedValue({ok:false,code:'UNAVAILABLE'});
  await expect(createClient()).rejects.toThrow('BROKER_SESSION_UNAVAILABLE');
  expect(state.resolve).toHaveBeenCalledTimes(2);
 });
});

it('never joins another request, changed cookies, or an explicit fresh fence',async()=>{
 const pending:Array<(value:unknown)=>void>=[];
 state.resolve.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const first=runWithReadScope(async()=>{
  const a=createClient();await vi.waitFor(()=>expect(pending).toHaveLength(1));
  state.cookies=[{name:'opaque',value:'B'}];
  const b=createClient();const fresh=createBrokerBoundClient({fresh:true});
  return Promise.all([a,b,fresh]);
 });
 await vi.waitFor(()=>expect(pending).toHaveLength(3));
 const other=runWithReadScope(()=>createClient());
 await vi.waitFor(()=>expect(pending).toHaveLength(4));
 pending.forEach((resolve,index)=>resolve({ok:true,client:{index}}));
 const result=await first;expect(result[0]).toEqual({index:0});expect(result[1]).not.toBe(result[0]);
 expect(await other).toEqual({index:3});
});
