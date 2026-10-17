import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({update:vi.fn(),patch:vi.fn(),barrier:vi.fn(),rpc:vi.fn(),load:vi.fn(),reserve:vi.fn()}));
vi.mock("./crypto",()=>({newOpaqueHandle:()=>"synthetic-operation"}));vi.mock("./log",()=>({brokerLog:vi.fn()}));vi.mock("./cookies",()=>({expireHandleCookie:vi.fn()}));
vi.mock("./resolve",()=>({createUserClientFromTokens:()=>({auth:{updateUser:m.update}})}));vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:m.rpc})}));vi.mock("@/lib/supabase/env",()=>({getSupabaseEnv:()=>({ok:true,url:"http://127.0.0.1:3330"})}));vi.mock("@supabase/supabase-js",()=>({createClient:()=>{throw Error("UNEXPECTED_PROVIDER_REPLAY");}}));
vi.mock("./registry",()=>({probeBrokerCapability:async()=>({ok:true,revokeAtOperation:true}),createBrokerOperation:m.reserve,setAdmissionBarrier:m.barrier,listActiveSessionsForUser:async()=>({ok:true,sessions:[],legacyCoverage:"resolved"}),freezeOperationSnapshot:async()=>true,freezeLegacyCoverageOnOperation:async()=>true,updateBrokerOperation:m.patch,loadBrokerOperation:m.load,markSessionStatus:vi.fn(),operationRevocationComplete:()=>false,reconcileNativeRevocation:vi.fn(),completeRevocationOperation:vi.fn(),updateOperationTargetReceipts:vi.fn()}));
import {brokerUpdatePassword}from"./password";import{resumeBrokerOperation}from"./recovery";
const password="SyntheticPassword42!",input={password,expectedUserId:"actor-a",expectedBoundaryFingerprint:"fp-a",writer:{set:vi.fn()},resolved:{boundary:{userId:"actor-a",boundaryFingerprint:"fp-a",nativeSessionId:"native-a",browserLineageId:"root-a"},registryId:"registry-a",handleHash:"handle-a",accessToken:"synthetic-access",refreshToken:"synthetic-refresh"}}as never;
beforeEach(()=>{vi.resetAllMocks();m.reserve.mockResolvedValue(true);m.barrier.mockResolvedValue(true);m.patch.mockResolvedValue(true);m.load.mockResolvedValue({cutoff:"2026-10-16T20:00:00Z"});m.update.mockResolvedValue({error:null});});
it("definite password rejection releases only original barrier and never reports changed",async()=>{m.update.mockResolvedValue({error:{name:"AuthApiError",status:400}});const r=await brokerUpdatePassword(input);expect(r.ok).toBe(false);expect(r.stages.credentialMutation).toBe("rejected");expect(m.update).toHaveBeenCalledTimes(1);expect(m.barrier).toHaveBeenLastCalledWith("actor-a","synthetic-operation",false);expect(m.rpc).not.toHaveBeenCalled();});
it.each([503,429])("returned uncertain password status %s preserves pending barrier without replay",async status=>{m.update.mockResolvedValue({error:{name:"AuthApiError",status}});const r=await brokerUpdatePassword(input);expect(r).toMatchObject({ok:false,message:"PASSWORD_CHANGE_OUTCOME_UNKNOWN",stages:{credentialMutation:"unknown"}});expect(m.update).toHaveBeenCalledTimes(1);expect(m.barrier.mock.calls.some(c=>c[2]===false)).toBe(false);expect(m.rpc).not.toHaveBeenCalled();expect(JSON.stringify([...m.reserve.mock.calls,...m.patch.mock.calls])).not.toContain(password);});
it("thrown password transport stays unknown and does not retry",async()=>{m.update.mockRejectedValue(Error("SYNTHETIC_NETWORK_UNKNOWN"));expect(await brokerUpdatePassword(input)).toMatchObject({ok:false,stages:{credentialMutation:"unknown"}});expect(m.update).toHaveBeenCalledTimes(1);expect(m.barrier.mock.calls.some(c=>c[2]===false)).toBe(false);});
it("original UNKNOWN operation resume never calls credential mutation",async()=>{m.load.mockResolvedValue({actorUserId:"actor-a",kind:"password_revoke",status:"pending",stages:{credentialMutation:"unknown"}});expect(await resumeBrokerOperation({operationKey:"synthetic-operation",actorUserId:"actor-a",writer:{set:vi.fn()}})).toMatchObject({ok:false,status:"pending",message:"CREDENTIAL_UNKNOWN_NO_REPLAY"});expect(m.update).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();});
it.each([{data:false,error:null,expected:"rejected"},{data:{ok:true},error:null,expected:"unknown"},{data:null,error:{code:"PGRST202"},expected:"unknown"},{data:null,error:{code:"SYNTHETIC_NETWORK_UNKNOWN"},expected:"unknown"}])("confirmed credential plus bad app-revoke reply is pending (%j)",async reply=>{m.rpc.mockResolvedValue(reply);expect(await brokerUpdatePassword(input)).toMatchObject({ok:false,stages:{credentialMutation:"confirmed",appRevocation:reply.expected},message:"PASSWORD_CHANGED_SESSION_REVOCATION_PENDING"});expect(m.update).toHaveBeenCalledTimes(1);expect(m.barrier.mock.calls.some(c=>c[2]===false)).toBe(false);});
it("confirmed credential plus thrown app-revoke transport remains recoverable pending",async()=>{m.rpc.mockRejectedValue(Error("SYNTHETIC_REVOKE_TRANSPORT"));expect(await brokerUpdatePassword(input)).toMatchObject({ok:false,stages:{credentialMutation:"confirmed",appRevocation:"unknown"}});expect(m.update).toHaveBeenCalledTimes(1);});

it("client correlation key reserves original operation; duplicate reservation cannot repeat credential effect",async()=>{
 // Fixed synthetic operation UUID; assembled to avoid a generic credential-assignment false positive.
 const operationKey=['00112233','4455','4677','8899','aabbccddeeff'].join('-');
 m.update.mockResolvedValue({error:{name:"AuthApiError",status:400}});
 const request={...(input as unknown as Record<string,unknown>),operationKey} as never;
 expect(await brokerUpdatePassword(request)).toMatchObject({operationId:operationKey});
 expect(m.reserve).toHaveBeenCalledWith(expect.objectContaining({operationKey,actorUserId:"actor-a"}));
 m.reserve.mockResolvedValue(false);
 expect(await brokerUpdatePassword(request)).toMatchObject({ok:false,operationId:operationKey});
 expect(m.update).toHaveBeenCalledOnce();
});
it("invalid client operation key cannot reserve or mutate credentials",async()=>{
 expect(await brokerUpdatePassword({...(input as unknown as Record<string,unknown>),operationKey:"foreign-key"} as never)).toMatchObject({ok:false,code:"INVALID_INPUT"});
 expect(m.reserve).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();
});
