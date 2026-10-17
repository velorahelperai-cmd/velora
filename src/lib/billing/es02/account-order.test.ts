import { describe, expect, it } from "vitest";
import { foreignOwnershipDenied, parseAccountOrderRow, parseOwnedRecoveryRow } from "./account-order";
import { ES02_CATALOG_REVISION } from "./contracts";

const accountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const foreign = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const offer = {
  catalogRevision: ES02_CATALOG_REVISION,
  persona: "level_1",
  package: "basic",
  term: "monthly",
  amountBaisa: 45000,
  currency: "OMR",
  repliesPerMonth: 1000,
  employees: 2,
  channels: 1,
  branchSlots: 1,
  purpose: "initial_subscription",
  productCode: "velora_subscription",
  slots: [
    {
      slotIndex: 0,
      persona: "level_1",
      package: "basic",
      amountBaisa: 45000,
      repliesPerMonth: 1000,
      employees: 2,
      channels: 1,
    },
  ],
} as const;

describe("es02 account order fencing", () => {
  it("parses owned order views and denies foreign ownership", () => {
    const order = parseAccountOrderRow(
      {
        orderId: "11111111-2222-4333-8444-555555555555",
        accountId,
        status: "settled",
        offer,
        specialReference: "ES02-ABC",
        paymentAttemptId: "66666666-7777-4888-8999-000000000000",
        environment: "test",
        settledAt: "2026-10-17T00:00:00.000Z",
        provisionedCompanyId: null,
        originalOrderGroupId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
      },
      accountId,
    );
    expect(order?.status).toBe("settled");
    expect(foreignOwnershipDenied(accountId, foreign)).toBe(true);
  });

  it("rejects foreign actor in recovery payload without overwrite", () => {
    expect(
      parseOwnedRecoveryRow(
        {
          accountId: foreign,
          orderId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
          status: "settled_unprovisioned",
          specialReference: "ES02-FOREIGN-RESULT",
          companyId: null,
          offer,
        },
        accountId,
      ),
    ).toBeNull();
  });

  it("rejects forged amount that does not match catalog recomputation", () => {
    expect(
      parseOfferWithTamper({
        ...offer,
        amountBaisa: 1,
      }),
    ).toBeNull();
  });
});

function parseOfferWithTamper(value: unknown) {
  return parseAccountOrderRow(
    {
      orderId: "11111111-2222-4333-8444-555555555555",
      accountId,
      status: "open",
      offer: value,
      specialReference: "ES02-ABC",
      paymentAttemptId: "66666666-7777-4888-8999-000000000000",
      environment: "test",
      settledAt: null,
      provisionedCompanyId: null,
      originalOrderGroupId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
    },
    accountId,
  );
}
