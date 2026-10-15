"use client";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDemo } from "@/lib/demo-state";
import { getPersonalPhoneStatus, sendPersonalPhoneCode, verifyPersonalPhoneCode } from "@/lib/tenancy/personal-phone-actions";
import { normalizePersonalPhone, type PersonalPhoneCode, type PersonalPhoneResult, type PersonalPhoneStatus } from "@/lib/tenancy/personal-phone";
import { resolvePostAuthPath } from "@/lib/tenancy/actions";
import { AuthShell } from "./auth-pages";
import { useOptionalAccountSession } from "./account-chrome";
import { Button, Field, LinkButton, Notice } from "./ui";
import {PersonalPhoneChangePanel} from "./personal-phone-change-panel";

const errors: Record<PersonalPhoneCode, [string, string]> = {
  UNAUTHENTICATED: ["Sign in again to continue safely.", "سجّل الدخول مجددًا للمتابعة بأمان."],
  EMAIL_REQUIRED: ["Confirm your email before verifying your personal phone.", "أكّد بريدك الإلكتروني قبل توثيق هاتفك الشخصي."],
  UNCONFIGURED: ["SMS verification is not available yet. Your progress is saved; return when it is enabled.", "توثيق الهاتف عبر SMS غير متاح بعد. تقدّمك محفوظ؛ عُد عند تفعيل الخدمة."],
  INVALID_INPUT: ["Enter an international phone number beginning with + and a six-digit code when requested.", "أدخل رقم هاتف دوليًا يبدأ بـ + ورمزًا من ستة أرقام عند طلبه."],
  PHONE_IN_USE: ["This phone is linked to an existing account. Recover the original account to continue.", "هذا الرقم مرتبط بحساب قائم. استعد الحساب الأصلي للمتابعة."],
  REVIEW_REQUIRED: ["Changing a verified personal phone requires a secure review. Keep using your current account.", "تغيير الهاتف الشخصي الموثق يحتاج مراجعة آمنة. استمر باستخدام حسابك الحالي."],
  COOLDOWN: ["Wait at least one minute before requesting another code.", "انتظر دقيقة على الأقل قبل طلب رمز آخر."],
  RATE_LIMITED: ["The verification request limit has been reached. Try again later.", "وصلت إلى الحد الأمني لطلبات التوثيق. حاول لاحقًا."],
  EXPIRED: ["This verification request expired. Request a new code.", "انتهت صلاحية طلب التوثيق. اطلب رمزًا جديدًا."],
  BUSY: ["A verification request is still being processed. Check your saved status before retrying.", "لا يزال طلب التوثيق قيد المعالجة. تحقّق من الحالة المحفوظة قبل المحاولة مجددًا."],
  ATTEMPTS_EXHAUSTED: ["The code attempt limit has been reached. Request a new code when allowed.", "وصلت إلى الحد الأمني لمحاولات الرمز. اطلب رمزًا جديدًا عند السماح بذلك."],
  CODE_INVALID: ["The code was not confirmed. Check the SMS code and try again.", "لم يُؤكّد الرمز. تحقّق من رمز SMS ثم حاول مجددًا."],
  VERIFICATION_INCOMPLETE: ["Phone verification has not been confirmed. Check your saved status before retrying.", "لم يُؤكّد توثيق الهاتف. تحقّق من الحالة المحفوظة قبل إعادة المحاولة."],
  UNAVAILABLE: ["The result could not be confirmed. Check your saved status; do not repeat a send immediately.", "تعذّر تأكيد النتيجة. تحقّق من الحالة المحفوظة ولا تكرّر الإرسال مباشرةً."],
};

export function PersonalPhonePage({ initialResult, next }: { initialResult: PersonalPhoneResult<PersonalPhoneStatus>; next?: string }) {
  const { locale } = useDemo(), ar = locale === "ar", router = useRouter();
  const session = useOptionalAccountSession(), sessionRef = useRef(session); useLayoutEffect(() => { sessionRef.current = session; }, [session]);
  const [result, setResult] = useState(initialResult), [phone, setPhone] = useState(""), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<PersonalPhoneCode | null>(null);
  const busyRef = useRef(false), request = useRef<{ phone: string; key: string } | null>(null);
  const userId = initialResult.ok ? initialResult.data.userId : null;
  const active = Boolean(userId && (!session || session.status === "ready" && session.identity?.userId === userId));
  const status = result.ok && result.data.userId === userId ? result.data : null;
  const t = (en: string, arabic: string) => ar ? arabic : en;
  async function perform(operation: () => Promise<void>) {
    if (!active || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { await operation(); } catch { if (stillCurrent()) setError("UNAVAILABLE"); }
    finally { busyRef.current = false; if (stillCurrent()) setBusy(false); }
  }
  function stillCurrent() { const current = sessionRef.current; return Boolean(userId && (!current || current.status === "ready" && current.identity?.userId === userId)); }
  async function readStatus() {
    if (!userId) return;
    const receipt = await getPersonalPhoneStatus(userId);
    if (!stillCurrent()) return;
    if (receipt.ok) setResult(receipt); else setError(receipt.code);
  }
  function send(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePersonalPhone(phone);
    if (!normalized || !userId) { setError("INVALID_INPUT"); return; }
    if (!request.current || request.current.phone !== normalized) request.current = { phone: normalized, key: crypto.randomUUID() };
    const input = { expectedUserId: userId, phone: normalized, requestKey: request.current.key };
    void perform(async () => {
      const receipt = await sendPersonalPhoneCode(input);
      if (!stillCurrent()) return;
      if (!receipt.ok) setError(receipt.code);
      else { request.current = null; setCode(""); }
      await readStatus();
    });
  }
  function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!userId || !status?.intent) return;
    const input = { expectedUserId: userId, intentId: status.intent.id, code };
    setCode("");
    void perform(async () => {
      const receipt = await verifyPersonalPhoneCode(input);
      if (!stillCurrent()) return;
      if (!receipt.ok) setError(receipt.code);
      await readStatus();
    });
  }
  function continueSetup() {
    void perform(async () => {
      const destination = await resolvePostAuthPath(next);
      if (!stillCurrent()) return;
      if (!destination.ok) { setError("UNAVAILABLE"); return; }
      router.replace(destination.data.next); router.refresh();
    });
  }
  const disabled = busy || !active || status?.configuration !== "CONFIGURED" || !status?.emailVerified;
  const canVerify = status?.intent?.state === "sent" || status?.intent?.state === "verifying";
  return <AuthShell title={t("Verify your personal phone", "وثّق هاتفك الشخصي")}
    body={t("Confirm a phone you control before creating your first business. This is separate from your business contact and WhatsApp number.", "وثّق هاتفًا شخصيًا تملكه قبل إنشاء نشاطك الأول. هذا الرقم مستقل عن رقم التواصل التجاري ورقم واتساب.")}
    footer={<Link href="/account" className="text-[var(--color-action-on-dark)]">{t("Back to account", "العودة إلى الحساب")}</Link>}>
    <div className="grid gap-5" dir={ar ? "rtl" : "ltr"}>
      {!initialResult.ok ? <Notice tone="error">{errors[initialResult.code][ar ? 1 : 0]}{initialResult.code === "EMAIL_REQUIRED" ? <p><LinkButton href="/verify-email">{t("Confirm email", "تأكيد البريد")}</LinkButton></p> : null}</Notice>
        : !active ? <Notice>{t("Waiting for your current account. Refresh this page if you changed accounts.", "جارٍ التحقق من حسابك الحالي. حدّث الصفحة إذا بدّلت الحساب.")}</Notice>
          : status?.phoneVerified ? <>
            <Notice tone="success">{t("Your personal phone is verified", "هاتفك الشخصي موثق")} <b dir="ltr">{status.phoneMasked}</b></Notice>
            <Button busy={busy} onClick={continueSetup}>{t("Continue", "متابعة")}</Button>
            <PersonalPhoneChangePanel userId={status.userId} onCompleted={()=>void perform(readStatus)}/>
          </> : <>
            {!status?.emailVerified ? <Notice tone="warn"><p>{errors.EMAIL_REQUIRED[ar ? 1 : 0]}</p><LinkButton href="/verify-email">{t("Confirm email", "تأكيد البريد")}</LinkButton></Notice> : null}
            {status?.configuration === "UNCONFIGURED" ? <Notice tone="warn">{errors.UNCONFIGURED[ar ? 1 : 0]}</Notice> : null}
            <form className="grid gap-4" onSubmit={send}>
              <Field required label={t("Personal phone", "الهاتف الشخصي")} hint={t("Include your country code, for example +968…", "أضف مفتاح الدولة، مثل ‎+968…")}>
                {props => <input {...props} dir="ltr" type="tel" autoComplete="tel" inputMode="tel" maxLength={40} value={phone} onChange={e => { setPhone(e.target.value); request.current = null; }} disabled={disabled} required />}
              </Field>
              <Button type="submit" busy={busy} disabled={disabled}>{t(status?.intent ? "Send a new SMS code" : "Send SMS code", status?.intent ? "إرسال رمز SMS جديد" : "إرسال رمز SMS")}</Button>
            </form>
            {canVerify ? <form className="grid gap-4" onSubmit={verifyCode}>
              <p className="text-sm">{t("SMS code requested for", "طُلب رمز SMS للرقم")} <b dir="ltr">{status?.intent?.phoneMasked}</b></p>
              <Field required label={t("Six-digit SMS code", "رمز SMS من ستة أرقام")}>
                {props => <input {...props} dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ""))} disabled={disabled} required />}
              </Field>
              <Button type="submit" busy={busy} disabled={disabled || code.length !== 6}>{t("Verify personal phone", "توثيق الهاتف الشخصي")}</Button>
            </form> : null}
            {status?.intent?.state === "reserved" || status?.intent?.state === "failed" ? <Notice>{t("The last send has no confirmed result. Check the saved status or deliberately request a new code when allowed.", "لم تُؤكّد نتيجة الإرسال الأخير. تحقّق من الحالة المحفوظة أو اطلب رمزًا جديدًا عند السماح بذلك.")}</Notice> : null}
          </>}
      {active && error ? <div role="alert"><Notice tone="error">{errors[error][ar ? 1 : 0]}{error === "PHONE_IN_USE" ? <p><Link href="/forgot-password" className="text-[var(--color-action-on-dark)]">{t("Recover original account", "استعادة الحساب الأصلي")}</Link></p> : null}</Notice></div> : null}
      {active ? <Button variant="secondary" busy={busy} onClick={() => { request.current = null; void perform(readStatus); }}>{t("Check saved status", "التحقق من الحالة المحفوظة")}</Button> : <LinkButton href="/login">{t("Sign in", "تسجيل الدخول")}</LinkButton>}
    </div>
  </AuthShell>;
}
