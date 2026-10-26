import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "@/lib/auth/session-guard";
import { es02Uuid } from "@/lib/billing/es02/contracts";
import { parseAccountOrderRow } from "@/lib/billing/es02/account-order";
import { Card, Notice } from "@/components/app/ui";
import { AccessGate } from "@/components/app/access-gate";
import { ContinueSetup } from "./continue-setup";
import { ThawaniVerify } from "./thawani-verify";

export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!es02Uuid(orderId)) return <AccessGate code="FORBIDDEN" />;
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const accountId = data?.claims?.sub;
  if (error || !es02Uuid(accountId)) redirect(`/login?next=${encodeURIComponent(`/account/payment/${orderId}`)}`);
  const session = await checkAppSession(client);
  if (!session.ok) return <AccessGate code="SESSION_EXPIRED" />;
  const thawani = process.env.BILLING_ES02_THAWANI_TEST_ENABLED === "true";
  const provider = "ثواني";
  const result = await client.rpc("es02_read_thawani_test_payment" as never, { p_expected_account_id: accountId, p_order_id: orderId } as never);
  const row = result.data as { ok?: boolean; data?: { order?: unknown; state?: string; paidAt?: string } } | null;
  const order = parseAccountOrderRow(row?.data?.order, accountId);
  if (result.error || row?.ok !== true || !order || order.orderId !== orderId) return <AccessGate code="UNAVAILABLE" />;
  const paid = row.data?.state === "paid" && !!row.data.paidAt;
  const persona = { level_1: "نورا", level_2: "لينا", level_3: "دانا" }[order.offer.persona];
  return <main dir="rtl" className="mx-auto max-w-2xl space-y-4 px-4 py-10">
    <Card title={paid ? "تم تأكيد الدفع التجريبي" : "التحقق من نتيجة الدفع"}>
      <Notice>{paid ? `استلمنا تأكيد ${provider} وحُفظت نتيجة الدفع التجريبي. لم يتم تحصيل أموال حقيقية.` : `لم يتأكد اكتمال الدفع لدى ${provider} بعد. لا تبدأ طلب دفع جديد؛ حدّث حالة هذا الطلب.`}</Notice>
      {!paid && thawani ? <ThawaniVerify key={orderId} orderId={orderId} /> : null}
      {paid ? <ContinueSetup key={orderId} orderId={orderId} /> : null}
      <dl className="my-6 grid grid-cols-2 gap-3">
        <dt>مرجع الطلب</dt><dd dir="ltr">{order.specialReference}</dd>
        <dt>المساعد والباقة</dt><dd>{persona} · {order.offer.package === "premium" ? "المميزة" : "القياسية"}</dd>
        <dt>المدة</dt><dd>{order.offer.term === "yearly" ? "سنوية" : "شهرية"}</dd>
        <dt>المبلغ</dt><dd>{(order.offer.amountBaisa / 1000).toFixed(3)} ر.ع</dd>
      </dl>
      <a href={`/account/payment/${orderId}`} className="underline">تحديث حالة الطلب</a>
      <Link href="/account" className="ms-6 underline">حسابي</Link>
    </Card>
  </main>;
}
