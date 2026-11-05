'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {listWhatsappMediaMetadata,runInboxExtension} from '@/lib/customer/inbox-extension-actions';
import type {VdiMessage} from './inbox-desktop';

type Media = {messageId:string;attachmentId:string;filename:string;mime:string;caption:string};
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function Download({item,companyId,conversationId,ar,paused,onDenied}:{item:Media;companyId:string;conversationId:string;ar:boolean;paused:boolean;onDenied:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 const live=useRef(false),blocked=useRef(paused);
 useLayoutEffect(()=>{blocked.current=paused;},[paused]);
 useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function download(){
  if(paused||busy)return;setBusy(true);setError(false);
  try{
   const result=await runInboxExtension({companyId,conversationId,channel:'whatsapp',action:'download',itemId:item.attachmentId});
   if(!live.current||blocked.current)return;
   if(!result.ok&&result.code==='FORBIDDEN'){onDenied();return;}
   if(!result.ok||!result.data||typeof result.data!=='object')throw Error('unavailable');
   const data=result.data as Record<string,unknown>;
   if(data.name!==item.filename||data.mime!==item.mime||typeof data.base64!=='string'||data.base64.length>699052||
      data.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64))throw Error('invalid');
   const binary=atob(data.base64);if(binary.length<1||binary.length>524288)throw Error('invalid');
   const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
   const link=document.createElement('a');link.href=url;link.download=item.filename;link.click();
   window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{if(live.current&&!blocked.current)setError(true);}finally{if(live.current)setBusy(false);}
 }
 return <span><button type="button" className="vdi-small-button" disabled={paused||busy} onClick={()=>void download()}>{ar?'تنزيل المرفق: ':'Download attachment: '}{item.filename}</button>{error&&<span role="status">{ar?'تعذّر تنزيل المرفق.':'Attachment download failed.'}</span>}</span>;
}

/** No attachment evidence is shown until the current authorized thread is read. */
export function useInboxMediaEvidence({companyId,conversationId,channel,paused,messages,ar,revision=0}:{companyId:string;conversationId:string;channel:'whatsapp'|'instagram';paused:boolean;messages:VdiMessage[];ar:boolean;revision?:number}){
 const idsKey=JSON.stringify(messages.filter(message=>message.direction==='outgoing'&&uuid(message.id)).map(message=>message.id.toLowerCase()));
 const evidenceKey=`${revision}:${idsKey}`;
 const [result,setResult]=useState<{key:string;items:Media[]}|null>(null);
 const [previousPaused,setPreviousPaused]=useState(paused);
 if(previousPaused!==paused){setPreviousPaused(paused);setResult(null);}
 useEffect(()=>{
  if(paused||channel!=='whatsapp')return;
  let active=true;
  void(async()=>{
   const ids=JSON.parse(idsKey) as string[],all:Media[]=[];
   for(let offset=0;offset<ids.length;offset+=40){
    const response=await listWhatsappMediaMetadata({companyId,conversationId,messageIds:ids.slice(offset,offset+40)});
    if(!active)return;
    if(!response.ok){setResult(null);return;}all.push(...response.data);
   }
   if(active)setResult({key:evidenceKey,items:all});
  })().catch(()=>{if(active)setResult(null);});
  return()=>{active=false;};
 },[companyId,conversationId,channel,paused,idsKey,evidenceKey]);
 const current=!paused&&result?.key===evidenceKey?result.items:[];
 return messages.map(message=>{
  const found=current.find(item=>item.messageId===message.id.toLowerCase());
  return found?{...message,attachment:<Download item={found} companyId={companyId} conversationId={conversationId} ar={ar} paused={paused} onDenied={()=>setResult(null)}/>} : message;
 });
}
