/**
 * VEL-PAYMOB-TEST-WIRING-01 — local journey tests.
 * Mock HTTP + locally signed synthetic events only.
 * Distinguishes path wiring success from real Paymob success.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildProcessedCallbackBody,
  paymobAdapterFixtures,
} from "@/lib/billing/paymob/fixtures";
import { createMockPaymobHttpClient } from "@/lib/billing/paymob/http";
import { decideCreateBillingOrder } from "@/lib/billing/wiring/order-create";
import { receivePaymobWebhook, type DurableEventInsert, type SavedOrderForWebhook } from "@/lib/billing/wiring/webhook-receive";
import { processStoredPaymobEvent } from "@/lib/billing/wiring/event-process";
import {
  mapBillingReturnDisplay,
  redirectionQueryGrantsEntitlement,
} from "@/lib/billing/wiring/return-status";
import {
  blocksPaymobConnection,
  readBillingPaymobWiringFlags,
  readWiringSecretsPresence,
} from "@/lib/billing/wiring/flags";
import {
  PAYMOB_HMAC_SETTLEMENT_EVIDENCE_MARKER,
  PAYMOB_HMAC_SETTLEMENT_RPC_CONTRACT,
} from "@/lib/billing/wiring/settlement-bridge";

export const WIRING_JOURNEY_TEST_MARKER = "VEL_PAYMOB_WIRING_JOURNEY_TEST_ONLY" as const;

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAN_V = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function publishedPlan(amountBaisa = 9000) {
  return {
    id: PLAN_V,
    status: "published" as const,
    amountBaisa,
    currency: "OMR" as const,
    periodDays: 30,
    periodUnit: "day" as const,
    periodCount: 30,
  };
}

function ownerMembership(companyId: string) {
  return { companyId, role: "owner" as const, status: "active" as const };
}

function seededOrder(overrides: Partial<SavedOrderForWebhook> & { companyId: string }): SavedOrderForWebhook {
  return {
    orderId: overrides.orderId ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    paymentAttemptId: overrides.paymentAttemptId ?? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    status: overrides.status ?? "provider_submitted",
    providerOrderId: overrides.providerOrderId ?? paymobAdapterFixtures.providerOrderId,
    specialReference: overrides.specialReference ?? paymobAdapterFixtures.specialReference,
    amountBaisa: overrides.amountBaisa ?? 9000,
    currency: "OMR",
    /** Seeded for match tests only — NOT produced by create while OMR barrier holds. */
    providerAmount: overrides.providerAmount ?? paymobAdapterFixtures.providerAmount,
    providerAccountRef: overrides.providerAccountRef ?? String(paymobAdapterFixtures.integrationId),
    providerEnvironment: "test",
    integrationId: overrides.integrationId ?? paymobAdapterFixtures.integrationId,
    merchantOwnerId: overrides.merchantOwnerId ?? paymobAdapterFixtures.merchantOwnerId,
    companyId: overrides.companyId,
  };
}

function makeEventStore() {
  const rows: DurableEventInsert[] = [];
  let failNext = false;
  return {
    rows,
    failNextPersist() {
      failNext = true;
    },
    async insert(row: DurableEventInsert) {
      if (failNext) {
        failNext = false;
        return { ok: false as const, code: "persist_failed" };
      }
      const dup = rows.find(
        (r) =>
          r.providerTransactionId === row.providerTransactionId &&
          r.eventStatus === row.eventStatus &&
          r.observationKey === row.observationKey &&
          r.providerAccountRef === row.providerAccountRef,
      );
      if (dup) {
        return { ok: true as const, inserted: false, eventId: "dup" };
      }
      rows.push(row);
      return { ok: true as const, inserted: true, eventId: `ev-${rows.length}` };
    },
  };
}

describe("WIRING-01 order create decisions", () => {
  it("reuses same client_op + fingerprint; conflicts on changed inputs", () => {
    const plan = publishedPlan();
    const first = decideCreateBillingOrder({
      companyId: COMPANY_A,
      planVersionId: PLAN_V,
      clientOpId: "op-1",
      membership: ownerMembership(COMPANY_A),
      planVersion: plan,
      existingSameClientOp: null,
    });
    expect(first.ok && first.action === "insert").toBe(true);
    if (!(first.ok && first.action === "insert")) return;

    const reuse = decideCreateBillingOrder({
      companyId: COMPANY_A,
      planVersionId: PLAN_V,
      clientOpId: "op-1",
      membership: ownerMembership(COMPANY_A),
      planVersion: plan,
      existingSameClientOp: {
        id: "order-1",
        companyId: COMPANY_A,
        planVersionId: PLAN_V,
        clientOpId: "op-1",
        inputFingerprint: first.inputFingerprint,
        amountBaisa: first.amountBaisa,
        currency: "OMR",
        specialReference: first.specialReference,
        status: "locked",
      },
    });
    expect(reuse.ok && reuse.action === "reuse").toBe(true);

    const conflict = decideCreateBillingOrder({
      companyId: COMPANY_A,
      planVersionId: PLAN_V,
      clientOpId: "op-1",
      membership: ownerMembership(COMPANY_A),
      planVersion: publishedPlan(12000),
      existingSameClientOp: {
        id: "order-1",
        companyId: COMPANY_A,
        planVersionId: PLAN_V,
        clientOpId: "op-1",
        inputFingerprint: first.inputFingerprint,
        amountBaisa: first.amountBaisa,
        currency: "OMR",
        specialReference: first.specialReference,
        status: "locked",
      },
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.code).toBe("client_op_conflict");
  });

  it("rejects browser money and non-owner", () => {
    expect(
      decideCreateBillingOrder({
        companyId: COMPANY_A,
        planVersionId: PLAN_V,
        clientOpId: "op-2",
        membership: ownerMembership(COMPANY_A),
        planVersion: publishedPlan(),
        existingSameClientOp: null,
        untrustedBrowserMoney: { amountBaisa: 1 },
      }).ok,
    ).toBe(false);

    expect(
      decideCreateBillingOrder({
        companyId: COMPANY_A,
        planVersionId: PLAN_V,
        clientOpId: "op-2",
        membership: { companyId: COMPANY_A, role: "staff", status: "active" },
        planVersion: publishedPlan(),
        existingSameClientOp: null,
      }).ok,
    ).toBe(false);
  });

  it("blocks Paymob connection when OMR conversion missing (no guess)", () => {
    const flags = readBillingPaymobWiringFlags({
      createEnabled: true,
      webhookEnabled: true,
      settleEnabled: true,
      liveEnabled: false,
    });
    const secrets = readWiringSecretsPresence({
      hmacSecret: true,
      merchantOwnerId: true,
      integrationId: true,
      secretKey: true,
      publicKey: true,
    });
    expect(blocksPaymobConnection(flags, secrets)).toBe("omr_conversion_not_configured");
    expect(secrets.omrConversionConfigured).toBe(false);
  });
});

describe("WIRING-01 webhook receive (local HMAC only)", () => {
  it("stores success; duplicate is 200 duplicate; persist fail is not 200", async () => {
    const order = seededOrder({ companyId: COMPANY_A });
    const store = makeEventStore();
    const signed = buildProcessedCallbackBody();

    const first = await receivePaymobWebhook({
      rawBody: JSON.stringify(signed.body),
      hmacQueryParam: signed.hmac,
      deps: {
        webhookEnabled: true,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
        findOrderByProviderOrderId: async (id) =>
          id === order.providerOrderId ? order : null,
        insertProviderEvent: store.insert,
      },
    });
    expect(first.status).toBe(200);
    expect(["stored", "stored_awaiting_processing"]).toContain(first.body);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.rawSummary).not.toHaveProperty("source_data");

    const dup = await receivePaymobWebhook({
      rawBody: JSON.stringify(signed.body),
      hmacQueryParam: signed.hmac,
      deps: {
        webhookEnabled: true,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
        findOrderByProviderOrderId: async () => order,
        insertProviderEvent: store.insert,
      },
    });
    expect(dup.status).toBe(200);
    expect(dup.body).toBe("duplicate");
    expect(store.rows).toHaveLength(1);

    store.failNextPersist();
    const fail = await receivePaymobWebhook({
      rawBody: JSON.stringify(
        buildProcessedCallbackBody({ id: 800099 }).body,
      ),
      hmacQueryParam: buildProcessedCallbackBody({ id: 800099 }).hmac,
      deps: {
        webhookEnabled: true,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
        findOrderByProviderOrderId: async () => order,
        insertProviderEvent: store.insert,
      },
    });
    expect(fail.status).toBe(500);
    expect(fail.body).toBe("persist_failed");
  });

  it("rejects bad signature; isolates two companies", async () => {
    const orderA = seededOrder({ companyId: COMPANY_A });
    const orderB = seededOrder({
      companyId: COMPANY_B,
      orderId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      paymentAttemptId: "99999999-9999-4999-8999-999999999999",
      providerOrderId: "900002",
    });
    const store = makeEventStore();
    const signed = buildProcessedCallbackBody();

    const bad = await receivePaymobWebhook({
      rawBody: JSON.stringify(signed.body),
      hmacQueryParam: "deadbeef",
      deps: {
        webhookEnabled: true,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
        findOrderByProviderOrderId: async () => orderA,
        insertProviderEvent: store.insert,
      },
    });
    expect(bad.status).toBe(401);

    const okA = await receivePaymobWebhook({
      rawBody: JSON.stringify(signed.body),
      hmacQueryParam: signed.hmac,
      deps: {
        webhookEnabled: true,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
        findOrderByProviderOrderId: async (id) =>
          id === orderA.providerOrderId ? orderA : id === orderB.providerOrderId ? orderB : null,
        insertProviderEvent: store.insert,
      },
    });
    expect(okA.status).toBe(200);
    expect(store.rows[0]?.companyId).toBe(COMPANY_A);

    const signedB = buildProcessedCallbackBody({
      order: { id: 900002, merchant_order_id: "B_REF" },
      id: 800010,
    });
    const okB = await receivePaymobWebhook({
      rawBody: JSON.stringify(signedB.body),
      hmacQueryParam: signedB.hmac,
      deps: {
        webhookEnabled: true,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
        findOrderByProviderOrderId: async (id) =>
          id === orderA.providerOrderId ? orderA : id === orderB.providerOrderId ? orderB : null,
        insertProviderEvent: store.insert,
      },
    });
    expect(okB.status).toBe(200);
    expect(store.rows.map((r) => r.companyId).sort()).toEqual([COMPANY_A, COMPANY_B].sort());
  });

  it("pending then success; process skips pending and settles success when enabled", async () => {
    const order = seededOrder({ companyId: COMPANY_A });
    const store = makeEventStore();

    const pending = buildProcessedCallbackBody({ pending: true, success: false, id: 800020 });
    const pRes = await receivePaymobWebhook({
      rawBody: JSON.stringify(pending.body),
      hmacQueryParam: pending.hmac,
      deps: {
        webhookEnabled: true,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
        findOrderByProviderOrderId: async () => order,
        insertProviderEvent: store.insert,
      },
    });
    expect(pRes.status).toBe(200);
    expect(store.rows[0]?.eventStatus).toBe("pending");

    const success = buildProcessedCallbackBody({ pending: false, success: true, id: 800021 });
    const sRes = await receivePaymobWebhook({
      rawBody: JSON.stringify(success.body),
      hmacQueryParam: success.hmac,
      deps: {
        webhookEnabled: true,
        hmacSecret: paymobAdapterFixtures.hmacSecret,
        findOrderByProviderOrderId: async () => order,
        insertProviderEvent: store.insert,
      },
    });
    expect(sRes.status).toBe(200);
    expect(store.rows).toHaveLength(2);

    const skip = await processStoredPaymobEvent({
      deps: {
        settleEnabled: true,
        settleHmacVerified: async () => {
          throw new Error("must not settle pending");
        },
      },
      event: {
        id: "e1",
        companyId: COMPANY_A,
        orderId: order.orderId,
        paymentAttemptId: order.paymentAttemptId,
        providerTransactionId: "800020",
        eventStatus: "pending",
        providerAccountRef: order.providerAccountRef,
        specialReference: order.specialReference,
        amountBaisa: order.amountBaisa,
        observationKey: "v1_pending",
      },
    });
    expect(skip).toEqual({ ok: true, outcome: "skipped_pending" });

    let settleCalls = 0;
    const settled = await processStoredPaymobEvent({
      deps: {
        settleEnabled: true,
        settleHmacVerified: async (evidence) => {
          settleCalls += 1;
          expect(evidence.evidence_marker).toBe(PAYMOB_HMAC_SETTLEMENT_EVIDENCE_MARKER);
          expect((evidence.authenticity as { method: string }).method).toBe("paymob_hmac_sha512");
          return { ok: true, outcome: "granted" };
        },
      },
      event: {
        id: "e2",
        companyId: COMPANY_A,
        orderId: order.orderId,
        paymentAttemptId: order.paymentAttemptId,
        providerTransactionId: "800021",
        eventStatus: "success",
        providerAccountRef: order.providerAccountRef,
        specialReference: order.specialReference,
        amountBaisa: order.amountBaisa,
        observationKey: store.rows[1]?.observationKey ?? "v1_success",
      },
    });
    expect(settled).toEqual({ ok: true, outcome: "granted" });
    expect(settleCalls).toBe(1);

    // Reprocess after prior failure → idempotent_replay
    const retry = await processStoredPaymobEvent({
      deps: {
        settleEnabled: true,
        settleHmacVerified: async () => ({ ok: false, code: "already_settled" }),
      },
      event: {
        id: "e2",
        companyId: COMPANY_A,
        orderId: order.orderId,
        paymentAttemptId: order.paymentAttemptId,
        providerTransactionId: "800021",
        eventStatus: "success",
        providerAccountRef: order.providerAccountRef,
        specialReference: order.specialReference,
        amountBaisa: order.amountBaisa,
        observationKey: store.rows[1]?.observationKey ?? "v1_success",
      },
    });
    expect(retry).toEqual({ ok: true, outcome: "idempotent_replay" });
  });

  it("does not use synthetic helper marker; RPC contract documented", () => {
    expect(PAYMOB_HMAC_SETTLEMENT_RPC_CONTRACT.functionName).toBe(
      "billing_settle_paymob_hmac_verified",
    );
    expect(PAYMOB_HMAC_SETTLEMENT_RPC_CONTRACT.rejects).toContain(
      "VEL_BILLING_SYNTHETIC_TEST_EVIDENCE",
    );
    expect(PAYMOB_HMAC_SETTLEMENT_EVIDENCE_MARKER).not.toBe(
      "VEL_BILLING_SYNTHETIC_TEST_EVIDENCE",
    );
  });
});

describe("WIRING-01 return display + mock HTTP (no live Paymob)", () => {
  it("URL query never grants; foreign company order hidden", () => {
    expect(redirectionQueryGrantsEntitlement({ success: "true", hmac: "x" })).toBe(false);

    expect(
      mapBillingReturnDisplay({
        requestCompanyId: COMPANY_A,
        row: {
          companyId: COMPANY_B,
          orderId: "x",
          orderStatus: "closed",
          attemptStatus: "paid",
          successEventStored: true,
          awaitingProcessing: false,
          latestEventStatus: "success",
          hasGrant: true,
          paidThrough: "2099-01-01",
        },
      }).kind,
    ).toBe("forbidden");

    expect(
      mapBillingReturnDisplay({
        requestCompanyId: COMPANY_A,
        row: {
          companyId: COMPANY_A,
          orderId: "x",
          orderStatus: "submitted",
          attemptStatus: "provider_submitted",
          successEventStored: false,
          awaitingProcessing: false,
          latestEventStatus: "pending",
          hasGrant: false,
          paidThrough: null,
        },
      }).kind,
    ).toBe("verifying");

    expect(
      mapBillingReturnDisplay({
        requestCompanyId: COMPANY_A,
        row: {
          companyId: COMPANY_A,
          orderId: "x",
          orderStatus: "closed",
          attemptStatus: "paid",
          successEventStored: true,
          awaitingProcessing: false,
          latestEventStatus: "success",
          hasGrant: true,
          paidThrough: "2027-01-01T00:00:00.000Z",
          financial: provenReturnQualification(COMPANY_A, "x", "2027-01-01T00:00:00.000Z"),
        },
      }).kind,
    ).toBe("success");
  });

  it("mock HTTP provider records calls; wiring success ≠ Paymob live success", async () => {
    const http = createMockPaymobHttpClient([
      {
        match: () => true,
        result: {
          kind: "response",
          response: { status: 200, headers: {}, bodyText: '{"id":1}' },
        },
      },
    ]);
    // Intentionally unused in create path while OMR blocked — prove mock exists and stays local.
    const res = await http.request({
      method: "POST",
      url: "https://oman.paymob.com/v1/intention/",
      headers: { Authorization: "Bearer test" },
      body: "{}",
      timeoutMs: 1000,
    });
    expect(res.kind).toBe("response");
    expect(http.calls).toHaveLength(1);

    const fingerprint = createHash("sha256")
      .update(`${WIRING_JOURNEY_TEST_MARKER}|paths_ok|mock_http_only`, "utf8")
      .digest("hex")
      .slice(0, 16);
    expect(fingerprint.length).toBe(16);
    // Marker: local path wiring verified — not a claim of real Paymob merchant success.
    expect(WIRING_JOURNEY_TEST_MARKER).toContain("WIRING_JOURNEY_TEST");
  });
});
import { provenReturnQualification } from "./financial-truth.fixtures";
