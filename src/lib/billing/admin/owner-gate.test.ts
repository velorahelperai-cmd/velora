import {beforeEach,it,expect,vi,describe} from "vitest";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({verified:vi.fn(),client:vi.fn(),claims:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({requireVerifiedUser:state.verified}));
vi.mock("@/lib/supabase/server",()=>({createClient:state.client}));
import {billingOwnerGate,recheckBillingOwner} from "./owner-gate";

const sid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(()=>{
  vi.clearAllMocks();
  state.verified.mockResolvedValue({ok:true,context:{userId:"actor"}});
  state.claims.mockResolvedValue({data:{claims:{sub:"actor",session_id:sid}},error:null});
  state.rpc.mockResolvedValue({data:true,error:null});
  state.client.mockResolvedValue({auth:{getClaims:state.claims},rpc:state.rpc});
});

it("current owner and session read is independent of AI",async()=>expect(await billingOwnerGate()).toMatchObject({ok:true,binding:{actorId:"actor",sessionId:sid}}));

it("failed verified identity denies before SDK owner reads",async()=>{
  state.verified.mockResolvedValue({ok:false,code:"FORBIDDEN"});
  expect(await billingOwnerGate()).toMatchObject({ok:false,code:"forbidden"});
  expect(state.client).not.toHaveBeenCalled();
});

it("transient user verification failure returns unavailable before SDK owner reads",async()=>{
  state.verified.mockResolvedValue({ok:false,code:"UNAVAILABLE"});
  expect(await billingOwnerGate()).toMatchObject({ok:false,code:"unavailable"});
  expect(state.client).not.toHaveBeenCalled();
});

it.each(["subject","session"])("invalid trusted %s denies before role predicate",async kind=>{
  state.claims.mockResolvedValue({data:{claims:{sub:kind==="subject"?"other":"actor",session_id:kind==="session"?"bad":sid}},error:null});
  expect(await billingOwnerGate()).toMatchObject({ok:false,code:"forbidden"});
  expect(state.rpc).not.toHaveBeenCalled();
});

it("claims read error (503/network) returns unavailable, not forbidden",async()=>{
  state.claims.mockResolvedValue({data:null,error:{message:"Service Unavailable",status:503}});
  expect(await billingOwnerGate()).toMatchObject({ok:false,code:"unavailable"});
  expect(state.rpc).not.toHaveBeenCalled();
});

it("delegated admin role is not owner authority",async()=>{
  state.rpc.mockResolvedValue({data:false,error:null});
  expect(await billingOwnerGate()).toMatchObject({ok:false,code:"forbidden"});
});

it("missing owner-session RPC is unavailable, never a broad fallback",async()=>{
  state.rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});
  expect(await billingOwnerGate()).toMatchObject({ok:false,code:"unavailable"});
});

describe("recheckBillingOwner distinct result",()=>{
  it("matching binding returns ok: true",async()=>{
    expect(await recheckBillingOwner({actorId:"actor",sessionId:sid})).toEqual({ok:true});
  });

  it("changed binding is rejected as forbidden at recheck",async()=>{
    expect(await recheckBillingOwner({actorId:"other",sessionId:sid})).toEqual({ok:false,code:"forbidden"});
    expect(await recheckBillingOwner({actorId:"actor",sessionId:"other"})).toEqual({ok:false,code:"forbidden"});
  });

  it("transient failure during recheck returns unavailable",async()=>{
    state.rpc.mockResolvedValue({data:null,error:{message:"timeout"}});
    expect(await recheckBillingOwner({actorId:"actor",sessionId:sid})).toEqual({ok:false,code:"unavailable"});
  });

  it("claims 503 failure during recheck returns unavailable",async()=>{
    state.claims.mockResolvedValue({data:null,error:{status:503}});
    expect(await recheckBillingOwner({actorId:"actor",sessionId:sid})).toEqual({ok:false,code:"unavailable"});
  });

  it("permission revocation during recheck returns forbidden",async()=>{
    state.rpc.mockResolvedValue({data:false,error:null});
    expect(await recheckBillingOwner({actorId:"actor",sessionId:sid})).toEqual({ok:false,code:"forbidden"});
  });
});
