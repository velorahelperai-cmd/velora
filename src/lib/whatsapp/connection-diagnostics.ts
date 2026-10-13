import { beginDiagnostic } from "@/lib/diagnostics/flow";
import type { DiagnosticCode, DiagnosticDetail, DiagnosticStage } from "@/lib/diagnostics/contract";

export type WhatsAppConnectionTrace = ReturnType<typeof beginDiagnostic>;
function failureCode(value: unknown): DiagnosticCode {
  switch (value) {
    case "INVALID_INPUT": case "FORBIDDEN": case "UNAVAILABLE": case "UNAUTHENTICATED": return value;
    case "COMPANY_SUSPENDED": return "FORBIDDEN";
    case "NEEDS_SETUP": return "DISABLED";
    case "RECONCILIATION_REQUIRED": return "OUTCOME_UNKNOWN";
    case "META_EXCHANGE_REJECTED": case "META_ASSET_REJECTED": case "META_TOKEN_REJECTED": case "META_AUTHORIZATION_REJECTED": return "PROVIDER_REJECTED";
    case "META_UNAVAILABLE": return "UNAVAILABLE";
    case "EXPIRED": case "CONSUMED": return "CONFLICT";
    default: return "UNEXPECTED_FAILURE";
  }
}

/** Only fixed stages and codes reach diagnostics. Results and exceptions retain their semantics. */
export async function diagnoseWhatsAppConnection<T extends { ok: boolean }>(
  work: (trace: WhatsAppConnectionTrace) => Promise<T>,
): Promise<T & { diagnostic?: DiagnosticDetail }> {
  const trace = beginDiagnostic("whatsapp_connect");
  let currentStage: DiagnosticStage = "input";
  const stage = trace.stage;
  trace.stage = (next: DiagnosticStage) => { currentStage = next; stage(next); };
  try {
    const result = await work(trace);
    if (!result.ok) {
      const failedAt = currentStage;
      const diagnostic = trace.finish(failureCode("code" in result ? result.code : undefined));
      return { ...result, diagnostic: { ...diagnostic, stage: failedAt } };
    }
    trace.stage("completed"); trace.finish("OK");
    return result;
  } catch (error) {
    const failedAt = currentStage;
    trace.event(failedAt, "UNEXPECTED_FAILURE");
    throw error;
  }
}

/** Observe existing port invocations; never invokes, repeats, or changes provider work itself. */
export function diagnosedWhatsAppPorts<T extends object>(ports: T, trace: WhatsAppConnectionTrace): T {
  const stages: Record<string, DiagnosticStage> = {
    claim: "claim", prepare: "provider", provider: "provider", checkpoint: "vault",
    subscribe: "subscribe", finalize: "finalize", authorize: "permissions",
  };
  return Object.fromEntries(Object.entries(ports).map(([key, value]) => [key,
    typeof value === "function" && stages[key]
      ? async (...args: unknown[]) => {
          const stage = stages[key];
          trace.stage(stage);
          try {
            const result = await value.apply(ports, args);
            if (result && typeof result === "object" && "ok" in result && result.ok === false) trace.event(stage, failureCode("code" in result ? result.code : undefined));
            return result;
          } catch (error) {
            trace.event(stage, "UNEXPECTED_FAILURE");
            throw error;
          }
        }
      : value,
  ])) as T;
}
