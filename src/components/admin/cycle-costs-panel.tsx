"use client";
import {useLayoutEffect,useRef,useState} from "react";
import {useDemo} from "@/lib/demo-state";
import {useOptionalAccountSession} from "@/components/app/account-chrome";
import {Button,Field,Notice} from "@/components/app/ui";
import {readAdminCostCompaniesAction,readAdminCostCyclesAction,readAdminCycleCostsAction} from "@/lib/billing/admin/cycle-cost-actions";
import type {AdminCycleCosts,CostCompanyPage,CostCyclePage,CostReadResult} from "@/lib/billing/admin/cycle-costs";
export function CycleCostsPanel({initialResult}:{initialResult:CostReadResult<CostCompanyPage>}){
 const {locale}=useDemo(),ar=locale==="ar",t=(en:string,arabic:string)=>ar?arabic:en;
 const session=useOptionalAccountSession(),sessionRef=useRef(session);useLayoutEffect(()=>{sessionRef.current=session;},[session]);
 const actor=initialResult.ok?initialResult.data.actorUserId:null;
 const allowed=Boolean(actor&&(!session||session.status==="ready"&&session.identity?.userId===actor&&session.identity.platformIdentity.role==="owner"&&session.identity.platformIdentity.status==="active"));
 const current=()=>{const s=sessionRef.current;return Boolean(actor&&(!s||s.status==="ready"&&s.identity?.userId===actor&&s.identity.platformIdentity.role==="owner"&&s.identity.platformIdentity.status==="active"));};
 const [companies,setCompanies]=useState(initialResult.ok?initialResult.data:null),[companyId,setCompanyId]=useState(""),[cycles,setCycles]=useState<CostCyclePage|null>(null),[cycleId,setCycleId]=useState(""),[report,setReport]=useState<AdminCycleCosts|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const busyRef=useRef(false),generation=useRef(0);
 async function run(op:()=>Promise<void>){if(!current()||busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{await op();}catch{if(current())setError("UNAVAILABLE");}finally{busyRef.current=false;setBusy(false);}}
 function chooseCompany(id:string){if(!current()||busyRef.current)return;const version=++generation.current;setCompanyId(id);setCycles(null);setCycleId("");setReport(null);if(!id)return;void run(async()=>{const result=await readAdminCostCyclesAction({companyId:id,expectedUserId:actor!});if(!current()||version!==generation.current)return;if(!result.ok){setError(result.code);return;}setCycles(result.data);});}
 async function moreCompanies(){if(!companies?.next)return;const cursor=companies.next;await run(async()=>{const result=await readAdminCostCompaniesAction({expectedUserId:actor!,afterCompanyId:cursor});if(!current())return;if(!result.ok){setError(result.code);return;}if(result.data.companies.some(c=>companies.companies.some(old=>old.id===c.id))){setError("UNAVAILABLE");return;}setCompanies({...result.data,companies:[...companies.companies,...result.data.companies]});});}
 async function moreCycles(){if(!cycles?.next)return;const version=generation.current;await run(async()=>{const result=await readAdminCostCyclesAction({companyId,expectedUserId:actor!,before:cycles.next!});if(!current()||version!==generation.current)return;if(!result.ok){setError(result.code);return;}if(result.data.cycles.some(c=>cycles.cycles.some(old=>old.id===c.id))){setError("UNAVAILABLE");return;}setCycles({...result.data,cycles:[...cycles.cycles,...result.data.cycles]});});}
 async function loadReport(){if(!cycles?.cycles.some(c=>c.id===cycleId)||cycles.companyId!==companyId)return;const version=generation.current;setReport(null);await run(async()=>{const result=await readAdminCycleCostsAction({companyId,cycleId,expectedUserId:actor!});if(!current()||version!==generation.current)return;if(!result.ok){setError(result.code);return;}setReport(result.data);});}
 const date=(s:string)=>new Date(s).toLocaleString(ar?"ar-OM":"en-OM",{timeZone:"Asia/Muscat"});
 const shown=allowed&&report?.companyId===companyId&&report.cycleId===cycleId?report:null;
 return <main className="grid gap-5 p-5 md:p-8" dir={ar?"rtl":"ltr"}>
  <h1 className="text-2xl font-bold">{t("AI costs by customer and cycle","تكلفة الذكاء الاصطناعي حسب العميل والدورة")}</h1>
  <Notice>{t("Estimates use recorded token usage and the tariff snapshot of each native attempt. Final provider invoice cost is unavailable until reconciliation. Reading this report makes no model or payment calls.","التقديرات تعتمد على استخدام الرموز المسجّل وتسعيرة كل محاولة أصلية. التكلفة النهائية لفاتورة المزود غير متاحة قبل المطابقة. قراءة التقرير لا تنفّذ اتصالًا بالنموذج أو دفعًا.")}</Notice>
  {!allowed?<Notice tone="warn">{initialResult.ok?t("Only a current platform owner can read this report.","يتاح التقرير فقط لمالك المنصة صاحب الجلسة الحالية."):initialResult.code==="UNCONFIGURED"?t("The cycle report is awaiting activation.","تقرير الدورة ينتظر التفعيل."):t("Report access could not be verified. No cost data was loaded.","تعذر التحقق من صلاحية التقرير. لم تُحمّل بيانات التكلفة.")}</Notice>:<>
   <form className="grid gap-4 md:grid-cols-2" onSubmit={e=>{e.preventDefault();void loadReport();}}>
    <Field label={t("Customer business","نشاط العميل")}>{p=><select {...p} value={companyId} disabled={busy} onChange={e=>chooseCompany(e.target.value)}><option value="">{t("Select a business","اختر النشاط")}</option>{companies?.companies.map(c=><option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select>}</Field>
    <Field label={t("Subscription cycle (Muscat time)","دورة الاشتراك (بتوقيت مسقط)")}>{p=><select {...p} value={cycleId} disabled={busy||!cycles} onChange={e=>{generation.current++;setCycleId(e.target.value);setReport(null);}}><option value="">{t("Select a cycle","اختر الدورة")}</option>{cycles?.cycles.map(c=><option key={c.id} value={c.id}>{date(c.startsAt)} — {date(c.expiresAt)}</option>)}</select>}</Field>
    <div className="flex flex-wrap gap-3 md:col-span-2"><Button type="submit" disabled={busy||!companyId||!cycleId} busy={busy}>{t("Read cycle costs","عرض تكلفة الدورة")}</Button>{companies?.next?<Button type="button" variant="secondary" disabled={busy} onClick={()=>void moreCompanies()}>{t("More businesses","أنشطة إضافية")}</Button>:null}{cycles?.next?<Button type="button" variant="secondary" disabled={busy} onClick={()=>void moreCycles()}>{t("Older cycles","دورات أقدم")}</Button>:null}</div>
   </form>
   {companies?.companies.length===0?<Notice>{t("No native subscription cycles have been recorded.","لا توجد دورات اشتراك أصلية مسجّلة.")}</Notice>:null}
   {cycles&&cycles.cycles.length===0?<Notice>{t("This business has no recorded cycle.","لا توجد دورة مسجّلة لهذا النشاط.")}</Notice>:null}
   {shown?<CycleCostReport value={shown} ar={ar}/>:null}
  </>}
  {error&&allowed?<Notice tone="error">{error==="FORBIDDEN"||error==="UNAUTHENTICATED"?t("Your current session or owner authority no longer permits this read.","لم تعد الجلسة الحالية أو صلاحية المالك تسمح بالقراءة."):t("The report could not be read. The last response was not used as a cost estimate.","تعذرت قراءة التقرير. لم تُستخدم الاستجابة الأخيرة كتقدير للتكلفة.")}</Notice>:null}
 </main>;
}

export function CycleCostReport({value:shown,ar}:{value:AdminCycleCosts;ar:boolean}){
 const t=(en:string,arabic:string)=>ar?arabic:en;
 const date=(s:string)=>new Date(s).toLocaleString(ar?"ar-OM":"en-OM",{timeZone:"Asia/Muscat"});
 const cost=(n:number)=>new Intl.NumberFormat(ar?"ar-OM":"en-OM",{minimumFractionDigits:3,maximumFractionDigits:9}).format(n/1000);
 return <section aria-label={t("Cycle cost report","تقرير تكلفة الدورة")} className="grid gap-4">
    <p dir="ltr" className="break-all text-sm">{shown.companyId} · {shown.cycleId}</p>
    <p>{date(shown.startsAt)} — {date(shown.expiresAt)}</p>
    <dl className="grid gap-4 rounded-2xl border border-[var(--color-border)] p-4 sm:grid-cols-3"><div><dt>{t("Recorded tariff estimate","التقدير المسجّل بالتسعيرة")}</dt><dd className="text-xl font-semibold">{cost(shown.groups.reduce((sum,g)=>sum+g.estimated_baisa,0))} OMR</dd></div><div><dt>{t("Attempts awaiting native cost settlement","محاولات تنتظر تسوية التكلفة الأصلية")}</dt><dd className="text-xl font-semibold">{shown.unsettledAttempts}</dd></div><div><dt>{t("Final provider invoice cost","التكلفة النهائية لفاتورة المزود")}</dt><dd>{t("Unknown","غير معلومة")}</dd></div></dl>
    {shown.unsettledAttempts>0?<Notice tone="warn">{t("Attempts with no settled native cost are excluded from the estimate; the displayed total is incomplete.","تُستبعد المحاولات التي لم تُسوّ تكلفتها الأصلية من التقدير؛ الإجمالي المعروض غير مكتمل.")}</Notice>:null}
    <div className="overflow-x-auto"><table className="w-full text-start text-sm"><caption className="mb-3 text-start">{t("Recorded attempts by model, channel and credit category","المحاولات المسجّلة حسب النموذج والقناة وفئة الرصيد")}</caption><thead><tr>{[t("Model","النموذج"),t("Channel","القناة"),t("Credit category","فئة الرصيد"),t("Attempts","المحاولات"),t("Estimated OMR","التقدير بالريال")].map(h=><th key={h} scope="col" className="border-b p-3 text-start">{h}</th>)}</tr></thead><tbody>{shown.groups.map(g=><tr key={JSON.stringify([g.model,g.channel,g.category])}><td className="border-b p-3" dir="ltr">{g.model}</td><td className="border-b p-3">{g.channel??t("Unattributed","غير منسوبة")}</td><td className="border-b p-3">{g.category==="base"?t("Package base","رصيد الباقة"):g.category==="topup"?t("Purchased top-up","رصيد إضافي مشترى"):g.category==="compensation"?t("Compensation","التعويض"):t("Unattributed","غير منسوبة")}</td><td className="border-b p-3">{g.attempts}</td><td className="border-b p-3">{cost(g.estimated_baisa)}</td></tr>)}</tbody></table></div>
    {shown.groups.length===0?<Notice>{t("No company-live model attempts were recorded inside this cycle.","لم تسجّل محاولات نموذج للعميل خلال هذه الدورة.")}</Notice>:null}
   </section>;
}
