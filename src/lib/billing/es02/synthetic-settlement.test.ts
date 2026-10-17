import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSyntheticSettlementEvidence,
  evaluateSyntheticSettlementGate,
  isOwnedFixtureDatabaseUrl,
  paymobExternalSettlementStatus,
} from "./synthetic-settlement";

const ids = {
  accountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  orderId: "11111111-2222-4333-8444-555555555555",
  paymentAttemptId: "66666666-7777-4888-8999-000000000000",
};

/** Owned fixture DB URL without username/password (gate proves ownership via db name + loopback). */
const ownedDb = "postgresql://127.0.0.1:3742/c1_ui_integration";
const ownedTransport = "http://127.0.0.1:3730";

describe("es02 synthetic settlement fence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies production node and vercel production", () => {
    expect(evaluateSyntheticSettlementGate({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toEqual({
      allowed: false,
      reason: "production_node_env",
    });
    expect(
      evaluateSyntheticSettlementGate({
        NODE_ENV: "development",
        VERCEL_ENV: "production",
        VELORA_ES02_OWNED_FIXTURE: "1",
        VELORA_OWNED_FIXTURE_DATABASE_URL: ownedDb,
      } as NodeJS.ProcessEnv),
    ).toEqual({ allowed: false, reason: "production_vercel_env" });
  });

  it("requires owned fixture flag, c1_ui_integration postgres URL, and loopback admin transport", () => {
    expect(
      evaluateSyntheticSettlementGate({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    ).toMatchObject({ allowed: false, reason: "fixture_flag_unset" });
    expect(
      evaluateSyntheticSettlementGate({
        NODE_ENV: "test",
        VELORA_ES02_OWNED_FIXTURE: "1",
        VELORA_OWNED_FIXTURE_DATABASE_URL: "postgresql://127.0.0.1:3742/unowned_database",
        NEXT_PUBLIC_SUPABASE_URL: ownedTransport,
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ allowed: false, reason: "database_not_owned_fixture" });
    expect(
      evaluateSyntheticSettlementGate({
        NODE_ENV: "test",
        VELORA_ES02_OWNED_FIXTURE: "1",
        VELORA_OWNED_FIXTURE_DATABASE_URL: ownedDb,
        NEXT_PUBLIC_SUPABASE_URL: "https://remote.invalid",
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ allowed: false, reason: "transport_not_loopback" });
  });

  it("rejects wrong DB scheme, nested pathname, generic DATABASE_URL fallback, and /fixture ownership claims", () => {
    expect(isOwnedFixtureDatabaseUrl("https://127.0.0.1:3742/c1_ui_integration")).toBe(false);
    expect(isOwnedFixtureDatabaseUrl("postgresql://127.0.0.1:3742/fixture")).toBe(false);
    expect(
      isOwnedFixtureDatabaseUrl("postgresql://127.0.0.1:3742/c1_ui_integration/another_database"),
    ).toBe(false);
    expect(
      evaluateSyntheticSettlementGate({
        NODE_ENV: "test",
        VELORA_ES02_OWNED_FIXTURE: "1",
        DATABASE_URL: ownedDb,
        NEXT_PUBLIC_SUPABASE_URL: ownedTransport,
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ allowed: false, reason: "database_not_owned_fixture" });
    expect(
      evaluateSyntheticSettlementGate({
        NODE_ENV: "test",
        VELORA_ES02_OWNED_FIXTURE: "1",
        VELORA_OWNED_FIXTURE_DATABASE_URL: ownedDb,
        SUPABASE_URL: ownedTransport,
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ allowed: false, reason: "transport_missing" });
  });

  it("builds evidence only when owned c1_ui_integration DB and NEXT_PUBLIC transport allow", () => {
    const env = {
      NODE_ENV: "test",
      VELORA_ES02_OWNED_FIXTURE: "1",
      VELORA_OWNED_FIXTURE_DATABASE_URL: ownedDb,
      NEXT_PUBLIC_SUPABASE_URL: ownedTransport,
    } as NodeJS.ProcessEnv;
    const ok = buildSyntheticSettlementEvidence({
      ...ids,
      specialReference: "ES02-ABCDEF12",
      amountBaisa: 45000,
      providerTransactionId: "txn-1",
      env,
    });
    expect(ok.ok).toBe(true);
    expect(evaluateSyntheticSettlementGate(env)).toEqual({ allowed: true, reason: "ok" });
  });

  it("keeps Paymob external deferred", () => {
    expect(paymobExternalSettlementStatus()).toEqual({
      status: "DEFERRED",
      code: "PAYMOB_EXTERNAL_DEFERRED",
    });
  });
});
