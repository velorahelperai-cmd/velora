import {beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({load:vi.fn(),reserve:vi.fn(),provider:vi.fn()}));
vi.mock("./registry",async original=>({...await original<typeof import("./registry")>(),
 probeBrokerCapability:async()=>({ok:true}),loadAuthIntentByNonce:m.load,reserveBoundAuthIntent:m.reserve,
}));
vi.mock("./lineage-auth",()=>({prepareBrokerAdmissionLineage:async()=>({ok:true,bootstrapHash:"fixture-root",browserLineageId:"fixture-lineage"})}));
vi.mock("./provider",()=>({createProviderAuthClient:()=>({client:{auth:{signInWithOAuth:m.provider}}}),readPkceVerifier:()=>"fixture-verifier"}));
vi.mock("./crypto",async original=>({...await original<typeof import("./crypto")>(),encryptSecret:()=>Buffer.from("fixture-encrypted")}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{const q={update:()=>q,eq:()=>q,is:()=>q,select:async()=>({data:[],error:null})};return {from:()=>q};}}));
import {brokerStartOAuth} from "./login";
const saved={id:"fixture-id",purpose:"oauth_google",status:"reserved",pkceVerifier:"fixture-verifier",browserLineageId:"fixture-lineage",expiresAt:new Date(Date.now()+600000).toISOString()};
const input={provider:"google" as const,next:"/setup",reader:{getAll:()=>[]},writer:{set(){}},requestNonce:"00000000-0000-4000-8000-000000000001"};
beforeEach(()=>{
 vi.clearAllMocks();m.reserve.mockResolvedValue({id:saved.id,stateNonce:"fixture-state",browserLineageId:saved.browserLineageId,providerState:"ready"});
 m.load.mockResolvedValue(saved);m.provider.mockResolvedValue({data:{url:"https://provider.example/oauth"},error:null});
});
describe("server-owned OAuth replacement decision",()=>{
 it.each(["committed","rejected","expired"])("allows a new gesture after a %s intent",async status=>{
  m.load.mockResolvedValue({...saved,status});
  expect(await brokerStartOAuth(input)).toMatchObject({ok:false,code:"OAUTH_NEW_INTENT_REQUIRED"});expect(m.provider).not.toHaveBeenCalled();
 });
 it("can supersede an issued URL whose code exchange has never been claimed",async()=>{
  expect(await brokerStartOAuth(input)).toMatchObject({ok:false,code:"OAUTH_NEW_INTENT_REQUIRED"});expect(m.provider).not.toHaveBeenCalled();
 });
 it.each(["in_flight","unknown","session_captured"])("does not supersede a %s exchange",async providerState=>{
  m.reserve.mockResolvedValue({id:saved.id,stateNonce:"fixture-state",browserLineageId:saved.browserLineageId,providerState});
  expect(await brokerStartOAuth(input)).toMatchObject({ok:false,code:"UNAVAILABLE"});expect(m.provider).not.toHaveBeenCalled();
 });
 it("refuses a foreign lineage or a different purpose",async()=>{
  for(const row of [{...saved,browserLineageId:"other-lineage"},{...saved,purpose:"signup_email"}]){
   m.load.mockResolvedValue(row);expect(await brokerStartOAuth(input)).toMatchObject({ok:false,code:"UNAVAILABLE"});
  }
  expect(m.provider).not.toHaveBeenCalled();
 });
});
