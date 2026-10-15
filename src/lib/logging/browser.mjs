// Browser adapter for the shared Pino logging stack. No remote ingestion,
// cookies, request bodies, unredacted errors or arbitrary user fields are accepted.
import pino from 'pino/browser.js';
import {redactLogText} from './redaction.mjs';

const levels=new Set(['trace','debug','info','warn','error','fatal']);
function level(){const production=['production','staging'].includes(process.env.NODE_ENV);const configured=process.env.NEXT_PUBLIC_LOG_LEVEL;const chosen=levels.has(configured)?configured:production?'info':'debug';return production&&['trace','debug'].includes(chosen)?'info':chosen;}
export function createBrowserLogger(write){
 return pino({level:level(),redact:{paths:['password','token','access_token','refresh_token','apiKey','secret','authorization','cookie','body','headers.authorization','headers.Authorization','headers.cookie','headers.Cookie','headers["set-cookie"]','headers["Set-Cookie"]'],censor:'[REDACTED]'},browser:{asObject:true,formatters:{level:label=>({level:label})},...(write?{write}:{})}});
}
const logger=createBrowserLogger();
const identifier=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)?value:null;
export function recordSessionCheckUnavailable(identity,target=logger){
 record(identity,'auth.session.check.unavailable','UNAVAILABLE',target);
}
export function recordPreparationValidationRejected(identity,target=logger){
 record(identity,'setup.preparation.validation.rejected','INVALID_INPUT',target);
}
export function recordLogoutTransportFailed(identity,error,target=logger){
 const safeError=error instanceof Error?{type:redactLogText(error.name),message:redactLogText(error.message),stack:redactLogText(error.stack??'')}:{type:'Error',message:'Logout transport unavailable',stack:''};
 record(identity,'auth.logout.transport.failed','UNAVAILABLE',target,'error',{error:safeError,kind:'security'});
}
function record(identity,event,code,target,severity='warn',extra={}){
 try{
  target.level=level();
  target[severity]({timestamp:new Date().toISOString(),service:'velora.browser',env:process.env.NODE_ENV??'development',version:process.env.NEXT_PUBLIC_APP_VERSION??'development',request_id:crypto.randomUUID(),trace_id:null,span_id:null,user_id:identifier(identity?.userId),tenant_id:identifier(identity?.companyId),kind:'application',event,code,...extra});
 }catch{/* Optional local diagnostics cannot change session authority or recovery. */}
}
