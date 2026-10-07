"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import type { CompanyRecord } from "@/lib/tenancy/types";
import { useDemo } from "@/lib/demo-state";
import { SubscriptionPanel } from "@/components/app/subscription-panel";
import type { SubscriptionOffersView } from "./subscription-offers-view";
import type { SubscriptionView } from "@/components/app/subscription-model";
import { AccountSettingsLinkCard } from "@/components/app/account-page";
import { WhatsappSettingsPanel } from "@/components/app/whatsapp-settings-panel";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { useOptionalAccountSession } from "./account-chrome";
import { subscriptionCopy } from "./subscription-copy";
import { saveOwnerBusiness, selectWorkspaceCompany } from "@/lib/tenancy/actions";
import {
  Button, Card, Field, Notice, Tabs,
  useAction, useAppCopy, useUnsavedWarning,
} from "@/components/app/ui";

type SettingsAccess = {email:string|null;companyId:string|null;companyName:string|null;role:"owner"|"staff"|null;needsCompanyContext:boolean;isPlatformAdmin:boolean;choices:Array<{companyId:string;displayName:string;role:"owner"|"staff"}>};

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
    if(!id||switchBusy)return;
    setSwitchBusy(true);setSwitchError(false);
    try { const result=await selectWorkspaceCompany(id); if(!result.ok){setSwitchError(true);return;} await accountSession?.refresh();router.refresh(); } catch {setSwitchError(true);} finally {setSwitchBusy(false);}
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
            {tab === "business" && initialCompany ? <BusinessTab key={initialCompany.id + initialCompany.updated_at} company={initialCompany} /> : null}
            {tab === "team" ? <TeamTab /> : null}
            {tab === "whatsapp" ? (
              <WhatsappSettingsPanel
                initialLink={initialWhatsappLink}
                initialLoadFailed={whatsappLinkLoadFailed}
                liveOpsReady={whatsappLiveOpsReady}
                singleTenant={singleTenantReception}
              />
            ) : null}
            {tab === "plan" ? (
              <SubscriptionPanel locale={locale} view={initialSubscription} offersView={initialOffersView} onRetry={() => router.refresh()} />
            ) : null}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

function AccountTab() {
  return <AccountSettingsLinkCard />;
}

function BusinessTab({company}:{company:CompanyRecord}) {
  const copy = useAppCopy();
  const router=useRouter();
  const fromCompany=(row:CompanyRecord)=>({name:row.display_name,type:row.business_type,replyLanguage:row.reply_language,country:row.country,city:row.city,hours:row.hours,contactPhone:row.contact_phone,contactEmail:row.contact_email});
  const [form,setForm]=useState(()=>fromCompany(company));
  const [baseline,setBaseline]=useState(()=>fromCompany(company));
  const [error,setError]=useState<string|null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, run } = useAction();
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  useUnsavedWarning(dirty && !busy);
  return (
    <Card title={copy.app.tabs.business}>
      <form className="grid gap-4 lg:grid-cols-2" noValidate onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);setError(null);
        void run(async () => {
          const result = await saveOwnerBusiness({
            displayName: form.name,
            businessType: form.type,
            replyLanguage: form.replyLanguage,
            country: form.country,
            city: form.city,
            hours: form.hours,
            contactPhone: form.contactPhone,
            contactEmail: form.contactEmail,
          });
          if (!result.ok) {
            setError(copy.errors.authFailed);
            return;
          }
          const business=fromCompany(result.data);
          setForm(business);setBaseline(business);
          router.refresh();
          setSaved(true);
        });
      }}>
        {error?<div className="lg:col-span-2"><Notice tone="error">{error}</Notice></div>:null}
        {saved && !dirty ? <div className="lg:col-span-2"><Notice tone="success">{copy.saved}</Notice></div> : null}
        <Field label={copy.setup.businessName} required>{(p) => <input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label={copy.setup.city}>{(p) => <input {...p} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />}</Field>
        <Field label={copy.setup.hours} required>{(p) => <input {...p} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />}</Field>
        <Field label={copy.setup.contactPhone}>{(p) => <input {...p} dir="ltr" inputMode="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />}</Field>
        <div className="lg:col-span-2"><Button type="submit" busy={busy} busyLabel={copy.saving} disabled={!dirty || !form.name.trim()}>{copy.save}</Button></div>
      </form>
    </Card>
  );
}

function TeamTab() {
  const copy = useAppCopy();
  return (
    <Card title={copy.app.tabs.team}>
      <Notice tone="warn">{copy.app.teamInviteUnavailable}</Notice>
    </Card>
  );
}
