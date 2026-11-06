import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../../supabase/migrations/20261106191500_es02_paid_commercial_read_alignment.sql", import.meta.url),
  "utf8",
);

describe("ES02 paid commercial read alignment migration", () => {
  it("adds a company-parameterized ES02 live paid-through helper without planting rows or tenant IDs", () => {
    expect(migration).toContain("private.billing_es02_live_paid_through(cid uuid)");
    expect(migration).toContain("where company_id = cid");
    expect(migration).toContain("plan_version_id is not null");
    expect(migration).not.toMatch(/insert into public\.billing_subscriptions/i);
    expect(migration).not.toMatch(/insert into private\.billing_proven_entitlement_grants/i);
    // Shared path for every ES02-paid company — never a single-tenant patch.
    expect(migration).not.toMatch(/40d2d885|7c5e429d|TAG\s*CITY|tag.?city/i);
  });

  it("repairs billing_chat_send, billing_chat_policy and display evidence for the null plan_version ES02 ledger", () => {
    expect(migration).toContain("ES02_PAID_COMMERCIAL_SEND");
    expect(migration).toContain("ES02_PAID_COMMERCIAL_POLICY");
    expect(migration).toContain("private.billing_chat_policy(cid uuid, channel text)");
    expect(migration).toContain("private.billing_es02_live_paid_through(cid) is not null");
    expect(migration).toContain("elsif s.plan_version_id is null then");
    expect(migration).toContain(
      "current_proof:=private.billing_es02_live_paid_through(p_company_id) is not distinct from s.paid_through",
    );
  });

  it("keeps owner reply/take-over aligned with the ES02 read fence for any company", () => {
    expect(migration).toContain("wa.conversations.reply");
    expect(migration).toContain("wa.conversations.take_over");
    expect(migration).toContain("p_company_id");
  });

  it("aligns staff send intent claim and dispatch with ES02 paid ledger", () => {
    expect(migration).toContain("wa_staff_payment_binding_complete");
    expect(migration).toContain("check (staff_claim_paid_through is not null or staff_claim_plan_version_id is null)");
    expect(migration).toContain("private.wa_f5_pre_number_gate_claim_staff");
    expect(migration).toContain("public.whatsapp_authorize_staff_dispatch");
    expect(migration).toContain("public.billing_read_company_operational_entitlement");
    expect(migration).toContain("es02_pt := private.billing_es02_live_paid_through(i.company_id)");
    expect(migration).toContain("coalesce(proof->>'plan_version_id', 'es02')");
  });
});
