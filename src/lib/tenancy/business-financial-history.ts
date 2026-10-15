import {importUuid} from '@/lib/knowledge/knowledge-import';
export type BusinessFinancialHistory={companyId:string;billingPaid:boolean;paidThrough:string|null;subscriptionStatus:string|null;orders:Array<{id:string;status:string;paymentState:string;amountBaisa:number;currency:string;createdAt:string;paidThrough:string|null}>};
const row=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const date=(v:unknown):v is string|null=>v===null||typeof v==='string'&&Number.isFinite(Date.parse(v));
const status=(v:unknown):v is string=>typeof v==='string'&&/^[a-z_]{1,60}$/.test(v);
/** Display only canonical read RPC output. No entitlement/proof inference from amounts or future dates. */
export function businessFinancialHistory(companyId:string,display:unknown,journey:unknown):BusinessFinancialHistory|null{
 const d=row(row(display)?.data),j=row(row(journey)?.data);if(row(display)?.ok!==true||row(journey)?.ok!==true||!d||!j||d.company_id!==companyId||d.environment!=='live'||typeof d.billing_paid!=='boolean'||!date(d.qualified_paid_through)||!Array.isArray(j.orders)||j.orders.length>100)return null;
 const s=row(j.subscription);if(j.subscription!==null&&(!s||s.company_id!==companyId||!status(s.status)))return null;
 const orders:BusinessFinancialHistory['orders']=[];
 for(const v of j.orders){const o=row(v);if(!o||!importUuid(o.id)||!status(o.status)||!status(o.payment_state)||!Number.isSafeInteger(o.amount_baisa)||(o.amount_baisa as number)<0||typeof o.currency!=='string'||!/^[A-Z]{3}$/.test(o.currency)||typeof o.created_at!=='string'||!date(o.created_at)||!date(o.paid_through))return null;orders.push({id:o.id,status:o.status,paymentState:o.payment_state,amountBaisa:o.amount_baisa as number,currency:o.currency,createdAt:o.created_at,paidThrough:o.paid_through});}
 return {companyId,billingPaid:d.billing_paid,paidThrough:d.qualified_paid_through,subscriptionStatus:s?.status as string??null,orders};
}
