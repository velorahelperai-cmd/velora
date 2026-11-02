type NativeReplyBalance={granted:number;remaining:number;held:number;paidThrough:string};
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
/** Reject stale, cross-company or internally inconsistent server projections. */
export function nativeReplyBalance(companyId:string,input:unknown):NativeReplyBalance|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const row=input as Record<string,unknown>;
 if(row.company_id!==companyId||!count(row.granted)||!count(row.remaining)||!count(row.held)||
  row.remaining>row.granted||row.held>row.remaining||typeof row.paid_through!=='string'||!Number.isFinite(Date.parse(row.paid_through)))return null;
 return {granted:row.granted,remaining:row.remaining-row.held,held:row.held,paidThrough:row.paid_through};
}
