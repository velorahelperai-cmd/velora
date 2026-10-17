import {readFileSync} from "node:fs";
import {beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({reply:null as unknown,error:null as unknown,update:vi.fn(),reserve:vi.fn(),barrier:vi.fn(),provider:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:async()=>({data:m.reply,error:m.error})})}));
vi.mock("./log",()=>({brokerLog:vi.fn()}));
vi.mock("./crypto",async importOriginal=>({...await importOriginal<object>(),brokerEncryptionConfigured:()=>true,newOpaqueHandle:()=>"synthetic-schema-operation"}));
vi.mock("./resolve",()=>({createUserClientFromTokens:()=>({auth:{updateUser:m.update}})}));
vi.mock("./cookies",()=>({expireHandleCookie:vi.fn()}));
vi.mock("./provider",()=>({createProviderAuthClient:m.provider,readPkceVerifier:vi.fn(),seedPkceVerifier:vi.fn()}));
vi.mock("./registry",async importOriginal=>({...await importOriginal<object>(),createBrokerOperation:m.reserve,setAdmissionBarrier:m.barrier,listActiveSessionsForUser:async()=>({ok:true,sessions:[],legacyCoverage:"resolved"}),freezeOperationSnapshot:async()=>true,freezeLegacyCoverageOnOperation:async()=>true,updateBrokerOperation:async()=>true,loadBrokerOperation:async()=>({cutoff:"2026-10-16T20:00:00Z"})}));
import {probeBrokerCapability} from "./registry";
import {brokerUpdatePassword} from "./password";
import {brokerPasswordLogin} from "./login";
import {admitNativeSession} from "./admit";
// Opt-in snapshots come only from the isolated real-PostgreSQL runner. Ordinary
// CI skips these instead of depending on an operator's filesystem or calling a DB.
const reportPath=process.env.VELORA_WP01A_SCHEMA_REPORT;
const report=reportPath?JSON.parse(readFileSync(reportPath,"utf8")):{profiles:[],checks:[]};
const latest=report.profiles.find((p:{name:string})=>p.name==="latest")?.capability;
const cases=[...["idle-only","epoch-noidentity"].map(name=>({name,data:null,error:{code:"PGRST202"}})),...report.checks.filter((r:{name:string})=>["missing-required","drift-body","drift-type"].includes(r.name)).map((r:{name:string;capability:unknown})=>({name:r.name,data:r.capability,error:null})),{name:"wrong-version",data:{...latest,contract_version:99},error:null},{name:"wrong-version-type",data:{...latest,contract_version:"2"},error:null},{name:"malformed-boolean",data:{...latest,ok:"true"},error:null}];
const input={password:"SyntheticPassword42!",expectedUserId:"actor-a",expectedBoundaryFingerprint:"fp-a",writer:{set:vi.fn()},resolved:{boundary:{userId:"actor-a",boundaryFingerprint:"fp-a",nativeSessionId:"native-a",browserLineageId:"root-a"},registryId:"registry-a",handleHash:"handle-a",accessToken:"synthetic-access",refreshToken:"synthetic-refresh"}} as never;
describe.skipIf(!reportPath)("WP01A schema residual application contract (real DB snapshots, effect spies)",()=>{
beforeEach(()=>{vi.clearAllMocks();m.error=null;m.reserve.mockResolvedValue(true);m.barrier.mockResolvedValue(true);m.update.mockResolvedValue({error:{name:"AuthApiError",status:400}});});
it("latest real PostgreSQL snapshot passes application capability decoder",async()=>{expect(latest).toBeTruthy();m.reply=latest;expect((await probeBrokerCapability()).ok).toBe(true);});
it.each(cases)("unsupported $name denies before credential mutation or operation reservation",async row=>{m.reply=row.data;m.error=row.error;expect((await probeBrokerCapability()).ok).toBe(false);const r=await brokerUpdatePassword(input);expect(r).toMatchObject({ok:false,code:"UNAVAILABLE",stages:{credentialMutation:"not_attempted"}});expect(m.update).not.toHaveBeenCalled();expect(m.reserve).not.toHaveBeenCalled();expect(m.barrier).not.toHaveBeenCalled();});
it("old password request without continuity/nonce denies before provider login",async()=>{m.reply=latest;const writer={set:vi.fn()};expect(await brokerPasswordLogin({email:"synthetic@example.invalid",password:"SyntheticPassword42!",writer})).toEqual({ok:false,code:"UNAVAILABLE"});expect(m.provider).not.toHaveBeenCalled();expect(writer.set).not.toHaveBeenCalled();});
it("old shared-token admit without bound continuity explicitly denies and emits no cookie",async()=>{m.reply=latest;const writer={set:vi.fn()};const token=["synthetic",Buffer.from(JSON.stringify({session_id:"00000000-0000-4000-8000-000000000001"})).toString("base64url"),"synthetic"].join(".");const r=await admitNativeSession({session:{user:{id:"actor-a"},access_token:token,refresh_token:"synthetic-refresh",expires_in:3600} as never,writer});expect(r).toEqual({ok:false,code:"CONTINUITY_REQUIRED"});expect(writer.set).not.toHaveBeenCalled();});
});
