"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { readDashboardBranch, type DashboardBranchLoad } from "@/lib/customer/dashboard-branch-actions";
import { setupPlanLabel } from "./setup-plan-label";
import styles from "./dashboard.module.css";

export function DashboardBranch({ companyId, locale }: { companyId: string; locale: "ar" | "en" }) {
  const ar = locale === "ar", t = (a: string, e: string) => ar ? a : e;
  const [load, setLoad] = useState<DashboardBranchLoad | null>(null);
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const fence = epoch;
    const request = ++epoch.current;
    void readDashboardBranch({ expectedCompanyId: companyId }).then(result => { if (request === epoch.current) setLoad(result); }).catch(() => { if (request === epoch.current) setLoad({ status: "unavailable" }); });
    return () => { fence.current++; };
  }, [companyId]);
  async function refresh(branchId?: string) {
    const request = ++epoch.current;
    setBusy(true); setLoad(null);
    try { const result = await readDashboardBranch({ expectedCompanyId: companyId, branchId }); if (request === epoch.current) setLoad(result); }
    catch { if (request === epoch.current) setLoad({ status: "unavailable" }); }
    finally { if (request === epoch.current) setBusy(false); }
  }
  const data = load?.status === "ready" && load.companyId === companyId ? load : null;
  const s = data?.summary;
  const confirmed = s?.activation.status === "launched" && !!s.activation.receiptId && !!s.operationId && s.activation.operationId === s.operationId && s.setup.launch.confirmed;
  const persona = s?.setup.entitlement?.persona;
  const assistant = persona ? ({ level_1: t("نورا", "Noura"), level_2: t("لينا", "Lina"), level_3: t("دانا", "Dana") })[persona] : t("المساعد", "Assistant");
  return <section className={styles.panel} aria-label={t("الفرع والقنوات", "Branch and channels")} aria-busy={busy || !load}>
    <header className={styles.panelHeader}><div><h2>{t("الفرع والقنوات", "Branch and channels")}</h2><p>{t("حالة الربط والإطلاق المحفوظة لفرعك", "Your branch’s saved connection and launch status")}</p></div><button className={styles.quietButton} type="button" disabled={busy || !load} onClick={() => void refresh(data?.selectedId ?? undefined)}>{t("تحديث", "Refresh")}</button></header>
    {!load ? <p role="status" className={styles.empty}>{t("جارٍ التحقق من الفرع…", "Checking your branch…")}</p> : !data ? <p role="status" className={styles.empty}>{t("تعذّر تأكيد حالة الفرع. أعد التحديث.", "Branch status could not be confirmed. Refresh to retry.")}</p> : <>
      {data.branches.length > 1 && <label className={styles.branchPicker}>{t("الفرع", "Branch")}<select value={data.selectedId ?? ""} disabled={busy} onChange={e => { if (e.target.value) void refresh(e.target.value); }}><option value="">{t("اختر فرعًا", "Choose a branch")}</option>{data.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.label}</option>)}</select></label>}
      {!data.selectedId ? <p className={styles.empty}>{data.branches.length ? t("اختر الفرع لعرض قنواته وحالته.", "Choose a branch to view its channels and status.") : t("لا يوجد فرع مدفوع متاح لهذا النشاط.", "No paid branch is available for this business.")}</p> : !s ? <p role="status" className={styles.empty}>{t("الفرع موجود، لكن تفاصيله غير متاحة الآن.", "The branch exists, but its details are unavailable right now.")}</p> : <>
        <div className={styles.branchIdentity}><div><h3>{s.branchLabel}</h3><p>{assistant} · {setupPlanLabel(locale, s.setup.entitlement?.package)}</p></div><span className={styles.badge} data-tone={confirmed ? "complete" : "pending"}>{confirmed ? t("✓ الإطلاق مؤكد", "✓ Launch confirmed") : t("التجهيز يحتاج متابعة", "Setup needs attention")}</span></div>
        <ul className={styles.channelList}>{(s.setup.selectedChannels ?? []).map(channel => { const row = s.summary.channels.find(value => value.channel === channel); return <li key={channel}><strong>{channel === "whatsapp" ? "WhatsApp" : "Instagram"}</strong><span className={styles.badge} data-tone={row?.status === "verified" ? "complete" : "pending"}>{row?.status === "verified" ? t("متصل ومؤكد", "Connection verified") : row?.status === "unavailable" || !row ? t("الحالة غير متاحة", "Status unavailable") : t("يحتاج إجراء", "Action needed")}</span><Link href="/setup">{t("إدارة الربط", "Manage connection")}</Link></li>; })}</ul>
        <p className={styles.caption}>{t("تأكيد الإطلاق لا يثبت إرسال أو وصول رسالة. حالة كل رسالة بتظهر في المحادثة.", "Launch confirmation does not prove a message was sent or delivered. Each message shows its own status in the inbox.")}</p>
      </>}
      <footer className={styles.panelFooter}><Link href="/setup">{t("مراجعة إعدادات الفرع", "Review branch setup")}</Link><time dateTime={data.asOf}>{t("آخر تحقق: ", "Checked: ")}{new Date(data.asOf).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time></footer>
    </>}
  </section>;
}
