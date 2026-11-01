"use client";
import {awaitSetupRequest} from "./paid-setup-request";
import {useRef,useState} from "react";
import {selectOwnedPaidBranchChannelsAction} from "@/lib/tenancy/paid-setup-actions";
import type {PaidBranchSetupRead,PaidSetupChannel} from "@/lib/tenancy/paid-setup-contracts";
import styles from "./paid-channel-view.module.css";

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
   const result=await awaitSetupRequest(selectOwnedPaidBranchChannelsAction({expectedAccountId:p.scope.expectedAccountId,companyId:p.scope.companyId,branchId:p.scope.branchId,clientOpId:operation.current.id,channels}),60_000);
   if(!p.isCurrent())return;
   if(result.ok&&result.companyId===p.scope.companyId&&result.branchId===p.scope.branchId||!result.ok&&result.code==="already_selected")p.onRefresh();
   else setFailed(true);
  }catch{if(p.isCurrent())setFailed(true);}
  finally{pending.current=false;if(p.isCurrent())setBusy(false);}
 };
 const titleId="channel-selection";
 return <section className={styles.view} dir={ar?"rtl":"ltr"} aria-labelledby={titleId}>
  <header className={styles.header}>
   <h2 id={titleId}>{t("اختر قنوات الفرع","Choose your branch channels")}</h2>
  </header>
  <p className={styles.stageCaption}>{entitlement.maxChannels===1?t("باقتك تشمل قناة واحدة","Your plan includes one channel"):t("باقتك تشمل قناتين","Your plan includes two channels")}</p>
  <div className={styles.connectLayout} data-wa-screen="choice">
   <div className={styles.intro}>
    <p>{entitlement.maxChannels===1
      ?t("اختر واتساب أو إنستغرام. بعد التأكيد تنتقل لربط القناة المختارة.","Choose WhatsApp or Instagram. After confirmation, continue to connect the selected channel.")
      :t("يمكنك اختيار واتساب وإنستغرام معًا. بعد التأكيد تنتقل لربط القنوات المختارة.","You can choose WhatsApp and Instagram together. After confirmation, continue to connect the selected channels.")}</p>
   </div>
   <form className={styles.routeCard} onSubmit={event=>{event.preventDefault();void submit();}}>
    <fieldset className={styles.routes} disabled={busy}>
     <legend>{t("القنوات التي سيعمل عليها مساعدك","Channels for your assistant")}</legend>
     {(["whatsapp","instagram"] as const).map(channel=>{
      const checked=channels.includes(channel);
      const blocked=!checked&&channels.length>=entitlement.maxChannels;
      return <label key={channel} className={styles.choice}>
       <input type="checkbox" value={channel} checked={checked} disabled={blocked||busy} onChange={event=>{
        if(pending.current||!p.isCurrent())return;
        const next=event.target.checked?[...channels,channel]:channels.filter(value=>value!==channel);
        if(next.length<=entitlement.maxChannels){setChannels((["whatsapp","instagram"] as const).filter(value=>next.includes(value)));setFailed(false);}
       }}/>
       <span>{channel==="whatsapp"?t("واتساب","WhatsApp"):t("إنستغرام","Instagram")}</span>
       <small>{channel==="whatsapp"
         ?t("محادثات العملاء على رقم واتساب الأعمال.","Customer chats on your WhatsApp Business number.")
         :t("رسائل إنستغرام من حساب نشاطك الاحترافي.","Instagram messages from your professional business account.")}</small>
      </label>;
     })}
    </fieldset>
    {failed&&<p role="alert">{t("لم يتأكد حفظ الاختيار. أعد المحاولة.","Your selection could not be confirmed. Please retry.")}</p>}
    <div className={styles.requirementActions}>
     <button type="submit" className={styles.primary} disabled={busy||!channels.length}>{busy?t("جارٍ الحفظ…","Saving…"):t("تأكيد القنوات والمتابعة","Confirm channels and continue")}</button>
    </div>
   </form>
  </div>
 </section>;
}
