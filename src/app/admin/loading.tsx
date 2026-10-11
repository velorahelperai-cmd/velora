"use client";
import {useDemo} from "@/lib/demo-state";
/** Prefetchable feedback only; authorization remains in the layout and each data read. */
export default function Loading(){
 const {locale}=useDemo();
 return <section aria-busy="true" role="status" aria-live="polite"
  className="rounded-2xl border border-[#D7C1A5] bg-[#FFFBF5] p-6 text-[#6B4932]">
  <p>{locale==="ar"?"\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0633\u062c\u0644\u0627\u062a \u0627\u0644\u0625\u062f\u0627\u0631\u0629\u2026":"Loading admin records…"}</p>
 </section>;
}
