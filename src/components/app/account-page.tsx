"use client";

import Link from "next/link";
import {useDemo} from '@/lib/demo-state';
import { TeamSelfPanel } from "@/components/teams/team-self-panel";
import { useEffect, useRef, useState } from "react";
import {
  AccountMenu,
  AppTopBar,
  accountInitials,
  useOptionalAccountSession,
} from "@/components/app/account-chrome";
import {
  Button, Field, FieldErrorKey, Notice, useAction, useAppCopy, useErrorText, useUnsavedWarning,
} from "@/components/app/ui";
import { updateAccountName, type AccountProfileView } from "@/lib/tenancy/actions";

/** Parent should remount with key={userId} so a user switch resets local draft state. */
export function AccountPage({ initial,masterJourneyEnabled=false }: { initial: AccountProfileView;masterJourneyEnabled?:boolean }) {
  const copy = useAppCopy();
  const ar=useDemo().locale==='ar';
  const session = useOptionalAccountSession();
  const [name, setName] = useState(initial.fullName);
  const [profile, setProfile] = useState(initial);
  const [error, setError] = useState<FieldErrorKey>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [clipboard, setClipboard] = useState<"copied" | "failed" | null>(null);
  const [trackedInitial, setTrackedInitial] = useState(initial);
  const [confirmedName, setConfirmedName] = useState<string | null>(null);
  const generation = useRef(0);
  const clipboardGeneration = useRef(0);
  const mounted = useRef(true);
  const { busy, run } = useAction();
  if (trackedInitial !== initial) {
    setTrackedInitial(initial);
    if (initial.userId !== profile.userId) {
      setProfile(initial);setConfirmedName(null);setName(initial.fullName);
      setError(undefined);setFormError(null);setSaved(false);setClipboard(null);
    } else {
      // Unversioned page reads cannot supersede a confirmed write in this session.
      const nextProfile = confirmedName === null ? initial : { ...initial, fullName: confirmedName };
      setProfile(nextProfile);
      if (name === profile.fullName) setName(nextProfile.fullName);
    }
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current+=1;clipboardGeneration.current+=1;};},[initial.userId]);
  const stillCurrent=()=>mounted.current&&(!session||session.isCurrentUser(initial.userId));
  const controlsReady = !session || (session.status === "ready" && session.identity?.userId === initial.userId);
  async function copyValue(value:string){
    if(!value||!stillCurrent())return;
    const gen=++clipboardGeneration.current;
    setClipboard(null);
    try{await navigator.clipboard.writeText(value);if(gen===clipboardGeneration.current&&stillCurrent())setClipboard("copied");}
    catch{if(gen===clipboardGeneration.current&&stillCurrent())setClipboard("failed");}
  }
  const dirty = name.trim() !== profile.fullName.trim();
  useUnsavedWarning(dirty && !busy);
  const nameError = useErrorText(error);

  const membershipLabel =
    profile.role === "owner" ? copy.app.owner
      : profile.role === "staff" ? copy.app.staff
        : copy.account.roleNone;
  const platform = profile.platformIdentity;
  const platformLabel = !platform || platform.unavailable ? copy.account.platformUnavailable
    : platform.role === "owner" ? copy.account.roleOwner
    : platform.role === "delegated" ? copy.account.roleDelegated : copy.account.platformNone;

  return (
    <main className="app-shell px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-[720px]">
        <AppTopBar />
        <h1 className="mt-8 text-3xl font-bold">{copy.account.title}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted-on-dark)]">{copy.account.body}</p>

        <section className="app-panel mt-6 rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <span
              className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#38dc89]/20 text-xl font-bold text-[var(--color-success-fg)]"
              aria-hidden
            >
              {accountInitials(profile.fullName, profile.email)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{profile.fullName || copy.account.unnamed}</p>
              <p className="truncate text-sm text-[var(--color-muted-soft)]" dir="ltr">{profile.email}</p>
              <p className="mt-1 font-mono text-xs tracking-wide text-[var(--color-success-fg)]" dir="ltr">
                {copy.account.supportCode}: {profile.supportCode || "—"}
              </p>
            </div>
          </div>

          <dl className="mt-5 grid gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-muted-on-dark)]">{copy.account.platformRole}</dt>
              <dd>{platformLabel}{platform?.status==="disabled"?` · ${copy.account.platformDisabled}`:""}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-muted-on-dark)]">{copy.account.companyRole}</dt>
              <dd>{membershipLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-muted-on-dark)]">{copy.account.company}</dt>
              <dd className="min-w-0 break-words text-end">
                {profile.companyName
                  || (profile.needsCompanyContext ? copy.account.pickCompany : copy.account.noCompany)}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={!controlsReady||!profile.supportCode} onClick={()=>void copyValue(profile.supportCode)}>{copy.account.copySupportCode}</Button>
            <Button type="button" variant="secondary" disabled={!controlsReady||!profile.email} onClick={()=>void copyValue(profile.email)}>{copy.account.copyEmail}</Button>
            <Link href="/" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border-soft)] px-4 text-sm">{copy.account.viewWebsite}</Link>
          </div>
          {clipboard?<div className="mt-3"><Notice tone={clipboard==="copied"?"success":"error"}>{clipboard==="copied"?copy.account.copied:copy.account.copyFailed}</Notice></div>:null}

          <form
            className="mt-6 grid max-w-md gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || !controlsReady || !stillCurrent()) return;
              setFormError(null);
              setSaved(false);
              const next = name.trim();
              if (next.length < 2) {
                setError("required");
                return;
              }
              if (next.length > 120) {
                setFormError(copy.account.nameTooLong);
                return;
              }
              setError(undefined);
              void run(async () => {
                const gen=++generation.current;
                try{
                  const result = await updateAccountName(next, initial.userId);
                  if(gen!==generation.current||!stillCurrent()||result.ok&&result.data.userId!==initial.userId)return;
                  if (!result.ok) {setFormError(result.message ?? copy.errors.authFailed);return;}
                  // The confirmed write survives an optional identity refresh failure.
                  setProfile(result.data);setConfirmedName(result.data.fullName);setName(result.data.fullName);setSaved(true);
                  session?.setIdentityName(result.data.fullName,initial.userId);
                  try{await session?.refresh();}catch{/* The name was already confirmed. */}
                }catch{if(gen===generation.current&&stillCurrent())setFormError(copy.errors.authFailed);}
              });
            }}
          >
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            {saved && !dirty ? <Notice tone="success">{copy.account.saved}</Notice> : null}
            <Field label={copy.auth.name} required error={nameError}>
              {(p) => (
                <input
                  {...p}
                  value={name}
                  maxLength={120}
                  autoComplete="name"
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaved(false);
                  }}
                />
              )}
            </Field>
            <Field label={copy.auth.email} hint={copy.account.emailReadOnly}>
              {(p) => (
                <input
                  {...p}
                  dir="ltr"
                  value={profile.email}
                  readOnly
                  className={`${p.className} opacity-70`}
                />
              )}
            </Field>
            <p className="text-xs text-[var(--color-muted-soft)]">{copy.account.supportCodeHint}</p>
            <p className="text-xs text-[var(--color-muted-soft)]">
              {copy.app.noPasswordChange}{" "}
              <Link href="/forgot-password" className="text-[#38dc89] underline">
                {copy.auth.forgotTitle}
              </Link>
            </p>
            <div className="flex flex-wrap gap-2">
              {masterJourneyEnabled&&<Link href="/account/businesses/manage" className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm">{ar?'إدارة أنشطتي وسجلها':'Manage my businesses and history'}</Link>}
              {masterJourneyEnabled&&<Link href="/verify-phone" className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm">{ar?'إدارة الهاتف الشخصي':'Manage personal phone'}</Link>}
              {masterJourneyEnabled&&<Link href="/account/recovery" className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm">{ar?'طلب استرداد الهوية':'Identity recovery request'}</Link>}
              {masterJourneyEnabled&&profile.isPlatformAdmin&&<Link href="/admin/identity-recovery" className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm">{ar?'مراجعة استرداد الهوية':'Review identity recovery'}</Link>}
              {masterJourneyEnabled&&profile.platformIdentity.role==='owner'&&profile.platformIdentity.status==='active'&&<Link href="/admin/ai/cycle-costs" className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm">{ar?'تكلفة الردود حسب العميل والدورة':'Response costs by customer and cycle'}</Link>}
              {masterJourneyEnabled&&((profile.ownedBusinessCount??0)>0||profile.role==='owner'||profile.role===null&&!profile.isPlatformAdmin&&!profile.hasBusinessMemberships)&&<Link href="/account/businesses/new" className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm">{ar?'إنشاء نشاط جديد':'Create a business'}</Link>}
              <Button type="submit" busy={busy} busyLabel={copy.saving} disabled={!controlsReady||!dirty}>
                {copy.save}
              </Button>
              <Button type="button" variant="secondary" disabled={busy||!dirty} onClick={()=>{setName(profile.fullName);setError(undefined);setFormError(null);setSaved(false);}}>{copy.cancel}</Button>
              {profile.adminHref ? (
                <Link
                  href={profile.adminHref}
                  className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border-soft)] px-4 text-sm"
                >
                  {copy.account.menuPlatformAdmin}
                </Link>
              ) : null}
              {profile.workspaceHref ? (
                <Link
                  href={profile.workspaceHref}
                  className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border-soft)] px-4 text-sm"
                >
                  {profile.workspaceHref.startsWith("/setup")
                    ? copy.account.menuSetup
                    : copy.account.menuMyWorkspace}
                </Link>
              ) : null}
            </div>
          </form>
        </section>
        <TeamSelfPanel actorId={initial.userId}/>
      </div>
    </main>
  );
}

/** Compact account entry for settings tab — points at the shared /account experience. */
export function AccountSettingsLinkCard() {
  const copy = useAppCopy();
  return (
    <div className="app-panel rounded-3xl p-5">
      <h2 className="text-lg font-bold">{copy.app.tabs.account}</h2>
      <p className="mt-2 text-sm text-[var(--color-muted-on-dark)]">{copy.account.settingsLinkBody}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href="/account"
          className="inline-flex min-h-11 items-center rounded-full bg-[#38dc89] px-4 text-sm font-medium text-[#072317]"
        >
          {copy.account.openShared}
        </Link>
        <AccountMenu compact />
      </div>
    </div>
  );
}
