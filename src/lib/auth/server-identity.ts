import { createBrokerBoundClient, createReadOnlyBrokerClient } from "@/lib/supabase/server";
import { checkAppSession } from "./session-guard";

export async function readSessionIdentity() {
  const result=await readIdentity(async () => (await createBrokerBoundClient()).bound);
  if(!result.ok)return result;
  // Preserve the existing public identity contract; only the scoped reader
  // needs the additional field for the private GET attestation.
  const {contextGeneration,...identity}=result;
  void contextGeneration;
  return identity;
}

/** Only for an operation that withholds its result until the verified read
 * scope's fresh final fence. Ordinary action identity reads keep their path. */
export async function readScopedSessionIdentity() {
  return readIdentity(createReadOnlyBrokerClient);
}

async function readIdentity(resolve: typeof createReadOnlyBrokerClient) {
  try {
    const bound = await resolve();
    if (!bound.ok) {
      return { ok: false as const, code: bound.code };
    }
    const client = bound.client;
    const [{ data, error }, guard] = await Promise.all([
      client.auth.getUser(),
      checkAppSession(client),
    ]);
    if (error) {
      return {
        ok: false as const,
        code: error.name === "AuthSessionMissingError" ? ("UNAUTHENTICATED" as const) : ("UNAVAILABLE" as const),
      };
    }
    if (!data.user || data.user.id !== bound.resolve.boundary.userId) {
      return { ok: false as const, code: "UNAUTHENTICATED" as const };
    }
    if (!guard.ok) return guard;
    return {
      ok: true as const,
      userId: data.user.id,
      email: data.user.email ?? "",
      fullName: String(data.user.user_metadata?.full_name || data.user.user_metadata?.name || ""),
      emailConfirmed: !!(data.user.email_confirmed_at || data.user.phone_confirmed_at),
      sessionExpiresAt: guard.expiresAt,
      boundaryFingerprint: bound.resolve.boundary.boundaryFingerprint,
      nativeSessionId: bound.resolve.boundary.nativeSessionId,
      contextGeneration: bound.resolve.boundary.contextGeneration,
      generation: bound.resolve.boundary.generation,
    };
  } catch {
    return { ok: false as const, code: "UNAVAILABLE" as const };
  }
}
