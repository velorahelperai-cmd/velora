import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  adminGate: vi.fn(),
  rpc: vi.fn(),
  storageDownload: vi.fn(),
  knowledgeSourceRow: null as unknown,
  knowledgeSourceRowPost: null as unknown,
  brokerGeneration: "gen-1",
  downloadSetupFile: vi.fn(),
  selectCount: 0,
}));

vi.mock("@/lib/tenancy/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenancy/access")>("@/lib/tenancy/access");
  return {
    ...actual,
    requirePlatformAdmin: mocks.adminGate,
    requirePlatformOwner: mocks.adminGate,
  };
});

vi.mock("@/lib/tenancy/setup-file-server", () => ({
  downloadSetupFile: mocks.downloadSetupFile,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          if (table === "knowledge_sources") {
            mocks.selectCount++;
            if (mocks.selectCount > 1 && mocks.knowledgeSourceRowPost !== null) {
              return { data: mocks.knowledgeSourceRowPost, error: null };
            }
            return { data: mocks.knowledgeSourceRow, error: null };
          }
          return { data: null, error: null };
        },
      };
      return query;
    },
    storage: {
      from: () => ({
        download: mocks.storageDownload,
      }),
    },
  }),
  createBrokerBoundClient: async () => ({
    bound: {
      ok: true,
      resolve: {
        boundary: {
          generation: mocks.brokerGeneration,
          boundaryFingerprint: "owner-boundary",
          userId: "owner-uid-1",
        },
      },
    },
  }),
}));

import { adminListCompanies, adminListCompaniesPage, adminListPendingReviews } from "@/lib/tenancy/actions";
import { adminGetKnowledgeFileUrl } from "@/lib/knowledge/actions";

const OWNER_EMAIL = "velorahelperai@gmail.com";
const VALID_OWNER_CONTEXT = {
  userId: "owner-uid-1",
  email: OWNER_EMAIL,
  phone: "",
  fullName: "Velora Owner",
  supportCode: "OWNER-01",
  needsProfileName: false,
  emailConfirmed: true,
  identityVerified: true,
  isPlatformAdmin: true,
  company: null,
  membership: null,
  needsCompanyContext: false,
  workspaceChoices: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminGate.mockResolvedValue({ ok: true, context: VALID_OWNER_CONTEXT });
  mocks.rpc.mockReset();
  mocks.knowledgeSourceRow = null;
  mocks.knowledgeSourceRowPost = null;
  mocks.brokerGeneration = "gen-1";
  mocks.selectCount = 0;
});

describe("Direct RPC & Action Security Bounds", () => {
  it("rejects direct call to adminListCompanies if caller is not platform owner", async () => {
    mocks.adminGate.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const result = await adminListCompanies("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects direct call to adminListCompaniesPage if caller is not platform owner", async () => {
    mocks.adminGate.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const result = await adminListCompaniesPage({ search: "test", limit: 25, offset: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects direct call to adminGetKnowledgeFileUrl if caller is not platform owner", async () => {
    mocks.adminGate.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const result = await adminGetKnowledgeFileUrl({ companyId: "11111111-1111-4111-8111-111111111111", sourceId: "22222222-2222-4222-8222-222222222222" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });
});

describe("adminListCompaniesPage pagination and filtering constraints", () => {
  it("reads pending reviews through a bounded server filter, not the unbounded legacy directory", async () => {
    mocks.rpc.mockResolvedValue({ data: { rows: [], total_count: 0 }, error: null });
    expect(await adminListPendingReviews()).toEqual({ ok: true, data: [] });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_list_companies_page", { p_search: "", p_status: "pending_review", p_limit: 25, p_offset: 0 });
    expect(mocks.rpc).not.toHaveBeenCalledWith("admin_list_companies", expect.anything());
  });
  it.each([{ search: 42 }, { status: "not-a-status" }, { offset: 2147483648 }])("rejects malformed direct-action input %j before RPC", async (input) => {
    await expect(adminListCompaniesPage(input as Parameters<typeof adminListCompaniesPage>[0])).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("strictly caps limit between 1 and 100", async () => {
    // Generate 120 sample companies
    const mockCompanies = Array.from({ length: 120 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      display_name: `Company ${i}`,
      status: i % 2 === 0 ? "active" : "setup",
      business_type: "services",
      country: "OM",
      city: "Muscat",
      contact_phone: "",
      contact_email: "",
      created_by: "user-1",
      created_at: new Date(Date.now() - i * 1000).toISOString(),
      updated_at: new Date(Date.now() - i * 1000).toISOString(),
      owner_email: `owner${i}@example.com`,
      owner_name: `Owner ${i}`,
      member_count: 2,
      review_requested_at: null,
      review_requested_by: null,
    }));

    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "admin_list_companies_page") {
        const lim = Math.min(Math.max((args.p_limit as number) ?? 25, 1), 100);
        const off = Math.max((args.p_offset as number) ?? 0, 0);
        const slice = mockCompanies.slice(off, off + lim);
        return Promise.resolve({
          data: {
            total_count: mockCompanies.length,
            limit: lim,
            offset: off,
            rows: slice,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Limit over 100 must be clamped to 100
    const overLimit = await adminListCompaniesPage({ limit: 500, offset: 0 });
    expect(overLimit.ok).toBe(true);
    if (overLimit.ok) {
      expect(overLimit.data.limit).toBe(100);
      expect(overLimit.data.rows.length).toBe(100);
      expect(overLimit.data.totalCount).toBe(120);
      expect(overLimit.data.hasMore).toBe(true);
    }

    // Limit under 1 must be clamped to 1
    const underLimit = await adminListCompaniesPage({ limit: -10, offset: 0 });
    expect(underLimit.ok).toBe(true);
    if (underLimit.ok) {
      expect(underLimit.data.limit).toBe(1);
      expect(underLimit.data.rows.length).toBe(1);
    }
  });

  it("computes totalCount using the exact same status and search filters", async () => {
    const mockCompanies = [
      { id: "1", display_name: "Acme Dental", status: "active", owner_email: "a@d.com", created_at: "2026-10-01T00:00:00Z" },
      { id: "2", display_name: "Acme Tech", status: "setup", owner_email: "b@d.com", created_at: "2026-10-02T00:00:00Z" },
      { id: "3", display_name: "Beta Clinic", status: "active", owner_email: "c@d.com", created_at: "2026-10-03T00:00:00Z" },
    ];
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "admin_list_companies_page") {
        const q = String(args.p_search ?? "").toLowerCase();
        const st = String(args.p_status ?? "all");
        const matching = mockCompanies.filter(c => (st === "all" || c.status === st) && (!q || c.display_name.toLowerCase().includes(q)));
        return Promise.resolve({
          data: {
            total_count: matching.length,
            limit: args.p_limit ?? 25,
            offset: args.p_offset ?? 0,
            rows: matching,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Filter by status=setup and search=Acme
    const res = await adminListCompaniesPage({ search: "Acme", status: "setup", limit: 10, offset: 0 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.rows.length).toBe(1);
      expect(res.data.rows[0].display_name).toBe("Acme Tech");
      // Total count reflects matching filters only, NOT all companies!
      expect(res.data.totalCount).toBe(1);
    }
  });
});

describe("/api/admin/knowledge-file TOCTOU session protection", () => {
  it("rejects request if session is revoked/expired before download starts", async () => {
    const { GET } = await import("@/app/api/admin/knowledge-file/route");
    mocks.adminGate.mockResolvedValueOnce({ ok: false, code: "UNAUTHENTICATED" });

    const req = new Request("http://localhost/api/admin/knowledge-file?companyId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("aborts and returns 401 if session is revoked AFTER file is fetched from storage (TOCTOU guard)", async () => {
    const { GET } = await import("@/app/api/admin/knowledge-file/route");
    // Initial check passes
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });
    mocks.knowledgeSourceRow = {
      id: "22222222-2222-4222-8222-222222222222",
      company_id: "11111111-1111-4111-8111-111111111111",
      kind: "file",
      file_name: "secret.pdf",
      storage_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/secret.pdf",
      status: "ready",
    };
    mocks.storageDownload.mockResolvedValueOnce({
      data: new Blob([new Uint8Array([1, 2, 3])]),
      error: null,
    });
    // Post-download check fails (e.g. session was revoked or signed out while storage was downloading)
    mocks.adminGate.mockResolvedValueOnce({ ok: false, code: "UNAUTHENTICATED", sessionExpired: true });

    const req = new Request("http://localhost/api/admin/knowledge-file?companyId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222");
    const res = await GET(req);
    // MUST NOT release bytes! Must return 401
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("releases bytes with private, no-store headers when both pre and post checks pass", async () => {
    const { GET } = await import("@/app/api/admin/knowledge-file/route");
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });
    mocks.knowledgeSourceRow = {
      id: "22222222-2222-4222-8222-222222222222",
      company_id: "11111111-1111-4111-8111-111111111111",
      kind: "file",
      file_name: "public.pdf",
      storage_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/public.pdf",
      status: "ready",
    };
    mocks.storageDownload.mockResolvedValueOnce({
      data: new Blob([new Uint8Array([65, 66, 67])]),
      error: null,
    });
    // Post-download re-check passes
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });

    const req = new Request("http://localhost/api/admin/knowledge-file?companyId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Content-Disposition")).toContain("public.pdf");
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBe(3);
  });

  it("aborts and returns 403 when post-download actor userId differs from pre-download actor", async () => {
    const { GET } = await import("@/app/api/admin/knowledge-file/route");
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });
    mocks.knowledgeSourceRow = {
      id: "22222222-2222-4222-8222-222222222222",
      company_id: "11111111-1111-4111-8111-111111111111",
      kind: "file",
      file_name: "test.pdf",
      storage_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/test.pdf",
      status: "ready",
      content_version: 1,
      updated_at: "2026-10-01T00:00:00Z",
      byte_size: 3,
    };
    mocks.storageDownload.mockResolvedValueOnce({
      data: new Blob([new Uint8Array([1, 2, 3])]),
      error: null,
    });
    // Post-check returns a different user!
    mocks.adminGate.mockResolvedValueOnce({
      ok: true,
      context: { ...VALID_OWNER_CONTEXT, userId: "intruder-uid-99" },
    });

    const req = new Request("http://localhost/api/admin/knowledge-file?companyId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222");
    const res = await GET(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("aborts and returns 403 when post-download session generation differs from pre-download generation", async () => {
    const { GET } = await import("@/app/api/admin/knowledge-file/route");
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });
    mocks.knowledgeSourceRow = {
      id: "22222222-2222-4222-8222-222222222222",
      company_id: "11111111-1111-4111-8111-111111111111",
      kind: "file",
      file_name: "test.pdf",
      storage_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/test.pdf",
      status: "ready",
      content_version: 1,
      updated_at: "2026-10-01T00:00:00Z",
      byte_size: 3,
    };
    mocks.storageDownload.mockImplementationOnce(async () => {
      mocks.brokerGeneration = "gen-new-superseded";
      return {
        data: new Blob([new Uint8Array([1, 2, 3])]),
        error: null,
      };
    });
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });

    const req = new Request("http://localhost/api/admin/knowledge-file?companyId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222");
    const res = await GET(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("aborts and returns 409 when file content_version or updated_at changed while download was in-flight", async () => {
    const { GET } = await import("@/app/api/admin/knowledge-file/route");
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });
    mocks.knowledgeSourceRow = {
      id: "22222222-2222-4222-8222-222222222222",
      company_id: "11111111-1111-4111-8111-111111111111",
      kind: "file",
      file_name: "test.pdf",
      storage_path: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/test.pdf",
      status: "ready",
      content_version: 1,
      updated_at: "2026-10-01T00:00:00Z",
      byte_size: 3,
    };
    mocks.storageDownload.mockResolvedValueOnce({
      data: new Blob([new Uint8Array([1, 2, 3])]),
      error: null,
    });
    // File was replaced in database with version 2 while downloading
    mocks.knowledgeSourceRowPost = {
      ...(mocks.knowledgeSourceRow as Record<string, unknown>),
      content_version: 2,
      updated_at: "2026-10-02T00:00:00Z",
    };
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });

    const req = new Request("http://localhost/api/admin/knowledge-file?companyId=11111111-1111-4111-8111-111111111111&sourceId=22222222-2222-4222-8222-222222222222");
    const res = await GET(req);
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("routes setup files via downloadSetupFile and bypasses generic storage download", async () => {
    const { GET } = await import("@/app/api/admin/knowledge-file/route");
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });
    const companyId = "10000000-0000-4000-8000-000000000001";
    const userId = "20000000-0000-4000-8000-000000000002";
    const draftId = "30000000-0000-4000-8000-000000000003";
    const sourceId = "40000000-0000-4000-8000-000000000004";
    const setupPath = `${companyId}/${userId}/setup/${draftId}/menu.pdf`;
    mocks.knowledgeSourceRow = {
      id: sourceId,
      company_id: companyId,
      kind: "file",
      file_name: "menu.pdf",
      storage_path: setupPath,
      status: "ready",
      content_version: 1,
      updated_at: "2026-10-01T00:00:00Z",
      byte_size: 4,
    };
    mocks.downloadSetupFile.mockResolvedValueOnce({
      bytes: new Uint8Array([10, 20, 30, 40]),
      binding: {
        path: setupPath,
        objectId: "obj-1",
        objectUpdatedAt: "2026-10-01",
        fileName: "menu.pdf",
        contentType: "application/pdf",
        byteSize: 4,
      },
    });
    mocks.adminGate.mockResolvedValueOnce({ ok: true, context: VALID_OWNER_CONTEXT });

    const req = new Request(`http://localhost/api/admin/knowledge-file?companyId=${companyId}&sourceId=${sourceId}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    // Verified that generic storage.download was NOT called for setup files!
    expect(mocks.storageDownload).not.toHaveBeenCalled();
    expect(mocks.downloadSetupFile).toHaveBeenCalled();
  });
});

describe("admin_list_companies_pagination_review.sql security review contract", () => {
  it("strictly enforces public.is_platform_owner() and eliminates can_admin_company and is_platform_admin()", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const migrationPath = path.resolve(process.cwd(), "supabase/migrations/20261022090000_admin_list_companies_pagination_review.sql");
    const sql = fs.readFileSync(migrationPath, "utf-8");

    // Must NOT allow delegated admins via can_admin_company
    expect(sql).not.toContain("can_admin_company");
    // Must NOT use permissive is_platform_admin()
    expect(sql).not.toContain("is_platform_admin()");
    // Must strictly check public.is_platform_owner()
    expect(sql).toContain("public.is_platform_owner()");
    // Both admin_list_companies_page AND admin_list_companies must be guarded
    expect(sql).toContain("create or replace function public.admin_list_companies_page");
    expect(sql).toContain("create or replace function public.admin_list_companies(");
  });
});

describe("adminListCompaniesPage no silent fallback", () => {
  it("fails honestly with UNAVAILABLE if admin_list_companies_page RPC errors, without falling back to admin_list_companies", async () => {
    mocks.rpc.mockImplementation((fn: string) => {
      if (fn === "admin_list_companies_page") {
        return Promise.resolve({ data: null, error: { message: "database timeout or rpc error" } });
      }
      if (fn === "admin_list_companies") {
        // Legacy RPC should NOT be called as a silent fallback!
        return Promise.resolve({ data: [{ id: "c1", display_name: "Fallback" }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const res = await adminListCompaniesPage({ search: "", limit: 25, offset: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("UNAVAILABLE");
    }
    // Verify admin_list_companies was NOT called
    expect(mocks.rpc).not.toHaveBeenCalledWith("admin_list_companies", expect.anything());
  });
});
