import type {TrialScope} from './paid-assistant-trial';
/** Read one bounded stream of an existing operation; reconnects never submit a question. */
export async function readTrialStream(scope:TrialScope,operationId:string,boundary:string,signal:AbortSignal,onText:(text:string)=>void):Promise<void>{
 signal=AbortSignal.any([signal,AbortSignal.timeout(35_000)]);
 const query=new URLSearchParams({...scope,operationId});
 const response=await fetch(`/api/setup/trial-stream?${query}`,{cache:'no-store',credentials:'same-origin',headers:{'x-velora-boundary':boundary},signal});
 if(!response.ok){if(response.status===401||response.status===403)onText('');return;}
 const reader=response.body?.getReader();if(!reader)return;
 const decoder=new TextDecoder();let buffer='';
 try{
  while(!signal.aborted){
   const {done,value}=await reader.read();
   buffer+=decoder.decode(value,{stream:!done});
   if(buffer.length>100_000)throw Error('STREAM_LIMIT');
   let newline:number;
   while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
    if(line){const item:unknown=JSON.parse(line);if(item&&typeof item==='object'&&'text'in item&&typeof item.text==='string'&&item.text.length<=16000&&!signal.aborted)onText(item.text);}
   }
   if(done)break;
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
