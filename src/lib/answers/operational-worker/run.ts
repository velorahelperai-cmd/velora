export type WorkerFrame={companyId:string;phoneNumberId:string;conversationId:string;jobId:string;operationKey:string;automationGeneration:number;linkGeneration:number;question:string;chunks:{sourceId:string;title:string;contentVersion:number;text:string}[]};
export type WorkerPorts={enabled:boolean;loadFrame:(id:string,claim:string)=>Promise<WorkerFrame|null>;checkFeature:(f:WorkerFrame)=>Promise<boolean>;reserveCost:(f:WorkerFrame)=>Promise<{ok:boolean;canDispatch:boolean}>;complete:(f:WorkerFrame,signal:AbortSignal)=>Promise<{ok:boolean;text:string;inputTokens:number;outputTokens:number;costAtoms:number}>;recordCost:(o:{status:"recorded"|"unknown";inputTokens?:number;outputTokens?:number;costAtoms?:number},f:WorkerFrame)=>Promise<void>;handoff:(reason:string,f:WorkerFrame)=>Promise<void>;stage:(f:WorkerFrame,text:string)=>Promise<boolean>};
export function memoryScopeKey(f:WorkerFrame):string{
 // Bounded request scope; no persisted transcript/provider thread until retention approval.
 return JSON.stringify([f.companyId,f.phoneNumberId,f.conversationId,f.automationGeneration,f.linkGeneration,f.chunks.map(c=>[c.sourceId,c.contentVersion]).sort()]);
}
export async function runOperationalAnswer(id:string,claim:string,ports:WorkerPorts,timeoutMs=25000):Promise<{code:string}>{
 if(!ports.enabled)return {code:"provider_not_configured"};
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)return {code:"invalid_timeout"};
 const frame=await ports.loadFrame(id,claim);if(!frame||frame.jobId!==id)return {code:"claim_invalid"};
 if(!frame.companyId||!frame.phoneNumberId||!frame.conversationId||!frame.operationKey||!frame.question.trim()||frame.question.length>1000||frame.chunks.length===0||frame.chunks.length>40||frame.chunks.some(c=>!c.sourceId||!c.text.trim()||c.contentVersion<1)||frame.chunks.reduce((sum,c)=>sum+c.text.length+c.title.length,0)>12000)return {code:"context_invalid"};
 if(!await ports.checkFeature(frame))return {code:"entitlement_blocked"};
 const reservation=await ports.reserveCost(frame);if(!reservation.ok)return {code:"budget_blocked"};
 if(!reservation.canDispatch)return {code:"operation_already_reserved"};
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let response:Awaited<ReturnType<WorkerPorts["complete"]>>;
 try{
  response=await Promise.race([ports.complete(frame,controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("provider_timeout"));},timeoutMs);})]);
 }catch{
  await ports.recordCost({status:"unknown"},frame);await ports.handoff("provider_unknown",frame);return {code:"provider_unknown"};
 }finally{if(timer!==undefined)clearTimeout(timer);}
 if(!response.ok||![response.inputTokens,response.outputTokens,response.costAtoms].every(n=>Number.isSafeInteger(n)&&n>=0)){
  await ports.recordCost({status:"unknown"},frame);await ports.handoff("usage_unverified",frame);return {code:"usage_unverified"};
 }
 // Costs remain real even if routing/knowledge changed while generation was running.
 await ports.recordCost({status:"recorded",inputTokens:response.inputTokens,outputTokens:response.outputTokens,costAtoms:response.costAtoms},frame);
 const again=await ports.loadFrame(id,claim);
 if(!again||again.operationKey!==frame.operationKey||memoryScopeKey(again)!==memoryScopeKey(frame)||!await ports.checkFeature(again)){await ports.handoff("routing_changed",frame);return {code:"routing_changed"};}
 if(!response.text.trim()){await ports.handoff("empty_answer",frame);return {code:"empty_answer"};}
 return {code:await ports.stage(again,response.text)?"staged":"stage_conflict"};
}
