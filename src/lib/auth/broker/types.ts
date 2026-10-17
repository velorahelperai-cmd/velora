/** WP01A session-broker contracts. Opaque handles only; no JWT/native IDs in cookies. */

export const BROKER_CONTRACT_VERSION = 2 as const;
export const BROKER_COOKIE_PREFIX = "vel_sh_" as const;
/**
 * Client-only continuity mirror (JS-readable). Never written by server Set-Cookie (C5-R4).
 */
export const BROKER_CONTINUITY_COOKIE = "vel_bc" as const;
export const CONTINUITY_STORAGE_KEY = "velora:wp01a:continuity:v1" as const;
export const CONTINUITY_LOCK_NAME = "velora:wp01a:continuity:v1" as const;
/**
 * Server-bound browser attempt identity (signed). Not a lineage selector (C5-01).
 * @deprecated vel_bl — do not use for resolve authority; retained for expire-only cleanup.
 */
export const BROKER_LINEAGE_COOKIE = "vel_bl" as const;
/** @deprecated vel_ba minting superseded by continuity bind (C5-R4); fail-closed for new roots. */
export const BROKER_ATTEMPT_COOKIE = "vel_ba" as const;
/** Per-intent OAuth cookie prefix: vel_ai_<stateNonceFingerprint> */
export const BROKER_INTENT_COOKIE_PREFIX = "vel_ai_" as const;
/** @deprecated shared intent cookie — ignored after cutover; kept for expire cleanup only */
export const BROKER_INTENT_COOKIE = "vel_ai" as const;
export const MAX_BROKER_HANDLE_COOKIES = 8;
export const AUTH_RETURN_GEN_COOKIE = "velora_auth_return_gen" as const;

export type BrokerSessionStatus = "active" | "quarantined" | "revoked" | "tombstoned";
export type BrokerIntentStatus = "reserved" | "committed" | "rejected" | "expired" | "frozen_target";
export type BrokerOperationKind = "logout" | "password_revoke";
export type BrokerStageState = "not_attempted" | "pending" | "confirmed" | "rejected" | "unknown";

export type BrokerStageReceipt = {
  credentialMutation: BrokerStageState;
  appRevocation: BrokerStageState;
  nativeRevocation: BrokerStageState;
  cookieCommit: BrokerStageState;
  clientCleanup: BrokerStageState;
  contextRead: BrokerStageState;
};

export type SessionBoundary = {
  /** Opaque fingerprint for logs/UI fences — not the raw handle or native session id. */
  boundaryFingerprint: string;
  userId: string;
  nativeSessionId: string;
  cookieName: string;
  generation: string;
  authOrdinal: number;
  contextGeneration: number;
  /** Browser lineage — supersession is scoped here, not across all user devices. */
  browserLineageId?: string | null;
};

export type BrokerResolveResult =
  | {
      ok: true;
      boundary: SessionBoundary;
      accessToken: string;
      refreshToken: string;
      expiresAt: string;
      refreshRevision: number;
      registryId: string;
      authOrdinal: number;
      /** Server handle_hash for parent lineage on sync/admit. */
      handleHash: string;
    }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" | "QUARANTINED" };

export type BrokerCapability = {
  ok: boolean;
  contractVersion: typeof BROKER_CONTRACT_VERSION;
  revokeBoolean: boolean;
  idleWrappers: boolean;
  brokerRegistry: boolean;
  revokeAtOperation: boolean;
  refreshLease: boolean;
  admitOrdinal: boolean;
  admitAtomic: boolean;
  browserAttemptIssue: boolean;
  admit14arg: boolean;
  issueSeqColumn: boolean;
  admissionScopeColumn: boolean;
  completeRevocation: boolean;
  /** C5-R4 */
  browserBootstrapClaim: boolean;
  completeRevocationStrict: boolean;
  boundAdmit: boolean;
  boundResolve: boolean;
  encryptionConfigured: boolean;
  codes: string[];
};

export type BrokerOperationStages = BrokerStageReceipt & {
  operationId: string;
  kind: BrokerOperationKind;
  status: "open" | "pending" | "confirmed" | "partial" | "failed";
  next?: string;
  supportRef?: string;
};
