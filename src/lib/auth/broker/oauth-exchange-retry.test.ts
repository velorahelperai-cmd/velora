import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({
 row:{id:"fixture-intent",browser_lineage_id:"fixture-lineage",status:"reserved",provider_state:"ready",cleanup_state:"not_needed"},
 exchange:vi.fn(),authorize:vi.fn(),failJournal:false,filters:[] as Array<[string,unknown]>,
}));
vi.mock("./registry",async original=>({...await original<typeof import("./registry")>(),
 probeBrokerCapability:async()=>({ok:true,boundAdmit:true}),
 reserveBoundAuthIntent:async()=>({id:m.row.id,stateNonce:"fixture-state-nonce-123456",browserLineageId:m.row.browser_lineage_id,providerState:m.row.provider_state}),
 loadAuthIntentByNonce:async()=>({id:m.row.id,status:m.row.status,purpose:"oauth_google",pkceVerifier:"fixture-verifier",browserLineageId:m.row.browser_lineage_id,expiresAt:new Date(Date.now()+600000).toISOString()}),
 claimProviderAttempt:async()=>{if(m.row.provider_state!=="ready")return {ok:false,claimed:false};m.row.provider_state="in_flight";return {ok:true,claimed:true};},
}));
vi.mock("./lineage-auth",()=>({prepareBrokerAdmissionLineage:async()=>({ok:true,bootstrapHash:"fixture-root",browserLineageId:"fixture-lineage"})}));
vi.mock("./provider",()=>({
 createProviderAuthClient:()=>({client:{auth:{exchangeCodeForSession:m.exchange,signInWithOAuth:m.authorize}}}),
 seedPkceVerifier:vi.fn(),readPkceVerifier:()=>"fixture-verifier",
}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{
 let update:Record<string,unknown>={};const filters:Array<[string,unknown]>=[];
 const q={update:(value:Record<string,unknown>)=>{update=value;return q;},
 eq:(key:string,value:unknown)=>{filters.push([key,value]);return q;},
 select:async()=>{m.filters=filters;
  if(m.failJournal||!filters.every(([key,value])=>Reflect.get(m.row,key)===value))return {data:[],error:null};
  Object.assign(m.row,update);return {data:[{id:m.row.id}],error:null};
 }};
 return {from:()=>q};
}}));
import { brokerExchangeOAuthCode, brokerStartOAuth } from "./login";
const input={reader:{getAll:()=>[]},writer:{set(){}},stateNonce:"fixture-state-nonce-123456",code:"fixture-code"};
const start={...input,provider:"google" as const,next:"/setup",requestNonce:"00000000-0000-4000-8000-000000000001"};
beforeEach(()=>{
 vi.clearAllMocks();Object.assign(m.row,{status:"reserved",provider_state:"ready",cleanup_state:"not_needed"});
 m.failJournal=false;m.filters=[];m.exchange.mockResolvedValue({data:{session:null},error:{status:400,code:"bad_code_verifier",name:"AuthApiError"}});
});
describe("actual OAuth exchange disposition before another intentional start",()=>{
 it("durably retires a confirmed rejection before allowing a new gesture",async()=>{
  expect(await brokerExchangeOAuthCode(input)).toMatchObject({ok:false,code:"AUTH_ERROR",expireIntent:true});
  expect(m.row).toMatchObject({status:"rejected",provider_state:"rejected",cleanup_state:"not_needed"});
  expect(m.filters).toEqual(expect.arrayContaining([["id",m.row.id],["browser_lineage_id","fixture-lineage"],["status","reserved"],["provider_state","in_flight"]]));
  expect(await brokerStartOAuth(start)).toMatchObject({ok:false,code:"OAUTH_NEW_INTENT_REQUIRED"});
  expect(m.exchange).toHaveBeenCalledTimes(1);expect(m.authorize).not.toHaveBeenCalled();
 });
 it.each([503,408])("keeps HTTP %s UNKNOWN and prevents provider replay",async status=>{
  m.exchange.mockResolvedValue({data:{session:null},error:{status,name:"AuthApiError"}});
  expect(await brokerExchangeOAuthCode(input)).toMatchObject({ok:false,code:"UNAVAILABLE",expireIntent:false});
  expect(m.row.status).toBe("reserved");
  expect(await brokerStartOAuth(start)).toMatchObject({ok:false,code:"UNAVAILABLE"});
  expect(m.authorize).not.toHaveBeenCalled();expect(m.exchange).toHaveBeenCalledTimes(1);
 });
 it.each(["network throw","missing session"])("keeps %s UNKNOWN without expiring the bound cookie",async scenario=>{
  if(scenario==="network throw")m.exchange.mockRejectedValue(new TypeError("synthetic network failure"));
  else m.exchange.mockResolvedValue({data:{session:null},error:null});
  expect(await brokerExchangeOAuthCode(input)).toMatchObject({ok:false,code:"UNAVAILABLE",expireIntent:false});
  expect(await brokerStartOAuth(start)).toMatchObject({ok:false,code:"UNAVAILABLE"});
  expect(m.authorize).not.toHaveBeenCalled();expect(m.exchange).toHaveBeenCalledTimes(1);
 });
 it("requires exactly one journal row before declaring a rejection terminal",async()=>{
  m.failJournal=true;
  expect(await brokerExchangeOAuthCode(input)).toMatchObject({ok:false,code:"UNAVAILABLE",expireIntent:false});
  expect(m.row.provider_state).toBe("in_flight");
  expect(await brokerStartOAuth(start)).toMatchObject({ok:false,code:"UNAVAILABLE"});
 });
});
