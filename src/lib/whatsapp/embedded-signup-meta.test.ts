import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {onboardMetaSignup, type MetaSignupConfig} from "./embedded-signup-meta";

const config:MetaSignupConfig={enabled:true,appId:"111",appSecret:"secret",systemUserToken:"system",graphVersion:"v25.0"};
const debug={data:{app_id:"111",is_valid:true,expires_at:0,data_access_expires_at:0,scopes:["whatsapp_business_management","whatsapp_business_messaging"],granular_scopes:[{scope:"whatsapp_business_management",target_ids:["222"]},{scope:"whatsapp_business_messaging",target_ids:["222"]}]}};
const phone={id:"333",display_phone_number:"+968 99001122",code_verification_status:"VERIFIED",platform_type:"CLOUD_API",status:"CONNECTED",is_on_biz_app:false};
function fake(overrides:{debug?:unknown;finalDebug?:unknown;phone?:unknown;subscription?:unknown;registerTimeout?:boolean;unregistered?:boolean}={}) {
 const writes:string[]=[];
 let debugReads=0;
 const http=async(url:string,init?:RequestInit)=>{
  const u=new URL(url); const path=u.pathname;
  if(init?.method==="POST") {writes.push(path);if(path.endsWith("/register")&&overrides.registerTimeout)throw Error("timeout URL contains secret");return Response.json({success:true});}
  if(path.endsWith("/oauth/access_token"))return Response.json({access_token:"business-secret"});
  if(path.endsWith("/debug_token")){debugReads++;return Response.json(debugReads>1?(overrides.finalDebug??overrides.debug??debug):(overrides.debug??debug));}
  if(path.endsWith("/phone_numbers"))return Response.json({data:[overrides.phone??phone]});
  if(path.endsWith("/subscribed_apps"))return Response.json(overrides.subscription??{data:[{whatsapp_business_api_data:{id:"111",name:"Velora"}}]});
  if(path.endsWith("/333"))return Response.json(overrides.unregistered?{...phone,status:"PENDING"}:overrides.phone??phone);
  if(path.endsWith("/222"))return Response.json({id:"222"});
  throw Error("unexpected request");
 };
 return {http,writes};
}
const input={code:"ephemeral-code",wabaId:"222",phoneNumberId:"333",pin:"123456",keepOnPhone:false};
describe("Meta Embedded Signup verification",()=>{
 it("keeps default-off setup from executing any provider request",async()=>{
  const f=fake(); const r=await onboardMetaSignup({...config,enabled:false},input,f.http);
  expect(r).toEqual({ok:false,code:"NEEDS_SETUP"});expect(f.writes).toEqual([]);
 });
 it.each([
  {data:{...debug.data,app_id:"999"}},
  {data:{...debug.data,is_valid:false}},
  {data:{...debug.data,granular_scopes:[{scope:"whatsapp_business_management",target_ids:["222"]},{scope:"whatsapp_business_messaging",target_ids:["999"]}]}},
  {data:{...debug.data,expires_at:1}},
 ])("rejects wrong-app, revoked, ungranted, or expired tokens before writes",async bad=>{
  const f=fake({debug:bad});expect(await onboardMetaSignup(config,input,f.http)).toEqual({ok:false,code:"META_AUTHORIZATION_REJECTED"});expect(f.writes).toEqual([]);
 });
 it("requires the selected phone to belong to the granted WABA",async()=>{
  const f=fake({phone:{...phone,id:"444"}});expect(await onboardMetaSignup(config,input,f.http)).toEqual({ok:false,code:"META_ASSET_REJECTED"});expect(f.writes).toEqual([]);
 });
 it("does not finalize from an HTTP 200 subscription response without matching readback",async()=>{
  const f=fake({subscription:{data:[{whatsapp_business_api_data:{id:"999"}}]}});
  expect(await onboardMetaSignup(config,input,f.http)).toEqual({ok:false,code:"RECONCILIATION_REQUIRED"});
 });
 it("returns only verified proof with a server-held token",async()=>{
  const f=fake();const r=await onboardMetaSignup(config,input,f.http);expect(r).toMatchObject({ok:true,accessToken:"business-secret",proof:{app_id:"111",waba_id:"222",phone_number_id:"333",code_verification_status:"VERIFIED",platform_type:"CLOUD_API",subscribed:true,registered:true,authorization_expires_at:null}});
 });
 it("does not retry a registration with an unknown outcome",async()=>{
  const f=fake({unregistered:true,registerTimeout:true});expect(await onboardMetaSignup(config,input,f.http)).toEqual({ok:false,code:"RECONCILIATION_REQUIRED"});expect(f.writes.filter(x=>x.endsWith("/register"))).toHaveLength(1);
 });
 it("rechecks token validity after the account writes before returning usable proof",async()=>{
  const f=fake({finalDebug:{data:{...debug.data,is_valid:false}}});
  expect(await onboardMetaSignup(config,input,f.http)).toEqual({ok:false,code:"RECONCILIATION_REQUIRED"});
 });
 it("refuses unsupported keep-on-phone without doing any account write",async()=>{
  const f=fake();expect(await onboardMetaSignup(config,{...input,keepOnPhone:true},f.http)).toEqual({ok:false,code:"NEEDS_SETUP"});expect(f.writes).toEqual([]);
 });
});
