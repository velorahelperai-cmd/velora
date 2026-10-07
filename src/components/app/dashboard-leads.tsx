"use client";
import Link from "next/link";
import {useDemo} from "@/lib/demo-state";
import type {WhatsappInboxLoad} from "@/lib/whatsapp/inbox";
import styles from "./operational-ui.module.css";
const labels={ar:{title:"المتابعات والمحادثات",scope:"أعداد من المحادثات المتاحة لصلاحياتك في الشركة الحالية.",unavailable:"تعذّر تحميل بيانات المحادثات. لا توجد أعداد مؤكدة لعرضها.",noCompany:"اختر مساحة الشركة لعرض المحادثات المسموح لك بها.",all:"كل المحادثات المتاحة",awaiting_staff:"بانتظار الموظف",follow_up_today:"متابعة اليوم",overdue:"متابعة متأخرة",trial_or_quote:"تجربة أو عرض سعر"},en:{title:"Follow-ups and conversations",scope:"Counts from conversations accessible to your role in the current company.",unavailable:"Conversation data could not be loaded. No confirmed counts are available.",noCompany:"Select a company workspace to view your permitted conversations.",all:"Accessible conversations",awaiting_staff:"Awaiting staff",follow_up_today:"Follow-up today",overdue:"Overdue follow-up",trial_or_quote:"Trial or quote"}} as const;
export function DashboardLeads({snapshot}:{snapshot:WhatsappInboxLoad}){
 const {locale}=useDemo(),c=labels[locale];
 return <section className={styles.panel}><h2>{c.title}</h2>{!snapshot.ok?<p role="status">{snapshot.code==="NO_COMPANY"?c.noCompany:c.unavailable}</p>:<><p>{c.scope}</p><div className={styles.metrics}>{(["all","awaiting_staff","follow_up_today","overdue","trial_or_quote"] as const).map(key=><Link key={key} href={"/app/conversations?worklist="+key}><span>{c[key]}</span><strong>{new Intl.NumberFormat(locale).format(snapshot.meta.counts[key])}</strong></Link>)}</div></>}</section>;
}
