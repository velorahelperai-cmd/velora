"use server";
import {createAdminClient} from "@/lib/supabase/admin";
import {billingUuid} from "../wiring/public-offer-policy";
import {readFinancialEvidence,financialDb} from "../financial-read";
import {qualifyFinancialOrder,type FinancialRecord} from "../financial-truth";
import {dashboardBillingSnapshot} from "@/lib/customer/dashboard-billing-model";
import {readCompanyBillingDisplay} from "../wiring/display-read";
import {billingOwnerGate,recheckBillingOwner} from "./owner-gate";
import {parseLedgerFilters,encodeBillingCursor,decodeBillingCursor} from "./cursor";
import {ledgerFailure,adminOrderProjection,type AdminBillingPage} from "./model";
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
export async function readAdminBillingOrders(input:unknown={}):Promise<AdminBillingPage>{
 const gate=await billingOwnerGate();if(!gate.ok)return ledgerFailure(gate.code);const filters=parseLedgerFilters(input);if(!filters)return ledgerFailure("invalid_input");
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();if(!key)return ledgerFailure("unavailable");const raw=record(input),cursor=raw?.cursor;const position=cursor===undefined||cursor===null||cursor===""?null:decodeBillingCursor(cursor,filters,gate.binding,key);if(cursor&& !position)return ledgerFailure("invalid_input");
 try{const rpc=gate.client as unknown as {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};const {data,error}=await rpc.rpc("billing_admin_read_order_page",{p_input:{company_id:filters.companyId,environment:filters.environment,from:filters.from,until:filters.until,page_size:filters.pageSize,snapshot:position?.snapshot??null,cursor_created_at:position?.createdAt??null,cursor_id:position?.id??null}});
 const envelope=record(data);if(error||envelope?.ok!==true)return ledgerFailure(envelope?.code==="forbidden"?"forbidden":envelope?.code==="invalid_input"?"invalid_input":"unavailable");
 if(!Array.isArray(envelope.orders)||!Number.isSafeInteger(envelope.total)||Number(envelope.total)<0||typeof envelope.snapshot!=="string"||!Number.isFinite(Date.parse(envelope.snapshot))||envelope.orders.length>filters.pageSize+1||Number(envelope.total)<envelope.orders.length)return ledgerFailure("unavailable");
 const rows:FinancialRecord[]=[];for(const value of envelope.orders){const o=record(value);if(!o||!billingUuid(o.id)||!billingUuid(o.company_id)||filters.companyId!==null&&o.company_id!==filters.companyId||typeof o.created_at!=="string"||!Number.isFinite(Date.parse(o.created_at))||filters.environment!=="all"&&(filters.environment==="unknown"?["live","test"].includes(String(o.provider_environment)):o.provider_environment!==filters.environment)||filters.from!==null&&Date.parse(o.created_at)<Date.parse(filters.from)||filters.until!==null&&Date.parse(o.created_at)>=Date.parse(filters.until)||Date.parse(o.created_at)>Date.parse(envelope.snapshot as string))return ledgerFailure("unavailable");rows.push(o);}
 const hasMore=rows.length>filters.pageSize,selected=rows.slice(0,filters.pageSize);const admin=createAdminClient();if(!admin)return ledgerFailure("unavailable");const projected=[];
 for(const companyId of [...new Set(selected.map(o=>String(o.company_id)))]){const orders=selected.filter(o=>o.company_id===companyId);const evidence=await readFinancialEvidence(financialDb(admin),orders,companyId);for(const order of orders)projected.push(adminOrderProjection(order,qualifyFinancialOrder(companyId,order,evidence)));}
 const byId=new Map(projected.map(o=>[o.id,o]));const resultRows=selected.map(o=>byId.get(String(o.id))!);const last=selected.at(-1);const nextCursor=hasMore&&last?encodeBillingCursor({snapshot:envelope.snapshot,createdAt:String(last.created_at),id:String(last.id)},filters,gate.binding,key):null;
 if(!await recheckBillingOwner(gate.binding))return ledgerFailure("forbidden");return {status:Number(envelope.total)===0?"empty":"ready",rows:resultRows,total:Number(envelope.total),hasMore,nextCursor,snapshot:envelope.snapshot};
 }catch{return ledgerFailure("unavailable");}
}
export async function readAdminBillingOrder(input:{companyId:string;orderId:string}){
 const gate=await billingOwnerGate();if(!gate.ok)return {status:gate.code as "forbidden"|"unavailable",data:null};if(!billingUuid(input?.companyId)||!billingUuid(input?.orderId))return {status:"invalid_input" as const,data:null};
 const admin=createAdminClient();if(!admin)return {status:"unavailable" as const,data:null};
 try{const {data:order,error}=await admin.from("billing_orders").select("*").eq("id",input.orderId).eq("company_id",input.companyId).returns<FinancialRecord[]>().maybeSingle();if(error)return {status:"unavailable" as const,data:null};if(!order)return {status:"not_found" as const,data:null};
 const evidence=await readFinancialEvidence(financialDb(admin),[order as FinancialRecord],input.companyId);const financial=qualifyFinancialOrder(input.companyId,order as FinancialRecord,evidence);const current=await readCompanyBillingDisplay(input.companyId);
 const sameScope=(x:FinancialRecord)=>["company_id","provider","provider_account_ref","provider_environment"].every(k=>x[k]===order[k as keyof typeof order]);
 const attempts=evidence.attempts.filter(x=>x.order_id===input.orderId&&sameScope(x));const ids=new Set(attempts.map(x=>x.id));
 const timeline=[...attempts.map(x=>({kind:"attempt",id:String(x.id),at:typeof x.created_at==="string"?x.created_at:null,state:String(x.status)})),...evidence.events.filter(x=>ids.has(x.payment_attempt_id)&&sameScope(x)&&x.amount_baisa_expected===order.amount_baisa&&x.currency_expected===order.currency).map(x=>({kind:"event",id:String(x.id),at:typeof x.created_at==="string"?x.created_at:null,state:String(x.event_status)})),...evidence.grants.filter(x=>x.order_id===input.orderId&&ids.has(x.payment_attempt_id)&&sameScope(x)).map(x=>({kind:"receipt",id:String(x.id),at:typeof x.applied_at==="string"?x.applied_at:null,state:String(x.status??"unknown")})),...evidence.outcomes.filter(x=>x.order_id===input.orderId&&ids.has(x.payment_attempt_id)&&sameScope(x)).map(x=>({kind:"outcome",id:String(x.id),at:typeof x.created_at==="string"?x.created_at:null,state:String(x.outcome)}))];
 const rpc=gate.client as unknown as {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};const service=await rpc.rpc("billing_admin_read_service_state",{p_company_id:input.companyId});const serviceData=record(service.data);
 const validService=!service.error&&serviceData?.ok===true&&serviceData.company_id===input.companyId&&Array.isArray(serviceData.states)&&serviceData.states.every((v:unknown)=>{const r=record(v);return r&&typeof r.service==="string"&&typeof r.tier==="string"&&typeof r.activated==="boolean";});
 const serviceStates=validService?serviceData!.states as {service:string;tier:string;activated:boolean}[]:null;
 const u=current.ok?record(current.data.usage):null;
 const snapshot=current.ok?dashboardBillingSnapshot(input.companyId,current.data.journey,current.data.usage,{companyId:input.companyId,billingPaid:current.data.billing_paid,operationalEligible:current.data.operational_eligible,channelReady:"unavailable",usageCompanyId:u?.company_id??null,qualifiedPaidThrough:current.data.qualified_paid_through}):null;
 if(!await recheckBillingOwner(gate.binding))return {status:"forbidden" as const,data:null};return {status:"ready" as const,data:{order:adminOrderProjection(order as FinancialRecord,financial),current:snapshot,serviceStates,timeline}};
 }catch{return {status:"unavailable" as const,data:null};}
}
