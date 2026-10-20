import { authFlowHref } from "./auth-journey";
import { safeInternalPath } from "./safe-next";

const BRANCH = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function whatsappSetupPath(branchId: string): string | null {
  return branchId.length===36&&BRANCH.test(branchId) ? `/setup/branches/${branchId.toLowerCase()}/whatsapp` : null;
}
export function setupBranchPath(branchId: string): string {
  return branchId.length===36&&BRANCH.test(branchId) ? `/setup?branch=${branchId.toLowerCase()}` : "/setup";
}
function exactWhatsappPath(path: string): boolean {
  const match = /^\/setup\/branches\/([^/]+)\/whatsapp$/.exec(path);
  return !!match && match[0]===path && match[1]!.length===36 && BRANCH.test(match[1]!);
}
/** A URL selects a candidate only; the paid entry read must still authorize it. */
export function setupBranchFromReturn(path: string): string {
  if (path.includes("#") || path.split("?")[0] !== "/setup") return "";
  const values = new URLSearchParams(path.split("?")[1] ?? "").getAll("branch");
  return values.length === 1 && values[0]!.length===36 && BRANCH.test(values[0]!) ? values[0]!.toLowerCase() : "";
}

/** Required setup keeps a navigation intent; it never grants operating access. */
export function setupPathForReturn(preferredNext?: string | null): string {
  if (preferredNext && exactWhatsappPath(preferredNext)) return preferredNext;
  const preferred = safeInternalPath(preferredNext, "");
  if (preferred.split(/[?#]/)[0] === "/setup") return preferred;
  return authFlowHref("/setup", preferred);
}

/** The proxy overwrites this request path. Reject duplicate or oversized next values. */
export function setupReturnContext(requestPath: string | null) {
  if (requestPath && exactWhatsappPath(requestPath)) return {returnTo:requestPath,preferredNext:""};
  const safe = safeInternalPath(requestPath, "/setup");
  if (safe.split(/[?#]/)[0] !== "/setup") return { returnTo: "/setup", preferredNext: "" };
  const params = new URLSearchParams(safe.split("?")[1]?.split("#")[0] ?? "");
  if (params.has("branch")) {
    const branch = setupBranchFromReturn(requestPath ?? "");
    if (!branch || [...params.keys()].some(key=>key!=="branch"&&key!=="next")) return {returnTo:"/setup",preferredNext:""};
    const next = params.getAll("next");
    const preferredNext = next.length === 1 && next[0]!.length <= 2048 ? safeInternalPath(next[0], "") : "";
    return {returnTo:setupBranchPath(branch)+(preferredNext?`&next=${encodeURIComponent(preferredNext)}`:""),preferredNext};
  }
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
