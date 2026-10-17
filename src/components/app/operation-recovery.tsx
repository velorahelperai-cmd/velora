"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useDemo } from "@/lib/demo-state";
import { clearCompanyDrafts } from "@/lib/company-draft";
import { reconcileOriginalOperation, type RecoveryReceipt } from "@/lib/auth/operation-recovery";
import { acknowledgeBrokerClientCleanupAction, recoveryReauthForOperationAction, resumeBrokerOperationAction } from "@/lib/auth/broker-actions";
import { ensureBrowserContinuity, clearAuthGestureNonce } from "@/lib/auth/browser-continuity";
import { Button, Field, Notice, PasswordField } from "./ui";

export type { RecoveryReceipt } from "@/lib/auth/operation-recovery";

export function OperationRecovery({ receipt, isCaptured }: { receipt: RecoveryReceipt | null; isCaptured: () => boolean }) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reauth, setReauth] = useState(false);
  const reconcile = async () => {
    if (pending.current || !receipt || !isCaptured()) return;
    pending.current = true; setBusy(true);
    try {
      if (reauth) {
        const continuity = await ensureBrowserContinuity("login");
        if (!continuity.ok || !isCaptured()) return;
        const admitted = await recoveryReauthForOperationAction({ operationKey: receipt.operationKey, email, password, requestNonce: continuity.requestNonce });
        setPassword("");
        if (admitted.code === "AUTH_ERROR") clearAuthGestureNonce(continuity.requestNonce);
        if (!isCaptured() || !admitted.ok) return;
        clearAuthGestureNonce(continuity.requestNonce);
      }
      const result = await reconcileOriginalOperation(receipt.operationKey, isCaptured, {
        cleanup: () => {
          if (!clearCompanyDrafts(receipt.userId)) throw new Error("CLIENT_CLEANUP_UNCONFIRMED");
        },
        resume: resumeBrokerOperationAction,
        acknowledge: acknowledgeBrokerClientCleanupAction,
      });
      if (result === "confirmed") setConfirmed(true);
      else if (result === "pending") setReauth(true);
    } catch {
      // A dropped response remains unresolved. Never repeat the original mutation.
    } finally { pending.current = false; setBusy(false); }
  };
  return <section className="mx-auto grid w-full max-w-md gap-4 text-start" aria-label={ar ? "التحقق من العملية" : "Operation recovery"}>
    <Notice tone={confirmed ? "success" : "error"}>{confirmed
      ? ar ? "تم تأكيد العملية والتنظيف. تبقى الجلسة السابقة مقفلة." : "The operation and cleanup are confirmed. The previous session remains locked."
      : ar ? "لم نتمكن من تأكيد اكتمال العملية. تبقى هذه الجلسة مقفلة؛ لا تعِد العملية الأصلية." : "Completion could not be confirmed. This session remains locked; do not repeat the original operation."}</Notice>
    {receipt && !confirmed ? <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void reconcile(); }}>
      {reauth ? <>
        <Field label={ar ? "البريد الإلكتروني للحساب نفسه" : "Same account email"}>{props => <input {...props} type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />}</Field>
        <PasswordField label={ar ? "كلمة المرور الحالية" : "Current password"} value={password} onChange={setPassword} autoComplete="current-password" />
      </> : null}
      <Button type="submit" busy={busy} disabled={busy} busyLabel={ar ? "جارٍ التحقق" : "Checking"}>{ar ? "التحقق من العملية الأصلية" : "Check original operation"}</Button>
    </form> : null}
    <Link className="underline" href="/login">{ar ? "العودة الآمنة لتسجيل الدخول" : "Return safely to sign in"}</Link>
  </section>;
}
