import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ rpc: vi.fn(), fetch: vi.fn(), company: vi.fn() }));
const scope = { expectedAccountId: "11111111-1111-4111-8111-111111111111", companyId: "22222222-2222-4222-8222-222222222222", branchId: "33333333-3333-4333-8333-333333333333" };
const page = { id: "44444444-4444-4444-8444-444444444444", companyId: scope.companyId, branchId: scope.branchId, version: 2, url: "https://stored.example.invalid/about", status: "pending", error: null, capabilities: { canRetry: true, canRetrain: false } };
const snapshot = { scope, version: 1, branchLabel: "Shop", pages: [page], websiteQuota: { used: 1, limit: 10 }, files: [], faq: [], capabilities: { canAddWebsite: true } };
vi.mock("@/lib/auth/server-identity", () => ({ readSessionIdentity: async () => ({ ok: true, userId: "11111111-1111-4111-8111-111111111111" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fake.rpc }) }));
vi.mock("@/lib/answers/context", () => ({ loadApprovedAnswerContext: fake.company }));
vi.mock("./safe-website-fetcher", () => ({ safeFetchWebsite: fake.fetch }));
vi.mock("@/lib/logging/logger.mjs", () => ({ withLogContext: async (_ctx: unknown, fn: () => unknown) => fn() }));
import { addOwnedBranchWebsiteAction, pageActionOwnedBranchKnowledgeAction, indexOwnedBranchWebsiteAction, loadApprovedBranchKnowledgeContext } from "./paid-branch-knowledge-actions";
beforeEach(() => {
  vi.clearAllMocks();
  fake.rpc.mockImplementation(async (name: string) => {
    if (name === "es02_read_owned_branch_answer_context") return { data: { ok: true, data: { pages: [{ id: page.id, version: 2, url: page.url, title: "Shop", extracted_text: "We open at nine." }], knowledgeRevision: "server-revision" } }, error: null };
    return { data: { ok: true, data: { snapshot } }, error: null };
  });
  fake.company.mockResolvedValue({ ok: false, code: "NO_KNOWLEDGE" });
  fake.fetch.mockResolvedValue({ ok: true, title: "Shop", extractedText: "We open at nine.", finalUrl: page.url });
});
it("loads authorized private page content through RPC into answer knowledge", async () => {
  const context = await loadApprovedBranchKnowledgeContext(scope.companyId, scope.branchId);
  expect(context).toMatchObject({ ok: true, knowledgeRevision: "server-revision", chunks: [{ text: "We open at nine.", usageRole: "knowledge", contentVersion: 2 }] });
  expect(fake.rpc).toHaveBeenCalledWith("es02_read_owned_branch_answer_context", expect.objectContaining({ p_expected_account_id: scope.expectedAccountId, p_branch_id: scope.branchId }));
});
it("indexes a newly saved website from its persisted URL", async () => {
  const result = await addOwnedBranchWebsiteAction({ ...scope, expectedVersion: 1, url: page.url, rightsAttested: true });
  expect(result).not.toBeNull();
  expect(fake.fetch).toHaveBeenCalledWith(page.url);
  expect(fake.rpc).toHaveBeenCalledWith("es02_index_branch_website_page", expect.objectContaining({ p_page_id: page.id, p_expected_version: 2, p_extracted_text: "We open at nine." }));
});
it("retry actually fetches and indexes the saved page", async () => {
  await pageActionOwnedBranchKnowledgeAction({ ...scope, pageId: page.id, pageVersion: 2, action: "retry" });
  expect(fake.fetch).toHaveBeenCalledWith(page.url);
});
it("never fetches before authoritative branch/page access succeeds", async () => {
  fake.rpc.mockResolvedValue({ data: { ok: false, code: "FORBIDDEN" }, error: null });
  await indexOwnedBranchWebsiteAction({ ...scope, pageId: page.id, url: page.url });
  expect(fake.fetch).not.toHaveBeenCalled();
});
it("cannot replace the persisted URL or server fetch limits from client input", async () => {
  await indexOwnedBranchWebsiteAction({ ...scope, pageId: page.id, url: "https://attacker.example.invalid", fetchOptions: { maxBytes: 999999999 } });
  expect(fake.fetch).toHaveBeenCalledWith(page.url);
});
