import 'server-only';
import {AsyncLocalStorage} from 'node:async_hooks';

type HttpStage='http_session'|'http_identity'|'http_capability'|'http_scope'|'http_channel'|'http_inbox'|'http_other';
type Stage='client'|'broker'|'broker_fresh'|'data_http'|'access'|'capabilities'|'channel_data'|'final_scope'|'branch'|'billing'|HttpStage;
type Measurements=Partial<Record<Stage,{count:number;total_ms:number}>>;
const reads=new AsyncLocalStorage<Measurements>();

// Fixed categories only. Unknown paths, query strings and response data never
// become log keys. Totals overlap data_http and must not be added to it.
const httpStages:Readonly<Record<string,HttpStage>>={
 '/auth/v1/user':'http_identity',
 '/rest/v1/profiles':'http_identity',
 '/rest/v1/company_members':'http_identity',
 '/rest/v1/companies':'http_identity',
 '/rest/v1/rpc/is_platform_admin':'http_identity',
 '/rest/v1/rpc/check_app_session':'http_session',
 '/rest/v1/rpc/has_company_capability':'http_capability',
 '/rest/v1/rpc/company_capability_snapshot':'http_capability',
 '/rest/v1/rpc/company_conversation_scope':'http_scope',
 '/rest/v1/rpc/read_company_channel_contract':'http_channel',
 '/rest/v1/rpc/whatsapp_inbox_page':'http_inbox',
 '/rest/v1/rpc/instagram_inbox_page':'http_inbox',
};

export async function measureDataHttp<T>(input:string|URL|Request,work:()=>Promise<T>):Promise<T>{
 if(!reads.getStore())return work();
 let stage:HttpStage='http_other';
 try{
  const path=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url).pathname;
  if(Object.hasOwn(httpStages,path))stage=httpStages[path];
 }catch{/* Invalid or unusual inputs still use the original fetch behavior. */}
 return measureRead('data_http',()=>measureRead(stage,work));
}

/** Timings only: never record cookies, identifiers, query arguments or data. */
export async function measureRead<T>(stage:Stage,work:()=>Promise<T>):Promise<T>{
 const measurements=reads.getStore();
 if(!measurements)return work();
 const started=performance.now();
 try{return await work();}
 finally{
  const entry=measurements[stage]??{count:0,total_ms:0};
  entry.count++;entry.total_ms+=performance.now()-started;measurements[stage]=entry;
 }
}

export async function traceRead<T>(operation:'service_inbox'|'service_inbox_http'|'workspace'|'account_profile'|'dashboard_http',work:()=>Promise<T>):Promise<T>{
 const stages:Measurements={};
 const started=performance.now();
 let outcome='returned';
 try{
  const result=await reads.run(stages,work);
  if(result&&typeof result==='object'&&'ok' in result)outcome=result.ok===true?'ok':'denied_or_unavailable';
  return result;
 }
 catch(error){outcome='threw';throw error;}
 finally{
  for(const stage of Object.values(stages))stage.total_ms=Math.round(stage.total_ms);
  // Stage totals include overlapping work; wall time is reported separately.
  console.info(JSON.stringify({service:'velora.read.performance',operation,outcome,wall_ms:Math.round(performance.now()-started),stages}));
 }
}
