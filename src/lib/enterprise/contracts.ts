export type EnterpriseResult<T>={ok:true;data:T}|{ok:false;code:string};
export type EnterpriseWorkspace={companyId:string;userId:string;role:"owner"|"manager"|"employee";
 branches:Array<{id:string;name:string;timezone:string;status:"setup"|"active"|"suspended";primary:boolean}>;
 accounts:Array<{id:string;userId:string;name:string;role:"manager"|"employee";branchId:string|null;status:"active"|"suspended"|"terminated";reactivationRequested:boolean}>};
export function uuid(value:unknown):value is string{return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
export function parseWorkspace(value:Record<string,unknown>,companyId:string,userId:string):EnterpriseWorkspace|null {
 if(value.companyId!==companyId||value.userId!==userId||!["owner","manager","employee"].includes(value.role as string)||!Array.isArray(value.branches)||!Array.isArray(value.accounts))return null;
 const branches:EnterpriseWorkspace["branches"]=[],accounts:EnterpriseWorkspace["accounts"]=[];
 for(const b of value.branches){if(!b||!uuid(b.id)||typeof b.name!=="string"||typeof b.timezone!=="string"||!["setup","active","suspended"].includes(b.status)||typeof b.primary!=="boolean")return null;branches.push({id:b.id,name:b.name,timezone:b.timezone,status:b.status,primary:b.primary});}
 for(const a of value.accounts){if(!a||!uuid(a.id)||!uuid(a.userId)||typeof a.name!=="string"||!["manager","employee"].includes(a.role)||!(a.branchId===null||uuid(a.branchId))||!["active","suspended","terminated"].includes(a.status)||typeof a.reactivationRequested!=="boolean")return null;accounts.push({id:a.id,userId:a.userId,name:a.name,role:a.role,branchId:a.branchId,status:a.status,reactivationRequested:a.reactivationRequested});}
 return {companyId,userId,role:value.role as EnterpriseWorkspace["role"],branches,accounts};
}
