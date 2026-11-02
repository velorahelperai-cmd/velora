import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({revoked:false,removeMember:false,changeDuringRead:false,userCalls:0,guardCalls:0}));
vi.mock('server-only',()=>({}));
// Deliberately emulate render memoization: final authority must bypass it.
vi.mock('react',()=>({cache:<T extends (...args:never[])=>unknown>(fn:T)=>{
 let set=false,value:unknown;
 return (...args:never[])=>{if(!set){value=fn(...args);set=true;}return value;};
}}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[{name:'opaque',value:'fixture'}],get:()=>undefined})}));
vi.mock('@/lib/master-journey/rollout',()=>({masterJourneyEnabled:()=>false}));
vi.mock('@/lib/auth/session-guard',()=>({checkAppSession:async()=>{
 state.guardCalls++;return state.revoked?{ok:false,code:'UNAUTHENTICATED'}:{ok:true};
}}));
vi.mock('@/lib/auth/broker',()=>({createBrokerUserClient:async()=>({
 ok:true,client:{
  auth:{getClaims:async()=>({data:{claims:{sub:'22222222-2222-4222-8222-222222222222'}},error:null}),
   getUser:async()=>{state.userCalls++;return {data:{user:{id:'22222222-2222-4222-8222-222222222222',email:'fixture@example.test',email_confirmed_at:'confirmed',user_metadata:{}}},error:null};}},
  rpc:async()=>({data:false,error:null}),
  from:(table:string)=>{
   const q={select:()=>q,eq:()=>q,
    order:async()=>({data:state.removeMember?[]:[{company_id:'11111111-1111-4111-8111-111111111111',user_id:'22222222-2222-4222-8222-222222222222',role:'owner',status:'active'}],error:null}),
    maybeSingle:async()=>({data:table==='profiles'?{full_name:'Fixture',support_code:'fixture'}:{id:'11111111-1111-4111-8111-111111111111',display_name:'Fixture',status:'active'},error:null})};
   return q;
  },
 },resolve:{registryId:'registry',boundary:{userId:'22222222-2222-4222-8222-222222222222',boundaryFingerprint:'same',nativeSessionId:'sid',cookieName:'opaque',generation:'generation',authOrdinal:1,contextGeneration:1}}
})}));
vi.mock('@/lib/customer/service-inbox-actions',()=>({readServiceInbox:async()=>{
 const {getCompanyAccess}=await import('@/lib/tenancy/access');
 for(let i=0;i<4;i++)await getCompanyAccess();
 if(state.changeDuringRead)state.revoked=true;
 return {ok:true,companyId:'11111111-1111-4111-8111-111111111111',actorId:'22222222-2222-4222-8222-222222222222',data:'private-result'};
}}));
import {GET} from './route';
import {getCompanyAccess} from '@/lib/tenancy/access';
const request=()=>new Request('https://velora.test/api/inbox/read?companyId=11111111-1111-4111-8111-111111111111&actorId=22222222-2222-4222-8222-222222222222');
beforeEach(()=>{Object.assign(state,{revoked:false,removeMember:false,changeDuringRead:false,userCalls:0,guardCalls:0});});
it('runs both real scope wrappers, reading native identity twice despite four consumers',async()=>{
 const response=await GET(request());
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({ok:true,data:'private-result'});
 expect(state.userCalls).toBe(2);expect(state.guardCalls).toBe(2);
});
it('discards the actual route payload on final revocation even with a populated React cache',async()=>{
 expect(await getCompanyAccess()).toMatchObject({ok:true});
 state.changeDuringRead=true;
 const response=await GET(request());
 expect(response.status).toBe(503);
 expect(await response.json()).toEqual({ok:false,code:'UNAVAILABLE'});
 expect(state.guardCalls).toBeGreaterThanOrEqual(2);
});
