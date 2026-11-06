import { pathForAccess, type AccessResult } from "@/lib/tenancy/access";

/** Bound wait after login.committed so Set-Cookie reaches the browser before access stalls. */
export const POST_LOGIN_ACCESS_BUDGET_MS = 15_000;

/**
 * Post-admit destination helper (not a server action). Kept outside `"use server"`
 * so auth-pages can still import the actions barrel on the client.
 */
export async function resolvePostLoginDestination(
  preferred: string,
  readAccess: () => Promise<AccessResult>,
  budgetMs = POST_LOGIN_ACCESS_BUDGET_MS,
): Promise<string> {
  const soft = preferred || "/app";
  try {
    const access = await Promise.race([
      readAccess(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), budgetMs);
      }),
    ]);
    if (access == null) return soft;
    // Transient access probe failure must not strand a committed session on /access?code=UNAVAILABLE.
    if (!access.ok && access.code === "UNAVAILABLE") return soft;
    return pathForAccess(access, preferred || null);
  } catch {
    return soft;
  }
}
