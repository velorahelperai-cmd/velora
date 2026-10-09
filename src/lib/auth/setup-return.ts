import { authFlowHref } from "./auth-journey";
import { safeInternalPath } from "./safe-next";

/** Required setup keeps a navigation intent; it never grants operating access. */
export function setupPathForReturn(preferredNext?: string | null): string {
  const preferred = safeInternalPath(preferredNext, "");
  if (preferred.split(/[?#]/)[0] === "/setup") return preferred;
  return authFlowHref("/setup", preferred);
}

/** The proxy overwrites this request path. Reject duplicate or oversized next values. */
export function setupReturnContext(requestPath: string | null) {
  const safe = safeInternalPath(requestPath, "/setup");
  if (safe.split(/[?#]/)[0] !== "/setup") return { returnTo: "/setup", preferredNext: "" };
  const params = new URLSearchParams(safe.split("?")[1]?.split("#")[0] ?? "");
  const values = params.getAll("next");
  const preferredNext = values.length === 1 && values[0]!.length <= 2048
    ? safeInternalPath(values[0], "") : "";
  return { returnTo: setupPathForReturn(preferredNext), preferredNext };
}

/** Only the plan tab may carry a selection into setup's subscription link. */
export function setupSubscriptionReturn(preferredNext: string | null | undefined): string {
  const safe = safeInternalPath(preferredNext, "");
  if (safe.length > 2048 || safe.includes("#") || safe.split("?")[0] !== "/app/settings") return "/app/settings?tab=plan";
  const tabs = new URLSearchParams(safe.split("?")[1] ?? "").getAll("tab");
  return tabs.length === 1 && tabs[0] === "plan" ? safe : "/app/settings?tab=plan";
}
