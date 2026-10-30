/**
 * B1 read model for one owned paid branch.
 * Caller input never supplies selected channels, readiness, or completion.
 * A missing persisted channel binding stays selection_required.
 */

export const PAID_SETUP_SCHEMA_VERSION = 1 as const;

/** Installed private.es02_resolve_slots rejects a slot array longer than 32. Indexes are 0..31. */
export const PAID_SETUP_MAX_BRANCH_SLOTS = 32;

/** Installed private.es02_activation_foundation.clock_state check. */
export const PAID_SETUP_CLOCK_STATES = ["waiting_readiness", "active", "ended"] as const;

export const PAID_SETUP_STEP_IDS = [
  "connect_whatsapp",
  "connect_instagram",
  "hours",
  "knowledge",
  "assistant_test",
  "invitations",
  "launch",
] as const;

export type PaidSetupStepId = (typeof PAID_SETUP_STEP_IDS)[number];
export type PaidSetupChannel = "whatsapp" | "instagram";
export type PaidSetupSourceStatus = "ready" | "selection_required" | "unavailable";
export type PaidSetupStepStatus = "blocked" | "pending" | "verified" | "skipped_optional" | "unavailable";
export type PaidSetupPersona = "level_1" | "level_2" | "level_3";
export type PaidSetupPackage = "basic" | "premium";

export type PaidSetupStep = {
  id: PaidSetupStepId;
  required: boolean;
  status: PaidSetupStepStatus;
  dependencyIds: PaidSetupStepId[];
  reasonCodes: string[];
  actionId: string;
};

export type PaidSetupEntitlement = {
  orderGroupId: string;
  slotIndex: number;
  persona: PaidSetupPersona;
  package: PaidSetupPackage;
  maxChannels: number;
  employeesExcludingOwner: number;
};

export type PaidBranchSetupRead = {
  schemaVersion: typeof PAID_SETUP_SCHEMA_VERSION;
  sourceStatus: PaidSetupSourceStatus;
  companyId: string;
  selectedBranchId: string;
  branches: { id: string; label: string }[];
  entitlement: PaidSetupEntitlement | null;
  selectedChannels: PaidSetupChannel[] | null;
  steps: PaidSetupStep[];
  progress: { denominator: number | null; verified: number; skippedOptional: number };
  launch: {
    confirmationRequired: true;
    confirmed: boolean;
    canRequest: boolean;
    blockedReasons: string[];
  };
  asOf: string;
};

/** Server-verified slot facts. Not accepted from a browser caller. */
export type PaidSlotFacts = {
  companyId: string;
  branchId: string;
  branchLabel: string;
  orderGroupId: string;
  slotIndex: number;
  persona: PaidSetupPersona;
  package: PaidSetupPackage;
  term: "monthly" | "yearly";
  maxChannels: number;
  employeesExcludingOwner: number;
  clockState: string;
  asOf: string;
};

/**
 * Future trusted binding. Tests may construct this. The runtime read action must not.
 * Invitation skip is explicit; it is not an invitation.
 */
export type TrustedChannelBinding = {
  channels: readonly PaidSetupChannel[];
  invitationSkipped?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FACT_KEYS = [
  "companyId",
  "branchId",
  "branchLabel",
  "orderGroupId",
  "slotIndex",
  "persona",
  "package",
  "term",
  "maxChannels",
  "employeesExcludingOwner",
  "clockState",
  "asOf",
] as const;

const PERSONAS = new Set<PaidSetupPersona>(["level_1", "level_2", "level_3"]);
const PACKAGES = new Set<PaidSetupPackage>(["basic", "premium"]);
const CHANNELS = new Set<PaidSetupChannel>(["whatsapp", "instagram"]);
const CLOCKS = new Set<string>(PAID_SETUP_CLOCK_STATES);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export function paidSetupUnavailable(input: {
  companyId?: string;
  branchId?: string;
  asOf: string;
  blockedReasons: string[];
}): PaidBranchSetupRead {
  return {
    schemaVersion: 1,
    sourceStatus: "unavailable",
    companyId: input.companyId && UUID.test(input.companyId) ? input.companyId : "",
    selectedBranchId: input.branchId && UUID.test(input.branchId) ? input.branchId : "",
    branches: [],
    entitlement: null,
    selectedChannels: null,
    steps: [],
    progress: { denominator: null, verified: 0, skippedOptional: 0 },
    launch: {
      confirmationRequired: true,
      confirmed: false,
      canRequest: false,
      blockedReasons: input.blockedReasons,
    },
    asOf: input.asOf,
  };
}

export function parsePaidSlotFacts(value: unknown): PaidSlotFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== FACT_KEYS.length || FACT_KEYS.some((key) => !keys.includes(key))) return null;
  if (keys.some((key) => key === "selectedChannels" || key === "readiness" || key === "completion")) return null;
  const companyId = uuid(row.companyId);
  const branchId = uuid(row.branchId);
  const orderGroupId = uuid(row.orderGroupId);
  const branchLabel = text(row.branchLabel);
  const persona = row.persona;
  const packageName = row.package;
  const term = row.term;
  const slotIndex = integer(row.slotIndex);
  const maxChannels = integer(row.maxChannels);
  const employees = integer(row.employeesExcludingOwner);
  const clockState = text(row.clockState);
  const asOf = text(row.asOf);
  if (!companyId || !branchId || !orderGroupId || branchLabel == null || !clockState || !asOf) return null;
  if (!CLOCKS.has(clockState) || !isIsoTimestamp(asOf)) return null;
  if (slotIndex == null || slotIndex < 0 || slotIndex >= PAID_SETUP_MAX_BRANCH_SLOTS) return null;
  if (!isPersona(persona) || !isPackage(packageName) || (term !== "monthly" && term !== "yearly")) return null;
  if (maxChannels == null || employees == null) return null;
  if (packageName === "basic" && (maxChannels !== 1 || employees !== 2)) return null;
  if (packageName === "premium" && (maxChannels !== 2 || employees !== 4)) return null;
  if (persona === "level_1" || persona === "level_2" || persona === "level_3") {
    // Persona never selects the package or the channel count.
  }
  return {
    companyId,
    branchId,
    branchLabel,
    orderGroupId,
    slotIndex,
    persona,
    package: packageName,
    term,
    maxChannels,
    employeesExcludingOwner: employees,
    clockState,
    asOf,
  };
}

export function projectSelectionRequired(facts: PaidSlotFacts): PaidBranchSetupRead {
  return {
    schemaVersion: 1,
    sourceStatus: "selection_required",
    companyId: facts.companyId,
    selectedBranchId: facts.branchId,
    branches: [{ id: facts.branchId, label: facts.branchLabel }],
    entitlement: entitlementOf(facts),
    selectedChannels: null,
    steps: [],
    progress: { denominator: null, verified: 0, skippedOptional: 0 },
    launch: {
      confirmationRequired: true,
      confirmed: false,
      canRequest: false,
      blockedReasons: ["selection_required"],
    },
    asOf: facts.asOf,
  };
}

/** Pure projection for a later authoritative binding. Runtime B1 does not call this. */
export function projectTrustedBoundSelection(facts: PaidSlotFacts, binding: TrustedChannelBinding): PaidBranchSetupRead {
  const channels = [...binding.channels];
  if (channels.length === 0) return projectSelectionRequired(facts);
  if (channels.length > facts.maxChannels || new Set(channels).size !== channels.length || channels.some((channel) => !CHANNELS.has(channel))) {
    return paidSetupUnavailable({
      companyId: facts.companyId,
      branchId: facts.branchId,
      asOf: facts.asOf,
      blockedReasons: ["entitlement_exceeded"],
    });
  }
  const ordered = (["whatsapp", "instagram"] as const).filter((channel) => channels.includes(channel));
  const channelSteps = ordered.map((channel) => step(channel === "whatsapp" ? "connect_whatsapp" : "connect_instagram", {
    required: true,
    status: "pending",
    dependencyIds: [],
    reasonCodes: ["connection_not_verified"],
  }));
  const channelIds = channelSteps.map((item) => item.id);
  const hours = step("hours", { required: true, status: "pending", dependencyIds: [], reasonCodes: ["setup_incomplete"] });
  const knowledge = step("knowledge", { required: true, status: "unavailable", dependencyIds: ["hours"], reasonCodes: ["readiness_unavailable"] });
  const assistant = step("assistant_test", { required: true, status: "unavailable", dependencyIds: ["knowledge"], reasonCodes: ["readiness_unavailable"] });
  const invitations = step("invitations", {
    required: false,
    status: binding.invitationSkipped ? "skipped_optional" : "pending",
    dependencyIds: ["assistant_test"],
    reasonCodes: binding.invitationSkipped ? ["invitation_skipped"] : ["setup_incomplete"],
  });
  const requiredBeforeLaunch: PaidSetupStepId[] = [...channelIds, "hours", "knowledge", "assistant_test"];
  const launch = step("launch", {
    required: true,
    status: "blocked",
    dependencyIds: requiredBeforeLaunch,
    reasonCodes: ["launch_not_confirmed", "launch_not_implemented"],
  });
  const steps = [...channelSteps, hours, knowledge, assistant, invitations, launch];
  return {
    schemaVersion: 1,
    sourceStatus: "ready",
    companyId: facts.companyId,
    selectedBranchId: facts.branchId,
    branches: [{ id: facts.branchId, label: facts.branchLabel }],
    entitlement: entitlementOf(facts),
    selectedChannels: ordered,
    steps,
    progress: {
      denominator: steps.length,
      verified: steps.filter((item) => item.status === "verified").length,
      skippedOptional: steps.filter((item) => item.status === "skipped_optional").length,
    },
    launch: {
      confirmationRequired: true,
      confirmed: false,
      canRequest: false,
      blockedReasons: ["awaiting_required_steps", "launch_not_implemented"],
    },
    asOf: facts.asOf,
  };
}

function entitlementOf(facts: PaidSlotFacts): PaidSetupEntitlement {
  return {
    orderGroupId: facts.orderGroupId,
    slotIndex: facts.slotIndex,
    persona: facts.persona,
    package: facts.package,
    maxChannels: facts.maxChannels,
    employeesExcludingOwner: facts.employeesExcludingOwner,
  };
}

function step(id: PaidSetupStepId, fields: Omit<PaidSetupStep, "id" | "actionId">): PaidSetupStep {
  return { id, actionId: id, ...fields };
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function isPersona(value: unknown): value is PaidSetupPersona {
  return typeof value === "string" && PERSONAS.has(value as PaidSetupPersona);
}

function isPackage(value: unknown): value is PaidSetupPackage {
  return typeof value === "string" && PACKAGES.has(value as PaidSetupPackage);
}

export type PaidBranchSetupEntryBranch = {
  id: string;
  label: string;
  isPrimary: boolean;
};

/** Owned paid branch ids only. selectedBranchId stays null until a later explicit read. */
export type PaidBranchSetupEntryRead = {
  schemaVersion: typeof PAID_SETUP_SCHEMA_VERSION;
  sourceStatus: "selection_required" | "unavailable";
  companyId: string;
  selectedBranchId: null;
  branches: PaidBranchSetupEntryBranch[];
  asOf: string;
  reasonCodes: string[];
};

export type ReadOwnedPaidBranchSetupEntryInput = {
  expectedAccountId: string;
  companyId: string;
};

export type SelectOwnedPaidBranchChannelsInput = {
  expectedAccountId: string;
  companyId: string;
  branchId: string;
  clientOpId: string;
  channels: readonly string[];
};

export type PaidBranchChannelSelectionResult =
  | {
      ok: true;
      code: "selected" | "duplicate";
      receiptId: string;
      companyId: string;
      branchId: string;
      channels: PaidSetupChannel[];
      asOf: string;
    }
  | {
      ok: false;
      code: string;
      companyId: string;
      branchId: string;
    };

const ENTRY_KEYS = ["companyId", "branches", "asOf"] as const;
const ENTRY_BRANCH_KEYS = ["id", "label", "isPrimary"] as const;
const RECEIPT_KEYS = ["receiptId", "companyId", "branchId", "channels", "asOf"] as const;
const BINDING_KEYS = ["channels"] as const;

export function paidSetupEntryUnavailable(input: {
  companyId?: string;
  asOf: string;
  reasonCodes: string[];
}): PaidBranchSetupEntryRead {
  return {
    schemaVersion: 1,
    sourceStatus: "unavailable",
    companyId: input.companyId && UUID.test(input.companyId) ? input.companyId : "",
    selectedBranchId: null,
    branches: [],
    asOf: input.asOf,
    reasonCodes: input.reasonCodes,
  };
}

export function parsePaidSetupEntry(value: unknown): { companyId: string; branches: PaidBranchSetupEntryBranch[]; asOf: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== ENTRY_KEYS.length || ENTRY_KEYS.some((key) => !keys.includes(key))) return null;
  const companyId = uuid(row.companyId);
  const asOf = text(row.asOf);
  if (!companyId || !asOf || !isIsoTimestamp(asOf) || !Array.isArray(row.branches)) return null;
  const branches: PaidBranchSetupEntryBranch[] = [];
  for (const item of row.branches) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const branch = item as Record<string, unknown>;
    const branchKeys = Object.keys(branch);
    if (branchKeys.length !== ENTRY_BRANCH_KEYS.length || ENTRY_BRANCH_KEYS.some((key) => !branchKeys.includes(key))) return null;
    const id = uuid(branch.id);
    const label = text(branch.label);
    if (!id || label == null || typeof branch.isPrimary !== "boolean") return null;
    branches.push({ id, label, isPrimary: branch.isPrimary });
  }
  if (new Set(branches.map((branch) => branch.id)).size !== branches.length) return null;
  return { companyId, branches, asOf };
}

/** Stored binding only. Caller channel arrays are not accepted here. */
export function parseStoredChannelBinding(value: unknown): TrustedChannelBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== BINDING_KEYS.length || !keys.includes("channels") || !Array.isArray(row.channels)) return null;
  const channels = canonicalChannels(row.channels);
  if (!channels) return null;
  return { channels };
}

export function parseChannelSelectionReceipt(value: unknown): {
  receiptId: string;
  companyId: string;
  branchId: string;
  channels: PaidSetupChannel[];
  asOf: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== RECEIPT_KEYS.length || RECEIPT_KEYS.some((key) => !keys.includes(key))) return null;
  const receiptId = uuid(row.receiptId);
  const companyId = uuid(row.companyId);
  const branchId = uuid(row.branchId);
  const asOf = text(row.asOf);
  const channels = canonicalChannels(row.channels);
  if (!receiptId || !companyId || !branchId || !asOf || !isIsoTimestamp(asOf) || !channels) return null;
  return { receiptId, companyId, branchId, channels, asOf };
}

export type PaidBranchChannelProof = {
  channel: "whatsapp" | "instagram";
  companyId: string;
  branchId: string;
  verified: boolean;
  generation: number | null;
  revoked: boolean;
  stale: boolean;
};

/** Marks only an exact selected channel verified. Launch and the other steps stay as projected. */
export function mergePaidBranchChannelProof(read: PaidBranchSetupRead, proofs: readonly PaidBranchChannelProof[]): PaidBranchSetupRead {
  if (read.sourceStatus !== "ready" || !read.selectedBranchId || !read.selectedChannels?.length) return read;
  const steps = read.steps.map((item) => {
    const channel = item.id === "connect_whatsapp" ? "whatsapp" : item.id === "connect_instagram" ? "instagram" : null;
    if (!channel || !read.selectedChannels?.includes(channel)) return item;
    const proof = proofs.find((entry) => entry.channel === channel);
    const accepted = !!proof
      && proof.companyId === read.companyId
      && proof.branchId === read.selectedBranchId
      && proof.verified
      && !proof.revoked
      && !proof.stale
      && proof.generation != null
      && proof.generation >= 1;
    return accepted ? { ...item, status: "verified" as const, reasonCodes: [] } : item;
  });
  return {
    ...read,
    steps,
    progress: { ...read.progress, verified: steps.filter((item) => item.status === "verified").length },
  };
}

export function canonicalChannels(value: unknown): PaidSetupChannel[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if ((item !== "whatsapp" && item !== "instagram") || seen.has(item)) return null;
    seen.add(item);
  }
  const ordered = (["whatsapp", "instagram"] as const).filter((channel) => seen.has(channel));
  if (ordered.length !== value.length) return null;
  for (let index = 0; index < ordered.length; index += 1) {
    if (value[index] !== ordered[index]) return null;
  }
  return ordered;
}
