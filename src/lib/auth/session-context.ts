/** Cross-tab hints invalidate UI only. Cookies and server authorization remain authoritative. */
export const SESSION_CONTEXT_KEY = "velora_session_context_v1";
export type SessionContext = {userId:string;companyId:string|null};
export type SessionContextSignal = ({type:"context"}&SessionContext)|{type:"logout";userId:string};
const id = (value:unknown):value is string => typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function parse(raw:string|null):SessionContextSignal|null {
  try {
    const row=JSON.parse(raw??"null");
    if(!row||typeof row!=="object"||Array.isArray(row)||row.version!==1||!id(row.userId)||!id(row.nonce))return null;
    const keys=Object.keys(row).sort().join(",");
    if(row.type==="logout"&&keys==="nonce,type,userId,version")return {type:"logout",userId:row.userId};
    if(row.type==="context"&&keys==="companyId,nonce,type,userId,version"&&(row.companyId===null||id(row.companyId)))return {type:"context",userId:row.userId,companyId:row.companyId};
  }catch{/* Corrupt or unrelated storage is never an auth signal. */}
  return null;
}
export function publishSessionContext(context:SessionContext,target:Window=window):void {
  try {
    const prior=parse(target.localStorage.getItem(SESSION_CONTEXT_KEY));
    if(prior?.type==="context"&&prior.userId===context.userId&&prior.companyId===context.companyId)return;
    target.localStorage.setItem(SESSION_CONTEXT_KEY,JSON.stringify({version:1,type:"context",userId:context.userId,companyId:context.companyId,nonce:crypto.randomUUID()}));
  }catch{/* Identity works when storage is disabled. */}
}
export function publishSessionLogout(userId:string,target:Window=window):void {
  try{target.localStorage.setItem(SESSION_CONTEXT_KEY,JSON.stringify({version:1,type:"logout",userId,nonce:crypto.randomUUID()}));}catch{/* Optional invalidation transport. */}
}
export function subscribeSessionContext(onSignal:(signal:SessionContextSignal)=>void,target:Window=window):()=>void {
  const listener=(event:StorageEvent)=>{
    if(event.key!==SESSION_CONTEXT_KEY)return;
    try{if(event.storageArea&&event.storageArea!==target.localStorage)return;}catch{return;}
    const signal=parse(event.newValue);if(signal)onSignal(signal);
  };
  target.addEventListener("storage",listener);
  return ()=>target.removeEventListener("storage",listener);
}
