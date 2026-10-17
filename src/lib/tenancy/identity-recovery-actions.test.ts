import {afterEach,beforeEach,expect,it,vi} from "vitest";

const f=vi.hoisted(()=>({
 client:vi.fn(),
 bound:vi.fn(),
 rpc:vi.fn(),
 user:vi.fn(),
 claims:vi.fn(),
 owner:vi.fn(),
 session:vi.fn(),
 log:vi.fn(),
}));

vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient:f.client,createBrokerBoundClient:f.bound}));
vi.mock("@/lib/tenancy/access",()=>({requirePlatformAdmin:f.owner}));
vi.mock("@/lib/auth/session-guard",()=>({checkAppSession:f.session}));
vi.mock("@/lib/auth/broker/log",()=>({brokerLog:f.log}));

import {
 adminDecideIdentityRecoveryAction,
 openIdentityRecoveryReviewAction,
 readIdentityRecoveryReviewsAction,
} from "./identity-recovery-actions";
import {classifyIdentityRecoveryRpcFailure} from "./identity-recovery";

const uid="b1000000-0000-4000-8000-000000000001";
const cid="b1000000-0000-4000-8000-000000000002";
const key="b1000000-0000-4000-8000-000000000003";
const registryA="b1000000-0000-4000-8000-0000000000a1";
const registryB="b1000000-0000-4000-8000-0000000000b1";
const lineageA="b1000000-0000-4000-8000-0000000000c1";
const fp="aaaaaaaaaaaaaaaa";
const fpLater="bbbbbbbbbbbbbbbb";

function tip(
 userId=uid,
 fingerprint=fp,
 nativeSessionId=key,
 registryId=registryA,
 browserLineageId=lineageA,
){
 return {
  bound:{
   ok:true as const,
   client:{rpc:f.rpc,auth:{getUser:f.user,getClaims:f.claims}},
   resolve:{
    registryId,
    boundary:{
     userId,
     boundaryFingerprint:fingerprint,
     nativeSessionId,
     generation:"gen-a",
     browserLineageId,
    },
   },
  },
 };
}

beforeEach(()=>{
 vi.clearAllMocks();
 vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED","true");
 f.client.mockResolvedValue({rpc:f.rpc,auth:{getUser:f.user,getClaims:f.claims}});
 f.bound.mockResolvedValue(tip());
 f.user.mockResolvedValue({error:null,data:{user:{id:uid}}});
 f.claims.mockResolvedValue({error:null,data:{claims:{sub:uid,session_id:key}}});
 f.owner.mockResolvedValue({ok:true});
 f.session.mockResolvedValue({ok:true});
 f.rpc.mockResolvedValue({
  error:null,
  status:200,
  data:{
   ok:true,
   data:{
    id:cid,
    userId:uid,
    reason:"lost_phone",
    state:"review",
    createdAt:"2026-10-14T00:00:00Z",
    verifiedEvidence:0,
   },
  },
 });
});
afterEach(()=>vi.unstubAllEnvs());

it("default off avoids Auth, administrator lookup and RPC",async()=>{
 vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED",undefined);
 expect(await adminDecideIdentityRecoveryAction({caseId:cid,decision:"approve_review",requestKey:key}))
  .toMatchObject({code:"UNCONFIGURED"});
 expect(f.client).not.toHaveBeenCalled();
 expect(f.bound).not.toHaveBeenCalled();
 expect(f.owner).not.toHaveBeenCalled();
});

it("a changed account cannot open or read the former account review",async()=>{
 expect(await openIdentityRecoveryReviewAction({
  expectedUserId:cid,
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();
 expect(await readIdentityRecoveryReviewsAction({expectedUserId:cid,expectedBoundaryFingerprint:fp}))
  .toMatchObject({code:"UNAUTHENTICATED"});
});

it("same user with a newer tip rejects the original capture before RPC",async()=>{
 f.bound.mockResolvedValue(tip(uid,fpLater));
 expect(await openIdentityRecoveryReviewAction({
  expectedUserId:uid,
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();
 expect(f.log).toHaveBeenCalledWith(
  "warn",
  "identity.recovery.capture_not_tip",
  expect.objectContaining({error_code:"CAPTURE_NOT_AUTHORITATIVE",boundary_fp:fp}),
 );
 expect(await readIdentityRecoveryReviewsAction({expectedUserId:uid,expectedBoundaryFingerprint:fp}))
  .toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();
});

it("expired or locked app session is rejected before open effect",async()=>{
 f.session.mockResolvedValue({ok:false,code:"UNAUTHENTICATED",expired:true});
 expect(await openIdentityRecoveryReviewAction({
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toMatchObject({ok:false,code:"UNAUTHENTICATED",expired:true});
 expect(f.rpc).not.toHaveBeenCalled();
});

it("unauthenticated broker tip rejects before open effect",async()=>{
 f.bound.mockResolvedValue({bound:{ok:false,code:"UNAUTHENTICATED"}});
 expect(await openIdentityRecoveryReviewAction({
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();
});

it("administrator rejection stops before database access",async()=>{
 f.owner.mockResolvedValue({ok:false});
 expect(await adminDecideIdentityRecoveryAction({caseId:cid,decision:"reject",requestKey:key}))
  .toMatchObject({code:"FORBIDDEN"});
 expect(f.client).not.toHaveBeenCalled();
});

it("native database owner authority is mandatory even if the outer admin precheck passed",async()=>{
 f.rpc.mockResolvedValue({error:{code:"42501"},data:null});
 expect(await adminDecideIdentityRecoveryAction({caseId:cid,decision:"approve_review",requestKey:key}))
  .toMatchObject({code:"FORBIDDEN"});
});

it("read rejects a case belonging to another subject",async()=>{
 f.rpc.mockResolvedValue({
  error:null,
  data:{
   ok:true,
   data:{
    userId:uid,
    configuration:"UNCONFIGURED",
    cases:[{
     id:key,
     userId:cid,
     reason:"lost_phone",
     state:"review",
     createdAt:"2026-10-14T00:00:00Z",
     verifiedEvidence:0,
    }],
   },
  },
 });
 expect(await readIdentityRecoveryReviewsAction({expectedUserId:uid,expectedBoundaryFingerprint:fp}))
  .toMatchObject({code:"UNAVAILABLE"});
});

it("intake creates a persisted review using tip userId, not a browser authority hint",async()=>{
 const opened=await openIdentityRecoveryReviewAction({
  expectedUserId:uid,
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 });
 expect(opened.ok).toBe(true);
 if(opened.ok){
  expect(opened.data).toMatchObject({id:cid,userId:uid,state:"review",boundaryFingerprint:fp});
 }
 expect(f.rpc).toHaveBeenCalledWith("master_open_identity_recovery_review",{
  p_expected_user_id:uid,
  p_reason:"lost_phone",
  p_request_key:key,
  p_expected_native_session_id:key,
  p_expected_registry_id:registryA,
  p_expected_browser_lineage_id:lineageA,
 });
 expect(f.bound).toHaveBeenCalled();
 expect(f.log).toHaveBeenCalledWith(
  "info",
  "identity.recovery.open",
  expect.objectContaining({
   module:"identity.recovery",
   support_ref:cid,
   boundary_fp:fp,
   stage:"review",
  }),
 );
});

it("open omits secrets and evidence bodies from diagnostic logs",async()=>{
 await openIdentityRecoveryReviewAction({
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 });
 const payload=f.log.mock.calls.find((c)=>c[1]==="identity.recovery.open")?.[2] as Record<string,unknown>;
 expect(payload).toBeTruthy();
 expect(JSON.stringify(payload)).not.toMatch(/password|evidenceReference|Authorization|Bearer/i);
});

it("thrown transport failure after open attempt returns UNCONFIRMED without claiming save failure",async()=>{
 f.rpc.mockRejectedValue(new Error("SYNTHETIC_TRANSPORT_LOSS"));
 expect(await openIdentityRecoveryReviewAction({
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toEqual({ok:false,code:"UNCONFIRMED"});
 expect(f.log).toHaveBeenCalledWith(
  "warn",
  "identity.recovery.open",
  expect.objectContaining({error_code:"UNCONFIRMED"}),
 );
});

it("SDK-shaped 503 (top-level status + message, no error.status) is UNCONFIRMED",async()=>{
 // Real @supabase client observation for gateway 503 — status is not on error.
 f.rpc.mockResolvedValue({data:null,error:{message:"Service Unavailable"},status:503,statusText:"Service Unavailable"});
 expect(await openIdentityRecoveryReviewAction({
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toEqual({ok:false,code:"UNCONFIRMED"});
 expect(classifyIdentityRecoveryRpcFailure(
  {error:{message:"Service Unavailable"},status:503,statusText:"Service Unavailable"},
  true,
 )).toBe("UNCONFIRMED");
 expect(classifyIdentityRecoveryRpcFailure(
  {error:{message:"Bad Gateway"},status:502},
  true,
 )).toBe("UNCONFIRMED");
 expect(classifyIdentityRecoveryRpcFailure(
  {error:{message:"Gateway Timeout"},status:504},
  true,
 )).toBe("UNCONFIRMED");
});

it("plain JSON 503 body without status field still classifies from message when uncertain",()=>{
 expect(classifyIdentityRecoveryRpcFailure(
  {error:{message:"Service Unavailable"}},
  true,
 )).toBe("UNCONFIRMED");
});

it("read path 503 stays UNAVAILABLE and is not presented as unconfirmed write",async()=>{
 f.rpc.mockResolvedValue({data:null,error:{message:"Service Unavailable"},status:503,statusText:"Service Unavailable"});
 expect(await readIdentityRecoveryReviewsAction({
  expectedUserId:uid,
  expectedBoundaryFingerprint:fp,
 })).toEqual({ok:false,code:"UNAVAILABLE"});
 expect(classifyIdentityRecoveryRpcFailure(
  {error:{message:"Service Unavailable"},status:503},
  false,
 )).toBe("UNAVAILABLE");
});

it("malformed RPC success body is UNAVAILABLE without success log",async()=>{
 f.rpc.mockResolvedValue({data:"not-an-object",error:null,status:200});
 expect(await openIdentityRecoveryReviewAction({
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toEqual({ok:false,code:"UNAVAILABLE"});
 expect(f.log).not.toHaveBeenCalledWith("info","identity.recovery.open",expect.anything());
});

it("proven privilege denial stays FORBIDDEN and is not collapsed to UNCONFIRMED",async()=>{
 f.rpc.mockResolvedValue({error:{code:"42501"},data:null,status:403});
 expect(await openIdentityRecoveryReviewAction({
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toEqual({ok:false,code:"FORBIDDEN"});
 expect(classifyIdentityRecoveryRpcFailure({error:{code:"42501"},status:403},true)).toBe("FORBIDDEN");
});

it("JWT session mismatch against tip native session denies before RPC",async()=>{
 f.claims.mockResolvedValue({error:null,data:{claims:{sub:uid,session_id:cid}}});
 expect(await openIdentityRecoveryReviewAction({
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();
});

it("same-user tip change during awaited getUser denies open and read before RPC",async()=>{
 f.bound
  .mockResolvedValueOnce(tip(uid,fp))
  .mockResolvedValue(tip(uid,fpLater));
 f.user.mockResolvedValue({error:null,data:{user:{id:uid}}});
 expect(await openIdentityRecoveryReviewAction({
  expectedUserId:uid,
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();

 f.bound.mockReset();
 f.rpc.mockClear();
 f.bound
  .mockResolvedValueOnce(tip(uid,fp))
  .mockResolvedValue(tip(uid,fpLater));
 expect(await readIdentityRecoveryReviewsAction({
  expectedUserId:uid,
  expectedBoundaryFingerprint:fp,
 })).toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();
});

it("same-user tip change after authorize but before RPC denies without invoking open",async()=>{
 f.bound
  .mockResolvedValueOnce(tip(uid,fp)) // authorize start
  .mockResolvedValueOnce(tip(uid,fp)) // authorize post-await
  .mockResolvedValueOnce(tip(uid,fpLater,key,registryB,lineageA)); // pre-RPC fence (new registry)
 expect(await openIdentityRecoveryReviewAction({
  expectedUserId:uid,
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();
});

it("same-user registry tip advance (same native placeholder) denies before RPC",async()=>{
 // Capture A then resolve returns same fingerprint/native but new registryId (tip B).
 f.bound
  .mockResolvedValueOnce(tip(uid,fp,key,registryA,lineageA))
  .mockResolvedValueOnce(tip(uid,fp,key,registryA,lineageA))
  .mockResolvedValueOnce(tip(uid,fp,key,registryB,lineageA));
 expect(await openIdentityRecoveryReviewAction({
  expectedUserId:uid,
  expectedBoundaryFingerprint:fp,
  reason:"lost_phone",
  requestKey:key,
 })).toMatchObject({code:"UNAUTHENTICATED"});
 expect(f.rpc).not.toHaveBeenCalled();
});

it("SSR read binds the tip boundary without requiring a browser capture fence",async()=>{
 f.rpc.mockResolvedValue({
  error:null,
  data:{ok:true,data:{userId:uid,configuration:"UNCONFIGURED",cases:[]}},
 });
 const view=await readIdentityRecoveryReviewsAction();
 expect(view).toMatchObject({
  ok:true,
  data:{actorUserId:uid,configuration:"UNCONFIGURED",boundaryFingerprint:fp,cases:[]},
 });
});

it("legacy admin signature still reads through the platform-owner path",async()=>{
 f.rpc.mockResolvedValue({
  error:null,
  data:{ok:true,data:{actorUserId:uid,configuration:"UNCONFIGURED",cases:[]}},
 });
 expect(await readIdentityRecoveryReviewsAction(undefined,true)).toMatchObject({
  ok:true,
  data:{actorUserId:uid,configuration:"UNCONFIGURED"},
 });
 expect(f.owner).toHaveBeenCalled();
});
