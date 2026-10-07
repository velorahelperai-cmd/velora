"use client";

import Link from "next/link";
import { useState } from "react";
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
export function AccountPage({ initial }: { initial: AccountProfileView }) {
  const copy = useAppCopy();
  const session = useOptionalAccountSession();
  const [name, setName] = useState(initial.fullName);
  const [profile, setProfile] = useState(initial);
  const [error, setError] = useState<FieldErrorKey>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, run } = useAction();
  const dirty = name.trim() !== profile.fullName.trim();
  useUnsavedWarning(dirty && !busy);
  const nameError = useErrorText(error);

  const membershipLabel =
    profile.role === "owner" ? copy.app.owner
      : profile.role === "staff" ? copy.app.staff
        : copy.account.roleNone;

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
              <dd>{profile.isPlatformAdmin ? copy.account.roleAdmin : copy.account.roleNone}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--color-muted-on-dark)]">{copy.app.roleLabel}</dt>
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

          <form
            className="mt-6 grid max-w-md gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
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
                const result = await updateAccountName(next);
                if (!result.ok) {
                  setFormError(result.message ?? copy.errors.authFailed);
                  return;
                }
                // Trust the write result — do not revert to a stale initial prop.
                setProfile(result.data);
                setName(result.data.fullName);
                setSaved(true);
                session?.setIdentityName(result.data.fullName);
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
              <Button type="submit" busy={busy} busyLabel={copy.saving} disabled={!dirty}>
                {copy.save}
              </Button>
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
