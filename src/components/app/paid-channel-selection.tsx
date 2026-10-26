"use client";
import {useRef,useState} from "react";
import {selectOwnedPaidBranchChannelsAction} from "@/lib/tenancy/paid-setup-actions";
import type {PaidBranchSetupRead,PaidSetupChannel} from "@/lib/tenancy/paid-setup-contracts";
import styles from "./paid-setup-workspace.module.css";

type Props={locale:"ar"|"en";scope:{expectedAccountId:string;companyId:string;branchId:string;boundaryFingerprint:string};read:PaidBranchSetupRead;isCurrent:()=>boolean;onRefresh:()=>void};
export function PaidChannelSelection(p:Props) {
 return <Selection key={JSON.stringify(p.scope)} {...p}/>;
}
function Selection(p:Props) {
 const [channels,setChannels]=useState<PaidSetupChannel[]>([]),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const pending=useRef(false),operation=useRef<{channels:string;id:string}|null>(null);
 const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,entitlement=p.read.entitlement;
 const valid=p.isCurrent()&&!!p.scope.expectedAccountId&&!!p.scope.boundaryFingerprint&&p.read.sourceStatus==="selection_required"&&
  p.read.companyId===p.scope.companyId&&p.read.selectedBranchId===p.scope.branchId&&p.read.branches.some(b=>b.id===p.scope.branchId)&&
  entitlement&&(entitlement.package==="basic"&&entitlement.maxChannels===1||entitlement.package==="premium"&&entitlement.maxChannels===2);
 if(!valid)return null;
 const submit=async()=>{
  if(pending.current||!p.isCurrent()||!channels.length||channels.length>entitlement.maxChannels)return;
  pending.current=true;setBusy(true);setFailed(false);
  const selection=JSON.stringify(channels);
  if(operation.current?.channels!==selection)operation.current={channels:selection,id:crypto.randomUUID()};
  try{
   const result=await selectOwnedPaidBranchChannelsAction({expectedAccountId:p.scope.expectedAccountId,companyId:p.scope.companyId,branchId:p.scope.branchId,clientOpId:operation.current.id,channels});
   if(!p.isCurrent())return;
   if(result.ok&&result.companyId===p.scope.companyId&&result.branchId===p.scope.branchId||!result.ok&&result.code==="already_selected")p.onRefresh();
   else setFailed(true);
  }catch{if(p.isCurrent())setFailed(true);}
  finally{pending.current=false;if(p.isCurrent())setBusy(false);}
 };
 return <section className={styles.workspace} dir={ar?"rtl":"ltr"}>
  <header className={styles.header}><h1>{t("اختر قنوات الفرع","Choose your branch channels")}</h1>
   <p>{entitlement.maxChannels===1?t("باقتك تشمل قناة واحدة: واتساب أو إنستغرام.","Your plan includes one channel: WhatsApp or Instagram."):t("باقتك تشمل قناتين: يمكنك اختيار واتساب وإنستغرام.","Your plan includes two channels: you can choose WhatsApp and Instagram.")}</p>
  </header>
  <form className={styles.empty} onSubmit={event=>{event.preventDefault();void submit();}}>
   <fieldset disabled={busy}><legend>{t("القنوات التي سيعمل عليها مساعدك","Channels for your assistant")}</legend>
    {(["whatsapp","instagram"] as const).map(channel=><label key={channel} style={{display:"block",padding:"12px"}}>
     <input type="checkbox" value={channel} checked={channels.includes(channel)} disabled={!channels.includes(channel)&&channels.length>=entitlement.maxChannels} onChange={event=>{
      if(pending.current||!p.isCurrent())return;
      const next=event.target.checked?[...channels,channel]:channels.filter(value=>value!==channel);
      if(next.length<=entitlement.maxChannels){setChannels((["whatsapp","instagram"] as const).filter(value=>next.includes(value)));setFailed(false);}
     }}/> {channel==="whatsapp"?t("واتساب","WhatsApp"):t("إنستغرام","Instagram")}
    </label>)}
   </fieldset>
   <p>{t("بعد التأكيد ستنتقل لربط القنوات المختارة.","After confirmation, continue to connect the selected channels.")}</p>
   {failed&&<p role="alert">{t("لم يتأكد حفظ الاختيار. أعد المحاولة.","Your selection could not be confirmed. Please retry.")}</p>}
   <button type="submit" disabled={busy||!channels.length}>{busy?t("جارٍ الحفظ…","Saving…"):t("تأكيد القنوات والمتابعة","Confirm channels and continue")}</button>
  </form>
 </section>;
}
