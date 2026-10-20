import {
  normalizeConfirmedPhone,
  paidBranchConnectionFlowMatches,
  parsePaidBranchConnectionScope,
  unavailablePaidBranchConnectionRead,
  type PaidBranchConnectionFlow,
  type PaidBranchConnectionDenial,
  type PaidBranchConnectionLaunch,
  type PaidBranchConnectionMutation,
  type PaidBranchConnectionRead,
  type PaidBranchConnectionReason,
  type PaidBranchConnectionScope,
} from "@/lib/tenancy/paid-branch-connection-contracts";

export type PaidBranchConnectionStorePorts = {
  read(scope: PaidBranchConnectionScope): Promise<PaidBranchConnectionRead | null>;
  start(input: PaidBranchConnectionStartRequest): Promise<PaidBranchConnectionCommandResult | null>;
  claim(input: PaidBranchConnectionAttemptRequest): Promise<PaidBranchConnectionCommandResult | null>;
  finalize(input: PaidBranchConnectionAttemptRequest): Promise<PaidBranchConnectionCommandResult | null>;
  recover(input: PaidBranchConnectionAttemptRequest): Promise<PaidBranchConnectionCommandResult | null>;
  cancel(input: PaidBranchConnectionAttemptRequest): Promise<PaidBranchConnectionCommandResult | null>;
  exchange(input: PaidBranchConnectionAttemptRequest): Promise<{ ok: true } | { ok: false; code: PaidBranchConnectionReason }>;
};

export type PaidBranchConnectionStartRequest = PaidBranchConnectionScope & {
  flow: PaidBranchConnectionFlow;
  clientOpId: string;
  expectedRevision: string;
  confirmedPhoneNumber?: string;
  confirmed?: true;
  sessionId?: string;
  appId?: string;
  configId?: string;
  graphVersion?: string;
  nonce?: string;
  oauthState?: string;
  contractId?: string;
  buildAuthorizationUrl?: (state: string) => string | null;
};

export type PaidBranchConnectionAttemptRequest = PaidBranchConnectionScope & {
  flow: PaidBranchConnectionFlow;
  attemptId: string;
  generation: number;
  clientOpId?: string;
  nonce?: string;
  oauthState?: string;
};

export type PaidBranchConnectionCommandResult = PaidBranchConnectionMutation & {
  fresh?: boolean;
  launch?: PaidBranchConnectionLaunch;
  legacy?: Record<string, unknown>;
};

export type PaidBranchConnectionClaimResult = PaidBranchConnectionCommandResult;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function deny(scope: PaidBranchConnectionScope | Partial<PaidBranchConnectionScope>, code: PaidBranchConnectionReason, asOf: string): PaidBranchConnectionDenial {
  return { ok: false, code, read: unavailablePaidBranchConnectionRead(scope, asOf, code) };
}

/** Attempt follow-ups do not carry start-only phone or confirmation fields. */
export function parseConnectionAttempt(value: unknown, asOf: string): PaidBranchConnectionAttemptRequest | PaidBranchConnectionDenial {
  const scope = parsePaidBranchConnectionScope(value);
  if (!scope || !value || typeof value !== "object") return deny(scope ?? {}, "invalid_input", asOf);
  const input = value as Record<string, unknown>;
  const flow = input.flow;
  if (flow !== "wa_new_number" && flow !== "wa_coexistence" && flow !== "instagram_direct") return deny(scope, "invalid_input", asOf);
  if (!paidBranchConnectionFlowMatches(scope.channel, flow)) return deny(scope, "invalid_input", asOf);
  const generation = input.generation;
  if (typeof input.attemptId !== "string" || !UUID.test(input.attemptId) || typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1) return deny(scope, "invalid_input", asOf);
  return { ...scope, flow, attemptId: input.attemptId.toLowerCase(), generation };
}

export function parseConnectionStart(value: unknown, asOf: string): PaidBranchConnectionStartRequest | PaidBranchConnectionDenial {
  const scope = parsePaidBranchConnectionScope(value);
  if (!scope || !value || typeof value !== "object") return deny(scope ?? {}, "invalid_input", asOf);
  const input = value as Record<string, unknown>;
  const flow = input.flow;
  if (flow !== "wa_new_number" && flow !== "wa_coexistence" && flow !== "instagram_direct") return deny(scope, "invalid_input", asOf);
  if (!paidBranchConnectionFlowMatches(scope.channel, flow)) return deny(scope, "invalid_input", asOf);
  if (typeof input.clientOpId !== "string" || !UUID.test(input.clientOpId) || typeof input.expectedRevision !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(input.expectedRevision)) return deny(scope, "invalid_input", asOf);
  const phone = flow === "wa_coexistence" ? normalizeConfirmedPhone(input.confirmedPhoneNumber) : null;
  if (flow === "wa_coexistence" && (!phone || input.confirmed !== true)) return deny(scope, "invalid_input", asOf);
  if (flow !== "wa_coexistence" && (("confirmedPhoneNumber" in input && input.confirmedPhoneNumber != null) || input.confirmed != null)) return deny(scope, "invalid_input", asOf);
  if ("verified" in input || "linkId" in input || "code" in input || "accessToken" in input || "nonce" in input || "state" in input || "authorizationUrl" in input) return deny(scope, "invalid_input", asOf);
  return { ...scope, flow, clientOpId: input.clientOpId.toLowerCase(), expectedRevision: input.expectedRevision, ...(phone ? { confirmedPhoneNumber: phone, confirmed: true as const } : {}) };
}

/** Read and recovery never call exchange. Completion exchanges only after a committed claim. */
export async function runPaidBranchConnectionRead(scope: PaidBranchConnectionScope, ports: PaidBranchConnectionStorePorts, asOf: string): Promise<PaidBranchConnectionMutation> {
  const read = await ports.read(scope);
  return read ? { ok: true, read } : deny(scope, "source_failed", asOf);
}

export async function runPaidBranchConnectionStart(request: PaidBranchConnectionStartRequest, ports: PaidBranchConnectionStorePorts, asOf: string): Promise<PaidBranchConnectionCommandResult> {
  const started = await ports.start(request);
  return started ?? deny(request, "source_failed", asOf);
}

export async function runPaidBranchConnectionRecover(request: PaidBranchConnectionAttemptRequest, ports: PaidBranchConnectionStorePorts, asOf: string): Promise<PaidBranchConnectionMutation> {
  const recovered = await ports.recover(request);
  return recovered ?? deny(request, "source_failed", asOf);
}

export async function runPaidBranchConnectionCancel(request: PaidBranchConnectionAttemptRequest, ports: PaidBranchConnectionStorePorts, asOf: string): Promise<PaidBranchConnectionMutation> {
  const cancelled = await ports.cancel(request);
  return cancelled ?? deny(request, "source_failed", asOf);
}

const HEX = /^[a-f0-9]{64}$/;
const PROVIDER_ID = /^[0-9]{1,64}$/;

export function paidBranchCompletionAccepted(flow: PaidBranchConnectionFlow, attemptId: string, completion: unknown): boolean {
  if (!completion || typeof completion !== "object" || !completionAttemptIdsMatch(attemptId, completion)) return false;
  const row = completion as Record<string, unknown>;
  if (flow === "wa_new_number") {
    return typeof row.nonce === "string" && HEX.test(row.nonce)
      && typeof row.code === "string" && row.code.length > 0 && row.code.length <= 4096
      && typeof row.wabaId === "string" && PROVIDER_ID.test(row.wabaId)
      && typeof row.phoneNumberId === "string" && PROVIDER_ID.test(row.phoneNumberId)
      && typeof row.pin === "string" && /^\d{6}$/.test(row.pin);
  }
  if (flow === "wa_coexistence") {
    return row.confirmed === true
      && typeof row.nonce === "string" && HEX.test(row.nonce)
      && typeof row.code === "string" && row.code.length > 0 && row.code.length <= 4096
      && normalizeConfirmedPhone(row.confirmedPhoneNumber) != null;
  }
  return typeof row.state === "string" && HEX.test(row.state)
    && typeof row.code === "string" && row.code.length > 0 && row.code.length <= 16384
    && !/[\u0000-\u001f\u007f]/.test(row.code);
}

export function completionAttemptIdsMatch(attemptId: string, completion: unknown): boolean {
  const ids: unknown[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "attemptId" || key === "attempt_id") ids.push(child);
      else walk(child);
    }
  };
  walk(completion);
  return ids.length > 0 && ids.every((value) => value === attemptId);
}

export async function runPaidBranchConnectionComplete(request: PaidBranchConnectionAttemptRequest, ports: PaidBranchConnectionStorePorts, asOf: string): Promise<PaidBranchConnectionMutation> {
  const claimed = await ports.claim(request);
  if (!claimed) return deny(request, "source_failed", asOf);
  if (!claimed.ok) return claimed;
  if (claimed.fresh !== true) {
    const recovered = await ports.recover(request);
    return recovered ?? deny(request, "reconciliation_required", asOf);
  }
  let exchanged = false;
  try {
    const pending = ports.exchange(request);
    exchanged = true;
    const exchange = await pending;
    if (!exchange.ok) {
      const recovered = await ports.recover(request);
      return recovered ?? { ok: false, code: exchange.code, read: claimed.read };
    }
    const finalized = await ports.finalize(request);
    return finalized ?? deny(request, "reconciliation_required", asOf);
  } catch {
    if (!exchanged) return deny(request, "source_failed", asOf);
    const recovered = await ports.recover(request);
    return recovered ?? deny(request, "reconciliation_required", asOf);
  }
}

export function assertLaunchMatches(read: PaidBranchConnectionRead, launch: PaidBranchConnectionLaunch | undefined): boolean {
  return !!launch && launch.flow === read.connection.flow && launch.attemptId === read.connection.attempt?.id;
}
