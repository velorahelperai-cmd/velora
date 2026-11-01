"use client";
/**
 * F4 item 3: one explicit owner action imports contacts (smb_app_state_sync) first, then chat
 * history. Reuses the existing once-only, 24h-bounded server sync (coexistence/sync.ts).
 * Never runs on mount or timer; reads status only.
 */
import { useEffect, useRef, useState } from "react";
import styles from "./paid-channel-view.module.css";

type SyncType = "history" | "smb_app_state_sync";
type SyncItem = { syncType: SyncType; state: string; requested: boolean; declined: boolean; errorCode: number | null };
export type CoexistenceImportSetup = { ok: true; linkId: string; linkGeneration: number; syncs: SyncItem[]; ready: boolean; deadlineAt?: string | null };
export type CoexistenceImportPorts = {
  read: (companyId: string) => Promise<CoexistenceImportSetup | { ok: false; code?: string }>;
  request: (input: { companyId: string; linkId: string; linkGeneration: number; syncType: SyncType; consent: true }) => Promise<{ ok: true } | { ok: false; code?: string }>;
  now?: () => number;
};

async function defaultPorts(): Promise<CoexistenceImportPorts> {
  const mod = await import("@/lib/whatsapp/coexistence/actions");
  return { read: id => mod.getCoexistenceSyncSetup(id) as never, request: input => mod.requestCoexistenceHistorySync(input) as never };
}

export function coexistenceImportRemaining(deadlineAt: string | null | undefined, now: number): number | null {
  const d = deadlineAt ? Date.parse(deadlineAt) : NaN;
  return Number.isFinite(d) ? Math.max(0, d - now) : null;
}

export function CoexistenceImportPanel({ companyId, locale, ports }: { companyId: string; locale: "ar" | "en"; ports?: CoexistenceImportPorts }) {
  const t = (ar: string, en: string) => locale === "ar" ? ar : en;
  const [setup, setSetup] = useState<CoexistenceImportSetup | null | "unavailable">(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => (ports?.now ?? Date.now)());
  const reserved = useRef(false);
  const portsRef = useRef<CoexistenceImportPorts | null>(ports ?? null);

  async function resolvePorts() { return portsRef.current ??= await defaultPorts(); }
  async function refresh() {
    try { const r = await (await resolvePorts()).read(companyId); setSetup(r.ok ? r : "unavailable"); return r.ok ? r : null; }
    catch { setSetup("unavailable"); return null; }
  }
  useEffect(() => {
    let live = true;
    // Status read only; ignore responses after the company panel unmounts.
    void (async () => {
      try {
        const resolved = ports ?? await defaultPorts();
        const result = await resolved.read(companyId);
        if (live) setSetup(result.ok ? result : "unavailable");
      } catch { if (live) setSetup("unavailable"); }
    })();
    return () => { live = false; };
  }, [companyId, ports]);
  useEffect(() => { const id = window.setInterval(() => setNow((ports?.now ?? Date.now)()), 30_000); return () => window.clearInterval(id); }, [ports?.now]);

  if (setup === null) return <p role="status" data-coexistence-import="loading">{t("جارٍ التحقق من حالة الاستيراد…", "Checking import status…")}</p>;
  if (setup === "unavailable") return <p role="status" data-coexistence-import="unavailable">{t("حالة الاستيراد غير متاحة الآن. لم يُرسل أي طلب.", "Import status is unavailable right now. No request was sent.")}</p>;

  const item = (type: SyncType) => setup.syncs.find(s => s.syncType === type);
  const contacts = item("smb_app_state_sync"), history = item("history");
  const remaining = coexistenceImportRemaining(setup.deadlineAt, now);
  const expired = remaining === 0;
  const declined = !!history?.declined;
  const allRequested = !!contacts?.requested && !!history?.requested;
  const canRun = setup.ready && !busy && !expired && !allRequested && !declined;
  const hours = remaining === null ? null : Math.floor(remaining / 3_600_000), minutes = remaining === null ? null : Math.floor((remaining % 3_600_000) / 60_000);
  const warn = remaining !== null && remaining > 0 && remaining < 3 * 3_600_000;

  async function run() {
    if (reserved.current || !canRun || setup === null || setup === "unavailable") return;
    reserved.current = true; setBusy(true); setMessage(null);
    try {
      const p = await resolvePorts();
      // Contacts first, then history. Each type is once-only server-side; skip already requested types.
      for (const type of ["smb_app_state_sync", "history"] as const) {
        if (item(type)?.requested) continue;
        const r = await p.request({ companyId, linkId: setup.linkId, linkGeneration: setup.linkGeneration, syncType: type, consent: true });
        if (!r.ok) {
          setMessage(r.code === "EXPIRED" ? t("انتهت مهلة الـ24 ساعة لاستيراد البيانات. لم يُستورد شيء إضافي.", "The 24-hour import window has ended. Nothing further was imported.")
            : r.code === "CONSUMED" ? t("تم إرسال هذا الطلب سابقًا ولا يمكن تكراره.", "This request was already sent and cannot be repeated.")
            : type === "history" ? t("تم طلب جهات الاتصال، وتعذّر طلب المحادثات. لا تكرر المحاولة قبل مراجعة الحالة.", "Contacts were requested, but chat history could not be requested. Review the status before retrying.")
            : t("تعذّر طلب الاستيراد. لم يُرسل طلب المحادثات.", "Import could not be requested. Chat history was not requested."));
          break;
        }
      }
    } catch { setMessage(t("تعذّر الوصول إلى الخادم. راجع الحالة قبل إعادة المحاولة.", "Could not reach the server. Review the status before retrying.")); }
    finally { await refresh(); setBusy(false); reserved.current = false; }
  }

  const stateText = (s?: SyncItem) => !s || s.state === "not_requested" ? t("لم يُطلب", "Not requested")
    : s.declined ? t("رفض صاحب الحساب المشاركة في تطبيق WhatsApp Business", "Declined in the WhatsApp Business app")
    : s.state === "pending" ? t("قيد الانتظار", "Pending") : s.state === "syncing" ? t("جارٍ الاستيراد", "Importing")
    : s.state === "completed" ? t("اكتمل", "Completed") : s.state === "failed" ? t("فشل", "Failed") : t("يحتاج مراجعة", "Needs review");

  return <section className={styles.requirements} data-coexistence-import aria-labelledby="coex-import-title">
    <h3 id="coex-import-title">{t("استيراد جهات الاتصال والمحادثات", "Import contacts and chats")}</h3>
    <p>{t("يُستورد مرة واحدة فقط: جهات الاتصال أولًا ثم سجل المحادثات (حتى 180 يومًا، دون المجموعات). ستطلب منك Meta الموافقة داخل تطبيق WhatsApp Business.", "Runs once only: contacts first, then chat history (up to 180 days, no groups). Meta will ask you to approve sharing in the WhatsApp Business app.")}</p>
    <p role={warn || expired ? "alert" : "status"} data-import-deadline={expired ? "expired" : warn ? "warning" : remaining === null ? "unknown" : "open"}>
      {remaining === null ? t("يجب الطلب خلال 24 ساعة من الربط.", "Must be requested within 24 hours of connecting.")
        : expired ? t("انتهت مهلة الـ24 ساعة.", "The 24-hour window has ended.")
        : t(`الوقت المتبقي: ${hours} ساعة و${minutes} دقيقة`, `Time left: ${hours}h ${minutes}m`)}
    </p>
    <ul aria-label={t("حالة الاستيراد", "Import status")}>
      <li>{t("جهات الاتصال", "Contacts")}: <span data-sync-state="smb_app_state_sync">{stateText(contacts)}</span></li>
      <li>{t("المحادثات", "Chats")}: <span data-sync-state="history">{stateText(history)}</span></li>
    </ul>
    {message && <p role="alert">{message}</p>}
    <button type="button" className={styles.primary} disabled={!canRun} aria-busy={busy} onClick={() => void run()}>{t("استيراد جهات الاتصال والمحادثات", "Import contacts and chats")}</button>
  </section>;
}
