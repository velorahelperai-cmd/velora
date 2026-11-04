import type {SupabaseClient} from '@supabase/supabase-js';

export type BranchWatchScope={companyId:string;branchId:string;channel:string};
export type CompanyInboxWatchScope={companyId:string;channels:readonly ('whatsapp'|'instagram')[]};
export const validBranchWatchScope=(s:BranchWatchScope)=>{
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 return uuid.test(s.companyId)&&uuid.test(s.branchId)&&['whatsapp','instagram'].includes(s.channel);
};

/** Server-side transport only. Neither provider credentials nor row payloads leave it. */
export function branchInboxEventStream(input:{
 client:SupabaseClient;scope:BranchWatchScope|CompanyInboxWatchScope;signal:AbortSignal;authorize:()=>Promise<boolean>;
 heartbeatMs?:number;lifetimeMs?:number;renewBeforeClose?:boolean;
}){
 const {client,scope,signal,authorize}=input;
 let cancelled=false;
 let stop=()=>{};
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   const encoder=new TextEncoder();
   let closed=false,busy=false,pending=false,renewPending=false,joined=false,replicationReady=false,readySent=false;
   let heartbeat:ReturnType<typeof setInterval>|undefined;
   const emit=(event:string)=>{if(!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`));};
   const channel=client.channel(`branch-inbox-${crypto.randomUUID()}`);
   const joinTimeout=setTimeout(()=>{emit('unavailable');stop();},8000);
   const lifetimeMs=input.lifetimeMs??45000;
   let renewal:ReturnType<typeof setTimeout>|undefined;
   const lifetime=setTimeout(()=>{if(input.renewBeforeClose)emit('unavailable');stop();},lifetimeMs);
   stop=()=>{
    if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(lifetime);clearTimeout(renewal);clearTimeout(joinTimeout);
    signal.removeEventListener('abort',stop);
    void client.removeChannel(channel).catch(()=>{});
    if(!cancelled)controller.close();
   };
   const check=async(event:string)=>{
    if(closed)return;
    // A concurrent event must survive an in-flight heartbeat check.
    if(busy){if(event==='renew')renewPending=true;else if(event!=='ping')pending=true;return;}
    busy=true;
    try{
     if(!await authorize()){emit('revoked');stop();return;}
     emit(event);
     if(event==='renew')stop();
    }catch{emit('unavailable');stop();}
    finally{busy=false;if(!closed){if(pending){pending=false;void check('change');}else if(renewPending){renewPending=false;void check('renew');}}}
   };
   // A planned rotation must prove fresh authority before preserving the UI.
   // A slow or failed authorization still reaches the hard fail-closed deadline.
   if(input.renewBeforeClose)renewal=setTimeout(()=>{if(readySent)void check('renew');},Math.max(0,lifetimeMs-5000));
   const changed=(payload:{new:Record<string,unknown>})=>{
    const row=payload.new;
    if(row.company_id===scope.companyId&&('branchId' in scope
     ?row.branch_id===scope.branchId&&row.channel===scope.channel
     :scope.channels.some(channel=>channel===row.channel)))void check('change');
   };
   const ready=()=>{
    if(closed||readySent||!joined||!replicationReady)return;
    readySent=true;clearTimeout(joinTimeout);void check('ready');
    heartbeat??=setInterval(()=>void check('ping'),input.heartbeatMs??15000);
   };
   const filter='branchId' in scope?`branch_id=eq.${scope.branchId}`:`company_id=eq.${scope.companyId}`;
   channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'branch_inbox_invalidations',filter},changed)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'branch_inbox_invalidations',filter},changed)
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
