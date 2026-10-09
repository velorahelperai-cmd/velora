vi.mock("server-only",()=>({}));
import { describe, expect, it, beforeEach, vi } from "vitest";
import { OpenAIAnswerAdapter } from "./adapters/openai";
import { GeminiAnswerAdapter } from "./adapters/gemini";
import { MultiModelAIRouter } from "./routing/router";
import {
  calculateTokensCostBaisa,
  MODEL_PRICING_CATALOG,
  PRICING_VERSION,
  PRICING_EFFECTIVE_DATE,
} from "./config/pricing";
import {
  InMemoryAIUsageLedger,
  checkCompanyAIBudget,
  recordExecutionInLedger,
} from "./ledger/ledger";
import { isLiveAnsweringEnabled } from "./guards";
import { simulateAdminAIAnswer } from "./admin-test";
import { getSecureProviderKey } from "./config/env";
import type { AnswerContextChunk } from "./types";

const SAMPLE_CHUNKS: AnswerContextChunk[] = [
  {
    sourceId: "src-1",
    title: "ساعات العمل",
    contentVersion: 1,
    text: "أوقات الدوام الرسمية من 9 صباحاً حتى 10 مساءً يومياً.",
  },
];

describe("1. Multi-Model Adapters Unified Interface", () => {
  it("executes gpt-6-luna via OpenAI adapter with correct token mapping and cost", async () => {
    const mockOpenAIClient = {
      responses: {
          create: vi.fn().mockResolvedValue({
            id: "resp-luna-123",
            status: "completed",
            output_text: "أوقات العمل من 9 صباحاً حتى 10 مساءً.",
            usage: {
              input_tokens: 150,
              output_tokens: 40,
              total_tokens: 190,
              input_tokens_details: { cached_tokens: 20 },
            },
          }),
      },
    };

    const adapter = new OpenAIAnswerAdapter({
      client: mockOpenAIClient as unknown as import("openai").default,
      defaultModelId: "gpt-6-luna",
    });

    const result = await adapter.complete({
      question: "متى تفتحون؟",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
      forceModelId: "gpt-6-luna",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.modelId).toBe("gpt-6-luna");
    expect(result.text).toContain("أوقات العمل");
    expect(result.usage.promptTokens).toBe(150);
    expect(result.usage.completionTokens).toBe(40);
    expect(result.usage.cachedTokens).toBe(20);
    expect(result.usage.provider).toBe("openai");

    // Standard: (130*.10 + 20*.01 + 40*.50)/1M USD, converted at 2.6008 USD/OMR.
    expect(result.usage.estimatedCostBaisa).toBe(0.012766);
  });

  it("executes gpt-6.1-sol via OpenAI adapter with reasoning tokens mapping", async () => {
    const mockOpenAIClient = {
      responses: {
          create: vi.fn().mockResolvedValue({
            id: "resp-sol-999",
            status: "completed",
            output_text: "نعتذر منك، سنقوم بإحالة الشكوى للإدارة فوراً.",
            usage: {
              input_tokens: 300,
              output_tokens: 100,
              total_tokens: 400,
              output_tokens_details: { reasoning_tokens: 50 },
            },
          }),
      },
    };

    const adapter = new OpenAIAnswerAdapter({
      client: mockOpenAIClient as unknown as import("openai").default,
      defaultModelId: "gpt-6.1-sol",
    });

    const result = await adapter.complete({
      question: "أريد تقديم شكوى رسمية",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
      forceModelId: "gpt-6.1-sol",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.modelId).toBe("gpt-6.1-sol");
    expect(result.usage.reasoningTokens).toBe(50);
    expect(result.usage.estimatedCostBaisa).toBeGreaterThan(0);
  });

  it("executes gemini-3.8-flash via Gemini adapter with usage metadata mapping", async () => {
    const mockGeminiClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "المنتجات المتوفرة تشمل الشاورما والبرجر.",
          usageMetadata: {
            promptTokenCount: 200,
            candidatesTokenCount: 60,
            cachedContentTokenCount: 50,
            totalTokenCount: 260,
          },
        }),
      },
    };

    const adapter = new GeminiAnswerAdapter({
      client: mockGeminiClient as unknown as import("@google/genai").GoogleGenAI,
    });

    const result = await adapter.complete({
      question: "ما هي قائمة المنتجات؟",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.modelId).toBe("gemini-3.8-flash");
    expect(result.usage.provider).toBe("google");
    expect(result.usage.promptTokens).toBe(200);
    expect(result.usage.completionTokens).toBe(60);
    expect(result.usage.cachedTokens).toBe(50);
    expect(result.usage.estimatedCostBaisa).toBeGreaterThan(0);
  });
});

describe("2. Pricing and Economics Verification", () => {
  it("has catalog configuration with required models and effective dates", () => {
    expect(MODEL_PRICING_CATALOG["gpt-6-luna"]).toBeDefined();
    expect(MODEL_PRICING_CATALOG["gemini-3.8-flash"]).toBeDefined();
    expect(MODEL_PRICING_CATALOG["gpt-6.1-sol"]).toBeDefined();
    expect(PRICING_VERSION).toBe("verified-2026-10-08");
    expect(PRICING_EFFECTIVE_DATE).toBe("2026-10-08");
  });

  it("calculates accurate Baisa costs according to rate tiers", () => {
    // Luna: 0.002 USD at the published Standard rates.
    const lunaCost = calculateTokensCostBaisa("gpt-6-luna", {
      promptTokens: 10_000,
      completionTokens: 2_000,
    });
    expect(lunaCost).toBe(0.768995);

    // Gemini: 0.015 USD at the introductory Standard rates.
    const geminiCost = calculateTokensCostBaisa("gemini-3.8-flash", {
      promptTokens: 10_000,
      completionTokens: 2_000,
    });
    expect(geminiCost).toBe(5.767457);

    // Sol: 0.040 USD at the published Standard rates.
    const solCost = calculateTokensCostBaisa("gpt-6.1-sol", {
      promptTokens: 10_000,
      completionTokens: 2_000,
    });
    expect(solCost).toBe(15.379884);
  });
});

describe("3. Multi-Model AI Router Dynamic Routing", () => {
  const router = new MultiModelAIRouter();

  it("routes standard questions and FAQs to gpt-6-luna", () => {
    const classification = router.classify({
      question: "مرحبا، ما هي أوقات العمل في فرع مسقط؟",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
    });

    expect(classification.modelId).toBe("gpt-6-luna");
    expect(classification.taskType).toBe("simple_faq");
  });

  it("routes complaints, refunds, and high-risk queries to gpt-6.1-sol", () => {
    const classification = router.classify({
      question: "أنا غير راضي أبداً عن الخدمة وأريد رفع شكوى للتعويض واسترجاع المبلغ",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
    });

    expect(classification.modelId).toBe("gpt-6.1-sol");
    expect(classification.taskType).toBe("risk_escalation");
    expect(classification.reason).toContain("Risk keyword");
  });

  it("routes catalog and multi-context queries to gemini-3.8-flash", () => {
    const classification = router.classify({
      question: "أريد استعراض كتالوج ومنيو المنتجات كامل مع الأسعار والمواصفات",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
    });

    expect(classification.modelId).toBe("gemini-3.8-flash");
    expect(classification.taskType).toBe("catalog_and_products");
  });

  it("routes large context volumes to gemini-3.8-flash even without catalog keywords", () => {
    const largeChunks: AnswerContextChunk[] = Array.from({ length: 5 }, (_, i) => ({
      sourceId: `chunk-${i}`,
      title: `Doc ${i}`,
      contentVersion: 1,
      text: "تفاصيل مطولة جداً عن الأنظمة والشروط والقوانين ".repeat(15),
    }));

    const classification = router.classify({
      question: "هل يمكن توضيح البنود العامة؟",
      locale: "ar",
      chunks: largeChunks,
    });

    expect(classification.modelId).toBe("gemini-3.8-flash");
  });

  it("respects explicit forceModelId override", () => {
    const classification = router.classify({
      question: "سؤال بسيط جداً",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
      forceModelId: "gpt-6.1-sol",
    });

    expect(classification.modelId).toBe("gpt-6.1-sol");
    expect(classification.reason).toContain("override");
  });
});

describe("4. Router Fallback & Retry Handling", () => {
  it("fails over to backup model when primary model returns an error", async () => {
    // An explicit model rejection permits controlled fallback; quota/timeouts do not.
    const failingOpenAI = {
      responses: {
          create: vi.fn().mockRejectedValue({ status: 404, message: "Model unavailable" }),
      },
    };

    // Healthy Gemini client
    const healthyGemini = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "رد بديل بنجاح من جيميني فلاش بعد تعثر لونا",
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 50 },
        }),
      },
    };

    const router = new MultiModelAIRouter({
      openAIAdapter: new OpenAIAnswerAdapter({
        client: failingOpenAI as unknown as import("openai").default,
      }),
      geminiAdapter: new GeminiAnswerAdapter({
        client: healthyGemini as unknown as import("@google/genai").GoogleGenAI,
      }),
    });

    // Simple FAQ would normally route to Luna first; upon failure, should fall back to Gemini
    const result = await router.complete({
      question: "ما هي أوقات العمل؟",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.modelId).toBe("gemini-3.8-flash");
    expect(result.attemptsCount).toBe(2);
    expect(result.routingReason).toContain("Fallback attempt #2");
  });
});

describe("5. Tenant Isolation & AI Usage Ledger", () => {
  let ledger: InMemoryAIUsageLedger;

  beforeEach(() => {
    ledger = new InMemoryAIUsageLedger();
  });

  it("strictly isolates usage and spend records between companies", async () => {
    // Record usage for Company Alpha
    await recordExecutionInLedger(
      "company-alpha",
      {
        ok: true,
        text: "رد A",
        citations: [],
        usage: {
          promptChars: 50,
          contextChars: 100,
          sourceCount: 1,
          promptTokens: 500,
          completionTokens: 100,
          modelId: "gpt-6-luna",
          provider: "openai",
          estimatedCostBaisa: 15.5,
        },
      },
      { store: ledger },
    );

    // Record usage for Company Beta
    await recordExecutionInLedger(
      "company-beta",
      {
        ok: true,
        text: "رد B",
        citations: [],
        usage: {
          promptChars: 80,
          contextChars: 200,
          sourceCount: 1,
          promptTokens: 1200,
          completionTokens: 250,
          modelId: "gemini-3.8-flash",
          provider: "google",
          estimatedCostBaisa: 32.0,
        },
      },
      { store: ledger },
    );

    const usageA = await ledger.getCompanyUsage("company-alpha");
    const usageB = await ledger.getCompanyUsage("company-beta");
    const spendA = await ledger.getCompanySpendBaisa("company-alpha");
    const spendB = await ledger.getCompanySpendBaisa("company-beta");

    expect(usageA.length).toBe(1);
    expect(usageB.length).toBe(1);
    expect(usageA[0].companyId).toBe("company-alpha");
    expect(usageB[0].companyId).toBe("company-beta");
    expect(spendA).toBe(15.5);
    expect(spendB).toBe(32.0);
  });
});

describe("6. Token Caps & Company Budget Guards", () => {
  let ledger: InMemoryAIUsageLedger;

  beforeEach(() => {
    ledger = new InMemoryAIUsageLedger();
  });

  it("blocks requests that exceed single-request token cap", async () => {
    const result = await checkCompanyAIBudget("company-cap-test", 10_000, ledger);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("TOKEN_LIMIT_EXCEEDED");
    }
  });

  it("blocks company when monthly spend limit is reached", async () => {
    // Set low budget of 50 Baisa (0.050 OMR)
    await ledger.setBudget({
      companyId: "company-budget-test",
      monthlyLimitBaisa: 50,
      hardStopEnabled: true,
      maxTokensPerRequest: 8000,
    });

    // Record 60 Baisa spend
    await recordExecutionInLedger(
      "company-budget-test",
      {
        ok: true,
        text: "رد",
        citations: [],
        usage: {
          promptChars: 10,
          contextChars: 10,
          sourceCount: 1,
          estimatedCostBaisa: 60,
          modelId: "gpt-6-luna",
          provider: "openai",
        },
      },
      { store: ledger },
    );

    const check = await checkCompanyAIBudget("company-budget-test", 100, ledger);
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.code).toBe("BUDGET_EXCEEDED");
    }
  });
});

describe("7. Live Answering Safety & Environment Protection", () => {
  it("strictly keeps live answering disabled", () => {
    expect(isLiveAnsweringEnabled()).toBe(false);
  });

  it("protects provider API keys in browser environments", () => {
    // In node environment without process.env key, returns null or env value
    // When window is defined, must always return null
    (global as unknown as { window?: unknown }).window = {};
    expect(getSecureProviderKey("openai")).toBeNull();
    expect(getSecureProviderKey("google")).toBeNull();
    delete (global as unknown as { window?: unknown }).window;
  });
});

describe("8. Admin Simulation Mode Sandbox", () => {
  it("runs simulation safely with dryRun and routes single chunk to Luna", async () => {
    const sim = await simulateAdminAIAnswer({
      question: "ما هي أوقات العمل؟",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
      dryRun: true,
    });

    expect(sim.ok).toBe(true);
    expect(sim.modelId).toBe("gpt-6-luna");
    expect(sim.tokens?.totalTokens).toBeGreaterThan(0);
    expect(sim.economics?.costBaisa).toBeGreaterThan(0);
    expect(sim.ledgerEntry?.status).toBe("success");
  });

  it("runs simulation with default 3 catalog chunks and routes to Gemini Flash", async () => {
    const sim = await simulateAdminAIAnswer({
      question: "ما هي أوقات العمل؟",
      locale: "ar",
      dryRun: true,
    });

    expect(sim.ok).toBe(true);
    expect(sim.modelId).toBe("gemini-3.8-flash");
    expect(sim.tokens?.totalTokens).toBeGreaterThan(0);
    expect(sim.economics?.costBaisa).toBeGreaterThan(0);
    expect(sim.ledgerEntry?.status).toBe("success");
  });
});

describe("9. OpenAI Responses API & High-Precision Currency Accounting", () => {
  it("executes via client.responses.create with accurate token and USD/Baisa output", async () => {
    const mockResponsesClient = {
      responses: {
        create: vi.fn().mockResolvedValue({
          id: "resp_test_123",
          output_text: "أهلاً بك، تم الرد عبر Responses API.",
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            total_tokens: 140,
            input_tokens_details: { cached_tokens: 30 },
            output_tokens_details: { reasoning_tokens: 10 },
          },
        }),
      },
    };

    const adapter = new OpenAIAnswerAdapter({
      client: mockResponsesClient as unknown as import("openai").default,
      defaultModelId: "gpt-6.1-sol",
    });

    const result = await adapter.complete({
      question: "استفسار",
      locale: "ar",
      chunks: SAMPLE_CHUNKS,
      forceModelId: "gpt-6.1-sol",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.text).toBe("أهلاً بك، تم الرد عبر Responses API.");
    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.completionTokens).toBe(40);
    expect(result.usage.cachedTokens).toBe(30);
    expect(result.usage.reasoningTokens).toBe(10);
    expect(result.usage.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.usage.estimatedCostBaisa).toBeGreaterThan(0);
  });

  it("does not round micro-requests to zero in USD or Baisa", async () => {
    const { calculateTokensCostDetailed } = await import("./config/pricing");
    // Extremely small request: 5 prompt tokens, 2 completion tokens
    const microCost = calculateTokensCostDetailed("gpt-6-luna", {
      promptTokens: 5,
      completionTokens: 2,
    });

    expect(microCost.costUsd).toBeGreaterThan(0);
    expect(microCost.costBaisa).toBeGreaterThan(0);
    // Verifying it is not prematurely truncated to 0
    expect(microCost.costBaisa).toBeGreaterThanOrEqual(0.000001);
  });
});

describe("10. Diagnostics: Model Availability & Account Privilege Verification", () => {
  it("distinguishes between authorized model, restricted tier, and missing model", async () => {
    const { checkOpenAIModelAvailability } = await import("./diagnostics/model-availability");

    // Case 1: 200 OK (Authorized)
    const mockClientAuthorized = {
      models: { retrieve: vi.fn().mockResolvedValue({ id: "gpt-6-luna" }) },
    };
    const res1 = await checkOpenAIModelAvailability(
      "gpt-6-luna",
      mockClientAuthorized as unknown as import("openai").default,
    );
    expect(res1.status).toBe("AVAILABLE_AND_AUTHORIZED");
    expect(res1.httpStatus).toBe(200);

    // Case 2: 403 Forbidden (Model exists globally, but account tier lacks permissions)
    const mockClientRestricted = {
      models: { retrieve: vi.fn().mockRejectedValue({ status: 403, message: "Tier restricted" }) },
    };
    const res2 = await checkOpenAIModelAvailability(
      "gpt-6.1-sol",
      mockClientRestricted as unknown as import("openai").default,
    );
    expect(res2.status).toBe("RESTRICTED_FOR_ACCOUNT");
    expect(res2.httpStatus).toBe(403);

    // Case 3: 404 Not Found
    const mockClientNotFound = {
      models: { retrieve: vi.fn().mockRejectedValue({ status: 404, message: "Model not found" }) },
    };
    const res3 = await checkOpenAIModelAvailability(
      "gpt-6-luna",
      mockClientNotFound as unknown as import("openai").default,
    );
    expect(res3.status).toBe("NOT_FOUND_ON_ENDPOINT");
    expect(res3.httpStatus).toBe(404);
  });
});

describe("11. Safety Gate on Live Connectivity Ping", () => {
  it("strictly blocks live ping execution unless executeConfirmed is true", async () => {
    const { executeLiveModelPing } = await import("./diagnostics/ping-test");

    const result = await executeLiveModelPing({
      modelId: "gpt-6-luna",
      executeConfirmed: false, // Must be blocked
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("SAFETY_GATE_ACTIVE");
    expect(result.latencyMs).toBe(0);
  });
});


