"use client";
import { useDemo } from "@/lib/demo-state";
import { SetupLoadingView } from "./setup-loading-view";

/** Setup-only feedback. No records, completion or readiness are inferred. */
export function SetupLoading() {
  const { locale } = useDemo();
  return <SetupLoadingView ar={locale === "ar"} />;
}
