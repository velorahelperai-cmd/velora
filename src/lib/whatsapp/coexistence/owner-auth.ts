export type OwnerRpcClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
type OwnerAccess={ok:true;context:{identityVerified:boolean;userId:string;company:{id:string;status:string}|null;membership:{role:string}|null}}|{ok:false;code:string};
export type OwnerAuthPorts={access:()=>Promise<OwnerAccess>;session:()=>Promise<{client:OwnerRpcClient;subject:unknown;sessionId:unknown;claimsError:boolean}>;checkSession:(client:OwnerRpcClient)=>Promise<{ok:boolean}>};
export type OwnerAuthorization={ok:true;identity:{companyId:string;userId:string;sessionId:string};client:OwnerRpcClient}|{ok:false;code:"INVALID_INPUT"|"FORBIDDEN"|"COMPANY_SUSPENDED"|"UNAVAILABLE"};
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Verified native Auth and selected owner membership are independent required gates. */
export async function authorizeCoexistenceOwner(expectedCompanyId:string|undefined,ports:OwnerAuthPorts):Promise<OwnerAuthorization>{
 if(expectedCompanyId!==undefined&&!uuid(expectedCompanyId))return {ok:false,code:"INVALID_INPUT"};
 try{
  const access=await ports.access();
  if(!access.ok)return {ok:false,code:access.code==="UNAVAILABLE"?"UNAVAILABLE":"FORBIDDEN"};
  const context=access.context;
  if(!context.identityVerified||!context.company||context.membership?.role!=="owner"||!uuid(context.userId)||!uuid(context.company.id))return {ok:false,code:"FORBIDDEN"};
  if(expectedCompanyId!==undefined&&context.company.id.toLowerCase()!==expectedCompanyId.toLowerCase())return {ok:false,code:"FORBIDDEN"};
  if(context.company.status==="suspended")return {ok:false,code:"COMPANY_SUSPENDED"};
  const native=await ports.session();
  if(native.claimsError||native.subject!==context.userId||!uuid(native.sessionId)||!(await ports.checkSession(native.client)).ok)return {ok:false,code:"FORBIDDEN"};
  return {ok:true,identity:{companyId:context.company.id.toLowerCase(),userId:context.userId.toLowerCase(),sessionId:native.sessionId.toLowerCase()},client:native.client};
 }catch{return {ok:false,code:"UNAVAILABLE"};}
}
