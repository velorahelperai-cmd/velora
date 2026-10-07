/**
 * TEST-ONLY fixtures for VEL-BILLING-FOUNDATION-01.
 * Marker must stay visible — never import into production catalog seeds.
 */

export const BILLING_TEST_FIXTURE_MARKER = "VEL_BILLING_TEST_FIXTURE_ONLY" as const;

export const billingTestFixtures = {
  marker: BILLING_TEST_FIXTURE_MARKER,
  /** Synthetic catalog price: 5.000 OMR = 5000 baisa — tests only. */
  amountBaisa: 5000,
  currency: "OMR" as const,
  periodDays: 30,
  /** Synthetic retention cap — tests only; not a product default. */
  retentionMessageCap: 100,
  providerAccountRef: "paymob-test-account-fixture",
  providerEnvironment: "test" as const,
  companyA: "11111111-1111-4111-8111-111111111111",
  companyB: "22222222-2222-4222-8222-222222222222",
};

export function assertTestFixture(marker: string): void {
  if (marker !== BILLING_TEST_FIXTURE_MARKER) {
    throw new Error("billing fixture marker mismatch");
  }
}
