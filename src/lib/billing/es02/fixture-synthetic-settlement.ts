/**
 * Fixture-only synthetic settlement — owned local loopback harness.
 * Not a customer server action path. Not Production authority.
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { es02Uuid, type Es02AccountOrderView, type Es02Result } from "./contracts";
import { parseAccountOrderRow } from "./account-order";
import {
  buildSyntheticSettlementEvidence,
  evaluateSyntheticSettlementGate,
} from "./synthetic-settlement";
import { classifySettleWriteAck } from "./write-ack";

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

/**
 * Settle an account order inside an owned local fixture only.
 * Gate checks owned postgres c1_ui_integration URL + ACTUAL admin transport
 * (NEXT_PUBLIC_SUPABASE_URL) before constructing a client.
 * SQL still requires velora.es02_fixture=on on the service-role session.
 */
export async function settleAccountOrderSyntheticFixture(input: {
  expectedAccountId: string;
  orderId: string;
  paymentAttemptId: string;
  specialReference: string;
  amountBaisa: number;
  providerTransactionId: string;
}): Promise<Es02Result<{ order: Es02AccountOrderView; action: "settled" | "duplicate" }>> {
  const gate = evaluateSyntheticSettlementGate();
  if (!gate.allowed) return { ok: false, code: "SYNTHETIC_DISABLED" };
  if (!es02Uuid(input.expectedAccountId)) return { ok: false, code: "INVALID_INPUT" };

  const evidence = buildSyntheticSettlementEvidence({
    accountId: input.expectedAccountId,
    orderId: input.orderId,
    paymentAttemptId: input.paymentAttemptId,
    specialReference: input.specialReference,
    amountBaisa: input.amountBaisa,
    providerTransactionId: input.providerTransactionId,
  });
  if (!evidence.ok) return evidence;

  // Construct admin client only after transport+DB gate passed.
  const admin = createAdminClient() as unknown as RpcClient | null;
  if (!admin) return { ok: false, code: "SYNTHETIC_DISABLED" };

  try {
    const { data, error } = await admin.rpc("es02_settle_account_order_synthetic", {
      p_evidence: evidence.data,
    });
    if (error) return { ok: false, code: "UNKNOWN" };
    const ack = classifySettleWriteAck(data);
    if (ack.status === "unknown") return { ok: false, code: "UNKNOWN" };
    if (ack.status === "denied") return { ok: false, code: ack.code };
    const order = parseAccountOrderRow(ack.data, input.expectedAccountId);
    if (!order) return { ok: false, code: "UNKNOWN" };
    return {
      ok: true,
      data: { order, action: ack.action },
    };
  } catch {
    return { ok: false, code: "UNKNOWN" };
  }
}
