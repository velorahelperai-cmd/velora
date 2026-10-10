import type {FinancialQualification,FinancialRecord} from "../financial-truth";
export type AdminBillingOrder={id:string;companyId:string;companyName:string;createdAt:string;environment:"live"|"test"|null;amountBaisa:number|null;currency:string|null;financial:FinancialQualification;checkoutDeadline:string|null;checkoutExpired:boolean|null};
export type AdminBillingPage={status:"ready"|"empty";rows:AdminBillingOrder[];total:number;hasMore:boolean;nextCursor:string|null;snapshot:string}|{status:"forbidden"|"unavailable"|"invalid_input";rows:null;total:null;hasMore:null;nextCursor:null};
export const ledgerFailure=(status:"forbidden"|"unavailable"|"invalid_input"):AdminBillingPage=>({status,rows:null,total:null,hasMore:null,nextCursor:null});
export function adminOrderProjection(order:FinancialRecord,financial:FinancialQualification,now=Date.now()):AdminBillingOrder{
 const deadline=typeof order.expires_at==="string"&&Number.isFinite(Date.parse(order.expires_at))?order.expires_at:null;
 return {id:String(order.id),companyId:String(order.company_id),companyName:typeof order.company_name==="string"?order.company_name:"",createdAt:String(order.created_at),environment:financial.environment,
 amountBaisa:Number.isSafeInteger(order.amount_baisa)&&Number(order.amount_baisa)>0?Number(order.amount_baisa):null,currency:typeof order.currency==="string"?order.currency:null,financial,checkoutDeadline:deadline,checkoutExpired:deadline===null?null:Date.parse(deadline)<=now};
}
