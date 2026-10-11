"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useDemo } from "@/lib/demo-state";
import {
  cancelStaffInvitation, createStaffInvitation, listCompanyTeam, replaceStaffInvitation,
  type CompanyStaffInvitation, type StaffInvitationMutation,
} from "@/lib/tenancy/staff-invitations";
import { useOptionalAccountSession } from "./account-chrome";
import { Button, Card, Field, Notice, useAppCopy } from "./ui";

type Scope = { companyId: string; accountId: string | null };
type Confirmation = { action: "replace" | "cancel"; invitation: CompanyStaffInvitation; operationId: string; stale: boolean };
type PanelState = {
  scope: Scope; team: Awaited<ReturnType<typeof listCompanyTeam>> | null;
  form: { name: string; email: string }; result: StaffInvitationMutation | null;
  error: string | null; readFailed: boolean; busy: boolean; refreshing: boolean;
  copied: boolean; copyBusy: boolean; confirmation: Confirmation | null; authorityDenied: boolean; authorityGeneration: number;
};
type Request = { scope: Scope; active: boolean; authorityDenied: boolean; authorityGeneration: number; pending: boolean; readPending: boolean; readGeneration: number; copyPending: boolean; copyGeneration: number; createAttempt: { key: string; id: string } | null; link: { url: string; invitation: CompanyStaffInvitation } | null };
const emptyState = (scope: Scope): PanelState => ({ scope, team: null, form: { name: "", email: "" }, result: null, error: null, readFailed: false, busy: false, refreshing: false, copied: false, copyBusy: false, confirmation: null, authorityDenied: false, authorityGeneration: 0 });

export function CompanyTeamPanel({ companyId, accountId = null }: { companyId: string; accountId?: string | null }) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const ar = locale === "ar";
  const session = useOptionalAccountSession();
  const scope = useMemo(() => ({ companyId, accountId }), [companyId, accountId]);
  const [stored, setStored] = useState<PanelState>(() => emptyState(scope));
  const state = stored.scope === scope ? stored : emptyState(scope);
  const requestRef = useRef<Request | null>(null);
  const authorityGeneration = state.authorityGeneration;
  const text = ar ? {
    members: "عضويات النشاط", invitations: "الدعوات المحفوظة", empty: "لا توجد دعوات محفوظة.",
    failed: "تعذّر تحديث الفريق. آخر بيانات مؤكدة ظاهرة إن توفرت. استخدم تحديث الفريق للتحقق؛ لا يلزم إعادة إجراء تم حفظه.",
    unknown: "تعذّر تأكيد نتيجة الطلب. أعد محاولة نفس الطلب دون تغيير، أو حدّث الفريق للتحقق مما تم حفظه.",
    invalid: "تحقق من الاسم والبريد والصلاحيات ثم أعد المحاولة.", changed: "تغيّرت الدعوة أو العضوية. حدّث الفريق وراجع الحالة قبل المحاولة مجدداً.",
    conflict: "توجد دعوات معلّقة متعارضة. حدّث الفريق ثم اختر صراحة استبدالها أو إلغاءها.", denied: "الصلاحيات أو الحساب تغيّرا. أعد التحقق من حسابك قبل إدارة الدعوات.",
    saved: "تم حفظ الدعوة. انسخ الرابط وشاركه مع الموظف المقصود.", cancelled: "تم إلغاء الدعوة. العضويات المقبولة والسجل محفوظان.",
    missing: "الدعوة محفوظة، لكن رابطها الأصلي غير متاح ولا يمكن استعادته. استخدم استبدال الدعوة لإصدار رابط جديد وإبطال الروابط السابقة.",
    expires: "تنتهي الدعوة", copy: "نسخ الرابط", copied: "تم النسخ", disabled: "معطّل", refresh: "تحديث الفريق", refreshing: "جارٍ تحديث الفريق…",
    replace: "استبدال الدعوة", cancel: "إلغاء الدعوة", confirmReplace: "تأكيد الاستبدال", confirmCancel: "تأكيد الإلغاء", dismiss: "رجوع",
    replaceWarning: "سيصدر رابط جديد لهذا البريد وتُبطل جميع روابطه المعلّقة في هذا النشاط. العضويات المقبولة والسجل محفوظان.",
    cancelWarning: "ستُبطل جميع روابط هذا البريد المعلّقة في هذا النشاط. العضويات المقبولة والسجل محفوظان.",
    statuses: { invited: copy.app.invited, expired: "منتهية", accepted: "مقبولة", cancelled: "ملغاة", conflicted: "دعوات معلّقة متعارضة" },
  } : {
    members: "Company memberships", invitations: "Saved invitations", empty: "No saved invitations.",
    failed: "Could not refresh the team. Last confirmed data is shown when available. Refresh team to check; a saved change does not need to be repeated.",
    unknown: "Could not confirm the result. Retry the unchanged request, or refresh team to check what was saved.",
    invalid: "Check the name, email and permissions, then try again.", changed: "The invitation or membership changed. Refresh team and review its state before trying again.",
    conflict: "There are conflicting pending invitations. Refresh team, then explicitly replace or cancel them.", denied: "Your account or permissions changed. Check your account before managing invitations.",
    saved: "Invitation saved. Copy the link and share it with the intended staff member.", cancelled: "Invitation cancelled. Accepted memberships and history are preserved.",
    missing: "The invitation is saved, but its original link is unavailable and cannot be recovered. Replace the invitation to issue a new link and invalidate earlier links.",
    expires: "Expires", copy: "Copy link", copied: "Copied", disabled: "Disabled", refresh: "Refresh team", refreshing: "Refreshing team…",
    replace: "Replace invitation", cancel: "Cancel invitation", confirmReplace: "Confirm replacement", confirmCancel: "Confirm cancellation", dismiss: "Back",
    replaceWarning: "This issues a new link for this email and invalidates all pending links for it in this company. Accepted memberships and history are preserved.",
    cancelWarning: "This invalidates all pending links for this email in this company. Accepted memberships and history are preserved.",
    statuses: { invited: copy.app.invited, expired: "Expired", accepted: "Accepted", cancelled: "Cancelled", conflicted: "Multiple conflicting pending invitations" },
  };

  function current(request: Request | null): request is Request {
    return !!request && request.active && request.scope === scope && requestRef.current === request
      && (!session || (!!accountId && session.isCurrentUser(accountId)));
  }
  function update(request: Request, patch: Partial<PanelState>) {
    if (current(request)) setStored(previous => ({ ...(previous.scope === scope ? previous : emptyState(scope)), ...patch }));
  }
  function failure(code: string) {
    if (["STALE_REVISION", "INVITE_NOT_PENDING", "MEMBER_EXISTS", "OPERATION_CONFLICT"].includes(code)) return text.changed;
    if (code === "LEGACY_CONFLICT") return text.conflict;
    if (["UNAUTHENTICATED", "UNVERIFIED", "FORBIDDEN"].includes(code)) return text.denied;
    return code === "INVALID_INPUT" ? text.invalid : text.unknown;
  }
  function denyAuthority(request: Request) {
    request.authorityDenied = true; request.authorityGeneration++;
    request.link = null; request.createAttempt = null;
    request.readGeneration++; request.copyGeneration++;
    request.pending = false; request.readPending = false; request.copyPending = false;
    update(request, { team: null, result: null, confirmation: null, copied: false, copyBusy: false,
      busy: false, refreshing: false, readFailed: true, authorityDenied: true, authorityGeneration: request.authorityGeneration, error: text.denied });
  }
  async function reload(request: Request, closeConfirmation = true) {
    if (!current(request) || request.readPending) return;
    if (!accountId) { denyAuthority(request); return; }
    request.readPending = true;
    const generation = ++request.readGeneration;
    update(request, { refreshing: true });
    try {
      const team = await listCompanyTeam(accountId);
      if (!current(request) || generation !== request.readGeneration) return;
      if (!team.ok || team.data.companyId !== companyId) {
        const denied = !team.ok && ["FORBIDDEN", "UNAUTHENTICATED", "UNVERIFIED"].includes(team.code);
        if (denied) denyAuthority(request);
        else update(request, { readFailed: true });
        return;
      }
      request.authorityDenied = false;
      if (request.link) {
        const row = team.data.invitations.find(item => item.id === request.link!.invitation.id);
        if (!row || row.status !== "invited" || row.revision !== request.link.invitation.revision) {
          request.link = null; request.copyGeneration++; request.copyPending = false;
        }
      }
      setStored(previous => {
        const next = previous.scope === scope ? previous : emptyState(scope);
        const saved = next.result;
        const row = saved && team.data.invitations.find(item => item.id === saved.invitation.id);
        // Confirmed acceptance, cancellation or replacement invalidates a displayed link.
        const result = saved?.inviteUrl && (!row || row.status !== "invited" || row.revision !== saved.invitation.revision)
          ? (row ? { ...saved, invitation: row, inviteUrl: null } : null) : saved;
        return { ...next, team, result, readFailed: false, authorityDenied: false, copyBusy: request.copyPending, ...(closeConfirmation ? { confirmation: null, error: null } : {}) };
      });
    } catch { update(request, { readFailed: true }); }
    finally {
      if (current(request) && generation === request.readGeneration) { request.readPending = false; update(request, { refreshing: false }); }
    }
  }

  useEffect(() => {
    const request: Request = { scope, active: true, authorityDenied: false, authorityGeneration: 0, pending: false, readPending: false, readGeneration: 0, copyPending: false, copyGeneration: 0, createAttempt: null, link: null };
    requestRef.current = request;
    startTransition(() => { void reload(request); });
    return () => { request.active = false; request.readGeneration++; request.copyGeneration++; };
    // Account/company identity defines the lifetime of drafts, operation IDs and links.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function mutate(confirmation: Confirmation | null) {
    const request = requestRef.current;
    if (!current(request) || request.authorityDenied || authorityGeneration !== request.authorityGeneration || request.pending || request.readPending || confirmation?.stale) return;
    if (!accountId) { denyAuthority(request); return; }
    const name = state.form.name.trim(), email = state.form.email.trim().toLowerCase();
    if (!confirmation && (!name || !email)) return;
    // Latch synchronously: two events in one render send only one operation.
    request.pending = true;
    request.copyGeneration++; request.copyPending = false;
    const changingSavedRecipient = !!confirmation && state.result?.invitation.email === confirmation.invitation.email;
    // An explicit change may commit even when its response is lost. Stop offering every
    // known old link for that recipient until replay or refresh confirms the outcome.
    if (confirmation && request.link?.invitation.email === confirmation.invitation.email) request.link = null;
    update(request, { busy: true, error: null, copied: false, copyBusy: false, ...(changingSavedRecipient && state.result ? { result: { ...state.result, inviteUrl: null } } : {}) });
    try {
      let response: Awaited<ReturnType<typeof createStaffInvitation>>;
      if (confirmation) {
        const input = { expectedUserId: accountId, companyId, invitationId: confirmation.invitation.id, expectedRevision: confirmation.invitation.revision, operationId: confirmation.operationId };
        response = await (confirmation.action === "replace" ? replaceStaffInvitation(input) : cancelStaffInvitation(input));
      } else {
        const key = JSON.stringify([name, email]);
        if (request.createAttempt?.key !== key) request.createAttempt = { key, id: crypto.randomUUID() };
        response = await createStaffInvitation({ expectedUserId: accountId, companyId, name, email, operationId: request.createAttempt.id });
      }
      if (!current(request) || authorityGeneration !== request.authorityGeneration) return;
      if (!response.ok) {
        if (["FORBIDDEN", "UNAUTHENTICATED", "UNVERIFIED"].includes(response.code)) { denyAuthority(request); return; }
        const stale = ["STALE_REVISION", "INVITE_NOT_PENDING", "MEMBER_EXISTS", "OPERATION_CONFLICT"].includes(response.code);
        update(request, { error: failure(response.code), ...(confirmation && stale ? { confirmation: { ...confirmation, stale: true } } : {}) });
        return;
      }
      const result = response.data;
      // A confirmed response ends this create intent. A later identical draft is a
      // new intent (for example after cancellation), while uncertain retries keep it.
      if (!confirmation) request.createAttempt = null;
      // Retain a known link on replay only for the same still-pending invitation.
      const inviteUrl = result.inviteUrl ?? (result.invitation.status === "invited" && request.link?.invitation.id === result.invitation.id && request.link.invitation.revision === result.invitation.revision ? request.link.url : null);
      request.link = inviteUrl ? { url: inviteUrl, invitation: result.invitation } : null;
      setStored(previous => {
        const next = previous.scope === scope ? previous : emptyState(scope);
        let team = next.team;
        if (team?.ok && team.data.companyId === companyId) {
          // The mutation projection is authoritative even if its following read fails.
          // Reconcile only pending rows for this recipient; accepted history survives.
          const invitations = team.data.invitations.map(row => {
            if (row.id === result.invitation.id) return result.invitation;
            // A replay describes a historical operation, so it does not prove that
            // other current pending invitations were superseded by this response.
            if (!result.replayed && ["replaced", "cancelled"].includes(result.outcome) && row.email === result.invitation.email && ["invited", "expired", "conflicted"].includes(row.status)) {
              return { ...row, status: "cancelled" as const, revision: result.invitation.revision };
            }
            return row;
          });
          if (!invitations.some(row => row.id === result.invitation.id)) invitations.push(result.invitation);
          team = { ok: true, data: { ...team.data, invitations } };
        }
        return { ...next, team, result: { ...result, inviteUrl }, confirmation: null, ...(!confirmation ? { form: { name: "", email: "" } } : {}) };
      });
      await reload(request);
    } catch { if (current(request) && authorityGeneration === request.authorityGeneration) update(request, { error: text.unknown }); }
    finally { if (current(request) && authorityGeneration === request.authorityGeneration) { request.pending = false; update(request, { busy: false }); } }
  }
  function confirm(action: Confirmation["action"], invitation: CompanyStaffInvitation) {
    const request = requestRef.current;
    if (!current(request) || request.authorityDenied || authorityGeneration !== request.authorityGeneration || request.pending || request.readPending) return;
    update(request, { confirmation: { action, invitation, operationId: crypto.randomUUID(), stale: false }, error: null });
  }
  async function copyLink() {
    const request = requestRef.current, inviteUrl = state.result?.inviteUrl;
    if (!current(request) || request.authorityDenied || authorityGeneration !== request.authorityGeneration || !inviteUrl || request.link?.url !== inviteUrl || request.pending || request.readPending || request.copyPending) return;
    request.copyPending = true;
    const generation = ++request.copyGeneration;
    update(request, { copyBusy: true, copied: false });
    try { await navigator.clipboard.writeText(inviteUrl); if (current(request) && generation === request.copyGeneration) update(request, { copied: true }); }
    catch { if (current(request) && generation === request.copyGeneration) update(request, { copied: false }); }
    finally { if (current(request) && generation === request.copyGeneration) { request.copyPending = false; update(request, { copyBusy: false }); } }
  }

  const snapshot = state.team?.ok && state.team.data.companyId === companyId ? state.team.data : null;
  const locked = state.busy || state.refreshing || state.authorityDenied;
  const result = state.result;
  const confirmation = state.confirmation;
  const formatDate = (date: string) => new Intl.DateTimeFormat(ar ? "ar-OM" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
  return <Card title={copy.app.tabs.team}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="font-semibold">{text.members}</h3>
      <Button variant="secondary" busy={state.refreshing} disabled={state.busy || state.refreshing} onClick={() => { const request = requestRef.current; if (current(request) && !request.pending) startTransition(() => { void reload(request); }); }}>{text.refresh}</Button>
    </div>
    {state.refreshing ? <p role="status">{text.refreshing}</p> : null}
    {state.readFailed ? <div role="alert"><Notice tone="error">{text.failed}</Notice></div> : null}
    {snapshot ? <div className="grid gap-3">
      {snapshot.members.length ? snapshot.members.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-soft)] p-4 text-sm">
        <div className="min-w-0"><strong>{member.name || member.email || member.id}</strong>{member.email ? <p className="break-all text-xs" dir="ltr">{member.email}</p> : null}</div>
        <div className="flex gap-2"><span>{member.role === "owner" ? copy.app.owner : copy.app.staff}</span><span>{member.status === "active" ? copy.app.active : text.disabled}</span></div>
      </div>) : <p className="text-sm">{copy.app.teamEmpty}</p>}
      <h3 className="mt-3 font-semibold">{text.invitations}</h3>
      {snapshot.invitations.length ? snapshot.invitations.map(invitation => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--color-border-soft)] p-4 text-sm">
        <div className="min-w-0"><strong>{invitation.name}</strong><p className="break-all text-xs" dir="ltr">{invitation.email}</p></div>
        <div className="text-xs">{text.statuses[invitation.status]} · {text.expires}: {formatDate(invitation.expiresAt)}</div>
        {["invited", "expired", "conflicted"].includes(invitation.status) && !(state.result?.inviteUrl && state.result.invitation.id === invitation.id && state.result.invitation.revision === invitation.revision) ? <p className="w-full text-xs">{text.missing}</p> : null}
        {["invited", "expired", "conflicted"].includes(invitation.status) ? <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={locked || !!confirmation} onClick={() => confirm("replace", invitation)}>{text.replace}</Button><Button variant="danger" disabled={locked || !!confirmation} onClick={() => confirm("cancel", invitation)}>{text.cancel}</Button></div> : null}
      </div>) : <p className="text-sm">{text.empty}</p>}
    </div> : !state.readFailed ? <p role="status">{copy.loading}</p> : null}

    {confirmation ? <div className="mt-5 grid gap-3 rounded-xl border border-[color:var(--color-border-soft)] p-4" role="group" aria-label={confirmation.action === "replace" ? text.replace : text.cancel}>
      <strong dir="ltr" className="break-all">{confirmation.invitation.email}</strong>
      <Notice tone="warn">{confirmation.action === "replace" ? text.replaceWarning : text.cancelWarning}</Notice>
      <div className="flex flex-wrap gap-2"><Button variant={confirmation.action === "replace" ? "primary" : "danger"} busy={state.busy} disabled={locked || confirmation.stale} onClick={() => startTransition(() => { void mutate(confirmation); })}>{confirmation.action === "replace" ? text.confirmReplace : text.confirmCancel}</Button><Button variant="ghost" disabled={locked} onClick={() => { const request = requestRef.current; if (current(request)) update(request, { confirmation: null, error: null }); }}>{text.dismiss}</Button></div>
    </div> : null}
    <form className="mt-6 grid gap-4 border-t border-[color:var(--color-line)] pt-5 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); if (!confirmation) startTransition(() => { void mutate(null); }); }}>
      <Field label={copy.app.inviteName} required>{props => <input {...props} value={state.form.name} maxLength={120} disabled={locked || !!confirmation} onChange={event => { const request = requestRef.current; if (current(request)) update(request, { form: { ...state.form, name: event.target.value } }); }} />}</Field>
      <Field label={copy.app.inviteEmail} required>{props => <input {...props} type="email" dir="ltr" value={state.form.email} maxLength={254} disabled={locked || !!confirmation} onChange={event => { const request = requestRef.current; if (current(request)) update(request, { form: { ...state.form, email: event.target.value } }); }} />}</Field>
      <div className="sm:col-span-2"><Button type="submit" busy={state.busy && !confirmation} disabled={locked || !!confirmation || state.form.name.trim().length < 2 || !state.form.email.trim()}>{copy.app.invite}</Button></div>
    </form>
    {state.error ? <div role="alert" className="mt-3"><Notice tone="error">{state.error}</Notice></div> : null}
    {result ? <div role="status" className="mt-4 grid gap-3 rounded-xl border border-[#38dc89]/30 bg-[#38dc89]/10 p-4">
      <Notice tone={result.inviteUrl || result.outcome === "cancelled" ? "success" : "info"}>{result.outcome === "cancelled" ? text.cancelled : result.inviteUrl ? text.saved : ["accepted", "cancelled"].includes(result.invitation.status) ? text.statuses[result.invitation.status] : text.missing}</Notice>
      <span dir="ltr" className="break-all text-sm">{result.invitation.email}</span>
      {result.inviteUrl ? <><input aria-label={copy.app.openInvite} dir="ltr" readOnly value={result.inviteUrl} className="min-h-11 w-full min-w-0 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-3 text-sm" onFocus={event => event.target.select()} /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs">{text.expires}: {formatDate(result.invitation.expiresAt)}</span><Button variant="secondary" busy={state.copyBusy} disabled={locked || state.copyBusy} onClick={() => { void copyLink(); }}>{state.copied ? text.copied : text.copy}</Button></div></> : null}
      {!result.inviteUrl && ["invited", "expired", "conflicted"].includes(result.invitation.status) && !confirmation && !snapshot?.invitations.some(item => item.id === result.invitation.id) ? <Button variant="secondary" disabled={locked} onClick={() => confirm("replace", result.invitation)}>{text.replace}</Button> : null}
    </div> : null}
  </Card>;
}
