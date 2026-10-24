import {beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({
 row:{id:"fixture-intent",purpose:"signup_email",status:"reserved",provider_state:"ready",pkce_verifier_enc:null as string|null},
 send:vi.fn(),exchange:vi.fn(),events:[] as string[],failPersist:false,redirect:"",cookie:vi.fn(),
}));
const stateNonce="fixture-state-nonce-for-email";
const actor={id:"fixture-user",email:"fixture@example.test",email_confirmed_at:"2026-10-24T00:00:00Z"};
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({getAll:()=>[],get:()=>undefined,set:m.cookie})}));
vi.mock("@/lib/auth/broker/lineage-auth",()=>({prepareBrokerAdmissionLineage:async()=>({ok:true,bootstrapHash:"fixture-root",browserLineageId:"fixture-lineage"})}));
vi.mock("@/lib/auth/broker/registry",async(original)=>{
 const actual=await original<typeof import("./registry")>();
 return {...actual,
  probeBrokerCapability:async()=>({ok:true,boundAdmit:true}),
  reserveBoundAuthIntent:async(input:{purpose:string})=>{m.row.purpose=input.purpose;return {id:m.row.id,stateNonce,browserLineageId:"fixture-lineage"};},
  loadAuthIntentByNonce:async()=>({...m.row,browserLineageId:"fixture-lineage",expiresAt:new Date(Date.now()+600000).toISOString(),pkceVerifier:m.row.pkce_verifier_enc?"fixture-verifier":null}),
  claimProviderAttempt:async()=>{if(m.row.provider_state!=="ready")return {ok:false,claimed:false};m.row.provider_state="in_flight";return {ok:true,claimed:true};},
  recordProviderSessionCapture:async()=>{m.row.provider_state="session_captured";return true;},
  admitBoundSessionAtomic:async()=>({cookieName:"vel_sh_"+"a".repeat(32),handle:"fixture-opaque-handle-".repeat(3),generation:"fixture-generation",userId:actor.id,boundaryFingerprint:"aaaaaaaaaaaaaaaa"}),
 };
});
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{
 let update:Record<string,unknown>={},onlyMissing=false,readyOnly=false;
 const q={update:(value:Record<string,unknown>)=>{update=value;return q;},eq:(key:string,value:string)=>{if(key==="provider_state"&&value==="ready")readyOnly=true;return q;},
  is:()=>{onlyMissing=true;return q;},select:async()=>{
   if(m.failPersist||(onlyMissing&&m.row.pkce_verifier_enc)||(readyOnly&&m.row.provider_state!=="ready"))return {data:[],error:null};
   Object.assign(m.row,update);m.events.push("persist");return {data:[{id:m.row.id}],error:null};
  }};
 return {from:()=>q};
}}));
vi.mock("@/lib/auth/broker/crypto",async(original)=>({...await original<typeof import("./crypto")>(),encryptSecret:()=>Buffer.from("fixture-encrypted-verifier")}));
vi.mock("@/lib/auth/broker/provider",()=>({createProviderAuthClient:(options?:{persistPkceVerifier?:(v:string)=>Promise<void>})=>({
 client:{auth:{
  signUp:async(input:{options:{emailRedirectTo:string}})=>{await options?.persistPkceVerifier?.("fixture-verifier");m.redirect=input.options.emailRedirectTo;m.events.push("send");return m.send();},
  resend:async(input:{options:{emailRedirectTo:string}})=>{await options?.persistPkceVerifier?.("fixture-verifier");m.redirect=input.options.emailRedirectTo;m.events.push("send");return m.send();},
  exchangeCodeForSession:m.exchange,
 }},getItem:()=>null,setItem:()=>{},entries:()=>[],
}),seedPkceVerifier:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{resend:async(input:{options:{emailRedirectTo:string}})=>{m.redirect=input.options.emailRedirectTo;return m.send();}}})}));
import {signUpWithEmail,resendVerificationEmail} from "@/lib/tenancy/actions";
import {brokerExchangeOAuthCode} from "./login";
const requestNonce="00000000-0000-4000-8000-000000000001";
const signup={name:"Fixture user",email:actor.email,password:"fixture-password-only",confirmPassword:"fixture-password-only",requestNonce};
const writer={set:m.cookie},reader={getAll:()=>[]};
beforeEach(()=>{
 vi.clearAllMocks();m.events.length=0;m.failPersist=false;m.redirect="";
 m.row={id:"fixture-intent",purpose:"signup_email",status:"reserved",provider_state:"ready",pkce_verifier_enc:null};
 m.send.mockResolvedValue({data:{user:{...actor,email_confirmed_at:null},session:null},error:null});
 const payload=Buffer.from(JSON.stringify({session_id:"00000000-0000-4000-8000-000000000002"})).toString("base64url");
 m.exchange.mockResolvedValue({data:{user:actor,session:{user:actor,access_token:"fixture."+payload+".fixture",refresh_token:"fixture-refresh-only",expires_in:3600}},error:null});
});
async function exchange(){
 return brokerExchangeOAuthCode({code:"fixture-code",stateNonce,reader,writer});
}
describe("email request to bound callback",()=>{
 it("persists PKCE before signup and leaves callback claim available",async()=>{
  expect(await signUpWithEmail(signup)).toMatchObject({ok:true,data:{needsVerification:true}});
  expect(m.events).toEqual(["persist","send"]);expect(m.row.provider_state).toBe("ready");
  expect(new URL(m.redirect).searchParams.get("vel_intent")).toBe(stateNonce);
  expect(await exchange()).toMatchObject({ok:true,generation:"fixture-generation"});expect(m.exchange).toHaveBeenCalledOnce();
 });
 it("resend binds a fresh PKCE callback without recreating a user",async()=>{
  expect(await resendVerificationEmail(actor.email,"/setup",requestNonce)).toMatchObject({ok:true});
  expect(m.events).toEqual(["persist","send"]);expect(new URL(m.redirect).searchParams.get("vel_intent")).toBe(stateNonce);
  expect(await exchange()).toMatchObject({ok:true});
 });
 it("refuses mail when durable PKCE persistence fails and permits a safe retry",async()=>{
  m.failPersist=true;expect(await signUpWithEmail(signup)).toMatchObject({ok:false,code:"UNAVAILABLE"});
  expect(m.send).not.toHaveBeenCalled();m.failPersist=false;
  expect(await signUpWithEmail(signup)).toMatchObject({ok:true});expect(m.send).toHaveBeenCalledOnce();
 });
 it("keeps an uncertain signup from sending a second email",async()=>{
  m.send.mockResolvedValue({data:{user:null,session:null},error:{status:503,name:"AuthRetryableFetchError"}});
  expect(await signUpWithEmail(signup)).toMatchObject({ok:false,code:"UNAVAILABLE"});
  expect(await signUpWithEmail(signup)).toMatchObject({ok:false,code:"UNAVAILABLE"});expect(m.send).toHaveBeenCalledOnce();
 });
 it("requires a request nonce for resend",async()=>{
  expect(await resendVerificationEmail(actor.email,"/setup")).toMatchObject({ok:false,code:"UNAVAILABLE"});
  expect(m.send).not.toHaveBeenCalled();
 });
 it("keeps resend transport failure unavailable",async()=>{
  m.send.mockResolvedValue({data:{user:null,session:null},error:{status:503,name:"AuthRetryableFetchError"}});
  expect(await resendVerificationEmail(actor.email,"/setup",requestNonce)).toMatchObject({ok:false,code:"UNAVAILABLE"});
 });
});
