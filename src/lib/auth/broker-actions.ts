"use server";

import { withAuthDiagnostic } from "@/lib/diagnostics/server-flow";
import { cookies } from "next/headers";
import { safeInternalPath } from "@/lib/auth/safe-next";
import {
  brokerStartOAuth,
  resolveBrokerSession,
  resolveBrokerSessionByFingerprint,
} from "@/lib/auth/broker";
import { createBrokerBoundClient } from "@/lib/supabase/server";

export async function startOAuthAction(
  provider: "google" = "google",
  next = "/setup",
  requestNonce?: string | null,
): Promise<{ ok: true; url: string } | { ok: false; code: "UNAVAILABLE" | "CONTINUITY_REQUIRED" | "OAUTH_NEW_INTENT_REQUIRED" }> {
  const cookieStore = await cookies();
  const writer = {
    set(name: string, value: string, options?: Record<string, unknown>) {
      cookieStore.set(name, value, options as never);
    },
  };
  const reader = {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
  };
  return brokerStartOAuth({
    provider,
    next: safeInternalPath(next, "/setup") || "/setup",
    writer,
    reader,
    requestNonce,
  });
}

export async function readBrokerSessionStatus(correlation?: unknown): Promise<
  | {
      ok: true;
      userId: string;
      boundaryFingerprint: string;
      nativeSessionId: string;
      contextGeneration: number;
      generation: string;
    }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" | "QUARANTINED" }
> {
  return withAuthDiagnostic<Awaited<ReturnType<typeof readBrokerSessionStatus>>>("auth_session_check", correlation, async trace => {
  trace.stage("session");
  const bound = await createBrokerBoundClient();
  if (!bound.bound.ok) { trace.finish(bound.bound.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "UNAVAILABLE"); return bound.bound; }
  trace.finish("OK");
  return {
    ok: true,
    userId: bound.bound.resolve.boundary.userId,
    boundaryFingerprint: bound.bound.resolve.boundary.boundaryFingerprint,
    nativeSessionId: bound.bound.resolve.boundary.nativeSessionId,
    contextGeneration: bound.bound.resolve.boundary.contextGeneration,
    generation: bound.bound.resolve.boundary.generation,
  };

  });
}

/**
 * Quarantine requires captured fingerprint — never retarget current session (C2-R7).
 */
export async function quarantineCurrentBrokerSession(
  expectedBoundaryFingerprint?: string | null,
): Promise<{ ok: boolean }> {
  try {
    if (!expectedBoundaryFingerprint || !/^[a-f0-9]{16}$/i.test(expectedBoundaryFingerprint)) {
      return { ok: false };
    }
    const { brokerExpireCapturedHandle } = await import("@/lib/auth/broker");
    const cookieStore = await cookies();
    const reader = {
      getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    const writer = {
      set(name: string, value: string, options?: Record<string, unknown>) {
        cookieStore.set(name, value, options as never);
      },
    };
    const resolved = await resolveBrokerSessionByFingerprint(reader, expectedBoundaryFingerprint);
    if (!resolved.ok) {
      return { ok: true };
    }
    const ok = await brokerExpireCapturedHandle(resolved, writer, expectedBoundaryFingerprint);
    return { ok };
  } catch {
    return { ok: false };
  }
}

export async function readBrokerResolveFingerprint(): Promise<string | null> {
  const cookieStore = await cookies();
  const resolved = await resolveBrokerSession({
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
  });
  return resolved.ok ? resolved.boundary.boundaryFingerprint : null;
}

/**
 * Resume original operation after self-revoke / cookie loss (C3-4).
 * Actor = current active tip (re-login). Fingerprint is optional same-tip bind only —
 * never client-claimed userId, never password replay, never cleanup-only fingerprint authority.
 */
/**
 * Recovery reauth under active password barrier — does not grant normal app use;
 * only creates tip so resume can run (C4-03). Client userId is never identity proof.
 */
export async function recoveryReauthForOperationAction(input: {
  operationKey: string;
  email: string;
  password: string;
  requestNonce?: string | null;
}): Promise<{ ok: boolean; code?: string }> {
  try {
    if (!input.operationKey || input.operationKey.length < 16) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    const { brokerPasswordLogin, loadBrokerOperation, resolveBrokerSession } = await import(
      "@/lib/auth/broker"
    );
    const cookieStore = await cookies();
    const reader = {
      getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    const writer = {
      set(name: string, value: string, options?: Record<string, unknown>) {
        cookieStore.set(name, value, options as never);
      },
    };
    const op = await loadBrokerOperation(input.operationKey);
    if (!op || (op.kind !== "password_revoke" && op.kind !== "logout")) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    const admissionScope = op.kind === "password_revoke" && op.status !== "confirmed" ? "recovery" : "app";
    const email = input.email.trim().toLowerCase();
    const admitted = await brokerPasswordLogin({
      email,
      password: input.password,
      writer,
      reader,
      recoveryOperationKey: input.operationKey,
      admissionScope,
      requestNonce: input.requestNonce,
    });
    if (!admitted.ok) {
      return {
        ok: false,
        code:
          admitted.code === "AUTH_ERROR"
            ? "AUTH_ERROR"
            : admitted.code === "CONTINUITY_REQUIRED"
              ? "CONTINUITY_REQUIRED"
              : "UNAVAILABLE",
      };
    }
    const resolved = await resolveBrokerSession(reader, { admissionScope });
    if (!resolved.ok || resolved.boundary.userId !== op.actorUserId) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function resumeBrokerOperationAction(input: {
  operationKey: string;
  expectedBoundaryFingerprint?: string | null;
}): Promise<{
  ok: boolean;
  code?: string;
  message?: string;
  status?: string;
}> {
  try {
    if (!input.operationKey) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    const { resumeBrokerOperation, resolveBrokerSession, loadBrokerOperation } = await import(
      "@/lib/auth/broker"
    );
    const cookieStore = await cookies();
    const reader = {
      getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    const writer = {
      set(name: string, value: string, options?: Record<string, unknown>) {
        cookieStore.set(name, value, options as never);
      },
    };
    const op = await loadBrokerOperation(input.operationKey);
    // Confirmed password ops: allow fresh app tip to acknowledge historical receipt (R4-F05).
    const resolveScope =
      op?.kind === "password_revoke" && op.status !== "confirmed" ? "recovery" : "app";
    const resolved = await resolveBrokerSession(reader, { admissionScope: resolveScope });
    if (!resolved.ok) {
      return { ok: false, code: "UNAUTHENTICATED", message: "REAUTH_REQUIRED" };
    }
    if (
      input.expectedBoundaryFingerprint &&
      resolved.boundary.boundaryFingerprint !== input.expectedBoundaryFingerprint
    ) {
      return { ok: false, code: "UNAUTHENTICATED", message: "CAPTURE_NOT_TIP" };
    }
    if (!op || op.actorUserId !== resolved.boundary.userId) {
      return { ok: false, code: "UNAUTHENTICATED", message: "FOREIGN_OPERATION" };
    }
    const result = await resumeBrokerOperation({
      operationKey: input.operationKey,
      actorUserId: resolved.boundary.userId,
      writer,
    });
    return {
      ok: result.ok,
      code: result.code,
      message: result.message,
      status: result.status,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function acknowledgeBrokerClientCleanupAction(input: {
  operationKey: string;
  expectedBoundaryFingerprint?: string | null;
}): Promise<{ ok: boolean }> {
  try {
    if (!input.operationKey) {
      return { ok: false };
    }
    const { acknowledgeBrokerClientCleanup, resolveBrokerSession, loadBrokerOperation } = await import(
      "@/lib/auth/broker"
    );
    const cookieStore = await cookies();
    const reader = {
      getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    const resolved = await resolveBrokerSession(reader);
    if (!resolved.ok) return { ok: false };
    if (
      input.expectedBoundaryFingerprint &&
      resolved.boundary.boundaryFingerprint !== input.expectedBoundaryFingerprint
    ) {
      return { ok: false };
    }
    const op = await loadBrokerOperation(input.operationKey);
    if (!op || op.actorUserId !== resolved.boundary.userId) return { ok: false };
    const ok = await acknowledgeBrokerClientCleanup({
      operationKey: input.operationKey,
      actorUserId: resolved.boundary.userId,
    });
    return { ok };
  } catch {
    return { ok: false };
  }
}
