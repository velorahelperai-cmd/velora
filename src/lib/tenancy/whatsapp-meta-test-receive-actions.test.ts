import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  access: vi.fn(),
  setup: vi.fn(),
  admin: vi.fn(),
  config: vi.fn(),
}));

vi.mock("./access", () => ({ getCompanyAccess: m.access }));
vi.mock("./paid-setup-actions", () => ({ readOwnedPaidBranchSetupAction: m.setup }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/whatsapp/config", () => ({ metaTestInboundAssetConfig: m.config }));

import { readOwnedWhatsappMetaTestReceiveProofAction } from "./whatsapp-meta-test-receive-actions";

const scope = {
  expectedAccountId: "11111111-1111-4111-8111-111111111111",
  companyId: "40d2d885-8b63-49c4-b3da-d2e9566f2750",
  branchId: "a268f9d8-fe5b-41b2-a337-97046a5eaa5c",
};

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  for (const key of ["select", "eq", "in", "order", "limit"]) api[key] = vi.fn(self);
  Object.assign(api, {
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  });
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.config.mockReturnValue({
    companyId: scope.companyId,
    wabaId: "2057350774985092",
    phoneNumberId: "1261345677073276",
    allowedSenders: ["96876351423"],
  });
  m.access.mockResolvedValue({
    ok: true,
    context: {
      needsCompanyContext: false,
      userId: scope.expectedAccountId,
      company: { id: scope.companyId },
      membership: { role: "owner" },
    },
  });
  m.setup.mockResolvedValue({
    companyId: scope.companyId,
    selectedBranchId: scope.branchId,
    sourceStatus: "ready",
    branches: [{ id: scope.branchId, label: "TAG CITY" }],
  });
});

it("returns receive-only proof with parallel message/conversation reads and without inventing verified", async () => {
  const from = vi.fn((table: string) => {
    if (table === "whatsapp_inbound_jobs") {
      return chain({
        data: [
          {
            completed_at: "2026-10-29T19:31:04.986Z",
            message_id: "7253d221-51b2-4e83-91a6-6259f263d949",
          },
        ],
        error: null,
      });
    }
    if (table === "whatsapp_messages") {
      return chain({
        data: [
          {
            id: "7253d221-51b2-4e83-91a6-6259f263d949",
            conversation_id: "f1d7b8b3-74d4-4163-8bf1-648d00b57f71",
            received_at: "2026-10-29T18:41:31.000Z",
            direction: "inbound",
          },
        ],
        error: null,
      });
    }
    return chain({
      data: [
        {
          id: "f1d7b8b3-74d4-4163-8bf1-648d00b57f71",
          phone_number_id: "1261345677073276",
          automation_allowed: false,
        },
      ],
      error: null,
    });
  });
  m.admin.mockReturnValue({ from });

  const result = await readOwnedWhatsappMetaTestReceiveProofAction(scope);
  expect(m.access).toHaveBeenCalledTimes(1);
  expect(m.setup).toHaveBeenCalledTimes(1);
  expect(from.mock.calls.map((call) => call[0])).toEqual([
    "whatsapp_inbound_jobs",
    "whatsapp_messages",
    "whatsapp_conversations",
  ]);
  expect(result).toEqual({
    ok: true,
    scope,
    proof: {
      status: "receive_only_success",
      receivedAt: "2026-10-29T18:41:31.000Z",
      completedAt: "2026-10-29T19:31:04.986Z",
      savedMessageCount: 1,
      phoneNumberId: "1261345677073276",
    },
  });
  expect(JSON.stringify(result)).not.toContain("verified");
});

it("hides proof for a foreign Meta-test company and rejects non-owners", async () => {
  m.config.mockReturnValue({
    companyId: "99999999-9999-4999-8999-999999999999",
    wabaId: "1",
    phoneNumberId: "2",
    allowedSenders: ["96876351423"],
  });
  expect(await readOwnedWhatsappMetaTestReceiveProofAction(scope)).toEqual({
    ok: true,
    scope,
    proof: null,
  });
  expect(m.admin).not.toHaveBeenCalled();
  expect(m.access).not.toHaveBeenCalled();

  m.config.mockReturnValue(null);
  m.access.mockResolvedValueOnce({ ok: false });
  expect(await readOwnedWhatsappMetaTestReceiveProofAction(scope)).toEqual({
    ok: false,
    code: "forbidden",
  });
});
