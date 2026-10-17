import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({signIn:vi.fn(),claim:vi.fn(),update:vi.fn(),resume:vi.fn(),load:vi.fn(),cleanup:vi.fn()}));
vi.mock("./registry",()=>({probeBrokerCapability:async()=>({ok:true,boundAdmit:true}),reserveBoundAuthIntent:async()=>({id:"synthetic-intent"}),claimProviderAttempt:m.claim,loadBrokerOperation:m.load}));
vi.mock("./lineage-auth",()=>({prepareBrokerAdmissionLineage:async()=>({ok:true,bootstrapHash:"synthetic-root",browserLineageId:"synthetic-lineage"})}));
vi.mock("./provider",()=>({createProviderAuthClient:()=>({client:{auth:{signInWithPassword:m.signIn}}})}));
vi.mock("./provider-session",()=>({resumeProviderCleanup:m.resume,signOutProviderSessionAfterAdmitFailure:m.cleanup}));
vi.mock("./log",()=>({brokerLog:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{const q={update:(v:unknown)=>{m.update(v);return q;},eq:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};return {from:()=>q};}}));
import {brokerPasswordLogin} from "./login";
const input={email:"synthetic@example.invalid",password:"synthetic-password",requestNonce:"synthetic-request-nonce",reader:{getAll:()=>[]},writer:{set:()=>{}}};
beforeEach(()=>{vi.resetAllMocks();m.claim.mockResolvedValue({ok:true,claimed:true});});
it("ambiguous password result journals unknown; retry cannot repeat provider effect",async()=>{
 m.signIn.mockResolvedValue({data:{session:null},error:{status:503,name:"AuthRetryableFetchError"}});
 expect(await brokerPasswordLogin(input)).toMatchObject({ok:false,code:"UNAVAILABLE"});
 expect(m.update).toHaveBeenCalledWith(expect.objectContaining({provider_state:"unknown",cleanup_state:"unknown",status:"reserved"}));
 m.claim.mockResolvedValue({ok:false,claimed:false});await brokerPasswordLogin(input);
 expect(m.signIn).toHaveBeenCalledOnce();expect(m.resume).toHaveBeenCalledWith("synthetic-intent","synthetic-lineage");
});
it("definite rejected credentials are terminal instead of unknown",async()=>{
 m.signIn.mockResolvedValue({data:{session:null},error:{status:400,name:"AuthApiError"}});
 expect(await brokerPasswordLogin(input)).toMatchObject({ok:false,code:"AUTH_ERROR"});
 expect(m.update).toHaveBeenCalledWith(expect.objectContaining({provider_state:"rejected",cleanup_state:"not_needed",status:"rejected"}));
});

it("recovery reauthentication rejects a foreign actor before app admission and cleans only captured provider session",async()=>{
 m.load.mockResolvedValue({actorUserId:"original-actor",kind:"password_revoke",status:"confirmed"});
 m.signIn.mockResolvedValue({error:null,data:{session:{user:{id:"foreign-actor"},access_token:"synthetic-access",refresh_token:"synthetic-refresh"}}});
 expect(await brokerPasswordLogin({...input,recoveryOperationKey:"original-operation",admissionScope:"app"})).toMatchObject({ok:false,code:"AUTH_ERROR"});
 expect(m.load).toHaveBeenCalledWith("original-operation");
 expect(m.cleanup).toHaveBeenCalledOnce();
});
