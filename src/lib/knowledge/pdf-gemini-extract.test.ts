import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  getKey: vi.fn(() => "synthetic-not-a-key"),
  createPart: vi.fn((data: string, mimeType: string) => ({ inlineData: { data, mimeType } })),
}));

vi.mock("@/lib/logging/logger.mjs", () => ({ logEvent: mocks.log }));
vi.mock("@/lib/answers/config/env", () => ({ getSecureProviderKey: mocks.getKey }));
vi.mock("@google/genai", () => ({
  createPartFromBase64: mocks.createPart,
  GoogleGenAI: class {
    constructor() {
      throw new Error("default client must not be constructed in unit tests");
    }
  },
}));

const sourceId = "efbad663-bfe9-4528-b8b3-11d817e20683";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getKey.mockReturnValue("synthetic-not-a-key");
  delete process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED;
  delete process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  delete process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED;
  delete process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS;
  delete process.env.VERCEL_ENV;
});

describe("pdf gemini extract gate", () => {
  it("stays off by default and refuses hosted production even when flagged", async () => {
    const { isPdfGeminiExtractAuthorized } = await import("./pdf-gemini-extract");
    expect(isPdfGeminiExtractAuthorized(sourceId)).toBe(false);

    process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED = "true";
    process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS = sourceId;
    process.env.VERCEL_ENV = "production";
    expect(isPdfGeminiExtractAuthorized(sourceId)).toBe(false);
  });

  it("requires an explicit allowlisted source id", async () => {
    process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED = "true";
    process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS = sourceId;
    const { isPdfGeminiExtractAuthorized } = await import("./pdf-gemini-extract");
    expect(isPdfGeminiExtractAuthorized(sourceId)).toBe(true);
    expect(isPdfGeminiExtractAuthorized("11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(isPdfGeminiExtractAuthorized(undefined)).toBe(false);
  });
});

describe("validateGeminiPdfPages", () => {
  it("requires ordered complete page markers with non-empty bodies", async () => {
    const { validateGeminiPdfPages } = await import("./pdf-gemini-extract");
    expect(validateGeminiPdfPages("## PAGE 1\nA\n\n## PAGE 2\nB", 2)).toBe(true);
    expect(validateGeminiPdfPages("## PAGE 1\nA\n\n## PAGE 3\nB", 2)).toBe(false);
    expect(validateGeminiPdfPages("## PAGE 1\nA", 2)).toBe(false);
    expect(validateGeminiPdfPages("## PAGE 1\n\n## PAGE 2\nB", 2)).toBe(false);
  });
});

describe("extractPdfWithGemini", () => {
  it("sends downloaded PDF bytes and rejects truncated or incomplete coverage", async () => {
    process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED = "true";
    process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS = sourceId;
    const { extractPdfWithGemini, PDF_GEMINI_EXTRACT_MODEL } = await import("./pdf-gemini-extract");
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const generateContent = vi.fn(async () => ({
      text: "## PAGE 1\nonly one page",
      candidates: [{ finishReason: "MAX_TOKENS" }],
    }));

    expect(await extractPdfWithGemini(bytes, 2, { sourceId }, { models: { generateContent } })).toBeNull();
    expect(mocks.log).toHaveBeenCalledWith(
      "warn",
      "knowledge.pdf.preparation_failed",
      expect.objectContaining({ stage: "external_extract", failure_code: "external_response_truncated", source_id: sourceId }),
    );

    generateContent.mockResolvedValueOnce({
      text: "## PAGE 1\nA\n\n## PAGE 2\n@tajseem_om",
      candidates: [{ finishReason: "STOP" }],
    });
    await expect(extractPdfWithGemini(bytes, 2, { sourceId }, { models: { generateContent } })).resolves.toContain("@tajseem_om");
    expect(generateContent).toHaveBeenLastCalledWith(expect.objectContaining({ model: PDF_GEMINI_EXTRACT_MODEL }));
    expect(mocks.createPart).toHaveBeenCalledWith(Buffer.from(bytes).toString("base64"), "application/pdf");
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/tajseem|SECRET|37,80/);
  });

  it("does not call the provider when the source is not allowlisted", async () => {
    process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED = "true";
    process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS = sourceId;
    const { extractPdfWithGemini } = await import("./pdf-gemini-extract");
    const generateContent = vi.fn();
    expect(
      await extractPdfWithGemini(new Uint8Array([1]), 1, { sourceId: "11111111-1111-4111-8111-111111111111" }, { models: { generateContent } }),
    ).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
  });
});
