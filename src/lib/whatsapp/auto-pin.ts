import 'server-only';
export type AutoPinScope={companyId:string;branchId:string;phoneNumberId:string};
/** Entries are operator-approved evidence records, not client input. Missing or malformed configuration fails closed. */
export function autoPinAllowed(scope:AutoPinScope,env:Record<string,string|undefined>=process.env):boolean {
 if(env.WHATSAPP_AUTO_PIN_ENABLED!=='true')return false;
 try {
  const list:unknown=JSON.parse(env.WHATSAPP_AUTO_PIN_ALLOWLIST??'[]');
  if(!Array.isArray(list))return false;
  return list.some((item:unknown)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))return false;
   const row=item as Record<string,unknown>;
   return row.companyId===scope.companyId&&row.branchId===scope.branchId&&row.phoneNumberId===scope.phoneNumberId
    &&typeof row.approvedBy==='string'&&row.approvedBy.trim().length>0&&typeof row.evidence==='string'&&row.evidence.trim().length>0;
  });
 }catch{return false;}
}

