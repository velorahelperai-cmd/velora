import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import type {CompanyContext} from "./types";
const state=vi.hoisted(()=>({access:vi.fn(),identity:vi.fn(),client:vi.fn(),row:null as unknown,rowError:null as unknown,readReject:false,from:vi.fn(),select:vi.fn(),eq:vi.fn(),write:vi.fn()}));
vi.mock("@/lib/tenancy/access",async()=>({...await vi.importActual<typeof import("./access")>("./access"),getCompanyAccess:state.access}));
vi.mock("@/lib/auth/server-identity",()=>({readSessionIdentity:state.identity}));
vi.mock("@/lib/supabase/server",()=>({createClient:state.client}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {completeProfileName,getAccountProfile,updateAccountName} from "./actions";
const context=(admin=false):CompanyContext=>({userId:"synthetic-owner",email:"owner@synthetic.invalid",phone:"",fullName:"Confirmed name",supportCode:"SYNTHETIC",needsProfileName:false,emailConfirmed:true,identityVerified:true,isPlatformAdmin:admin,company:null,membership:null,needsCompanyContext:false,workspaceChoices:[]});
beforeEach(()=>{vi.clearAllMocks();state.row=null;state.rowError=null;state.readReject=false;state.identity.mockResolvedValue({ok:true,userId:"synthetic-owner",email:"owner@synthetic.invalid",fullName:"Confirmed name",emailConfirmed:true,sessionExpiresAt:"2026-10-11T12:00:00Z"});state.access.mockResolvedValue({ok:true,context:context()});state.from.mockImplementation((table:string)=>{const query={select:(fields:string)=>{state.select(table,fields);return query;},eq:(...args:unknown[])=>{state.eq(table,...args);return query;},maybeSingle:async()=>{if(state.readReject)throw new Error("Synthetic read failure");return {data:state.row,error:state.rowError};},upsert:(input:unknown)=>{state.write(table,input);return query;},single:async()=>({data:{user_id:"synthetic-owner",full_name:"Saved name",support_code:"SYNTHETIC"},error:null}),update:()=>query};return query;});state.client.mockResolvedValue({from:state.from,auth:{getUser:async()=>({data:{user:{id:"synthetic-owner",email:"owner@synthetic.invalid",email_confirmed_at:"confirmed"}},error:null})}});});
describe("persisted account platform identity is display metadata",()=>{
 it.each(["owner","delegated"] as const)("reads own %s identity using only role/status",async role=>{state.row={role,status:"active"};state.access.mockResolvedValue({ok:true,context:context(role==="owner")});const result=await getAccountProfile();expect(result).toMatchObject({ok:true,data:{platformIdentity:{role,status:"active",unavailable:false},role:null,companyId:null,workspaceHref:null,adminHref:role==="owner"?"/admin":null}});expect(state.select).toHaveBeenCalledWith("platform_admins","role,status");expect(state.eq).toHaveBeenCalledWith("platform_admins","user_id","synthetic-owner");expect(state.write).not.toHaveBeenCalled();});
 it("disabled persisted owner identity does not grant admin access",async()=>{state.row={role:"owner",status:"disabled"};expect(await getAccountProfile()).toMatchObject({ok:true,data:{platformIdentity:{role:"owner",status:"disabled",unavailable:false},isPlatformAdmin:false,adminHref:null}});});
 it.each(["error","reject","malformed"])("shows unavailable metadata on %s instead of inventing a role",async mode=>{if(mode==="error")state.rowError={code:"42501"};if(mode==="reject")state.readReject=true;if(mode==="malformed")state.row={role:"admin",status:"active"};expect(await getAccountProfile()).toMatchObject({ok:true,data:{platformIdentity:{role:null,status:null,unavailable:true}}});});
 it("verified absence is distinct from an unavailable read",async()=>{expect(await getAccountProfile()).toMatchObject({ok:true,data:{platformIdentity:{role:null,status:null,unavailable:false}}});});
 it("does not query platform metadata for an unverified account",async()=>{state.identity.mockResolvedValue({ok:true,userId:"synthetic-owner",email:"owner@synthetic.invalid",fullName:"Confirmed name",emailConfirmed:false});state.access.mockResolvedValue({ok:false,code:"UNVERIFIED"});await getAccountProfile();expect(state.from).not.toHaveBeenCalledWith("platform_admins");});
});
describe("account name action boundaries",()=>{
 it("refuses a name draft submitted for a different account",async()=>{expect(await updateAccountName("Saved name","different-account")).toMatchObject({ok:false,code:"UNAUTHENTICATED"});expect(state.write).not.toHaveBeenCalled();});
 it.each([null,42,{}," ","x","x".repeat(121)])("refuses malformed or out-of-range name %j",async name=>{expect(await updateAccountName(name as unknown as string)).toMatchObject({ok:false,code:"INVALID_INPUT"});expect(state.write).not.toHaveBeenCalled();});
 it("retains a confirmed name save and platform identity when company refresh fails",async()=>{state.row={role:"owner",status:"active"};state.access.mockResolvedValueOnce({ok:true,context:context(true)}).mockRejectedValueOnce(new Error("Synthetic refresh failure"));expect(await updateAccountName("  Saved name  ")).toMatchObject({ok:true,data:{fullName:"Saved name",platformIdentity:{role:"owner",status:"active",unavailable:false}}});expect(state.write).toHaveBeenCalledWith("profiles",{user_id:"synthetic-owner",full_name:"Saved name"});});
 it("refuses an identity switch before writing",async()=>{state.identity.mockResolvedValue({ok:true,userId:"different-account",emailConfirmed:true});expect(await updateAccountName("Saved name")).toMatchObject({ok:false,code:"UNAUTHENTICATED"});expect(state.write).not.toHaveBeenCalled();});
});

describe("confirmed profile completion survives secondary read failures",()=>{
 function database({memberFailure=false,profileFailure=false}:{memberFailure?:boolean;profileFailure?:boolean}={}){
  const persisted=new Map<string,string>();
  state.from.mockImplementation(()=>({
   upsert:async(input:{user_id:string;full_name:string})=>{
    if(profileFailure)return {error:{code:'42501'}};
    persisted.set(input.user_id,input.full_name);return {error:null};
   },
   update:()=>({eq:()=>({eq:async()=>{if(memberFailure)throw Error('Synthetic member refresh unavailable');return {error:null};}})}),
  }));
  return persisted;
 }
 it("returns the confirmed save after membership display synchronization throws",async()=>{
  const persisted=database({memberFailure:true});
  expect(await completeProfileName('  Saved profile  ','/setup','synthetic-owner')).toEqual({ok:true,data:{next:'/setup'}});
  expect(persisted.get('synthetic-owner')).toBe('Saved profile');
 });
 it("routes a confirmed save to access recovery when the post-save read throws",async()=>{
  const persisted=database();state.access.mockRejectedValueOnce(Error('Synthetic access read unavailable'));
  expect(await completeProfileName('Saved profile','/setup','synthetic-owner')).toEqual({ok:true,data:{next:'/access?code=UNAVAILABLE&next=%2Fsetup'}});
  expect(persisted.size).toBe(1);
 });
 it("never reports a failed profile write as completed",async()=>{
  const persisted=database({profileFailure:true});
  expect(await completeProfileName('Saved profile','/setup','synthetic-owner')).toMatchObject({ok:false});
  expect(persisted.size).toBe(0);expect(state.access).not.toHaveBeenCalled();
 });
 it("does not use another account's post-save access snapshot",async()=>{
  database();state.access.mockResolvedValueOnce({ok:true,context:{...context(),userId:'different-account'}});
  expect(await completeProfileName('Saved profile','/setup','synthetic-owner')).toEqual({ok:true,data:{next:'/access?code=UNAVAILABLE&next=%2Fsetup'}});
 });
});
