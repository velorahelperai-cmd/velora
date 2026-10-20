import {randomUUID} from "node:crypto";
const syntheticFixturePassword = randomUUID();
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ adminFactory: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.adminFactory }));

import { settleAccountOrderSyntheticFixture } from "./fixture-synthetic-settlement";

const actor = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const orderId = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const attemptId = "66666666-7777-4888-8999-000000000000";

describe("es02 fixture synthetic settlement", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects remote API transport before constructing admin client", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VELORA_ES02_OWNED_FIXTURE", "1");
    vi.stubEnv("VELORA_OWNED_FIXTURE_DATABASE_URL", `postgresql://fixture:${syntheticFixturePassword}@127.0.0.1:3742/c1_ui_integration`);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://remote.invalid");
    m.adminFactory.mockReturnValue({ rpc: m.rpc });
    await settleAccountOrderSyntheticFixture({
      expectedAccountId: actor,
      orderId,
      paymentAttemptId: attemptId,
      specialReference: "ES02-CONTROL",
      amountBaisa: 45000,
      providerTransactionId: "local-fixture-txn",
    });
    expect(m.adminFactory).not.toHaveBeenCalled();
  });
});
