import {describe,expect,it,vi} from "vitest";
import {readNumberConfirmationStore,decideNumberConfirmationStore} from "./number-confirmation-store";
const company="00000000-0000-4000-8000-000000000001",link="00000000-0000-4000-8000-000000000002";
const client=(data:unknown,error:unknown=null)=>({rpc:vi.fn(async()=>({data,error}))});
describe("F5 number confirmation store",()=>{
 it("reads pending state bound to the exact link generation",async()=>{
  const c=client({ok:true,status:"pending",link_id:link.toUpperCase(),link_generation:3});
  await expect(readNumberConfirmationStore(c,company)).resolves.toEqual({ok:true,status:"pending",linkId:link,linkGeneration:3,displayNumber:null});
  expect(c.rpc).toHaveBeenCalledWith("whatsapp_read_number_confirmation",{p_company_id:company});
 });
 it("treats grandfathered links as not_required and fails closed on malformed rows",async()=>{
  await expect(readNumberConfirmationStore(client({ok:true,status:"not_required"}),company)).resolves.toEqual({ok:true,status:"not_required"});
  await expect(readNumberConfirmationStore(client({ok:true,status:"weird"}),company)).resolves.toEqual({ok:false,code:"UNAVAILABLE"});
  await expect(readNumberConfirmationStore(client({ok:true,status:"pending",link_id:"x",link_generation:1}),company)).resolves.toEqual({ok:false,code:"UNAVAILABLE"});
  await expect(readNumberConfirmationStore(client(null,{message:"boom"}),company)).resolves.toEqual({ok:false,code:"UNAVAILABLE"});
  await expect(readNumberConfirmationStore(client({ok:false,code:"FORBIDDEN"}),company)).resolves.toEqual({ok:false,code:"FORBIDDEN"});
 });
 it("sends the exact decision and surfaces disconnect and conflict outcomes",async()=>{
  const c=client({ok:true,status:"rejected",disconnected:true});
  await expect(decideNumberConfirmationStore(c,{companyId:company,linkId:link,linkGeneration:2,answer:"rejected"})).resolves.toEqual({ok:true,status:"rejected",replayed:false,disconnected:true});
  expect(c.rpc).toHaveBeenCalledWith("whatsapp_decide_number_confirmation",{p_company_id:company,p_link_id:link,p_link_generation:2,p_answer:"rejected"});
  await expect(decideNumberConfirmationStore(client({ok:false,code:"ALREADY_DECIDED"}),{companyId:company,linkId:link,linkGeneration:2,answer:"confirmed"})).resolves.toEqual({ok:false,code:"ALREADY_DECIDED"});
  await expect(decideNumberConfirmationStore(client({ok:false,code:"DISCONNECT_FAILED"}),{companyId:company,linkId:link,linkGeneration:2,answer:"rejected"})).resolves.toEqual({ok:false,code:"DISCONNECT_FAILED"});
 });
 it("rejects invalid input without calling the database",async()=>{
  const c=client({});
  await expect(decideNumberConfirmationStore(c,{companyId:company,linkId:link,linkGeneration:1,answer:"maybe" as never})).resolves.toEqual({ok:false,code:"INVALID_INPUT"});
  expect(c.rpc).not.toHaveBeenCalled();
 });
});
