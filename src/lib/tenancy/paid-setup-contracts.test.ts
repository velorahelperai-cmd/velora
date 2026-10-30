import { describe, expect, it } from "vitest";
import {
  canonicalChannels,
  parsePaidSetupEntry,
  parsePaidSlotFacts,
  parseStoredChannelBinding,
  projectSelectionRequired,
  projectTrustedBoundSelection,
  type PaidSlotFacts,
} from "./paid-setup-contracts";

const facts: PaidSlotFacts = {
  companyId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  branchLabel: "Main",
  orderGroupId: "33333333-3333-4333-8333-333333333333",
  slotIndex: 0,
  persona: "level_3",
  package: "basic",
  term: "monthly",
  maxChannels: 1,
  employeesExcludingOwner: 2,
  clockState: "waiting_readiness",
  asOf: "2026-10-20T00:00:00.000Z",
};

const premium: PaidSlotFacts = { ...facts, package: "premium", maxChannels: 2, employeesExcludingOwner: 4 };

describe("paid slot parser", () => {
  it("accepts a strict catalog-matching row", () => {
    expect(parsePaidSlotFacts(facts)).toEqual(facts);
  });

  it("rejects unknown, missing, and tampered keys", () => {
    expect(parsePaidSlotFacts({ ...facts, extra: true })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, selectedChannels: ["whatsapp"] })).toBeNull();
    const { clockState: _clock, ...missing } = facts;
    expect(parsePaidSlotFacts(missing)).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, persona: "noura" })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, maxChannels: 2 })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, maxChannels: null })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, employeesExcludingOwner: null })).toBeNull();
    expect(parsePaidSlotFacts({ ...premium, maxChannels: null, employeesExcludingOwner: null })).toBeNull();
    expect(parsePaidSlotFacts({ ...premium, employeesExcludingOwner: 2 })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, slotIndex: 1.5 })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, slotIndex: 32 })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, slotIndex: 31 })?.slotIndex).toBe(31);
    expect(parsePaidSlotFacts({ ...facts, clockState: "started" })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, clockState: "active" })?.clockState).toBe("active");
    expect(parsePaidSlotFacts({ ...facts, asOf: "2026-10-20" })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, asOf: "2026-10-20T01:00:00.123456+00:00" })?.asOf).toBe("2026-10-20T01:00:00.123456+00:00");
  });

  it("does not treat persona as a channel or package grant", () => {
    expect(parsePaidSlotFacts({ ...facts, persona: "level_1", maxChannels: 2, package: "basic" })).toBeNull();
    expect(parsePaidSlotFacts({ ...facts, persona: "level_3" })?.maxChannels).toBe(1);
  });
});

describe("runtime projection without a persisted channel", () => {
  it("returns selection_required and invents no channel steps", () => {
    const read = projectSelectionRequired(facts);
    expect(read.sourceStatus).toBe("selection_required");
    expect(read.selectedChannels).toBeNull();
    expect(read.steps).toEqual([]);
    expect(read.progress).toEqual({ denominator: null, verified: 0, skippedOptional: 0 });
    expect(read.launch).toEqual({
      confirmationRequired: true,
      confirmed: false,
      canRequest: false,
      blockedReasons: ["selection_required"],
    });
    expect(read.entitlement).toEqual({
      orderGroupId: facts.orderGroupId,
      slotIndex: 0,
      persona: "level_3",
      package: "basic",
      maxChannels: 1,
      employeesExcludingOwner: 2,
    });
    expect(JSON.stringify(read)).not.toContain("whatsapp");
  });
});

describe("future trusted binding shape", () => {
  it("projects one entitled channel as six steps and both as seven with invitations", () => {
    const whatsapp = projectTrustedBoundSelection(facts, { channels: ["whatsapp"], invitationSkipped: true });
    const instagram = projectTrustedBoundSelection(facts, { channels: ["instagram"], invitationSkipped: true });
    const both = projectTrustedBoundSelection(premium, { channels: ["instagram", "whatsapp"], invitationSkipped: true });
    expect(whatsapp.steps.map((step) => step.id)).toEqual([
      "connect_whatsapp", "hours", "knowledge", "assistant_test", "invitations", "launch",
    ]);
    expect(instagram.steps.map((step) => step.id)).toEqual([
      "connect_instagram", "hours", "knowledge", "assistant_test", "invitations", "launch",
    ]);
    expect(both.steps.map((step) => step.id)).toEqual([
      "connect_whatsapp", "connect_instagram", "hours", "knowledge", "assistant_test", "invitations", "launch",
    ]);
    expect(whatsapp.steps).toHaveLength(6);
    expect(both.steps).toHaveLength(7);
    expect(whatsapp.selectedChannels).toEqual(["whatsapp"]);
    expect(both.selectedChannels).toEqual(["whatsapp", "instagram"]);
  });

  it("keeps a dynamic denominator and a distinct skipped invitation", () => {
    const skipped = projectTrustedBoundSelection(facts, { channels: ["whatsapp"], invitationSkipped: true });
    const open = projectTrustedBoundSelection(premium, { channels: ["whatsapp", "instagram"] });
    expect(skipped.progress).toEqual({ denominator: 6, verified: 0, skippedOptional: 1 });
    expect(skipped.steps.find((step) => step.id === "invitations")).toMatchObject({
      required: false,
      status: "skipped_optional",
      reasonCodes: ["invitation_skipped"],
    });
    expect(open.progress).toEqual({ denominator: 7, verified: 0, skippedOptional: 0 });
    expect(open.steps.find((step) => step.id === "invitations")?.status).toBe("pending");
    expect(skipped.steps.find((step) => step.id === "assistant_test")?.dependencyIds).toEqual(["knowledge"]);
    expect(skipped.steps.every((step) => step.status !== "verified")).toBe(true);
    expect(skipped.launch.canRequest).toBe(false);
    expect(skipped.launch.confirmed).toBe(false);
    expect(skipped.steps.find((step) => step.id === "launch")?.status).toBe("blocked");
  });

  it("fails closed when the binding exceeds the paid channel count", () => {
    const read = projectTrustedBoundSelection(facts, { channels: ["whatsapp", "instagram"] });
    expect(read.sourceStatus).toBe("unavailable");
    expect(read.selectedChannels).toBeNull();
    expect(read.steps).toEqual([]);
    expect(read.launch.blockedReasons).toEqual(["entitlement_exceeded"]);
  });
});

describe("paid branch entry inventory", () => {
  const entry = {
    companyId: facts.companyId,
    branches: [
      { id: facts.branchId, label: "Main", isPrimary: true },
      { id: "55555555-5555-4555-8555-555555555555", label: "Second", isPrimary: false },
    ],
    asOf: facts.asOf,
  };

  it("accepts a strict branch list and rejects tampered or duplicate rows", () => {
    expect(parsePaidSetupEntry(entry)).toEqual(entry);
    expect(parsePaidSetupEntry({ ...entry, branches: [] })?.branches).toEqual([]);
    expect(parsePaidSetupEntry({ ...entry, selectedBranchId: entry.branches[0].id })).toBeNull();
    expect(parsePaidSetupEntry({ ...entry, branches: [entry.branches[0], entry.branches[0]] })).toBeNull();
    expect(parsePaidSetupEntry({ ...entry, branches: [{ ...entry.branches[0], paid: true }] })).toBeNull();
    expect(parsePaidSetupEntry({ ...entry, companyId: "company" })).toBeNull();
  });

  it("accepts only a canonical stored channel binding", () => {
    expect(parseStoredChannelBinding({ channels: ["whatsapp"] })).toEqual({ channels: ["whatsapp"] });
    expect(parseStoredChannelBinding({ channels: ["whatsapp", "instagram"] })).toEqual({ channels: ["whatsapp", "instagram"] });
    expect(parseStoredChannelBinding({ channels: ["instagram", "whatsapp"] })).toBeNull();
    expect(canonicalChannels(["whatsapp", "whatsapp"])).toBeNull();
    expect(canonicalChannels(["sms"])).toBeNull();
    expect(parseStoredChannelBinding({ channels: ["instagram"], invitationSkipped: true })).toBeNull();
  });
});
