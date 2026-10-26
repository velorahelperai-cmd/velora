"use client";
import Link from "next/link";
import { useDemo } from "@/lib/demo-state";

export default function NotFound() {
  const {locale}=useDemo(); const ar=locale==="ar";
  return <main className="app-shell grid min-h-svh place-content-center gap-5 p-6 text-center" dir={ar?"rtl":"ltr"}>
    <p>404</p><h1 className="text-2xl font-bold">{ar?"الصفحة غير موجودة":"Page not found"}</h1>
    <p>{ar?"قد يكون الرابط غير صحيح أو تم نقل الصفحة.":"The link may be incorrect or the page may have moved."}</p>
    <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--service-accent)] px-5 text-white" href="/">{ar?"العودة للرئيسية":"Back to home"}</Link>
  </main>;
}
