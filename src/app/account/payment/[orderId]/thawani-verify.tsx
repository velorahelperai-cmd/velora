"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyThawaniPayment } from "./actions";

export function ThawaniVerify({ orderId }: { orderId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("جارٍ التحقق من الدفع التجريبي…");
  function verify() {
    startTransition(async () => {
      try {
        const result = await verifyThawaniPayment(orderId);
        if (result.ok && result.paid) { router.refresh(); return; }
        setMessage(result.ok ? "لم يكتمل الدفع بعد. يمكنك تحديث حالة نفس الطلب." : "تعذر تأكيد النتيجة الآن. أعد التحقق من نفس الطلب دون دفع جديد.");
      } catch { setMessage("تعذر الاتصال. أعد التحقق من نفس الطلب دون دفع جديد."); }
    });
  }
  useEffect(() => {
    if (!started.current) { started.current = true; verify(); }
    // One server verification per mounted order; further attempts are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  return <div><p role="status">{message}</p><button type="button" disabled={pending} onClick={verify} className="underline">{pending ? "جارٍ التحقق…" : "التحقق من حالة الدفع"}</button></div>;
}
