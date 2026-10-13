import { diagnosticText } from "@/lib/diagnostics/contract";
export function DiagnosticHint({ diagnostic, locale }: { diagnostic: unknown; locale: "ar" | "en" }) {
  const text = diagnosticText(diagnostic, locale);
  return text ? <p className="mt-2 break-words text-sm leading-6" dir={locale === "ar" ? "rtl" : "ltr"}>{text}</p> : null;
}
