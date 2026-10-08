import {describe,expect,it} from "vitest";
import {finishEmbeddedSignup, type SignupPorts} from "./embedded-signup-flow";
const identity={companyId:"company",userId:"owner",sessionId:"session"};
const input={attemptId:"attempt",nonce:"nonce",code:"code",wabaId:"222",phoneNumberId:"333",pin:"123456"};
const config={enabled:true,appId:"111",configId:"444",appSecret:"secret",systemUserToken:"system",graphVersion:"v25.0"};
const proof={app_id:"111",waba_id:"222",phone_number_id:"333",display_phone_number:"+96899001122",scopes:["whatsapp_business_management","whatsapp_business_messaging"],granular_scopes:[{scope:"whatsapp_business_management",target_ids:["222"]},{scope:"whatsapp_business_messaging",target_ids:["222"]}],expires_at:0,data_access_expires_at:0,authorization_expires_at:null,code_verification_status:"VERIFIED" as const,platform_type:"CLOUD_API" as const,registered:true as const,subscribed:true as const,is_on_biz_app:false as const,verified_at:"2026-10-08T02:00:00Z"};
function fake(change:Record<string,unknown>={}){
 const events:string[]=[];
 const ports:SignupPorts={claim:async()=>({ok:true,attempt_id:"attempt",company_id:"company",user_id:"owner",session_id:"session",app_id:"111",config_id:"444",graph_version:"v25.0",keep_on_phone:false,...change}),provider:async()=>{events.push("provider");return {ok:true,accessToken:"secret-token",proof};},finalize:async(_claim,token,p)=>{if(token!=="secret-token"||p!==proof)throw Error("bad secret or proof");events.push("vault");return {ok:true};},fail:async()=>{events.push("failed");}};
 return {ports,events};
}
describe("durable signup completion",()=>{
 it.each([{session_id:"other-session"},{company_id:"other-company"},{user_id:"other-user"},{app_id:"other-app"},{config_id:"other-config"},{graph_version:"v26.0"}])("rejects mismatched persisted binding before provider",async change=>{
  const f=fake(change);expect(await finishEmbeddedSignup(identity,input,config,f.ports)).toEqual({ok:false,code:"FORBIDDEN"});expect(f.events).toEqual([]);
 });
 it("claims the durable attempt before exchanging the single-use code and returns no token",async()=>{
  const f=fake();const result=await finishEmbeddedSignup(identity,input,config,f.ports);expect(result).toEqual({ok:true});expect(f.events).toEqual(["provider","vault"]);expect(JSON.stringify(result)).not.toContain("secret-token");
 });
 it("refuses replay before exchanging the code",async()=>{
  const f=fake();f.ports.claim=async()=>({ok:false,code:"CONSUMED"});expect(await finishEmbeddedSignup(identity,input,config,f.ports)).toEqual({ok:false,code:"CONSUMED"});expect(f.events).toEqual([]);
 });
 it("retains reconciliation state after an unknown provider write",async()=>{
  const f=fake();f.ports.provider=async()=>({ok:false,code:"RECONCILIATION_REQUIRED"});expect(await finishEmbeddedSignup(identity,input,config,f.ports)).toEqual({ok:false,code:"RECONCILIATION_REQUIRED"});expect(f.events).toEqual(["failed"]);
 });
});
