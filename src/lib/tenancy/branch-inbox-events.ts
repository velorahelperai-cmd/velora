import type {SupabaseClient} from '@supabase/supabase-js';

export type BranchWatchScope={companyId:string;branchId:string;channel:string};
export const validBranchWatchScope=(s:BranchWatchScope)=>{
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 return uuid.test(s.companyId)&&uuid.test(s.branchId)&&['whatsapp','instagram'].includes(s.channel);
};

/** Server-side transport only. Neither provider credentials nor row payloads leave it. */
export function branchInboxEventStream(input:{
 client:SupabaseClient;scope:BranchWatchScope;signal:AbortSignal;authorize:()=>Promise<boolean>;
 heartbeatMs?:number;lifetimeMs?:number;
}){
 const {client,scope,signal,authorize}=input;
 let cancelled=false;
 let stop=()=>{};
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   const encoder=new TextEncoder();
   let closed=false,busy=false,pending=false,joined=false,replicationReady=false,readySent=false;
   let heartbeat:ReturnType<typeof setInterval>|undefined;
   const emit=(event:string)=>{if(!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`));};
   const channel=client.channel(`branch-inbox-${crypto.randomUUID()}`);
   const joinTimeout=setTimeout(()=>{emit('unavailable');stop();},8000);
   const lifetime=setTimeout(()=>stop(),input.lifetimeMs??45000);
   stop=()=>{
    if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(lifetime);clearTimeout(joinTimeout);
    signal.removeEventListener('abort',stop);
    void client.removeChannel(channel).catch(()=>{});
    if(!cancelled)controller.close();
   };
   const check=async(event:string)=>{
    if(closed)return;
    // A concurrent event must survive an in-flight heartbeat check.
    if(busy){if(event!=='ping')pending=true;return;}
    busy=true;
    try{
     if(!await authorize()){emit('revoked');stop();return;}
     emit(event);
    }catch{emit('unavailable');stop();}
    finally{busy=false;if(pending&&!closed){pending=false;void check('change');}}
   };
   const changed=(payload:{new:Record<string,unknown>})=>{
    const row=payload.new;
    if(row.company_id===scope.companyId&&row.branch_id===scope.branchId&&row.channel===scope.channel)void check('change');
   };
   const ready=()=>{
    if(closed||readySent||!joined||!replicationReady)return;
    readySent=true;clearTimeout(joinTimeout);void check('ready');
    heartbeat??=setInterval(()=>void check('ping'),input.heartbeatMs??15000);
   };
   channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'branch_inbox_invalidations',filter:`branch_id=eq.${scope.branchId}`},changed)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'branch_inbox_invalidations',filter:`branch_id=eq.${scope.branchId}`},changed)
    .on('system',{},payload=>{
     if(payload.extension!=='postgres_changes')return;
     if(payload.status==='ok'){replicationReady=true;ready();}
     else{emit('unavailable');stop();}
    });
   signal.addEventListener('abort',stop,{once:true});
   if(signal.aborted){stop();return;}
   controller.enqueue(encoder.encode('retry: 5000\n\n'));
   channel.subscribe(status=>{
    if(closed)return;
    if(status==='SUBSCRIBED'){
     joined=true;ready();
    }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){emit('unavailable');stop();}
   });
  },
  cancel(){cancelled=true;stop();},
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-store, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
