export const diagnosticOperations = ["auth_continuity", "auth_session_check", "auth_signup", "auth_login", "auth_verification", "auth_verification_resend", "auth_password_update", "company_save", "customer_readiness", "workspace_load", "billing_email", "billing_processing", "instagram_connect", "whatsapp_connect", "unknown"] as const;
export const diagnosticStages = ["input", "session", "provider", "profile", "access", "persistence", "readiness", "workspace", "permissions", "refresh", "completed", "handoff", "claim", "receipt", "delivery", "knowledge", "channel", "billing", "review", "preflight", "code_exchange", "granted_permissions", "long_token_exchange", "profile_read", "profile_identity", "vault", "subscribe", "finalize", "unknown"] as const;
export const diagnosticCodes = ["STARTED", "OK", "INVALID_INPUT", "AUTH_ERROR", "UNAVAILABLE", "UNAUTHENTICATED", "UNVERIFIED", "FORBIDDEN", "CONFLICT", "NO_COMPANY", "DEPENDENCY_FAILED", "REFRESH_FAILED", "UNEXPECTED_FAILURE", "PROVIDER_REJECTED", "OUTCOME_UNKNOWN", "DISABLED"] as const;
export type DiagnosticOperation = typeof diagnosticOperations[number];
export type DiagnosticStage = typeof diagnosticStages[number];
export type DiagnosticCode = typeof diagnosticCodes[number];
export type DiagnosticDetail = { reference: string; operation: DiagnosticOperation; stage: DiagnosticStage; code: DiagnosticCode };
export function validDiagnostic(value: unknown): value is DiagnosticDetail {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if(Object.keys(value).some(key=>!["reference","operation","stage","code"].includes(key)))return false;
  const row = value as DiagnosticDetail;
  return typeof row.reference === "string" && /^VEL-[A-F0-9]{16}$/.test(row.reference)
    && diagnosticOperations.includes(row.operation) && diagnosticStages.includes(row.stage) && diagnosticCodes.includes(row.code);
}
const labels: Record<DiagnosticStage, readonly [string, string]> = {
  input: ["Checking the entered details", "فحص البيانات المدخلة"], session: ["Checking your session", "فحص جلسة الدخول"],
  provider: ["Contacting the service", "الاتصال بالخدمة"], profile: ["Preparing your profile", "تجهيز ملف الحساب"], access: ["Checking access", "فحص صلاحية الوصول"],
  persistence: ["Saving your changes", "حفظ التغييرات"], readiness: ["Checking business readiness", "فحص جاهزية النشاط"], workspace: ["Loading your workspace", "تحميل مساحة العمل"],
  permissions: ["Checking granted permissions", "فحص الأذونات الممنوحة"], refresh: ["Updating the displayed information", "تحديث المعلومات المعروضة"],
  completed: ["Completing the request", "إتمام الطلب"], handoff: ["Opening the next page", "فتح الصفحة التالية"], claim: ["Preparing the request", "تجهيز الطلب"],
  receipt: ["Checking the payment receipt", "فحص إيصال الدفع"], delivery: ["Sending the request", "إرسال الطلب"], knowledge: ["Loading business knowledge", "تحميل معرفة النشاط"],
  channel: ["Checking the connection", "فحص الاتصال"], billing: ["Checking the subscription", "فحص الاشتراك"], review: ["Loading the business review", "تحميل مراجعة النشاط"],
  preflight: ["Checking connection settings", "فحص إعدادات الاتصال"], code_exchange: ["Confirming the connection authorization", "تأكيد تصريح الاتصال"],
  granted_permissions: ["Checking granted permissions", "فحص الأذونات الممنوحة"], long_token_exchange: ["Preparing the authorized connection", "تجهيز الاتصال المصرّح به"],
  profile_read: ["Loading the connected account", "تحميل الحساب المتصل"], profile_identity: ["Checking the connected account", "فحص الحساب المتصل"],
  vault: ["Saving the connection securely", "حفظ الاتصال بأمان"], subscribe: ["Preparing connection updates", "تجهيز تحديثات الاتصال"], finalize: ["Confirming the saved connection", "تأكيد الاتصال المحفوظ"],
  unknown: ["Completing the request", "إتمام الطلب"],
};
/** Runtime validation prevents a transported error or customer payload becoming UI diagnostics. */
export function diagnosticText(value: unknown, locale: "ar" | "en"): string {
  if (!validDiagnostic(value)) return "";
  return locale === "ar" ? `المرحلة: ${labels[value.stage][1]}. مرجع الدعم: ${value.reference}` : `Step: ${labels[value.stage][0]}. Support reference: ${value.reference}`;
}
