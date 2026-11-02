export type ReviewChannel='whatsapp'|'instagram';
export type ReviewGrant={id:string;channel:ReviewChannel;app_id:string;asset_id:string;source_account_id:string;recipient_ids:string[];send_limit:1|50;used_count:number;expires_at:string;revoked_at:string|null;review_conversation_id?:string;review_link_id?:string;review_link_generation?:number;review_body_sha256?:string};
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const numeric=(value:unknown):value is string=>typeof value==='string'&&/^[0-9]{1,64}$/.test(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const date=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function parseReviewGrant(value:unknown):ReviewGrant|null{
 if(!record(value)||!uuid(value.id)||!['whatsapp','instagram'].includes(String(value.channel))
 ||![value.app_id,value.asset_id,value.source_account_id].every(numeric)||![1,50].includes(Number(value.send_limit))||typeof value.send_limit!=='number'
 ||!Number.isInteger(value.used_count)||Number(value.used_count)<0||Number(value.used_count)>Number(value.send_limit)
 ||!date(value.expires_at)||value.revoked_at!==null&&!date(value.revoked_at)
 ||!Array.isArray(value.recipient_ids)||value.recipient_ids.length<1||value.recipient_ids.length>5
 ||value.recipient_ids.some(v=>!numeric(v))||new Set(value.recipient_ids).size!==value.recipient_ids.length)return null;
 if(value.send_limit===1&&(value.channel!=='whatsapp'||value.recipient_ids.length!==1||!uuid(value.review_conversation_id)||!uuid(value.review_link_id)||!Number.isSafeInteger(value.review_link_generation)||Number(value.review_link_generation)<0||typeof value.review_body_sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.review_body_sha256)))return null;
 return {id:value.id,channel:value.channel as ReviewChannel,app_id:value.app_id as string,asset_id:value.asset_id as string,
 source_account_id:value.source_account_id as string,recipient_ids:[...value.recipient_ids],send_limit:value.send_limit as 1|50,used_count:Number(value.used_count),expires_at:value.expires_at,revoked_at:value.revoked_at as string|null,
 ...(value.send_limit===1?{review_conversation_id:value.review_conversation_id as string,review_link_id:value.review_link_id as string,review_link_generation:value.review_link_generation as number,review_body_sha256:value.review_body_sha256 as string}:{})};
}
export function reviewDispatchCurrent(proof:unknown,grant:ReviewGrant,companyId:string,channel:ReviewChannel,assetId:string,now=Date.now()):boolean{
 return Number.isFinite(now)&&record(proof)&&grant.revoked_at===null&&grant.channel===channel&&grant.asset_id===assetId
 &&proof.grant_id===grant.id&&proof.company_id===companyId&&proof.channel===channel&&proof.asset_id===assetId
 &&proof.expires_at===grant.expires_at&&Date.parse(grant.expires_at)>now;
}
