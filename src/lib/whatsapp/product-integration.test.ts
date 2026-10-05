import { describe, expect, it } from "vitest";
import { answerIsolationKey } from "@/lib/answers/isolation";
import { entitlementAllowsAutomation, readCompanyEntitlement } from "@/lib/billing/entitlement";
import { pickWorkspaceMembership } from "@/lib/tenancy/access";
import { lookupWhatsappAccessSecret, whatsappSecretBackend, WHATSAPP_SECRET_BACKEND_CANDIDATE } from "@/lib/whatsapp/access-secrets";
import {
  applyEmbeddedSignupWindowEvent,
  createEmbeddedSignupAttempt,
  embeddedSignupEnabled,
  embeddedSignupPersistReady,
  persistEmbeddedSignupAttempt,
} from "@/lib/whatsapp/embedded-signup";
import { inboundWorkerPlan, runInboundWorkerAnswer } from "@/lib/whatsapp/inbound-worker";
import { decideClaimedTenantSend } from "@/lib/whatsapp/send-attempt";
import { isPreGraphSendFailure, sendFinalizeKind } from "@/lib/whatsapp/send-failure";
import type { WhatsappTenantResolveOk } from "@/lib/whatsapp/tenant-resolve";

const conversation = { companyId: "co-a", phoneNumberId: "phone-a", customerWaId: "96890000000" };

function verified(generation = 1): WhatsappTenantResolveOk {
  return {
    ok: true,
    eligible: true,
    companyId: "co-a",
    linkId: "link-1",
    linkGeneration: generation,
    providerPhoneNumberId: "phone-a",
    status: "verified",
  };
}

describe("pre-graph vs unknown finalize", () => {
  it("records setup and binding failures as rejected, not unknown", () => {
    expect(isPreGraphSendFailure("NEEDS_SETUP")).toBe(true);
    expect(sendFinalizeKind("NEEDS_SETUP")).toBe("rejected");
    expect(sendFinalizeKind("LINK_CHANGED")).toBe("rejected");
    expect(sendFinalizeKind("unavailable")).toBe("rejected");
    expect(sendFinalizeKind("GRAPH_TIMEOUT")).toBe("unknown");
  });
});

describe("access secrets contract", () => {
  it("returns NEEDS_SETUP without reading another company token", () => {
    expect(whatsappSecretBackend()).toBe("unconfigured");
    expect(WHATSAPP_SECRET_BACKEND_CANDIDATE).toBe("supabase_vault");
    expect(lookupWhatsappAccessSecret({
      companyId: "co-a",
      providerPhoneNumberId: "phone-a",
      linkId: "link-1",
      linkGeneration: 1,
    })).toEqual({ ok: false, code: "NEEDS_SETUP" });
    expect(lookupWhatsappAccessSecret({
      companyId: "",
      providerPhoneNumberId: "phone-a",
      linkId: "link-1",
      linkGeneration: 1,
    })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("claimed tenant send path", () => {
  it("rejects when intent generation no longer matches the verified link", () => {
    const decision = decideClaimedTenantSend({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      recipientWaId: conversation.customerWaId,
      conversation,
      resolved: verified(2),
      intentLinkId: "link-1",
      intentLinkGeneration: 1,
    });
    expect(decision).toEqual({ action: "rejected", code: "link_changed" });
    expect(sendFinalizeKind(decision.action === "rejected" ? decision.code : "")).toBe("rejected");
  });

  it("does not Graph-send when secrets are unconfigured", () => {
    const decision = decideClaimedTenantSend({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      recipientWaId: conversation.customerWaId,
      conversation,
      resolved: verified(1),
      intentLinkId: "link-1",
      intentLinkGeneration: 1,
    });
    expect(decision).toEqual({ action: "rejected", code: "NEEDS_SETUP" });
  });

  it("marks resolver unavailable before Graph as rejected, not unknown", () => {
    const decision = decideClaimedTenantSend({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      recipientWaId: conversation.customerWaId,
      conversation,
      resolved: { ok: false, eligible: false, code: "unavailable" },
      intentLinkId: "link-1",
      intentLinkGeneration: 1,
    });
    expect(decision).toEqual({ action: "rejected", code: "unavailable" });
    if (decision.action !== "graph") {
      expect(sendFinalizeKind(decision.code)).toBe("rejected");
    }
  });
});

describe("workspace picker", () => {
  it("does not auto-pick the first of several memberships", () => {
    const rows = [{ company_id: "co-a" }, { company_id: "co-b" }];
    expect(pickWorkspaceMembership(rows, null)).toEqual({ ok: false, needsContext: true });
    expect(pickWorkspaceMembership(rows, "co-b")).toEqual({ ok: true, membership: rows[1] });
    expect(pickWorkspaceMembership([{ company_id: "co-a" }], null)).toEqual({
      ok: true,
      membership: { company_id: "co-a" },
    });
  });
});

describe("embedded signup contract", () => {
  it("stays disabled without env and never verifies from a window event", () => {
    expect(embeddedSignupEnabled()).toBe(false);
    expect(createEmbeddedSignupAttempt({ companyId: "co-a", userId: "u1", keepOnPhone: true })).toEqual({
      ok: false,
      code: "NEEDS_SETUP",
    });
    expect(persistEmbeddedSignupAttempt()).toEqual({ ok: false, code: "NEEDS_SETUP" });
    expect(embeddedSignupPersistReady()).toBe(false);
    const applied = applyEmbeddedSignupWindowEvent({
      attempt: {
        id: "es_1",
        companyId: "co-a",
        userId: "u1",
        nonce: "n",
        keepOnPhone: true,
        status: "in_progress",
        createdAt: "2026-10-06T00:00:00.000Z",
        consumedAt: null,
      },
      actorUserId: "u1",
      companyId: "co-a",
      event: "CODE",
      phoneNumberId: "phone-from-window",
      wabaId: "waba-from-window",
      code: "oauth-code",
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.verified).toBe(false);
      expect(applied.status).toBe("code_received");
      expect(applied.attempt.consumedAt).toBeTruthy();
    }
    const reuse = applyEmbeddedSignupWindowEvent({
      attempt: applied.ok ? applied.attempt : {
        id: "es_1",
        companyId: "co-a",
        userId: "u1",
        nonce: "n",
        keepOnPhone: true,
        status: "code_received",
        createdAt: "2026-10-06T00:00:00.000Z",
        consumedAt: "2026-10-06T00:00:00.000Z",
      },
      actorUserId: "u1",
      companyId: "co-a",
      event: "CODE",
    });
    expect(reuse).toMatchObject({ ok: false, code: "CONSUMED" });
  });
});

describe("entitlement and worker", () => {
  it("keeps automation off while entitlement is not configured", async () => {
    const snap = readCompanyEntitlement("co-a");
    expect(snap.status).toBe("not_configured");
    expect(snap.paid).toBe(false);
    expect(entitlementAllowsAutomation(snap)).toBe(false);
    expect(inboundWorkerPlan()).toEqual({
      scheduled: false,
      steps: ["claim", "answer", "recheck", "intent", "send", "record"],
    });
    await expect(runInboundWorkerAnswer({
      jobId: "job-1",
      claimToken: "tok",
      companyId: "co-a",
    })).resolves.toEqual({
      ok: false,
      code: "ENTITLEMENT_NOT_CONFIGURED",
      jobCompleted: false,
      sendAccepted: false,
      delivered: false,
    });
  });
});

describe("answer isolation", () => {
  it("keys context by company, phone, and conversation", () => {
    expect(answerIsolationKey({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      conversationId: "conv-1",
    })).toBe("co-a:phone-a:conv-1");
    expect(answerIsolationKey({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      conversationId: "conv-2",
    })).not.toBe("co-a:phone-a:conv-1");
    expect(answerIsolationKey({ companyId: "", phoneNumberId: "p", conversationId: "c" })).toBeNull();
  });
});

describe("pending live approvals stay unset", () => {
  it("does not activate vault, payment, or an answer provider", async () => {
    const { PENDING_DECISIONS } = await import("@/lib/ops/pending-decisions");
    const { answerRuntimeSetup } = await import("@/lib/answers/runtime-setup");
    expect(PENDING_DECISIONS.secretBackend.active).toBe("unconfigured");
    expect(PENDING_DECISIONS.paymentProvider.active).toBe("none");
    expect(PENDING_DECISIONS.answerRuntime.active).toBe("none");
    expect(PENDING_DECISIONS.embeddedSignup.liveOauth).toBe(false);
    expect(PENDING_DECISIONS.metaAiIntegrationReady).toBe(true);
    expect(PENDING_DECISIONS.liveMetaAi).toBe(false);
    expect(answerRuntimeSetup()).toEqual({
      ok: false,
      code: "NEEDS_SETUP",
      provider: null,
      model: null,
      budget: null,
    });
  });
});
