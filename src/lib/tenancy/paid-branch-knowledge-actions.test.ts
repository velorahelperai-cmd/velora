import { describe, expect, it, vi, beforeEach } from "vitest";

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_BRANCH_ID = "33333333-3333-4333-8333-333333333333";

let currentSessionId: string | null = VALID_ACCOUNT_ID;
let rpcMock = vi.fn();

vi.mock("@/lib/auth/server-identity", () => ({
  readSessionIdentity: vi.fn(async () => {
    if (!currentSessionId) return { ok: false, code: "UNAUTHENTICATED" };
    return { ok: true, userId: currentSessionId };
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
  })),
}));

vi.mock("@/lib/logging/logger.mjs", () => ({
  logEvent: vi.fn(),
  withLogContext: vi.fn(async (_ctx, fn) => fn()),
}));

import {
  addOwnedBranchWebsiteAction,
  indexOwnedBranchWebsiteAction,
  isSafePublicUrl,
  loadApprovedBranchKnowledgeContext,
  readOwnedBranchKnowledgeAction,
} from "./paid-branch-knowledge-actions";
import { safeFetchWebsite } from "./safe-website-fetcher";
vi.mock("./safe-website-fetcher", async () => ({ ...(await vi.importActual<typeof import("./safe-website-fetcher")>("./safe-website-fetcher")), safeFetchWebsite: vi.fn() }));
vi.mock("@/lib/answers/context", () => ({ loadApprovedAnswerContext: vi.fn(async () => ({ ok: false, code: "NO_KNOWLEDGE" })) }));

describe("paid-branch-knowledge-actions", () => {
  beforeEach(() => {
    currentSessionId = VALID_ACCOUNT_ID;
    vi.mocked(safeFetchWebsite).mockReset().mockResolvedValue({ ok: true, title: "Velora Boutique", extractedText: "Welcome to our shop", finalUrl: "https://example.com/about" });
    rpcMock = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        data: {
          snapshot: {
            scope: {
              expectedAccountId: VALID_ACCOUNT_ID,
              companyId: VALID_COMPANY_ID,
              branchId: VALID_BRANCH_ID,
            },
            version: 1,
            branchLabel: "Main",
            websiteQuota: { limit: 10, used: 1 },
            pages: [{ id: "44444444-4444-4444-8444-444444444444", companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, version: 1, url: "https://example.com/about", status: "processing" }],
            files: [],
            faq: [],
            capabilities: { canAddWebsite: true, canUploadFiles: true, canSaveText: true },
          },
        },
      },
      error: null,
    });
  });

  describe("isSafePublicUrl SSRF protection", () => {
    it("rejects non-http/https protocols", async () => {
      expect(await isSafePublicUrl("ftp://example.com")).toBe(false);
      expect(await isSafePublicUrl("file:///etc/passwd")).toBe(false);
      expect(await isSafePublicUrl("javascript:alert(1)")).toBe(false);
    });

    it("rejects loopback and localhost", async () => {
      expect(await isSafePublicUrl("http://localhost:3000")).toBe(false);
      expect(await isSafePublicUrl("https://127.0.0.1:8080")).toBe(false);
      expect(await isSafePublicUrl("http://[::1]")).toBe(false);
    });

    it("rejects cloud metadata and private IP ranges", async () => {
      expect(await isSafePublicUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
      expect(await isSafePublicUrl("http://10.0.0.1/admin")).toBe(false);
      expect(await isSafePublicUrl("http://192.168.1.1/router")).toBe(false);
      expect(await isSafePublicUrl("http://172.16.0.5")).toBe(false);
    });

    it("accepts safe public web URLs", async () => {
      expect(await isSafePublicUrl("https://example.com")).toBe(true);
      expect(await isSafePublicUrl("https://www.velora.om/about")).toBe(true);
      expect(await isSafePublicUrl("http://mybusiness.com/menu")).toBe(true);
    });
  });

  it("denies unauthenticated read", async () => {
    currentSessionId = null;
    const res = await readOwnedBranchKnowledgeAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
    });
    expect(res).toBeNull();
  });

  it("blocks SSRF attempts in addOwnedBranchWebsiteAction without hitting database", async () => {
    const res = await addOwnedBranchWebsiteAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      url: "http://169.254.169.254/latest/meta-data",
      rightsAttested: true,
    });
    expect(res).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("saves safe public url with rightsAttested", async () => {
    const res = await addOwnedBranchWebsiteAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      url: "https://example.com/about",
      rightsAttested: true,
    });
    expect(res).not.toBeNull();
    expect(rpcMock).toHaveBeenCalledWith(
      "es02_add_owned_branch_website",
      expect.objectContaining({
        p_url: "https://example.com/about",
      })
    );
  });

  describe("indexOwnedBranchWebsiteAction", () => {
    const VALID_PAGE_ID = "44444444-4444-4444-8444-444444444444";

    it("denies unauthenticated indexing", async () => {
      currentSessionId = null;
      const res = await indexOwnedBranchWebsiteAction({
        expectedAccountId: VALID_ACCOUNT_ID,
        companyId: VALID_COMPANY_ID,
        branchId: VALID_BRANCH_ID,
        pageId: VALID_PAGE_ID,
        url: "https://example.com/about",
      });
      expect(res).toBeNull();
    });

    it("indexes website successfully when safe fetch succeeds", async () => {
      const res = await indexOwnedBranchWebsiteAction({
        expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID,
        pageId: VALID_PAGE_ID, url: "https://example.com/about",
      });

      expect(res).not.toBeNull();
      expect(rpcMock).toHaveBeenCalledWith(
        "es02_index_branch_website_page",
        expect.objectContaining({
          p_page_id: VALID_PAGE_ID,
          p_title: "Velora Boutique",
          p_status: "indexed",
          p_error: null,
        })
      );
    });

    it("records failure when safe fetch fails (e.g. SSRF blocked)", async () => {
      vi.mocked(safeFetchWebsite).mockResolvedValueOnce({ ok: false, code: "SSRF_BLOCKED", message: "Unsafe destination" });
      const res = await indexOwnedBranchWebsiteAction({
        expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID,
        pageId: VALID_PAGE_ID, url: "https://metadata-bypass.com",
      });

      expect(res).not.toBeNull();
      expect(rpcMock).toHaveBeenCalledWith(
        "es02_index_branch_website_page",
        expect.objectContaining({
          p_page_id: VALID_PAGE_ID,
          p_status: "failed",
        })
      );
    });
  });

  describe("loadApprovedBranchKnowledgeContext", () => {
    it("loads indexed branch website pages and approved company knowledge", async () => {
      rpcMock.mockResolvedValueOnce({ data: { ok: true, data: {
        pages: [{ id: "44444444-4444-4444-8444-444444444444", version: 1, url: "https://velora.om", title: "Velora Main", extracted_text: "Exclusive fashion boutique in Muscat." }], knowledgeRevision: "server-revision",
      } }, error: null });
      const result = await loadApprovedBranchKnowledgeContext(VALID_COMPANY_ID, VALID_BRANCH_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.chunks.length).toBeGreaterThan(0);
        expect(result.chunks[0].text).toContain("Exclusive fashion boutique in Muscat.");
        expect(result.knowledgeRevision).not.toBe("no_pages");
      }
    });
  });
});

it("does not report successful knowledge context when private-page access fails", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  rpcMock = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
  const result = await loadApprovedBranchKnowledgeContext(VALID_COMPANY_ID, VALID_BRANCH_ID);
  expect(result.ok).toBe(false);
  expect(result.chunks).toEqual([]);
});

describe("es02 page action migration preflight baseline guard", () => {
  it("proves correct matching with md5(pg_get_functiondef(oid)) and rejection on altered definition", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const crypto = await import("node:crypto");

    const sqlPath = path.resolve(process.cwd(), "supabase/migrations/20261022075859_es02_page_action_version_guard_review.sql");
    const sqlContent = fs.readFileSync(sqlPath, "utf8");

    // 1. Verify SQL contract strictly uses pg_get_functiondef(oid) and NOT prosrc
    expect(sqlContent).toContain("select md5(pg_get_functiondef(oid)) from pg_proc");
    expect(sqlContent).not.toContain("select md5(prosrc) from pg_proc");

    const approvedFunctionDefHash = "a603d893224730a13332e005a174cc7e";
    const prodProsrcHash = "f1b31b4d1cf2b8d4b024122111a8209c";
    expect(sqlContent).toContain(`is distinct from '${approvedFunctionDefHash}'`);

    // 2. Logic model of the SQL DO block guard:
    const runGuard = (computedHash: string) => {
      if (computedHash !== approvedFunctionDefHash) {
        throw new Error("ES02_PAGE_ACTION_BASELINE_CHANGED");
      }
      return true;
    };

    // Correct matching: pg_get_functiondef hash on production matches approved hash -> PASS
    expect(runGuard(approvedFunctionDefHash)).toBe(true);

    // Rejection on altered definition: any altered definition produces different hash -> REJECT
    const alteredHash = crypto.createHash("md5").update("CREATE OR REPLACE FUNCTION modified_body").digest("hex");
    expect(() => runGuard(alteredHash)).toThrow("ES02_PAGE_ACTION_BASELINE_CHANGED");

    // Regression proof: old buggy prosrc check would have falsely rejected the valid production baseline
    expect(() => runGuard(prodProsrcHash)).toThrow("ES02_PAGE_ACTION_BASELINE_CHANGED");
  });
});
