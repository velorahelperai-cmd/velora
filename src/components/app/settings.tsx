"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";
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
import { createStaffInvitation, listCompanyTeam } from "@/lib/tenancy/staff-invitations";
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
            {tab === "team" && initialAccess.companyId ? <TeamTab key={initialAccess.companyId} companyId={initialAccess.companyId} /> : null}
            {tab === "whatsapp" ? (
              <WhatsappSettingsPanel
                initialLink={initialWhatsappLink}
                initialLoadFailed={whatsappLinkLoadFailed}
                liveOpsReady={whatsappLiveOpsReady}
                singleTenant={singleTenantReception}
              />
            ) : null}
            {tab === "plan" ? (
              <div className="grid gap-6">
                <PlanHeroSummary view={initialSubscription} locale={locale} />
                <SubscriptionPanel locale={locale} view={initialSubscription} offersView={initialOffersView} onRetry={() => router.refresh()} />
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
  const tierName = tier ? tier[locale] : (ar ? "باقة نورا الذكية (خدمة العملاء)" : "Noura AI (Customer Service)");
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
                ? "تتضمن رداً آلياً معتمداً عبر واتساب، تصنيف استفسارات العملاء، والتحويل اللحظي للموظف البشري."
                : "Includes approved automated WhatsApp replies, lead classification, and real-time staff handover."}
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
          <strong className="text-[#f7fbf8] mt-0.5 block">{view.cycle ? c[view.cycle] : (ar ? "شهري" : "Monthly")}</strong>
        </div>
        <div>
          <span className="text-[#8aa394] block">{ar ? "تاريخ التجديد" : "Renewal Date"}</span>
          <strong className="text-[#f7fbf8] mt-0.5 block">{view.paidThrough ? formatDate(view.paidThrough) : (ar ? "سارٍ حالياً" : "Active")}</strong>
        </div>
        <div>
          <span className="text-[#8aa394] block">{ar ? "بوابة الدفع" : "Payment Gateway"}</span>
          <strong className="text-[#9af0c3] mt-0.5 block">Paymob Oman (سلطنة عُمان)</strong>
        </div>
        <div>
          <span className="text-[#8aa394] block">{ar ? "القناة المعتمدة" : "Active Channel"}</span>
          <strong className="text-[#f7fbf8] mt-0.5 block">WhatsApp Business API</strong>
        </div>
      </div>
    </div>
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

function TeamTab({ companyId }: { companyId: string }) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const ar = locale === "ar";
  const [team, setTeam] = useState<Awaited<ReturnType<typeof listCompanyTeam>> | null>(null);
  const [form, setForm] = useState({ email: "", name: "" });
  const [invite, setInvite] = useState<{ inviteUrl: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, run } = useAction();
  const request = useRef(0);
  const text = ar ? {
    members: "عضويات النشاط", invitations: "الدعوات المحفوظة", emptyInvites: "لا توجد دعوات معلّقة.",
    failed: "تعذّر تحميل الفريق من الخادم. حاول مرة أخرى.", createFailed: "تعذّر إنشاء الدعوة. تحقق من البيانات والصلاحيات ثم أعد المحاولة.",
    saved: "تم حفظ الدعوة. انسخ الرابط وشاركه مع الموظف المقصود.", expires: "تنتهي الدعوة", copy: "نسخ الرابط", copied: "تم النسخ", disabled: "معطّل", expired: "منتهية", refresh: "تحديث الفريق",
  } : {
    members: "Company memberships", invitations: "Saved invitations", emptyInvites: "No pending invitations.",
    failed: "The team could not be loaded from the server. Try again.", createFailed: "Could not create the invitation. Check the details and permissions, then try again.",
    saved: "Invitation saved. Copy the link and share it with the intended staff member.", expires: "Expires", copy: "Copy link", copied: "Copied", disabled: "Disabled", expired: "Expired", refresh: "Refresh team",
  };
  const formatDate = (date: string) => new Intl.DateTimeFormat(ar ? "ar-OM" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));

  useEffect(() => {
    const generation = ++request.current;
    startTransition(async () => {
      try {
        const result = await listCompanyTeam();
        if (generation === request.current) setTeam(result);
      } catch {
        if (generation === request.current) setTeam({ ok: false, code: "UNAVAILABLE" });
      }
    });
    return () => { request.current += 1; };
  }, []);

  async function reload() {
    const generation = ++request.current;
    try {
      const result = await listCompanyTeam();
      if (generation === request.current) setTeam(result);
    } catch {
      if (generation === request.current) setTeam({ ok: false, code: "UNAVAILABLE" });
    }
  }

  const snapshot = team?.ok && team.data.companyId === companyId ? team.data : null;
  return (
    <Card title={copy.app.tabs.team}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold">{text.members}</h3>
        <Button variant="secondary" busy={busy || team === null} onClick={() => void run(reload)}>{text.refresh}</Button>
      </div>
      {snapshot ? (
        <div className="grid gap-3">
          {snapshot.members.length ? snapshot.members.map((member) => (
            <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-4 text-sm">
              <div className="min-w-0"><strong>{member.name || member.email || member.id}</strong>{member.email ? <p className="break-all text-xs text-[var(--color-muted-on-dark)]" dir="ltr">{member.email}</p> : null}</div>
              <div className="flex gap-2"><span>{member.role === "owner" ? copy.app.owner : copy.app.staff}</span><span className="text-[var(--color-muted-on-dark)]">{member.status === "active" ? copy.app.active : text.disabled}</span></div>
            </div>
          )) : <p className="text-sm text-[var(--color-muted-on-dark)]">{copy.app.teamEmpty}</p>}
          <h3 className="mt-3 font-semibold">{text.invitations}</h3>
          {snapshot.invitations.length ? snapshot.invitations.map((invitation) => (
            <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-soft)] p-4 text-sm">
              <div className="min-w-0"><strong>{invitation.name}</strong><p className="break-all text-xs text-[var(--color-muted-on-dark)]" dir="ltr">{invitation.email}</p></div>
              <div className="text-xs text-[var(--color-muted-on-dark)]">{invitation.status === "invited" ? copy.app.invited : text.expired} · {text.expires}: {formatDate(invitation.expiresAt)}</div>
            </div>
          )) : <p className="text-sm text-[var(--color-muted-on-dark)]">{text.emptyInvites}</p>}
        </div>
      ) : team === null ? <p role="status">{copy.loading}</p> : <Notice tone="error">{text.failed}</Notice>}

      <form className="mt-6 grid gap-4 border-t border-[color:var(--color-line)] pt-5 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        setError(null); setInvite(null); setCopied(false);
        void run(async () => {
          try {
            const result = await createStaffInvitation(form);
            if (!result.ok) { setError(text.createFailed); return; }
            setInvite(result.data);
            setForm({ email: "", name: "" });
            await reload();
          } catch { setError(text.createFailed); }
        });
      }}>
        <Field label={copy.app.inviteName} required>{(props) => <input {...props} value={form.name} maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} />}</Field>
        <Field label={copy.app.inviteEmail} required>{(props) => <input {...props} type="email" dir="ltr" value={form.email} maxLength={254} onChange={(event) => setForm({ ...form, email: event.target.value })} />}</Field>
        {error ? <div className="sm:col-span-2"><Notice tone="error">{error}</Notice></div> : null}
        <div className="sm:col-span-2"><Button type="submit" busy={busy} disabled={!form.name.trim() || !form.email.trim()}>{copy.app.invite}</Button></div>
      </form>
      {invite ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-[#38dc89]/30 bg-[#38dc89]/10 p-4">
          <Notice tone="success">{text.saved}</Notice>
          <input aria-label={copy.app.openInvite} dir="ltr" readOnly value={invite.inviteUrl} className="min-h-11 w-full min-w-0 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-3 text-sm" onFocus={(event) => event.target.select()} />
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-[var(--color-muted-on-dark)]">{text.expires}: {formatDate(invite.expiresAt)}</span><Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(invite.inviteUrl).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? text.copied : text.copy}</Button></div>
        </div>
      ) : null}
    </Card>
  );
}
