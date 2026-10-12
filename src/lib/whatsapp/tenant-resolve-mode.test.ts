import {expect,it} from "vitest";
import {resolveWhatsappCompanyByMetaAsset} from "./tenant-resolve";
const row={ok:true,eligible:true,company_id:"10000000-0000-4000-8000-000000000001",link_id:"10000000-0000-4000-8000-000000000002",link_generation:1,provider_phone_number_id:"333",provider_waba_id:"222",status:"verified"};
const client=(data:unknown)=>({rpc:async()=>({data,error:null})}) as unknown as Parameters<typeof resolveWhatsappCompanyByMetaAsset>[0];
it("carries exact persisted coexistence mode into live inbound routing",async()=>expect(await resolveWhatsappCompanyByMetaAsset(client({...row,connection_mode:"coexistence"}),"222","333")).toMatchObject({ok:true,connectionMode:"coexistence"}));
it("preserves legacy independent-number mode when installed old helper has no mode field",async()=>expect(await resolveWhatsappCompanyByMetaAsset(client(row),"222","333")).toMatchObject({ok:true,connectionMode:"cloud_api"}));
it("does not silently downgrade a malformed persisted mode into independent routing",async()=>expect(await resolveWhatsappCompanyByMetaAsset(client({...row,connection_mode:"unknown"}),"222","333")).toEqual({ok:false,eligible:false,code:"unavailable"}));
it("exposes a proven pending checkpoint solely for durable ingress without granting operational eligibility",async()=>expect(await resolveWhatsappCompanyByMetaAsset(client({ok:false,eligible:false,code:"unknown_or_inactive",connection_mode:"coexistence_pending"}),"222","333")).toEqual({ok:false,eligible:false,code:"unknown_or_inactive",pendingCoexistence:true}));
