import 'server-only';
import {createHash} from 'node:crypto';
import {instagramConfig} from './config';
import type {InstagramRpcClient} from './connection-store';
import type {InstagramWebhookRoutePorts} from './webhook-route';
import {createInstagramWebhookPersistence} from './webhook-store';
const closed=()=>({receiveEnabled:false,providerFixtureVerified:false,timestampContractVerified:false,installedSecretVerified:false});
/** A flag never certifies installation. A service-only RPC binds the real
 * stored reviewed contract to this exact parent app and SHA256 signing key.
 * No raw secret, proof rows or provider credentials are returned to callers. */
export async function readInstagramInboundRuntime(environment:Readonly<Record<string,string|undefined>>=process.env,server?:InstagramRpcClient|null){
 const app=environment.INSTAGRAM_PARENT_WEBHOOK_APP_ID,secret=environment.INSTAGRAM_PARENT_WEBHOOK_APP_SECRET;
 if(!instagramConfig(environment).receiveEnabled||!server||!app||!/^\d{1,64}$/.test(app)||!secret||secret!==secret.trim())return closed();
 try{
 const {data,error}=await server.rpc('instagram_read_installed_runtime',{p_parent_app_id:app,p_secret_fingerprint:createHash('sha256').update(secret,'utf8').digest('hex')});
 if(error||!data||typeof data!=='object'||Array.isArray(data))return closed();
 const r=data as Record<string,unknown>;
 if(r.ok!==true||r.installedSecretVerified!==true||r.providerFixtureVerified!==true||typeof r.timestampContractVerified!=='boolean')return closed();
 return {receiveEnabled:true,providerFixtureVerified:true,timestampContractVerified:r.timestampContractVerified,installedSecretVerified:true};
 }catch{return closed();}
}
type Installation=Readonly<{parentAppId:string;secret:Readonly<{source:'parent_webhook_app';value:string}>;installedSecretVerified:boolean;providerFixtureVerified:boolean;reviewCompanyId?:string}>;
/** Server-internal composition after raw-body HMAC verification by webhook-route.
 * SQL independently checks the installed fingerprint. Never pass the secret to SQL,
 * accept a company from the event, or normalize undocumented timestamp units. */
export function createInstagramSignedWebhookPersistence(server:InstagramRpcClient,installation:Installation):NonNullable<InstagramWebhookRoutePorts['persist']>{
 const app=installation.parentAppId,secret=installation.secret;
 const verified=installation.installedSecretVerified===true&&installation.providerFixtureVerified===true
  &&/^\d{1,64}$/.test(app)&&secret.source==='parent_webhook_app'&&typeof secret.value==='string'&&secret.value.length>0;
 const fingerprint=verified?createHash('sha256').update(secret.value,'utf8').digest('hex'):null;
 // Reuse the existing strict, immutable batch capture and commit acknowledgement.
 const persist=createInstagramWebhookPersistence({rpc:(_name,args)=>server.rpc(installation.reviewCompanyId?'instagram_ingest_review_webhook':'instagram_ingest_signed_webhook',{
  p_batch:args.p_batch,p_parent_app_id:app,p_secret_fingerprint:fingerprint,
  ...(installation.reviewCompanyId?{p_company_id:installation.reviewCompanyId}:{}),
 })});
 return batch=>verified?persist(batch):Promise.resolve({status:'retryable' as const});
}
