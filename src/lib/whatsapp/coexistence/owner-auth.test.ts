import {describe,expect,it} from "vitest";
import {authorizeCoexistenceOwner,type OwnerAuthPorts} from "./owner-auth";
const company="10000000-0000-4000-8000-000000000001",user="10000000-0000-4000-8000-000000000002",session="10000000-0000-4000-8000-000000000003";
function ports(change:Partial<OwnerAuthPorts>={}):OwnerAuthPorts {return {
 access:async()=>({ok:true,context:{identityVerified:true,userId:user,company:{id:company,status:"active"},membership:{role:"owner"}}}),
 session:async()=>({client:{rpc:async()=>({data:null,error:null})},subject:user,sessionId:session,claimsError:false}),
 checkSession:async()=>({ok:true}),...change,
};}
describe("coexistence native owner boundary",()=>{
 it("binds the current selected company, user and native session",async()=>{
  const r=await authorizeCoexistenceOwner(company,ports());expect(r.ok).toBe(true);
  if(r.ok)expect(r.identity).toEqual({companyId:company,userId:user,sessionId:session});
 });
 it.each(["staff","admin",null])("rejects role %s before creating a provider-capable session",async role=>{
  let created=false;const r=await authorizeCoexistenceOwner(company,ports({access:async()=>({ok:true,context:{identityVerified:true,userId:user,company:{id:company,status:"active"},membership:role?{role}:null}}),session:async()=>{created=true;throw Error("must not run");}}));
  expect(r).toEqual({ok:false,code:"FORBIDDEN"});expect(created).toBe(false);
 });
 it("rejects an explicitly different tenant",async()=>expect(await authorizeCoexistenceOwner("10000000-0000-4000-8000-000000000009",ports())).toEqual({ok:false,code:"FORBIDDEN"}));
 it("rejects unverified identity",async()=>expect(await authorizeCoexistenceOwner(company,ports({access:async()=>({ok:true,context:{identityVerified:false,userId:user,company:{id:company,status:"active"},membership:{role:"owner"}}})}))).toEqual({ok:false,code:"FORBIDDEN"}));
 it("rejects suspended company",async()=>expect(await authorizeCoexistenceOwner(company,ports({access:async()=>({ok:true,context:{identityVerified:true,userId:user,company:{id:company,status:"suspended"},membership:{role:"owner"}}})}))).toEqual({ok:false,code:"COMPANY_SUSPENDED"}));
 it.each([{subject:"other",sessionId:session,claimsError:false},{subject:user,sessionId:"invalid",claimsError:false},{subject:user,sessionId:session,claimsError:true}])("rejects invalid native claims %#",async claims=>expect(await authorizeCoexistenceOwner(company,ports({session:async()=>({client:{rpc:async()=>({data:null,error:null})},...claims})}))).toEqual({ok:false,code:"FORBIDDEN"}));
 it("denies a revoked or expired app session",async()=>expect(await authorizeCoexistenceOwner(company,ports({checkSession:async()=>({ok:false})}))).toEqual({ok:false,code:"FORBIDDEN"}));
 it("fails closed when auth dependencies are unavailable",async()=>expect(await authorizeCoexistenceOwner(company,ports({access:async()=>{throw Error("secret-shaped-error");}}))).toEqual({ok:false,code:"UNAVAILABLE"}));
 it("rejects missing explicit company before access",async()=>expect(await authorizeCoexistenceOwner("",ports())).toEqual({ok:false,code:"INVALID_INPUT"}));
});
