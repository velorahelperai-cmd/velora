"use client";
import Link from "next/link";
import {startTransition,useEffect,useRef,useState} from "react";
import {useDemo} from "@/lib/demo-state";
import {readDashboardBilling} from "@/lib/customer/dashboard-billing-actions";
import type {DashboardBillingLoad} from "@/lib/customer/dashboard-billing-model";
import {getCustomerReadiness} from "@/lib/tenancy/actions";
import {readDashboardReadiness} from "@/lib/customer/dashboard-readiness-actions";
import type {CustomerReadinessSnapshot} from "@/lib/tenancy/customer-readiness";
import {dashboardInboxMetrics,type DashboardInboxLoad} from "./onboarding-contracts";
import {WorkspaceShell} from "./workspace-shell";
import {Button,Notice,useAppCopy} from "./ui";
import {DiagnosticHint} from "./diagnostic-hint";
import {DashboardBranch} from "./dashboard-branch";
import styles from "./dashboard.module.css";
function DashboardBillingCard({ companyId }: { companyId: string | null }) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const [billing, setBilling] = useState<DashboardBillingLoad | null>(null);
  const request = useRef(0);
  const text = ar
    ? {
        title: "الاشتراك والاستهلاك الشهري",
        body: "الرسائل الآلية المقبولة والسعة المحجوزة من سجلات النشاط الفعلية.",
        account: "إدارة الباقة والاشتراك",
        retry: "تحديث",
        unavailable: "تعذّر تحميل الاشتراك والاستهلاك. لا تتوفر أرقام مؤكدة الآن.",
        forbidden: "بيانات الاشتراك متاحة لمالك النشاط بعد اختيار مساحة العمل.",
        empty: "لا يوجد اشتراك مسجّل لهذا النشاط.",
        sent: "رسائل آلية مقبولة",
        held: "سعة محجوزة",
        remaining: "من السعة المتبقية",
        capMissing: "السعة القابلة للاستخدام غير متوفرة",
        period: "بداية شهر الاستخدام",
        status: "أهلية الاشتراك الحالية",
        paidThrough: "مدفوع حتى",
        loading: "جارٍ تحميل البيانات…",
      }
    : {
        title: "Subscription and Usage",
        body: "Accepted automated messages and reserved capacity from company records.",
        account: "Manage Subscription",
        retry: "Refresh",
        unavailable: "Subscription and usage could not be loaded. Confirmed figures are unavailable.",
        forbidden: "Subscription data requires the company owner and a selected workspace.",
        empty: "No subscription is recorded for this company.",
        sent: "accepted automated messages",
        held: "reserved capacity",
        remaining: "remaining allowance",
        capMissing: "Usable allowance unavailable",
        period: "Usage month starts",
        status: "Current subscription eligibility",
        paidThrough: "Paid through",
        loading: "Loading data…",
      };

  useEffect(() => {
    const generation = ++request.current;
    startTransition(async () => {
      try {
        const result = await readDashboardBilling({expectedCompanyId:companyId??undefined});
        if (generation === request.current) setBilling(result);
      } catch {
        if (generation === request.current) setBilling({ status: "unavailable" });
      }
    });
    return () => {
      request.current += 1;
    };
  }, [companyId]);

  function refresh() {
    const generation = ++request.current;
    setBilling(null);
    startTransition(async () => {
      try {
        const result = await readDashboardBilling({expectedCompanyId:companyId??undefined});
        if (generation === request.current) setBilling(result);
      } catch {
        if (generation === request.current) setBilling({ status: "unavailable" });
      }
    });
  }

  const snapshot = billing?.status === "ready" && billing.companyId === companyId ? billing : null;
  const factLabel=(value:boolean|"unavailable")=>value==="unavailable"?(ar?"غير متوفر":"Unavailable"):value?(ar?"مؤكد":"Confirmed"):(ar?"غير مؤكد":"Not confirmed");
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(ar ? "ar-OM" : "en-GB", { timeZone: "UTC" }).format(new Date(date));

  return <section className={styles.panel} aria-label={text.title}>
    <header className={styles.panelHeader}><div><h2>{text.title}</h2><p>{text.body}</p></div><Button type="button" variant="secondary" busy={billing === null} onClick={refresh}>{text.retry}</Button></header>
    {snapshot ? <>
      <div className={styles.usageAmount}><strong>{snapshot.sent === null ? "—" : snapshot.sent.toLocaleString(locale)}</strong><span>{snapshot.cap !== null ? " / " + snapshot.cap.toLocaleString(locale) : ""} {text.sent}</span></div>
      {snapshot.usedPercent !== null && <div className={styles.meter} role="progressbar" aria-label={text.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.usedPercent}><span style={{width: Math.min(100,snapshot.usedPercent)+"%"}} /></div>}
      <div className={styles.usageDetails}><span>{snapshot.remaining === null ? text.capMissing : snapshot.remaining.toLocaleString(locale)+" "+text.remaining}</span><span>{snapshot.held === null ? "—" : snapshot.held.toLocaleString(locale)} {text.held}</span></div>
      <dl className={styles.facts}><div><dt>{text.status}</dt><dd>{factLabel(snapshot.operationalEligible)}</dd></div><div><dt>{text.paidThrough}</dt><dd>{snapshot.paidThrough ? formatDate(snapshot.paidThrough) : "—"}</dd></div><div><dt>{text.period}</dt><dd>{snapshot.monthStart ? formatDate(snapshot.monthStart) : "—"}</dd></div></dl>
      <details className={styles.disclosure}><summary>{ar ? "تفاصيل الأهلية والاستهلاك" : "Eligibility and usage details"}</summary><p>{ar ? "سجل الدفع المؤهل" : "Qualified payment history"}: {factLabel(snapshot.billingPaid)}</p><p>{ar ? "جاهزية القناة" : "Channel readiness"}: {factLabel(snapshot.channelReady)}</p><p>{ar ? "الرسائل المقبولة لا تعني التسليم. الدفع والربط وتشغيل الخدمة حالات مستقلة." : "Accepted messages do not confirm delivery. Payment, connection and service activation are separate states."}</p></details>
    </> : <p className={styles.empty} role="status">{billing === null ? text.loading : billing.status === "forbidden" ? text.forbidden : billing.status === "empty" && billing.companyId === companyId ? text.empty : text.unavailable}</p>}
    <footer className={styles.panelFooter}><Link href="/app/settings?tab=plan">{text.account}</Link></footer>
  </section>;
}

export function DashboardPage({
  initialLeads,
  initialReadiness = null,
  readinessLoadFailed = false,
  initialDiagnostic,
  workspace,
}: {
  initialLeads: DashboardInboxLoad;
  initialReadiness?: CustomerReadinessSnapshot | null;
  readinessLoadFailed?: boolean;
  initialDiagnostic?:unknown;
  workspace?: {actorId:string;companyId:string|null;companyName:string|null;fullName:string;role:CustomerReadinessSnapshot["role"]}|null;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const ar = locale === "ar";

  const [readiness, setReadiness] = useState<CustomerReadinessSnapshot | null>(initialReadiness);
  const [diagnostic,setDiagnostic]=useState<unknown>(initialDiagnostic);
  const [loadFailed, setLoadFailed] = useState(readinessLoadFailed);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const genRef = useRef(0);
  const attemptedRead = useRef(Boolean(initialReadiness));

  const [trackedProps, setTrackedProps] = useState(() => ({
    readiness: initialReadiness,
    failed: readinessLoadFailed,
  }));
  if (
    trackedProps.readiness !== initialReadiness ||
    trackedProps.failed !== readinessLoadFailed
  ) {
    setTrackedProps({ readiness: initialReadiness, failed: readinessLoadFailed });
    setReadiness(initialReadiness);
    setLoadFailed(readinessLoadFailed);
    setRefreshFailed(false);
  }

  useEffect(() => {
    const fence=genRef;
    fence.current += 1;
    return ()=>{fence.current += 1;};
  }, [initialReadiness, readinessLoadFailed]);

  async function reloadReadiness() {
    if(workspace===null)return;
    attemptedRead.current=true;
    const gen = ++genRef.current;
    setBusy(true);
    try {
      const result = workspace ? await readDashboardReadiness({actorId:workspace.actorId,companyId:workspace.companyId}) : await getCustomerReadiness();
      if (gen !== genRef.current) return;setDiagnostic(result.diagnostic);
      if (!result.ok || workspace && result.data.companyId!==workspace.companyId) {
        setRefreshFailed(true);
        if(!readiness)setLoadFailed(true);
        return;
      }
      setLoadFailed(false);
      setRefreshFailed(false);
      setReadiness(result.data);
    } catch {
      if (gen !== genRef.current) return;
      setRefreshFailed(true);
      if(!readiness)setLoadFailed(true);
    } finally {
      if (gen === genRef.current) setBusy(false);
    }
  }


  const companyId = workspace === undefined ? readiness?.companyId ?? null : workspace?.companyId ?? null;
  const identity = workspace === undefined ? readiness : workspace;
  const scopedInbox = initialLeads.ok && companyId !== null && initialLeads.meta.companyId === companyId;
  const metrics = dashboardInboxMetrics(scopedInbox ? initialLeads : {ok:false,code:"FORBIDDEN"},companyId);
  const automationOpen = scopedInbox && initialLeads.ok ? initialLeads.conversations.filter(conv => conv.status !== "resolved" && conv.automationAllowed === true && !conv.assistantPaused).length : null;
  const attentionIds = new Set(scopedInbox && initialLeads.ok ? initialLeads.page?.conversations.filter(conv => conv.intervention.reasons.length > 0).map(conv => conv.id) ?? [] : []);
  const recent = scopedInbox && initialLeads.ok ? [...initialLeads.conversations].sort((a,b) => (Date.parse(b.lastTouchAt ?? "") || b.messages.at(-1)?.at || 0) - (Date.parse(a.lastTouchAt ?? "") || a.messages.at(-1)?.at || 0)).slice(0,4) : [];
  const count = (value:number|null) => value === null ? "—" : value.toLocaleString(locale);
  const t = (a:string,e:string) => ar ? a : e;
  const cards = [
    {label:t("محادثات واتساب","WhatsApp conversations"),value:metrics.total,detail:t("الإجمالي المتاح لك في النشاط","Total available to you in this business"),href:"/app/conversations?channel=whatsapp"},
    {label:t("تحتاج متابعة","Needs attention"),value:metrics.loadedAwaitingStaff,detail:t("محادثات مسجّل لها تدخل بشري","Conversations with recorded intervention needs"),href:"/app/conversations?channel=whatsapp&filter=staff"},
    {label:t("الأتمتة مسموحة","Automation permitted"),value:automationOpen,detail:t("محادثات مفتوحة محمّلة؛ ليست عدد الردود","Open loaded chats; not a reply count"),href:"/app/conversations?channel=whatsapp&filter=noura"},
  ];
  return <WorkspaceShell title={copy.app.dashboardTitle}>
    <div className={styles.dashboard} dir={ar ? "rtl" : "ltr"}>
      <header className={styles.welcome}><div><h2>{t("أهلًا، ","Hello, ")}{identity?.fullName || t("صاحب النشاط","business owner")}</h2><p>{identity?.companyName || t("مساحة نشاطك","Your business workspace")}</p></div><nav aria-label={t("إجراءات سريعة","Quick actions")} className={styles.actions}><Link href="/app/settings" className={styles.secondary}>{t("الإعدادات","Settings")}</Link><Link href="/app/conversations" className={styles.primary}>{t("فتح المحادثات","Open inbox")}</Link></nav></header>
      <section className={styles.metrics} aria-label={t("ملخص محادثات النشاط","Business conversation overview")}>{cards.map(card => <Link href={card.href} key={card.href} className={styles.metric}><span>{card.label}</span><strong>{count(card.value)}</strong><p>{card.detail}</p></Link>)}</section>
      <div className={styles.columns}>
        {companyId && identity?.role === "owner" ? <DashboardBranch key={"branch:" + companyId} companyId={companyId} locale={locale}/> : <section className={styles.panel}><h2>{t("الفرع والقنوات","Branch and channels")}</h2><p className={styles.empty}>{t("حالة الفروع متاحة لمالك النشاط بعد اختيار مساحة العمل.","Branch status is available to the owner after choosing a workspace.")}</p></section>}
        <DashboardBillingCard key={"billing:" + (companyId ?? "none")} companyId={companyId}/>
      </div>
      <section className={styles.panel} aria-label={t("آخر محادثات واتساب المحمّلة","Latest loaded WhatsApp conversations")}>
        <header className={styles.panelHeader}><div><h2>{t("آخر المحادثات","Latest conversations")}</h2><p>{t("واتساب · أحدث نشاط في الصفحة المحمّلة","WhatsApp · latest activity in the loaded page")}</p></div><Link href="/app/conversations">{t("عرض الكل","View all")}</Link></header>
        {!scopedInbox ? <p role="status" className={styles.empty}>{!initialLeads.ok && initialLeads.code === "FORBIDDEN" ? copy.app.inboxAccessDeniedTitle + ": " + copy.app.inboxAccessDeniedBody : !initialLeads.ok && initialLeads.code === "NO_COMPANY" ? t("اختر مساحة الشركة لعرض المحادثات المسموح لك بها.","Select a company workspace to view conversations.") : t("تعذّر تحميل بيانات المحادثات. افتح الصندوق لإعادة المحاولة.","Conversation data could not be loaded. Open the inbox to retry.")}</p> : !recent.length ? <div className={styles.empty}><h3>{t("لسه مفيش محادثات","No conversations yet")}</h3><p>{t("لما تستقبل القناة رسالة وتتحقق منها، هتظهر في صندوق المحادثات.","Messages appear in the inbox after the channel receives and verifies them.")}</p><Link href="/app/conversations">{t("فتح صندوق المحادثات","Open inbox")}</Link></div> : <ul className={styles.conversations}>{recent.map(conv => {const at=Date.parse(conv.lastTouchAt ?? "") || conv.messages.at(-1)?.at || 0;return <li key={conv.id}><Link href={"/app/conversations?source=whatsapp&c="+encodeURIComponent(conv.id)}><span className={styles.avatar} aria-hidden="true">{(conv.customer || conv.phone || "W").slice(0,1)}</span><span className={styles.conversationBody}><strong dir="auto">{conv.customer || conv.phone || t("عميل واتساب","WhatsApp customer")}</strong><span dir="auto">{conv.summary || conv.messages.at(-1)?.text || "—"}</span></span><span className={styles.conversationMeta}><time dateTime={at ? new Date(at).toISOString() : undefined}>{at ? new Date(at).toLocaleDateString(locale,{day:"numeric",month:"short"}) : "—"}</time><span>{attentionIds.has(conv.id) ? t("تحتاج متابعة","Needs attention") : conv.assistantPaused ? t("المساعد متوقف","Assistant paused") : t("عرض المحادثة","View conversation")}</span></span></Link></li>;})}</ul>}
      </section>
      <section className={styles.tools} aria-label={t("إدارة الخدمة","Manage service")}>
        <Link href="/setup"><strong>{t("إعدادات المساعد والفرع","Assistant and branch setup")}</strong><p>{t("المواعيد، المعرفة، اللغة وتجربة المساعد","Hours, knowledge, language and assistant trial")}</p></Link>
        <Link href="/app/settings?tab=plan"><strong>{t("الباقة والفواتير","Plan and billing")}</strong><p>{t("راجع اشتراكك وسجل الدفع","Review your subscription and payment history")}</p></Link>
        <Link href="/app/settings"><strong>{t("إعدادات النشاط","Business settings")}</strong><p>{t("بيانات النشاط وإعدادات الحساب","Business details and account settings")}</p></Link>
      </section>
      <details className={styles.readiness} onToggle={event=>{if(event.currentTarget.open&&!attemptedRead.current&&!busy&&workspace!==null)void reloadReadiness();}}><summary>{t("تفاصيل جاهزية النشاط","Business readiness details")}</summary><div className={styles.panelHeader}><p>{t("حالات النشاط العامة؛ حالة الفرع المأكدة موجودة بالأعلى.","Business-wide status; confirmed branch status is shown above.")}</p><Button type="button" variant="secondary" busy={busy} disabled={workspace===null} onClick={() => void reloadReadiness()}>{copy.app.readinessRetry}</Button></div><DiagnosticHint diagnostic={diagnostic} locale={locale}/>
        {busy && !readiness && <p role="status">{t("جارٍ تحميل تفاصيل الجاهزية…","Loading readiness details…")}</p>}
        {loadFailed && !readiness && <Notice tone="error">{copy.app.readinessLoadFailed}</Notice>}
        {refreshFailed && readiness && <Notice tone="warn">{copy.app.readinessStaleSnapshot}</Notice>}
        {readiness && <ul className={styles.readinessList}>{readiness.items.map(item => <li key={item.id}><strong>{copy.app.readinessItems[item.id]}</strong><span>{copy.app.readinessDetails[item.detail]}</span><span className={styles.badge} data-tone={item.tone}>{copy.app.readinessTones[item.tone]}</span>{item.href && item.action !== "none" && <Link href={item.href}>{copy.app.readinessActions[item.action]}</Link>}</li>)}</ul>}
      </details>
    </div>
  </WorkspaceShell>;
}
