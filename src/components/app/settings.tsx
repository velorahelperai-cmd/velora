"use client";
import {DiagnosticHint} from "./diagnostic-hint";
import {beginDiagnostic} from "@/lib/diagnostics/flow";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CompanyRecord } from "@/lib/tenancy/types";
import { useDemo } from "@/lib/demo-state";
import { SubscriptionPanel } from "@/components/app/subscription-panel";
import type { SubscriptionOffersView } from "./subscription-offers-view";
import type { SubscriptionView } from "@/components/app/subscription-model";
import { AccountSettingsLinkCard } from "@/components/app/account-page";
import { WhatsappSettingsPanel } from "@/components/app/whatsapp-settings-panel";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { useOptionalAccountSession } from "./account-chrome";
import { subscriptionCopy, subscriptionTiers } from "./subscription-copy";
import { saveOwnerBusiness, selectWorkspaceCompany } from "@/lib/tenancy/actions";
import { CompanyTeamPanel } from "./company-team-panel";
import { reconcileDraftFields } from "./draft-refresh";
import {
  Button, Card, Field, Notice, Tabs,
  useAction, useAppCopy, useUnsavedWarning,
} from "@/components/app/ui";

type SettingsAccess = {userId?:string|null;email:string|null;companyId:string|null;companyName:string|null;role:"owner"|"staff"|null;needsCompanyContext:boolean;isPlatformAdmin:boolean;choices:Array<{companyId:string;displayName:string;role:"owner"|"staff"}>};

type Tab = "account" | "business" | "team" | "whatsapp" | "plan";

export function SettingsPage({
  initialAccess,
  initialCompany,
  initialSubscription,
  initialOffersView,
  initialWhatsappLink = null,
  whatsappLinkLoadFailed = false,
  whatsappLiveOpsReady = false,
  singleTenantReception = null,
}: {
  initialAccess: SettingsAccess;
  initialCompany:CompanyRecord|null;
  initialSubscription: SubscriptionView;
  initialOffersView: SubscriptionOffersView;
  initialWhatsappLink?: import("@/lib/whatsapp/connection").WhatsappCompanyLink | null;
  whatsappLinkLoadFailed?: boolean;
  whatsappLiveOpsReady?: boolean;
  singleTenantReception?: import("@/lib/whatsapp/config").SingleTenantReceptionStatus | null;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const effectiveRole = initialAccess.needsCompanyContext || !initialAccess.companyId ? null : initialAccess.role;
  const c=subscriptionCopy[locale];
  const accountSession=useOptionalAccountSession();
  const [switchBusy,setSwitchBusy]=useState(false);
  const [switchError,setSwitchError]=useState(false);
  const businessLeaveGuard = useRef<() => boolean>(() => true);
  const params = useSearchParams();
  const router = useRouter();
  const requested = (params.get("tab") as Tab) || "account";
  const ownerTabs: Tab[] = ["business", "team", "whatsapp", "plan"];
  const tabs = (Object.keys(copy.app.tabs) as Tab[])
    .filter((id) => effectiveRole === "owner" || !ownerTabs.includes(id))
    .map((id) => ({ id, label: copy.app.tabs[id] }));
  const tab = tabs.some((t) => t.id === requested) ? requested : "account";
  const locked = effectiveRole !== "owner" && ownerTabs.includes(requested);

  async function switchCompany(id:string) {
    if(!id||id===initialAccess.companyId||switchBusy||!businessLeaveGuard.current())return;
    setSwitchBusy(true);setSwitchError(false);
    if (!initialAccess.userId) { setSwitchBusy(false); return; }
    try { const result=await selectWorkspaceCompany(id, { expectedUserId: initialAccess.userId, next: window.location.pathname + window.location.search }); if(accountSession && !accountSession.isCurrentUser(initialAccess.userId))return; if(!result.ok){setSwitchError(true);return;} window.location.replace(result.data.next); } catch {setSwitchError(true);} finally {setSwitchBusy(false);}
  }
  const accessNote=initialAccess.needsCompanyContext?c.permissionNotes.select_company:!initialAccess.companyId?c.permissionNotes.no_company:c.permissionNotes.staff;

  return (
    <WorkspaceShell title={copy.app.settingsTitle}>
      <Card title={c.signedAccount}>
        <dl className="grid gap-3 break-words text-sm sm:grid-cols-3"><div><dt>{c.signedAccount}</dt><dd dir="ltr">{initialAccess.email??c.unknown}</dd></div><div><dt>{c.companyContext}</dt><dd>{initialAccess.companyName??c.noCompany}</dd></div><div><dt>{c.membershipRole}</dt><dd>{effectiveRole==="owner"?c.ownerRole:effectiveRole==="staff"?c.staffRole:c.unknown}</dd></div></dl>
        {initialAccess.isPlatformAdmin?<p className="mt-3 text-sm">{c.platformRole}. {c.permissionNotes.platform} <Link className="underline" href="/admin">{c.navigationLabels.platform}</Link></p>:null}
        {initialAccess.choices.length>0&&(initialAccess.needsCompanyContext||initialAccess.choices.length>1||initialAccess.isPlatformAdmin)?<label className="mt-4 grid max-w-md gap-2 text-sm">{c.chooseCompany}<select aria-label={c.chooseCompany} className="min-h-11 rounded-xl border px-3" value={initialAccess.companyId??""} disabled={switchBusy} onChange={event=>void switchCompany(event.target.value)}><option value="">{c.chooseCompany}</option>{initialAccess.choices.map(choice=><option key={choice.companyId} value={choice.companyId}>{choice.displayName} / {choice.role==="owner"?c.ownerRole:c.staffRole}</option>)}</select></label>:null}
        {switchError?<p role="alert">{c.switchFailed}</p>:null}
        <Button variant="ghost" busy={switchBusy} onClick={()=>{void accountSession?.refresh();router.refresh();}}>{c.refreshAccess}</Button>
      </Card>
      <div className="mt-5" />
      <Tabs tabs={tabs} value={tab} onChange={(t) => router.replace(`/app/settings?tab=${t}`)} />
      <div className="mt-5">
        {locked ? (
          <Notice tone="warn">{accessNote} <Link className="underline" href="/#packages">{c.viewPlans}</Link></Notice>
        ) : (
          <>
            {tab === "account" ? <AccountTab /> : null}
            {effectiveRole === "owner" && initialCompany ? <div hidden={tab !== "business"}><BusinessTab key={`${initialAccess.userId}:${initialCompany.id}`} userId={initialAccess.userId ?? null} company={initialCompany} leaveGuardRef={businessLeaveGuard} /></div> : null}
            {tab === "team" && initialAccess.companyId ? <CompanyTeamPanel key={`${initialAccess.companyId}:${accountSession?.identity?.userId ?? initialAccess.email ?? "guest"}`} companyId={initialAccess.companyId} accountId={accountSession?.identity?.userId ?? null} /> : null}
            {tab === "whatsapp" ? (
              <WhatsappSettingsPanel
                key={`${initialAccess.companyId}:${initialWhatsappLink?.updatedAt ?? ""}:${whatsappLinkLoadFailed}`}
                companyId={initialAccess.companyId!}
                initialLink={initialWhatsappLink}
                initialLoadFailed={whatsappLinkLoadFailed}
                liveOpsReady={whatsappLiveOpsReady}
                singleTenant={singleTenantReception}
              />
            ) : null}
            {tab === "plan" ? (
              <div className="grid gap-6">
                <PlanHeroSummary view={initialSubscription} locale={locale} />
                <SubscriptionPanel key={initialAccess.companyId} companyId={initialAccess.companyId!} locale={locale} view={initialSubscription} offersView={initialOffersView} onRetry={() => router.refresh()} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

function PlanHeroSummary({
  view,
  locale,
}: {
  view: SubscriptionView;
  locale: "ar" | "en";
}) {
  const ar = locale === "ar";
  const c = subscriptionCopy[locale];
  const tier = subscriptionTiers.find((t) => t.id === view.currentTier);
  const tierName = tier ? tier[locale] : c.noPlan;
  const isActive = view.state === "active";
  const isPending = view.state === "pending";

  const formatDate = (dateStr: string) => {
    try {
      return new Intl.DateTimeFormat(ar ? "ar-OM" : "en-GB", { dateStyle: "medium" }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-[#38dc89]/30 bg-gradient-to-r from-[#12281e] via-[#0d1c15] to-[#07110d] p-5 shadow-[0_12px_32px_rgba(0,0,0,0.35)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#38dc89]/20 border border-[#38dc89]/40 text-2xl font-bold">
            ⚡
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-[#f7fbf8]">{tierName}</h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  isActive
                    ? "bg-[#38dc89]/20 text-[#9af0c3] border border-[#38dc89]/40"
                    : isPending
                      ? "bg-[#d9a467]/20 text-[#f0cf9d] border border-[#d9a467]/40"
                      : "bg-white/10 text-[#b7c6b9] border border-white/15"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-[#38dc89] animate-pulse" : "bg-[#d9a467]"}`} />
                {c.states[view.state] ?? view.state}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#b7c6b9]">
              {ar
                ? "حالة الاشتراك من سجلات النشاط. ربط ميتا وتفعيل الردود الحية لهما شروط مستقلة."
                : "Subscription status comes from company records. Meta connection and live replies have separate requirements."}
            </p>
          </div>
        </div>

        <a
          href="#subscription-plans"
          className="inline-flex min-h-10 items-center rounded-full border border-[#38dc89]/40 bg-[#38dc89]/15 px-4 text-xs font-semibold text-[#9af0c3] transition hover:bg-[#38dc89]/25 hover:shadow-[0_0_12px_rgba(56,220,137,0.3)]"
        >
          {ar ? "ترقية الباقة أو تغيير الدورة ↗" : "Upgrade or Change Cycle ↗"}
        </a>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-white/10 pt-4 text-xs">
        <div>
          <span className="text-[#8aa394] block">{ar ? "دورة الفاتورة" : "Billing Cycle"}</span>
          <strong className="text-[#f7fbf8] mt-0.5 block">{view.cycle ? c[view.cycle] : c.unknown}</strong>
        </div>
        <div>
          <span className="text-[#8aa394] block">{ar ? "تاريخ التجديد" : "Renewal Date"}</span>
          <strong className="text-[#f7fbf8] mt-0.5 block">{view.paidThrough ? formatDate(view.paidThrough) : c.unknown}</strong>
        </div>
        <div>
          <span className="text-[#8aa394] block">{ar ? "بوابة الدفع" : "Payment Gateway"}</span>
          <strong className="text-[#9af0c3] mt-0.5 block">Paymob Oman (سلطنة عُمان)</strong>
        </div>
        <div>
          <span className="text-[#8aa394] block">{ar ? "القناة" : "Channel"}</span>
          <strong className="text-[#f7fbf8] mt-0.5 block">WhatsApp Business API</strong>
        </div>
      </div>
    </div>
  );
}

function AccountTab() {
  return <AccountSettingsLinkCard />;
}

function BusinessTab({userId,company,leaveGuardRef}:{userId:string|null;company:CompanyRecord;leaveGuardRef:{current:()=>boolean}}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const router=useRouter();
  const accountSession=useOptionalAccountSession();
  const fromCompany=(row:CompanyRecord)=>({name:row.display_name,type:row.business_type,replyLanguage:row.reply_language,country:row.country,city:row.city,hours:row.hours,contactPhone:row.contact_phone,contactEmail:row.contact_email});
  const [form,setForm]=useState(()=>fromCompany(company));
  const [baseline,setBaseline]=useState(()=>fromCompany(company));
  const [trackedCompany,setTrackedCompany]=useState(company);
  const [conflicts,setConflicts]=useState<Array<keyof typeof form>>([]);
  const [error,setError]=useState<string|null>(null);
  const [diagnostic,setDiagnostic]=useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const { busy, run } = useAction();
  if(trackedCompany!==company){
    const refreshed=reconcileDraftFields(form,baseline,fromCompany(company),conflicts);
    setTrackedCompany(company);setForm(refreshed.values);setBaseline(refreshed.baseline);setConflicts(refreshed.conflicts);setSaved(false);
  }
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  useUnsavedWarning(dirty && !busy);
  useEffect(()=>{
    leaveGuardRef.current=()=>!busy&&(!dirty||window.confirm(copy.unsaved));
    return ()=>{leaveGuardRef.current=()=>true;};
  },[busy,dirty,copy.unsaved,leaveGuardRef]);
  return (
    <Card title={copy.app.tabs.business}>
      <form className="grid gap-4 lg:grid-cols-2" noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!userId || (accountSession && !accountSession.isCurrentUser(userId))) return;
        if(conflicts.length)return;
        setSaved(false);setError(null);setDiagnostic(null);
        void run(async () => {
          const result = await saveOwnerBusiness({
            expectedUserId: userId,
            expectedCompanyId: company.id,
            displayName: form.name,
            businessType: form.type,
            replyLanguage: form.replyLanguage,
            country: form.country,
            city: form.city,
            hours: form.hours,
            contactPhone: form.contactPhone,
            contactEmail: form.contactEmail,
          });
          if (accountSession && !accountSession.isCurrentUser(userId)) return;
          setDiagnostic(result.diagnostic);if (!result.ok) {
            setError(copy.errors.authFailed);
            return;
          }
          const business=fromCompany(result.data);
          setForm(business);setBaseline(business);setConflicts([]);
          setSaved(true);
          try{router.refresh();}catch{setDiagnostic(result.diagnostic??beginDiagnostic("company_save").event("refresh","REFRESH_FAILED"));}
        });
      }}>
        {error?<div className="lg:col-span-2"><Notice tone="error">{error}</Notice></div>:null}
        <div className="lg:col-span-2"><DiagnosticHint diagnostic={diagnostic} locale={locale}/></div>
        {conflicts.length?<div className="lg:col-span-2"><Notice tone="warn">
          <p>{locale==="ar"?"تم تحديث بعض الحقول التي تعدّلها. راجع القيم الأحدث قبل الحفظ.":"Some fields you are editing changed in the saved record. Review the latest values before saving."}</p>
          <Button type="button" variant="secondary" disabled={busy} onClick={()=>{setForm(previous=>conflicts.reduce((next,key)=>({...next,[key]:baseline[key]}),previous));setConflicts([]);}}>{locale==="ar"?"استخدام أحدث القيم المتعارضة":"Use latest conflicting values"}</Button>
        </Notice></div>:null}
        {saved && !dirty ? <div className="lg:col-span-2"><Notice tone="success">{copy.saved}</Notice></div> : null}
        <Field label={copy.setup.businessName} required>{(p) => <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label={copy.setup.city}>{(p) => <input {...p} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />}</Field>
        <Field label={copy.setup.hours} required>{(p) => <input {...p} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />}</Field>
        <Field label={copy.setup.contactPhone}>{(p) => <input {...p} dir="ltr" inputMode="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />}</Field>
        <div className="lg:col-span-2"><Button type="submit" busy={busy} busyLabel={copy.saving} disabled={conflicts.length>0 || !dirty || !form.name.trim()}>{copy.save}</Button></div>
      </form>
    </Card>
  );
}
