"use client";
import { validClientOperationKey } from "./operation-key";

export type RecoveryReceipt = { operationKey: string; userId: string; boundaryFingerprint: string; kind: "logout" | "password_revoke" };
const hintPrefix = "velora:wp01a:operation:";

export function createRecoveryReceipt(userId: string, boundaryFingerprint: string, kind: RecoveryReceipt["kind"]): RecoveryReceipt {
  const receipt = { operationKey: crypto.randomUUID(), userId, boundaryFingerprint, kind };
  try { window.sessionStorage.setItem(hintPrefix + boundaryFingerprint, JSON.stringify(receipt)); } catch { /* Memory capture remains locked; storage never supplies authority. */ }
  return receipt;
}

export function readRecoveryReceipt(boundaryFingerprint: string): RecoveryReceipt | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(hintPrefix + boundaryFingerprint) ?? "null") as RecoveryReceipt | null;
    return value && validClientOperationKey(value.operationKey) && value.boundaryFingerprint === boundaryFingerprint
      && typeof value.userId === "string" && (value.kind === "logout" || value.kind === "password_revoke") ? value : null;
  } catch { return null; }
}

type RecoveryPorts = {
  cleanup: () => void | Promise<void>;
  resume: (input: { operationKey: string }) => Promise<{ ok: boolean; status?: string }>;
  acknowledge: (input: { operationKey: string }) => Promise<{ ok: boolean }>;
};

/** Original receipt reconciliation only. No credential mutation or timer can confirm it. */
export async function reconcileOriginalOperation(
  operationKey: string,
  isCaptured: () => boolean,
  ports: RecoveryPorts,
): Promise<"confirmed" | "pending" | "stale"> {
  if (!isCaptured()) return "stale";
  try {
    await ports.cleanup();
    if (!isCaptured()) return "stale";
    const receipt = await ports.resume({ operationKey });
    if (!isCaptured()) return "stale";
    if (!receipt.ok || receipt.status !== "confirmed") return "pending";
    const durable = await ports.acknowledge({ operationKey });
    if (!isCaptured()) return "stale";
    return durable.ok === true ? "confirmed" : "pending";
  } catch {
    return isCaptured() ? "pending" : "stale";
  }
}
