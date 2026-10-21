import {redactLogText} from './redaction.mjs';
export {redactLogText} from './redaction.mjs';
import pino from 'pino';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';

const context=new AsyncLocalStorage();
const rootRequestId=randomUUID();
const levels=new Set(['trace','debug','info','warn','error','fatal']);
function level(){const production=['production','staging'].includes(process.env.NODE_ENV);const selected=levels.has(process.env.LOG_LEVEL)?process.env.LOG_LEVEL:production?'info':'debug';return production&&['trace','debug'].includes(selected)?'info':selected;}
const reserved=new Set(['timestamp','level','service','env','version','request_id','trace_id','span_id','user_id','tenant_id']);
function sanitize(value,seen=new WeakSet()){
 if(value instanceof Error)return {type:value.name,message:redactLogText(value.message),stack:redactLogText(value.stack??'')};
 if(typeof value==='string')return redactLogText(value);
 if(!value||typeof value!=='object')return value;
 if(seen.has(value))return '[Circular]';seen.add(value);
 const result=Array.isArray(value)?[]:{};
 for(const [key,item] of Object.entries(value)){
  const normalized=key.toLowerCase().replace(/[_-]/g,'');
  if(/^(password|token|accesstoken|refreshtoken|idtoken|sessiontoken|verifytoken|claimtoken|attempttoken|clientsecret|oauthsecret|appsecret|appsecretproof|xhubsignature|xhubsignature256|stagereceipt|claimreceipt|oauthstate|nonce|pin|apikey|secret|jwt|authorization|cookie|cookies|setcookie|body|cvv|cardnumber|bankaccount|nationalid|passport|healthdata|databaseurl|encryptionkey)$/.test(normalized))result[key]='[REDACTED]';
  else if(normalized==='phone'){let remaining=String(item).replace(/\D/g,'').length;result[key]=String(item).replace(/\d/g,digit=>--remaining>=2?'*':digit);}
  else result[key]=sanitize(item,seen);
 }
 seen.delete(value);return result;
}
export function createStructuredLogger(destination){
 const env=process.env.NODE_ENV??'development';
 return pino({
  level:level(),
  hooks:{logMethod(args,method){if(['production','staging'].includes(process.env.NODE_ENV)&&this.levelVal<30)this.level=level();const first=args[0];if(first&&typeof first==='object'){const fields={};for(const [key,value] of Object.entries(first))if(!reserved.has(key))fields[key]=value;args[0]=sanitize(fields);}return method.apply(this,args);}},
  base:{service:process.env.SERVICE_NAME??'velora',env,version:process.env.VERSION??process.env.VERCEL_GIT_COMMIT_SHA??'unknown'},
  timestamp:()=>',"timestamp":'+JSON.stringify(new Date().toISOString()),
  formatters:{level:label=>({level:label})},
  mixin:()=>({request_id:rootRequestId,trace_id:null,span_id:null,user_id:null,tenant_id:null,...context.getStore()}),
  serializers:{email:redactLogText,phone:value=>String(value).replace(/\d(?=\d{2})/g,'*'),error:error=>({type:error?.type??error?.name??'Error',message:redactLogText(error?.message??''),stack:redactLogText(error?.stack??'')})},
  redact:{paths:['password','token','access_token','refresh_token','verify_token','claim_token','attempt_token','api_key','apiKey','secret','app_secret','appsecret_proof','jwt','oauth_secret','oauth_state','nonce','pin','stage_receipt','claim_receipt','sessionToken','authorization','cookie','cookies','cvv','card_number','bank_account','national_id','passport','health_data','database_url','encryption_key','body','req.body','res.body','headers.authorization','headers.Authorization','headers["x-hub-signature-256"]','headers["X-Hub-Signature-256"]','headers.cookie','headers.Cookie','headers["set-cookie"]','headers["Set-Cookie"]','req.headers.authorization','req.headers.cookie','*.password','*.token','*.access_token','*.refresh_token','*.api_key','*.secret'],censor:'[REDACTED]'},
  ...(!destination&&env==='development'?{transport:{target:'pino-pretty',options:{colorize:true,timestampKey:'timestamp',translateTime:"UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'"}}}:{}),
 },destination);
}
const logger=createStructuredLogger();
export function flushLogs(){return new Promise((resolve,reject)=>{
 // Pino's development transport unrefs its worker. Keep the event loop alive
 // until its flush receipt arrives, with a bounded failure if it never does.
 const timeout=setTimeout(()=>reject(Error('LOGGER_FLUSH_TIMEOUT')),10000);
 logger.flush(error=>{clearTimeout(timeout);if(error)reject(error);else resolve();});
});}
export function withLogContext(fields,operation){
 const safe={};
 for(const key of ['request_id','trace_id','span_id','user_id','tenant_id']){
  const value=fields[key];
  if(typeof value==='string'&&value.length>0&&value.length<=128&&!/[\s@\r\n]/.test(value))safe[key]=value;
 }
 return context.run({...context.getStore(),...safe},operation);
}
export function logEvent(severity,event,fields={},target=logger){
 if(!levels.has(severity)||!/^\w+(?:\.\w+)+$/.test(event))throw Error('INVALID_LOG_EVENT');
 target.level=level();
 target[severity]({...fields,event});
}
let handlersInstalled=false;
export function installProcessLogging(){
 if(handlersInstalled)return;handlersInstalled=true;
 const fatal=(event,error)=>{logEvent('fatal',event,{kind:'application',error:error instanceof Error?error:new Error('Unhandled rejection')});process.exitCode=1;logger.flush(()=>process.exit(1));};
 process.on('uncaughtException',error=>fatal('process.exception',error));
 process.on('unhandledRejection',error=>fatal('process.rejection',error));
}
