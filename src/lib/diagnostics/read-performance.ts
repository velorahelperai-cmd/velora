import 'server-only';
import {AsyncLocalStorage} from 'node:async_hooks';

type Stage='client'|'broker'|'broker_fresh'|'data_http'|'access'|'capabilities'|'channel_data'|'final_scope';
type Measurements=Partial<Record<Stage,{count:number;total_ms:number}>>;
const reads=new AsyncLocalStorage<Measurements>();

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

export async function traceRead<T>(operation:'service_inbox'|'workspace',work:()=>Promise<T>):Promise<T>{
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
