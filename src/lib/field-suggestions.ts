type StoragePort=Pick<Storage,'getItem'|'setItem'>;
type History={userId:string;field:'businessName';items:{value:string;usedAt:number}[]};
const ttl=30*24*60*60*1000;
const actor=(userId:string)=>/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(userId);
const valid=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=120&&!/[\u0000-\u001f\u007f]/.test(value);
const key=(userId:string)=>`velora_field_suggestions_v1:${userId}:businessName`;
/** Optional suggestions only. Never hydrate a form or copy legacy drafts. */
function historyEntries(storage:StoragePort,userId:string,now:number):History['items']{
 if(!actor(userId))return [];
 try{const raw=storage.getItem(key(userId));if(!raw)return [];const history=JSON.parse(raw) as History;
  if(history.userId!==userId||history.field!=='businessName'||!Array.isArray(history.items))return [];
  return history.items.filter(item=>item&&valid(item.value)&&Number.isFinite(item.usedAt)&&item.usedAt<=now&&now-item.usedAt<ttl).slice(0,5);
 }catch{return [];}
}
export function businessNameSuggestions(storage:StoragePort,userId:string,now=Date.now()):string[]{return historyEntries(storage,userId,now).map(item=>item.value);}
/** Called only after an authoritative creation receipt. Storage failure never blocks business creation. */
export function rememberBusinessName(storage:StoragePort,userId:string,value:string,now=Date.now()):void{
 if(!actor(userId)||!valid(value))return;
 try{const items=[{value:value.trim(),usedAt:now},...historyEntries(storage,userId,now).filter(item=>item.value!==value.trim())].slice(0,5);
  const history:History={userId,field:'businessName',items};storage.setItem(key(userId),JSON.stringify(history));
 }catch{/* Optional field history is unavailable. */}
}
