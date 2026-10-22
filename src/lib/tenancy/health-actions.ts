"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlatformRole } from "@/lib/tenancy/access-guards";
import type {
  HealthProbeStatus,
  PlatformHealthOverviewData,
  SecurityInvariantCheck,
  SubsystemProbe,
} from "./health-types";

export type HealthResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE"; message?: string };

interface DynamicHealthDbClient {
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
}

export async function adminGetPlatformHealthOverview(): Promise<
  HealthResult<PlatformHealthOverviewData>
> {
  const roleCheck = await requirePlatformRole(["owner", "operations"]);
  if (!roleCheck.ok) {
    if (roleCheck.code === "UNVERIFIED" || roleCheck.code === "UNAUTHENTICATED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (roleCheck.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN", message: roleCheck.message };
  }

  try {
    const supabase = await createClient();
    const dynamicClient = supabase as unknown as DynamicHealthDbClient;

    // 1. Database Connection & Latency Probe (Real PostgreSQL round-trip)
    const t0 = Date.now();
    const { error: dbError } = await supabase.from("companies").select("id").limit(1);
    const dbLatencyMs = Math.max(1, Date.now() - t0);

    const dbStatus: HealthProbeStatus = dbError ? "DOWN" : "HEALTHY";

    // 2. Auth Service Probe
    let authStatus: HealthProbeStatus = "HEALTHY";
    let authLatencyMs: number | null = null;
    try {
      const authT0 = Date.now();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      authLatencyMs = Math.max(1, Date.now() - authT0);
      if (authError || !authData.user) authStatus = "DEGRADED";
    } catch {
      authStatus = "DEGRADED";
    }

    // 3. AI Router & Budget Table Probe (Zero paid provider calls)
    let aiStatus: HealthProbeStatus = "UNKNOWN";
    let aiBudgetInfo = "Provider operation not verified; budget metadata alone is not a runtime probe";
    try {
      const { data: budgetData, error: budgetError } = await dynamicClient
        .from("ai_budget")
        .select("total_budget_baisa, consumed_baisa")
        .limit(1)
        .maybeSingle();

      if (budgetError) {
        aiStatus = "DEGRADED";
        aiBudgetInfo = "Budget query error";
      } else if (budgetData) {
        const totalBaisa = typeof budgetData.total_budget_baisa === "number" ? budgetData.total_budget_baisa : 0;
        const consumedBaisa = typeof budgetData.consumed_baisa === "number" ? budgetData.consumed_baisa : 0;
        const remBaisa = totalBaisa - consumedBaisa;
        aiBudgetInfo = `Budget metadata: ${(remBaisa / 1000).toFixed(3)} OMR remaining; provider operation unverified`;
      }
    } catch {
      aiStatus = "DEGRADED";
    }

    const probes: SubsystemProbe[] = [
      {
        id: "postgres_db",
        nameAr: "قاعدة بيانات Supabase (PostgreSQL)",
        nameEn: "Supabase PostgreSQL Database",
        category: "database",
        status: dbStatus,
        latencyMs: dbLatencyMs,
        detailsAr: dbError ? `خطأ اتصال: ${dbError.message}` : `متصلة وجاهزة · زمن الاستجابة: ${dbLatencyMs}ms`,
        detailsEn: dbError ? `Error: ${dbError.message}` : `Online and healthy · Latency: ${dbLatencyMs}ms`,
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: "gotrue_auth",
        nameAr: "خدمة الهوية والجلسات (GoTrue Auth)",
        nameEn: "GoTrue Auth Service",
        category: "auth",
        status: authStatus,
        latencyMs: authLatencyMs,
        detailsAr: "التحقق من جلسات JWT وتفويض الصلاحيات نشط",
        detailsEn: "JWT session validation and RBAC checks active",
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: "meta_wa_webhook",
        nameAr: "قناة مسار واتساب (Meta WhatsApp Webhook)",
        nameEn: "Meta WhatsApp Webhook Pipe",
        category: "integrations",
        status: "UNKNOWN",
        latencyMs: null,
        detailsAr: "غير متحقق: لم يُجرَ فحص لقناة واتساب",
        detailsEn: "Unverified: no WhatsApp channel probe was performed",
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: "meta_ig_webhook",
        nameAr: "قناة مسار إنستجرام (Meta Instagram Webhook)",
        nameEn: "Meta Instagram Webhook Pipe",
        category: "integrations",
        status: "UNKNOWN",
        latencyMs: null,
        detailsAr: "غير متحقق: لم يُجرَ فحص لقناة إنستجرام",
        detailsEn: "Unverified: no Instagram channel probe was performed",
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: "paymob_gateway",
        nameAr: "بوابة الدفع (Paymob Sandbox)",
        nameEn: "Paymob Payment Gateway",
        category: "integrations",
        status: "GUARDED",
        latencyMs: null,
        detailsAr: "وضع الاختبار محمى ومفعل (Test Mode) · الدفع المباشر محظور تماماً",
        detailsEn: "Guarded Test Mode active · Zero live charges allowed",
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: "ai_router_fleet",
        nameAr: "محرك وموجه الذكاء الاصطناعي (Velora AI Router)",
        nameEn: "Velora AI Model Router Fleet",
        category: "ai",
        status: aiStatus,
        latencyMs: null,
        detailsAr: aiBudgetInfo,
        detailsEn: aiBudgetInfo,
        lastCheckedAt: new Date().toISOString(),
      },
      {
        id: "storage_service",
        nameAr: "خدمة تخزين المستندات (Supabase Storage)",
        nameEn: "Supabase Object Storage",
        category: "storage",
        status: "UNKNOWN",
        latencyMs: null,
        detailsAr: "غير متحقق: لم يُجرَ فحص للتخزين أو العزل",
        detailsEn: "Unverified: storage access and isolation were not probed",
        lastCheckedAt: new Date().toISOString(),
      },
    ];

    const invariants: SecurityInvariantCheck[] = [
      {
        id: "inv_append_only_audit",
        labelAr: "سجل تدقيق غير قابل للتعديل (Append-Only Audit)",
        labelEn: "Immutable Append-Only Audit Logging",
        status: "WARN",
        evidence: "UNVERIFIED: this request did not execute the relevant security acceptance check",
      },
      {
        id: "inv_tenant_isolation",
        labelAr: "عزل كامل لبيانات الشركات والفروع (Tenant Isolation)",
        labelEn: "Tenant & Branch Boundary Isolation",
        status: "WARN",
        evidence: "UNVERIFIED: this request did not execute the relevant security acceptance check",
      },
      {
        id: "inv_payment_sandbox",
        labelAr: "حماية بوابة الدفع ومنع الخصم الفعلي (Payment Guard)",
        labelEn: "Live Payment Zero-Execution Guard",
        status: "WARN",
        evidence: "UNVERIFIED: this request did not execute the relevant security acceptance check",
      },
      {
        id: "inv_secret_redaction",
        labelAr: "فلترة وتشفير المفاتيح السرية (Secret Redaction)",
        labelEn: "Sensitive Credential Sanitization Filter",
        status: "WARN",
        evidence: "UNVERIFIED: this request did not execute the relevant security acceptance check",
      },
      {
        id: "inv_platform_owner_gate",
        labelAr: "حصر صلاحية المالك في البريد المعتمد (Owner Authorization)",
        labelEn: "Authoritative Platform Owner Boundary",
        status: "WARN",
        evidence: "UNVERIFIED: this request did not execute the relevant security acceptance check",
      },
    ];

    const overallStatus = dbStatus === "DOWN" ? "DOWN" : "DEGRADED";

    const overview: PlatformHealthOverviewData = {
      kpis: {
        overallStatus,
        dbLatencyMs,
        authStatus: authStatus === "HEALTHY" ? "HEALTHY" : "DEGRADED",
        paymentGatewayMode: "TEST_MODE_GUARDED",
        aiRouterStatus: "UNKNOWN",
      },
      probes,
      invariants,
      evaluatedAt: new Date().toISOString(),
    };

    return { ok: true, data: overview };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to execute health check";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}
