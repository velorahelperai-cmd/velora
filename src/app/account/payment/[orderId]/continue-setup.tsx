"use client";
import { useEffect, useRef, useState } from "react";
import { finishTestCheckout } from "./actions";

export function ContinueSetup({ orderId }: { orderId: string }) {
  const started = useRef(false);
  const [retry, setRetry] = useState(false);
  async function finish() {
    setRetry(false);
    try {
      const result = await finishTestCheckout(orderId);
      if (result.ok) { window.location.assign(result.next); return; }
    } catch { /* Same order remains recoverable; never start another payment. */ }
    setRetry(true);
  }
  useEffect(() => {
    if (!started.current) { started.current = true; void finish(); }
    // One attempt per mounted order; retries are explicit and keep the order ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  return retry ? <div><p>تم تأكيد الدفع. تجهيز النشاط لم يتأكد بعد؛ أعد المحاولة لنفس الطلب دون دفع جديد.</p><button type="button" onClick={() => void finish()} className="underline">متابعة تجهيز النشاط</button></div> : <p role="status">جارٍ حفظ نشاطك والانتقال إلى التجهيز حسب الباقة…</p>;
}
