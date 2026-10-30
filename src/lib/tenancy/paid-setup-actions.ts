"use server";

import { randomUUID } from "node:crypto";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { parsePaidBranchConnectionRead } from "@/lib/tenancy/paid-branch-connection-contracts";
import {
  paidSetupEntryUnavailable,
  paidSetupUnavailable,
  parseChannelSelectionReceipt,
  parsePaidSetupEntry,
  parsePaidSlotFacts,
  parseStoredChannelBinding,
  mergePaidBranchChannelProof,
  projectSelectionRequired,
  projectTrustedBoundSelection,
  type PaidBranchChannelSelectionResult,
  type PaidBranchSetupEntryRead,
  type PaidBranchSetupRead,
  type ReadOwnedPaidBranchSetupEntryInput,
  type SelectOwnedPaidBranchChannelsInput,
} from "@/lib/tenancy/paid-setup-contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReadOwnedPaidBranchSetupInput = {
  expectedAccountId: string;
  companyId: string;
  branchId: string;
};

/**
 * Read one owned paid branch. selectedChannels, readiness, and completion are not inputs.
 * No persisted channel binding exists in B1, so a successful authority read is selection_required.
 */
export async function readOwnedPaidBranchSetupAction(input: ReadOwnedPaidBranchSetupInput): Promise<PaidBranchSetupRead> {
  return readPaidBranchSetup(input, true);
}

/** Paid branch authority and navigation only. Never supplies channel/launch proof. */
export async function readOwnedPaidBranchSetupShellAction(input: ReadOwnedPaidBranchSetupInput): Promise<PaidBranchSetupRead> {
  return readPaidBranchSetup(input, false);
}

async function readPaidBranchSetup(input: ReadOwnedPaidBranchSetupInput, includeConnections: boolean): Promise<PaidBranchSetupRead> {
  const requestId = randomUUID();
  const asOf = new Date().toISOString();
  const companyId = uuid(input?.companyId);
  const branchId = uuid(input?.branchId);
  const expectedAccountId = uuid(input?.expectedAccountId);
  return withLogContext({ request_id: requestId, user_id: expectedAccountId ?? undefined }, async () => {
    if (!expectedAccountId || !companyId || !branchId) {
      logFailure("INVALID_INPUT", requestId);
      return paidSetupUnavailable({ companyId: companyId ?? undefined, branchId: branchId ?? undefined, asOf, blockedReasons: ["invalid_input"] });
    }
    try {
      const identity = await readSessionIdentity();
      if (!identity.ok || identity.userId !== expectedAccountId) {
        logFailure(identity.ok ? "ACCOUNT_MISMATCH" : identity.code, requestId);
        return paidSetupUnavailable({
          companyId,
          branchId,
          asOf,
          blockedReasons: [identity.ok ? "account_mismatch" : identity.code.toLowerCase()],
        });
      }
      const client = await createClient();
      const observation = await client.rpc("es02_read_owned_branch_setup_binding" as never, {
        p_expected_account_id: expectedAccountId,
        p_company_id: companyId,
        p_branch_id: branchId,
      } as never);
      if (observation.error) {
        logFailure("SOURCE_FAILED", requestId);
        return paidSetupUnavailable({ companyId, branchId, asOf, blockedReasons: ["source_failed"] });
      }
      const row = observation.data as { ok?: boolean; code?: string; data?: unknown; binding?: unknown } | null;
      if (!row || row.ok !== true || (row.code !== "SELECTION_REQUIRED" && row.code !== "BOUND")) {
        logFailure(row?.code || "UNAVAILABLE", requestId);
        return paidSetupUnavailable({
          companyId,
          branchId,
          asOf,
          blockedReasons: [sqlReason(row?.code)],
        });
      }
      const facts = parsePaidSlotFacts(row.data);
      if (!facts || facts.companyId !== companyId || facts.branchId !== branchId) {
        logFailure("TAMPERED_ROW", requestId);
        return paidSetupUnavailable({ companyId, branchId, asOf, blockedReasons: ["tampered_row"] });
      }
      if (row.code === "SELECTION_REQUIRED") {
        if (row.binding != null) {
          logFailure("TAMPERED_ROW", requestId);
          return paidSetupUnavailable({ companyId, branchId, asOf, blockedReasons: ["tampered_row"] });
        }
        return projectSelectionRequired(facts);
      }
      const binding = parseStoredChannelBinding(row.binding);
      if (!binding) {
        logFailure("TAMPERED_ROW", requestId);
        return paidSetupUnavailable({ companyId, branchId, asOf, blockedReasons: ["tampered_row"] });
      }
      const projected = projectTrustedBoundSelection(facts, binding);
      if (!includeConnections) return projected;
      const proofs = [];
      const channels = projected.selectedChannels ?? [];
      const connections = await Promise.all(channels.map(channel => client.rpc("es02_b3_read_owned_branch_connection" as never, {
          p_expected_account_id: expectedAccountId,
          p_company_id: companyId,
          p_branch_id: branchId,
          p_channel: channel,
        } as never)));
      for (const [index, channel] of channels.entries()) {
        const connection = connections[index];
        if (connection.error) {
          logFailure("SOURCE_FAILED", requestId);
          return paidSetupUnavailable({ companyId, branchId, asOf, blockedReasons: ["source_failed"] });
        }
        const parsed = parsePaidBranchConnectionRead(connection.data, {
          expectedAccountId,
          companyId,
          branchId,
          channel,
        });
        if (!parsed || parsed.sourceStatus !== "ready") {
          logFailure("SOURCE_FAILED", requestId);
          return paidSetupUnavailable({ companyId, branchId, asOf, blockedReasons: ["source_failed"] });
        }
        proofs.push({
          channel,
          companyId,
          branchId,
          verified: parsed.connection.state === "connected" && parsed.connection.verified && parsed.connection.link != null,
          generation: parsed.connection.link?.generation ?? null,
          revoked: false,
          stale: parsed.connection.reasonCodes.includes("stale_scope"),
        });
      }
      return mergePaidBranchChannelProof(projected, proofs);
    } catch {
      logFailure("SOURCE_FAILED", requestId);
      return paidSetupUnavailable({ companyId, branchId, asOf, blockedReasons: ["source_failed"] });
    }
  });
}

function logFailure(code: string, requestId: string) {
  logEvent("warn", "es02.paid_setup.read_failed", {
    request_id: requestId,
    operation: "read_owned_branch_setup",
    error_code: code,
    stage: "b1",
  });
}

function sqlReason(code: string | undefined): string {
  switch (code) {
    case "UNAUTHENTICATED":
      return "unauthenticated";
    case "FOOTPRINT_MISSING":
      return "footprint_missing";
    case "FORBIDDEN":
      return "forbidden";
    case "SUSPENDED":
      return "suspended";
    case "UNPAID":
      return "unpaid";
    case "NOT_PROVISIONED":
      return "not_provisioned";
    case "NOT_OWNED":
      return "not_owned";
    case "AMBIGUOUS":
      return "ambiguous";
    case "INCONSISTENT":
      return "inconsistent";
    case "INVALID_INPUT":
      return "invalid_input";
    case "CHANNEL_CONNECTED":
      return "channel_connected";
    case "LEGACY_CHANNEL_UNSCOPED":
      return "legacy_channel_unscoped";
    case "ALREADY_SELECTED":
      return "already_selected";
    case "CONFLICT":
      return "conflict";
    case "ENTITLEMENT_EXCEEDED":
      return "entitlement_exceeded";
    default:
      return "unavailable";
  }
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

export type { ReadOwnedPaidBranchSetupEntryInput, SelectOwnedPaidBranchChannelsInput };

/**
 * Inventory of owned paid branches. Does not choose a branch or grant readiness.
 * branches, paid flags, and selected channels are not inputs.
 */
export async function readOwnedPaidBranchSetupEntryAction(input: ReadOwnedPaidBranchSetupEntryInput): Promise<PaidBranchSetupEntryRead> {
  const requestId = randomUUID();
  const asOf = new Date().toISOString();
  const companyId = uuid(input?.companyId);
  const expectedAccountId = uuid(input?.expectedAccountId);
  return withLogContext({ request_id: requestId, user_id: expectedAccountId ?? undefined }, async () => {
    if (!expectedAccountId || !companyId) {
      logEntryFailure("INVALID_INPUT", requestId);
      return paidSetupEntryUnavailable({ companyId: companyId ?? undefined, asOf, reasonCodes: ["invalid_input"] });
    }
    try {
      const identity = await readSessionIdentity();
      if (!identity.ok || identity.userId !== expectedAccountId) {
        logEntryFailure(identity.ok ? "ACCOUNT_MISMATCH" : identity.code, requestId);
        return paidSetupEntryUnavailable({
          companyId,
          asOf,
          reasonCodes: [identity.ok ? "account_mismatch" : identity.code.toLowerCase()],
        });
      }
      const client = await createClient();
      const observation = await client.rpc("es02_list_owned_paid_setup_branches" as never, {
        p_expected_account_id: expectedAccountId,
        p_company_id: companyId,
      } as never);
      if (observation.error) {
        logEntryFailure("SOURCE_FAILED", requestId);
        return paidSetupEntryUnavailable({ companyId, asOf, reasonCodes: ["source_failed"] });
      }
      const row = observation.data as { ok?: boolean; code?: string; data?: unknown } | null;
      if (!row || row.ok !== true || row.code !== "SELECTION_REQUIRED") {
        logEntryFailure(row?.code || "UNAVAILABLE", requestId);
        return paidSetupEntryUnavailable({ companyId, asOf, reasonCodes: [sqlReason(row?.code)] });
      }
      const entry = parsePaidSetupEntry(row.data);
      if (!entry || entry.companyId !== companyId) {
        logEntryFailure("TAMPERED_ROW", requestId);
        return paidSetupEntryUnavailable({ companyId, asOf, reasonCodes: ["tampered_row"] });
      }
      return {
        schemaVersion: 1,
        sourceStatus: "selection_required",
        companyId: entry.companyId,
        selectedBranchId: null,
        branches: entry.branches,
        asOf: entry.asOf,
        reasonCodes: entry.branches.length === 0 ? ["empty_inventory"] : [],
      };
    } catch {
      logEntryFailure("SOURCE_FAILED", requestId);
      return paidSetupEntryUnavailable({ companyId, asOf, reasonCodes: ["source_failed"] });
    }
  });
}

/**
 * Initial channel binding for one paid branch. A stored binding is not edited.
 * Order, entitlement, completion, provider, and clock fields are not inputs.
 */
export async function selectOwnedPaidBranchChannelsAction(input: SelectOwnedPaidBranchChannelsInput): Promise<PaidBranchChannelSelectionResult> {
  const requestId = randomUUID();
  const companyId = uuid(input?.companyId);
  const branchId = uuid(input?.branchId);
  const expectedAccountId = uuid(input?.expectedAccountId);
  const clientOpId = uuid(input?.clientOpId);
  const denied = (code: string): PaidBranchChannelSelectionResult => ({
    ok: false,
    code,
    companyId: companyId ?? "",
    branchId: branchId ?? "",
  });
  return withLogContext({ request_id: requestId, user_id: expectedAccountId ?? undefined }, async () => {
    if (!expectedAccountId || !companyId || !branchId || !clientOpId || !Array.isArray(input?.channels) || input.channels.some((channel) => typeof channel !== "string")) {
      logSelectionFailure("INVALID_INPUT", requestId);
      return denied("invalid_input");
    }
    try {
      const identity = await readSessionIdentity();
      if (!identity.ok || identity.userId !== expectedAccountId) {
        logSelectionFailure(identity.ok ? "ACCOUNT_MISMATCH" : identity.code, requestId);
        return denied(identity.ok ? "account_mismatch" : identity.code.toLowerCase());
      }
      const client = await createClient();
      const observation = await client.rpc("es02_select_owned_branch_channels" as never, {
        p_expected_account_id: expectedAccountId,
        p_company_id: companyId,
        p_branch_id: branchId,
        p_client_op_id: clientOpId,
        p_channels: input.channels,
      } as never);
      if (observation.error) {
        logSelectionFailure("SOURCE_FAILED", requestId);
        return denied("source_failed");
      }
      const row = observation.data as { ok?: boolean; code?: string; data?: unknown } | null;
      if (!row || (row.ok === true && row.code !== "SELECTED" && row.code !== "DUPLICATE") || (row.ok !== true && row.ok !== false)) {
        logSelectionFailure(row?.code || "UNAVAILABLE", requestId);
        return denied(sqlReason(row?.code));
      }
      if (row.ok !== true) {
        logSelectionFailure(row.code || "UNAVAILABLE", requestId);
        return denied(sqlReason(row.code));
      }
      const receipt = parseChannelSelectionReceipt(row.data);
      if (!receipt || receipt.companyId !== companyId || receipt.branchId !== branchId) {
        logSelectionFailure("TAMPERED_ROW", requestId);
        return denied("tampered_row");
      }
      return {
        ok: true,
        code: row.code === "DUPLICATE" ? "duplicate" : "selected",
        receiptId: receipt.receiptId,
        companyId: receipt.companyId,
        branchId: receipt.branchId,
        channels: receipt.channels,
        asOf: receipt.asOf,
      };
    } catch {
      logSelectionFailure("SOURCE_FAILED", requestId);
      return denied("source_failed");
    }
  });
}

function logEntryFailure(code: string, requestId: string) {
  logEvent("warn", "es02.paid_setup.entry_failed", {
    request_id: requestId,
    operation: "list_owned_paid_setup_branches",
    error_code: code,
    stage: "b2",
  });
}

function logSelectionFailure(code: string, requestId: string) {
  logEvent("warn", "es02.paid_setup.selection_failed", {
    request_id: requestId,
    operation: "select_owned_branch_channels",
    error_code: code,
    stage: "b2",
  });
}
