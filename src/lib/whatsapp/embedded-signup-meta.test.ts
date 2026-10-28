import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {exchangeEarlyMetaAuthorization,onboardMetaSignup, type MetaSignupConfig} from "./embedded-signup-meta";

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
 it('does not retry an automatic registration after an unknown result',async()=>{const f=fake({unregistered:true,registerTimeout:true});const result=await onboardMetaSignup(config,{...input,pin:''},f.http,{token:'prepared',autoPinAllowed:()=>true});expect(result).toEqual({ok:false,code:'RECONCILIATION_REQUIRED'});expect(f.writes.filter(x=>x.endsWith('/register'))).toHaveLength(1);});

 it('generates a server PIN only for approved automatic registration',async()=>{const f=fake({unregistered:true});let sent='';const http=async(url:string,init?:RequestInit)=>{if(url.endsWith('/register'))sent=String(JSON.parse(String(init?.body)).pin);return f.http(url,init);};const result=await onboardMetaSignup(config,{...input,pin:''},http,{token:'prepared',autoPinAllowed:()=>true});expect(sent).toMatch(/^\d{6}$/);expect(JSON.stringify(result)).not.toContain(sent);expect(f.writes.filter(x=>x.endsWith('/register'))).toHaveLength(1);});
 it('uses the existing manual PIN without replacing it',async()=>{const f=fake({unregistered:true});let sent='';const http=async(url:string,init?:RequestInit)=>{if(url.endsWith('/register'))sent=String(JSON.parse(String(init?.body)).pin);return f.http(url,init);};await onboardMetaSignup(config,input,http,{token:'prepared',autoPinAllowed:()=>false});expect(sent).toBe(input.pin);});
 it('denies automatic registration when approval changes before registration',async()=>{const f=fake({unregistered:true});let calls=0;const result=await onboardMetaSignup(config,{...input,pin:''},f.http,{token:'prepared',autoPinAllowed:()=>++calls===1});expect(result).toEqual({ok:false,code:'INVALID_INPUT'});expect(f.writes.some(x=>x.endsWith('/register'))).toBe(false);});

 it('uses only the app credential for debug_token and the customer token for WhatsApp operations',async()=>{const f=fake(),calls:Array<{path:string;authorization?:string}>=[];const http=async(url:string,init?:RequestInit)=>{calls.push({path:new URL(url).pathname,authorization:(init?.headers as Record<string,string>)?.Authorization});return f.http(url,init);};const {systemUserToken:_unused,...appConfig}=config;const result=await onboardMetaSignup(appConfig,input,http);expect(result).toMatchObject({ok:true});expect(calls.filter(c=>c.path.endsWith('/debug_token')).map(c=>c.authorization)).toEqual(['Bearer 111|secret','Bearer 111|secret']);expect(calls.filter(c=>!c.path.endsWith('/debug_token')).every(c=>c.authorization!=='Bearer 111|secret')).toBe(true);expect(JSON.stringify(result)).not.toContain('111|secret');});
 it('reconciles a saved authorization with read-only Meta proof and zero repeated writes',async()=>{const f=fake();expect(await onboardMetaSignup(config,{...input,pin:''},f.http,{token:'saved-token',readOnly:true})).toMatchObject({ok:true,proof:{registered:true,subscribed:true}});expect(f.writes).toEqual([]);});
 it('keeps an interrupted registration unknown when Meta is still pending without retrying it',async()=>{const f=fake({unregistered:true});expect(await onboardMetaSignup(config,{...input,pin:''},f.http,{token:'saved-token',readOnly:true})).toEqual({ok:false,code:'RECONCILIATION_REQUIRED'});expect(f.writes).toEqual([]);});
 it('rejects recovery without the app subscription even if the number is connected',async()=>{const f=fake({subscription:{data:[]}});expect(await onboardMetaSignup(config,{...input,pin:''},f.http,{token:'saved-token',readOnly:true})).toEqual({ok:false,code:'RECONCILIATION_REQUIRED'});expect(f.writes).toEqual([]);});
 it('probes real registration status without any provider writes or public token result',async()=>{const f=fake();let required:boolean|undefined;const result=await onboardMetaSignup(config,{...input,pin:''},f.http,{probe:true,capture:(_token,value)=>{required=value;}});expect(required).toBe(false);expect(f.writes).toEqual([]);expect(result).not.toHaveProperty('accessToken');});
 it('requires a PIN only when the verified number is not registered',async()=>{const f=fake({unregistered:true});let required:boolean|undefined;await onboardMetaSignup(config,{...input,pin:''},f.http,{probe:true,capture:(_token,value)=>{required=value;}});expect(required).toBe(true);expect(f.writes).toEqual([]);});
 it('completes an already registered number with no PIN and without re-exchanging its code',async()=>{const f=fake();const http=async(url:string,init?:RequestInit)=>{expect(url).not.toContain('oauth/access_token');return f.http(url,init);};expect(await onboardMetaSignup(config,{...input,pin:''},http,{token:'prepared-token'})).toMatchObject({ok:true});expect(f.writes.some(path=>path.endsWith('/register'))).toBe(false);});
 it('does not write when registration is required and no PIN was provided',async()=>{const f=fake({unregistered:true});expect(await onboardMetaSignup(config,{...input,pin:''},f.http,{token:'prepared-token'})).toEqual({ok:false,code:'INVALID_INPUT'});expect(f.writes).toEqual([]);});
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

describe('pre-FINISH server exchange',()=>{
 it('exchanges and checks app scopes without requiring WABA IDs or writing assets',async()=>{const f=fake(),paths:string[]=[];const http=async(url:string,init?:RequestInit)=>{paths.push(new URL(url).pathname);return f.http(url,init);};expect(await exchangeEarlyMetaAuthorization(config,'synthetic-code',http)).toEqual({ok:true,token:'business-secret'});expect(paths).toEqual(['/v25.0/oauth/access_token','/v25.0/debug_token']);expect(f.writes).toEqual([]);});
 it.each([{...debug.data,app_id:'999'},{...debug.data,is_valid:false},{...debug.data,expires_at:1},{...debug.data,granular_scopes:[]},{...debug.data,scopes:[]}])('rejects invalid early grants without granting asset authority',async data=>{expect(await exchangeEarlyMetaAuthorization(config,'code',fake({debug:{data}}).http)).toEqual({ok:false});});
 it('does not expose provider exception details',async()=>{expect(await exchangeEarlyMetaAuthorization(config,'code',async()=>{throw Error('sensitive provider URL');})).toEqual({ok:false});});
});
