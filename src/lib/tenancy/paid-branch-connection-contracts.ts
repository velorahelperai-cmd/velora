/**
 * Safe branch-bound channel connection DTOs.
 * Browser input never supplies verified, link, or branch-assignment authority.
 * Company-level provider uniqueness is preserved; it is not a new one-channel product policy.
 */

export const PAID_BRANCH_CONNECTION_SCHEMA_VERSION = 1 as const;

export const PAID_BRANCH_CONNECTION_CHANNELS = ["whatsapp", "instagram"] as const;
export const PAID_BRANCH_CONNECTION_FLOWS = ["wa_new_number", "wa_coexistence", "instagram_direct"] as const;
export const PAID_BRANCH_CONNECTION_STATES = ["not_connected", "pending", "connected", "reconciliation_required", "legacy_ambiguous", "unavailable"] as const;
export const PAID_BRANCH_CONNECTION_ATTEMPT_STATUSES = ["pending", "claimed", "vault_staged", "bound", "unknown", "rejected", "expired", "cancelled"] as const;
export const PAID_BRANCH_CONNECTION_REASONS = [
  "invalid_input",
  "account_mismatch",
  "forbidden",
  "unpaid",
  "suspended",
  "selection_required",
  "channel_not_selected",
  "stale_scope",
  "expired",
  "conflict",
  "legacy_ambiguous",
  "reconciliation_required",
  "setup_required",
  "source_failed",
  "unauthenticated",
] as const;

/** Existing catalog fences. A second paid branch cannot share or auto-adopt these rows. */
export const PAID_BRANCH_CONNECTION_ROUTING_GAP = {
  code: "conflict",
  constraints: [
    "public.whatsapp_company_links UNIQUE (company_id)",
    "private.whatsapp_coexistence_connections PRIMARY KEY (company_id)",
    "private.instagram_company_links UNIQUE (company_id) WHERE status = active",
    "private.instagram_company_links UNIQUE (account_id) WHERE status = active",
  ],
} as const;

export type PaidBranchConnectionChannel = (typeof PAID_BRANCH_CONNECTION_CHANNELS)[number];
export type PaidBranchConnectionFlow = (typeof PAID_BRANCH_CONNECTION_FLOWS)[number];
export type PaidBranchConnectionState = (typeof PAID_BRANCH_CONNECTION_STATES)[number];
export type PaidBranchConnectionAttemptStatus = (typeof PAID_BRANCH_CONNECTION_ATTEMPT_STATUSES)[number];
export type PaidBranchConnectionReason = (typeof PAID_BRANCH_CONNECTION_REASONS)[number];

export type PaidBranchConnectionScope = {
  expectedAccountId: string;
  companyId: string;
  branchId: string;
  channel: PaidBranchConnectionChannel;
};

export type PaidBranchConnectionCapabilities = {
  canStart: boolean;
  canRecover: boolean;
  canCancel: boolean;
  allowedFlows: PaidBranchConnectionFlow[];
};

export type PaidBranchConnectionRead = {
  schemaVersion: typeof PAID_BRANCH_CONNECTION_SCHEMA_VERSION;
  sourceStatus: "ready" | "unavailable";
  expectedAccountId: string;
  companyId: string;
  branchId: string;
  channel: PaidBranchConnectionChannel;
  asOf: string;
  revision: string | null;
  connection: {
    state: PaidBranchConnectionState;
    flow: PaidBranchConnectionFlow | null;
    attempt: null | { id: string; generation: number; expiresAt: string; status: PaidBranchConnectionAttemptStatus };
    link: null | { id: string; generation: number };
    verified: boolean;
    reasonCodes: PaidBranchConnectionReason[];
  };
  capabilities: PaidBranchConnectionCapabilities;
};

export type PaidBranchConnectionLaunch =
  | { flow: "wa_new_number"; attemptId: string; nonce: string; appId: string; configId: string; graphVersion: string }
  | { flow: "wa_coexistence"; attemptId: string; nonce: string; appId: string; configId: string; graphVersion: string; confirmedPhoneNumber: string }
  | { flow: "instagram_direct"; attemptId: string; state: string; authorizationUrl: string };

export type PaidBranchConnectionDenial = {
  ok: false;
  code: PaidBranchConnectionReason;
  read: PaidBranchConnectionRead;
};

/** Complete, recover, and cancel do not carry launch material. */
export type PaidBranchConnectionMutation =
  | { ok: true; read: PaidBranchConnectionRead }
  | PaidBranchConnectionDenial;

/** Start success always includes the server-issued launch descriptor for that flow and attempt. */
export type PaidBranchConnectionStartResult = {
  ok: true;
  read: PaidBranchConnectionRead;
  launch: PaidBranchConnectionLaunch;
};

export type ReadOwnedPaidBranchConnectionInput = PaidBranchConnectionScope;

export type StartOwnedPaidBranchConnectionInput = PaidBranchConnectionScope & {
  flow: PaidBranchConnectionFlow;
  clientOpId: string;
  expectedRevision: string;
  confirmedPhoneNumber?: string;
  confirmed?: true;
};

export type CompleteWhatsappNewNumberInput = {
  attemptId: string;
  nonce: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
  pin: string;
};

export type CompleteWhatsappCoexistenceInput = {
  attemptId: string;
  nonce: string;
  code: string;
  confirmedPhoneNumber: string;
  confirmed: true;
};

export type CompleteInstagramDirectInput = {
  attemptId: string;
  state: string;
  code: string;
};

export type PaidBranchConnectionCompletion = CompleteWhatsappNewNumberInput | CompleteWhatsappCoexistenceInput | CompleteInstagramDirectInput;

export type CompleteOwnedPaidBranchConnectionInput = PaidBranchConnectionScope & {
  flow: PaidBranchConnectionFlow;
  attemptId: string;
  generation: number;
  completion: PaidBranchConnectionCompletion;
};

export type RecoverOwnedPaidBranchConnectionInput = PaidBranchConnectionScope & {
  flow: PaidBranchConnectionFlow;
  attemptId: string;
  generation: number;
};

export type CancelOwnedPaidBranchConnectionInput = RecoverOwnedPaidBranchConnectionInput;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const PHONE = /^\+[1-9]\d{6,14}$/;
const PUBLIC_ID = /^[0-9]{1,64}$/;
const GRAPH = /^v[0-9]+\.0$/;

export function paidBranchConnectionFlowFor(channel: PaidBranchConnectionChannel): PaidBranchConnectionFlow[] {
  return channel === "whatsapp" ? ["wa_new_number", "wa_coexistence"] : ["instagram_direct"];
}

export function paidBranchConnectionFlowMatches(channel: PaidBranchConnectionChannel, flow: PaidBranchConnectionFlow): boolean {
  return paidBranchConnectionFlowFor(channel).includes(flow);
}

export function parsePaidBranchConnectionScope(value: unknown): PaidBranchConnectionScope | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!UUID.test(String(input.expectedAccountId ?? "")) || !UUID.test(String(input.companyId ?? "")) || !UUID.test(String(input.branchId ?? ""))) return null;
  if (!PAID_BRANCH_CONNECTION_CHANNELS.includes(input.channel as PaidBranchConnectionChannel)) return null;
  return {
    expectedAccountId: String(input.expectedAccountId).toLowerCase(),
    companyId: String(input.companyId).toLowerCase(),
    branchId: String(input.branchId).toLowerCase(),
    channel: input.channel as PaidBranchConnectionChannel,
  };
}

export function normalizeConfirmedPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || !/^[+\d ()-]+$/.test(value)) return null;
  const compact = value.replace(/[ ()-]/g, "");
  return PHONE.test(compact) ? compact : null;
}

export function unavailablePaidBranchConnectionRead(scope: Partial<PaidBranchConnectionScope>, asOf: string, reason: PaidBranchConnectionReason): PaidBranchConnectionRead {
  return {
    schemaVersion: 1,
    sourceStatus: "unavailable",
    expectedAccountId: scope.expectedAccountId ?? "",
    companyId: scope.companyId ?? "",
    branchId: scope.branchId ?? "",
    channel: scope.channel ?? "whatsapp",
    asOf,
    revision: null,
    connection: { state: "unavailable", flow: null, attempt: null, link: null, verified: false, reasonCodes: [reason] },
    capabilities: { canStart: false, canRecover: false, canCancel: false, allowedFlows: [] },
  };
}

const CAPABILITY_DENY = new Set<PaidBranchConnectionReason>([
  "invalid_input",
  "account_mismatch",
  "forbidden",
  "unpaid",
  "suspended",
  "selection_required",
  "channel_not_selected",
  "stale_scope",
  "expired",
  "conflict",
  "legacy_ambiguous",
  "setup_required",
  "source_failed",
  "unauthenticated",
]);

function capabilitiesFor(read: Omit<PaidBranchConnectionRead, "capabilities">): PaidBranchConnectionCapabilities {
  const attempt = read.connection.attempt;
  const hardDeny = read.sourceStatus !== "ready"
    || read.connection.state === "legacy_ambiguous"
    || read.connection.state === "unavailable"
    || read.connection.reasonCodes.some((code) => CAPABILITY_DENY.has(code));
  const recoverable = !!attempt && (attempt.status === "unknown" || attempt.status === "vault_staged" || attempt.status === "claimed");
  const terminal = attempt?.status === "cancelled" || attempt?.status === "expired" || attempt?.status === "rejected";
  return {
    canStart: !hardDeny && read.connection.state !== "reconciliation_required" && read.connection.state !== "connected" && (read.connection.state === "not_connected" || !!terminal),
    canRecover: !hardDeny && recoverable,
    canCancel: !hardDeny && read.connection.state !== "reconciliation_required" && read.connection.state !== "connected" && !!attempt && (attempt.status === "pending" || attempt.status === "claimed"),
    allowedFlows: hardDeny || read.connection.state === "connected" || read.connection.state === "reconciliation_required" ? [] : paidBranchConnectionFlowFor(read.channel),
  };
}

export function parsePaidBranchConnectionRead(value: unknown, scope: PaidBranchConnectionScope): PaidBranchConnectionRead | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || (row.sourceStatus !== "ready" && row.sourceStatus !== "unavailable")) return null;
  if (row.companyId !== scope.companyId || row.branchId !== scope.branchId || row.channel !== scope.channel || row.expectedAccountId !== scope.expectedAccountId) return null;
  if (row.revision !== null && (typeof row.revision !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(row.revision))) return null;
  if (typeof row.asOf !== "string" || !ISO.test(row.asOf)) return null;
  const connection = row.connection;
  if (!connection || typeof connection !== "object") return null;
  const body = connection as Record<string, unknown>;
  if (!PAID_BRANCH_CONNECTION_STATES.includes(body.state as PaidBranchConnectionState)) return null;
  if (body.flow !== null && !PAID_BRANCH_CONNECTION_FLOWS.includes(body.flow as PaidBranchConnectionFlow)) return null;
  if (body.verified !== true && body.verified !== false) return null;
  if (body.verified === true && (body.state !== "connected" || body.link == null)) return null;
  const attempt = parseAttempt(body.attempt);
  const link = parseLink(body.link);
  if (attempt === undefined || link === undefined) return null;
  if (!Array.isArray(body.reasonCodes) || body.reasonCodes.some((code) => !PAID_BRANCH_CONNECTION_REASONS.includes(code as PaidBranchConnectionReason))) return null;
  const read: Omit<PaidBranchConnectionRead, "capabilities"> = {
    schemaVersion: 1,
    sourceStatus: row.sourceStatus,
    expectedAccountId: scope.expectedAccountId,
    companyId: scope.companyId,
    branchId: scope.branchId,
    channel: scope.channel,
    asOf: row.asOf,
    revision: row.revision as string | null,
    connection: {
      state: body.state as PaidBranchConnectionState,
      flow: body.flow as PaidBranchConnectionFlow | null,
      attempt,
      link,
      verified: body.verified === true,
      reasonCodes: body.reasonCodes as PaidBranchConnectionReason[],
    },
  };
  return { ...read, capabilities: capabilitiesFor(read) };
}

function parseAttempt(value: unknown): PaidBranchConnectionRead["connection"]["attempt"] | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!UUID.test(String(row.id ?? "")) || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1) return undefined;
  if (typeof row.expiresAt !== "string" || !ISO.test(row.expiresAt)) return undefined;
  if (!PAID_BRANCH_CONNECTION_ATTEMPT_STATUSES.includes(row.status as PaidBranchConnectionAttemptStatus)) return undefined;
  return { id: String(row.id).toLowerCase(), generation: Number(row.generation), expiresAt: row.expiresAt, status: row.status as PaidBranchConnectionAttemptStatus };
}

function parseLink(value: unknown): PaidBranchConnectionRead["connection"]["link"] | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (!UUID.test(String(row.id ?? "")) || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1) return undefined;
  return { id: String(row.id).toLowerCase(), generation: Number(row.generation) };
}

export function parsePaidBranchConnectionLaunch(flow: PaidBranchConnectionFlow, value: unknown, attemptId: string): PaidBranchConnectionLaunch | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.flow !== flow || row.attemptId !== attemptId) return null;
  if (flow === "instagram_direct") {
    if (typeof row.state !== "string" || !/^[a-f0-9]{64}$/.test(row.state) || typeof row.authorizationUrl !== "string" || !row.authorizationUrl.startsWith("https://")) return null;
    return { flow, attemptId, state: row.state, authorizationUrl: row.authorizationUrl };
  }
  if (typeof row.nonce !== "string" || row.nonce.length < 16 || typeof row.appId !== "string" || !PUBLIC_ID.test(row.appId) || typeof row.configId !== "string" || !PUBLIC_ID.test(row.configId) || typeof row.graphVersion !== "string" || !GRAPH.test(row.graphVersion)) return null;
  if (flow === "wa_coexistence") {
    if (typeof row.confirmedPhoneNumber !== "string" || !PHONE.test(row.confirmedPhoneNumber)) return null;
    return { flow, attemptId, nonce: row.nonce, appId: row.appId, configId: row.configId, graphVersion: row.graphVersion, confirmedPhoneNumber: row.confirmedPhoneNumber };
  }
  return { flow, attemptId, nonce: row.nonce, appId: row.appId, configId: row.configId, graphVersion: row.graphVersion };
}

const SECRET = /accessToken|nonce|authorization|code|vault|secret|oauth/i;

export function paidBranchConnectionReadHasSecrets(value: PaidBranchConnectionRead): boolean {
  return SECRET.test(JSON.stringify(value));
}
