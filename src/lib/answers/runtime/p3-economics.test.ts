import { describe, expect, it } from "vitest";
import { calculateTokensCostDetailed } from "../config/pricing";
import { priceRealUsage, realModelPricing, reserveRealCost } from "./economics";

const date = new Date("2026-10-08T00:00:00Z");
const usage = { promptTokens: 1_000, completionTokens: 500, cachedTokens: 200, cacheWriteTokens: 100, reasoningTokens: 400 };

describe("verified Standard model economics", () => {
  it.each([
    ["gpt-6-luna", 0.0003345],
    ["gpt-6.1-sol", 0.00667],
    ["gemini-3.8-flash", 0.00249],
  ] as const)("bills input/cache/write/output exactly once for %s", (model, expected) => {
    const cost = calculateTokensCostDetailed(model, usage);
    expect(cost.costUsd).toBeCloseTo(expected, 10);
  });

  it("applies OpenAI long-context rates to the entire request above 272K input", () => {
    const long = { ...usage, promptTokens: 272_001 };
    // (271701*4 + 200*.2 + 100*5 + 500*15) / 1M = 1.094844
    expect(priceRealUsage(long, realModelPricing("gpt-6.1-sol", date)).costUsd).toBeCloseTo(1.094844, 10);
  });

  it("keeps short-context rates at the inclusive 272K boundary", () => {
    expect(priceRealUsage({ ...usage, promptTokens: 272_000 }, realModelPricing("gpt-6.1-sol", date)).costUsd).toBeCloseTo(0.54867, 10);
  });

  it("reserves the applicable long-context tariff before execution", () => {
    // UTF-8 bytes + framing bound exceeds the 272K threshold; use costly write rate.
    expect(reserveRealCost("gpt-6.1-sol", "", "x".repeat(272_001), realModelPricing("gpt-6.1-sol", date))).toBeGreaterThan(630);
  });

  it.each([
    { ...usage, promptTokens: -1 },
    { ...usage, cachedTokens: 1_001 },
    { ...usage, cachedTokens: 950, cacheWriteTokens: 100 },
    { ...usage, reasoningTokens: 501 },
    { ...usage, completionTokens: Number.NaN },
  ])("rejects malformed provider usage instead of inventing a price", (invalid) => {
    expect(() => calculateTokensCostDetailed("gpt-6-luna", invalid)).toThrow("INVALID_PROVIDER_USAGE");
  });

  it("rejects an unsupported model instead of silently charging Gemini or zero", () => {
    expect(() => realModelPricing("unavailable-model" as "gpt-6-luna", date)).toThrow("INVALID_MODEL");
  });

  it("rejects invalid pricing snapshots", () => {
    expect(() => priceRealUsage(usage, { ...realModelPricing("gpt-6-luna", date), output: Number.NaN })).toThrow("INVALID_PRICING");
  });

  it("rejects reasoning greater than total output", () => {
    expect(() => priceRealUsage({ ...usage, reasoningTokens: 501 }, realModelPricing("gpt-6-luna", date))).toThrow("INVALID_PROVIDER_USAGE");
  });

  it("rejects omitted output usage instead of returning NaN cost", () => {
    expect(() => priceRealUsage({ promptTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } as unknown as typeof usage, realModelPricing("gpt-6-luna", date)))
      .toThrow("INVALID_PROVIDER_USAGE");
  });

  it("reserves bounded output ceiling when requestedMaxOutputTokens is provided", () => {
    const defaultCost = reserveRealCost("gemini-3.8-flash", "s", "p", realModelPricing("gemini-3.8-flash", date));
    const boundedCost = reserveRealCost("gemini-3.8-flash", "s", "p", realModelPricing("gemini-3.8-flash", date), 384);
    expect(defaultCost).toBeGreaterThan(90);
    expect(boundedCost).toBeLessThan(2.0);
    expect(boundedCost).toBeGreaterThan(0);
  });

  it("never estimates input below its UTF-8 byte length unless the provider counted it", () => {
    const pricing = realModelPricing("gemini-3.8-flash", date);
    const text = "مرحبا".repeat(200);
    const bytes = new TextEncoder().encode(text).length;
    const byBytes = reserveRealCost("gemini-3.8-flash", "", text, pricing, 256);
    expect(byBytes).toBeCloseTo(((bytes * 0.75 + 256 * 3.75) / 1e6) * 1.2 * 1000 / 2.6008, 5);
    const counted = reserveRealCost("gemini-3.8-flash", "", text, pricing, 256, 300);
    expect(counted).toBeLessThan(byBytes);
  });
});

it('prices Flash-Lite separately without changing retained Flash snapshots',()=>{
 const lite=realModelPricing('gemini-3.5-flash-lite',new Date('2026-11-01'));
 expect(lite).toMatchObject({input:0.30,cached:0.03,output:2.50,longContextThreshold:null,version:'verified-2026-11-01'});
 expect(realModelPricing('gemini-3.8-flash',new Date('2026-11-01')).output).toBe(3.75);
});
