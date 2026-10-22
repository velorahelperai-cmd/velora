import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "@/lib/auth/session-guard";
import type { PlatformRole, PlatformRoleCatalogItem } from "./access-types";

export const PLATFORM_ROLE_CATALOG: PlatformRoleCatalogItem[] = [
  {
    role: "owner",
    nameAr: "مالك المنصة (Super Admin)",
    nameEn: "Platform Owner",
    descriptionAr: "صلاحيات سيادية كاملة لإدارة المنصة، المشرفين، المالية، ونماذج الذكاء.",
    descriptionEn: "Complete platform sovereign authority covering administration, finance, and AI operations.",
    badgeStyle: "bg-purple-100 text-purple-800 border-purple-200",
    capabilities: [
      "platform.manage_admins",
      "platform.manage_access",
      "platform.billing_write",
      "platform.ai_manage",
      "platform.view_audit",
      "platform.manage_companies",
    ],
  },
  {
    role: "support",
    nameAr: "مشرف الدعم والمراجعات (Support Admin)",
    nameEn: "Support Admin",
    descriptionAr: "البحث عن الحسابات، إدارة تذاكر الدعم، مراجعة ملفات المنشآت، ومراقبة حالة القنوات.",
    descriptionEn: "Customer account lookup, support ticket management, onboarding review, channel status inspection.",
    badgeStyle: "bg-blue-100 text-blue-800 border-blue-200",
    capabilities: [
      "platform.search_accounts",
      "support.tickets.manage",
      "reviews.manage",
      "channels.read",
      "companies.read",
    ],
  },
  {
    role: "finance",
    nameAr: "مشرف المالية والاشتراكات (Finance Admin)",
    nameEn: "Finance Admin",
    descriptionAr: "الاطلاع على سجل الفوترة، أوامر الدفع، تسوية الإيرادات، وكتالوج الباقات دون صلاحيات أمنية أو ذكاء.",
    descriptionEn: "Billing ledger, order inspection, revenue reconciliation, catalog plans without security/AI management.",
    badgeStyle: "bg-emerald-100 text-emerald-800 border-emerald-200",
    capabilities: [
      "billing.ledger.read",
      "billing.orders.read",
      "catalog.plans.manage",
      "financial.reconcile",
    ],
  },
  {
    role: "operations",
    nameAr: "مشرف العمليات والتشغيل (Operations Admin)",
    nameEn: "Operations Admin",
    descriptionAr: "مراقبة مركز العمليات، سجلات الارتباط، زمن استجابة الذكاء، وتدفق الـ Webhooks دون وصول للبيانات المالية.",
    descriptionEn: "Observability center, correlation logs, AI router telemetry, webhook health without financial data access.",
    badgeStyle: "bg-amber-100 text-amber-800 border-amber-200",
    capabilities: [
      "operations.center.read",
      "telemetry.read",
      "ai.router.inspect",
      "webhooks.inspect",
    ],
  },
];

export type PlatformRoleCheckResult =
  | {
      ok: true;
      userId: string;
      email: string;
      role: PlatformRole;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "UNVERIFIED" | "FORBIDDEN" | "UNAVAILABLE";
      message?: string;
    };

/**
 * Validates that the active user possesses one of the allowed platform roles.
 * Strictly verifies database status = 'active' to ensure immediate session invalidation on suspension/revocation.
 */
export async function requirePlatformRole(
  allowedRoles: PlatformRole[]
): Promise<PlatformRoleCheckResult> {
  try {
    const supabase = await createClient();
    const session = await checkAppSession(supabase);
    if (!session.ok) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }

    if (!user.email_confirmed_at) {
      return { ok: false, code: "UNVERIFIED" };
    }

    const email = (user.email ?? "").trim().toLowerCase();

    type AdminTableClient = {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: { role?: string; status?: string } | null; error: { message: string } | null }>;
          };
        };
      };
    };

    const adminClient = supabase as unknown as AdminTableClient;
    const { data: adminRow, error: adminErr } = await adminClient
      .from("platform_admins")
      .select("role, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminErr) {
      return { ok: false, code: "UNAVAILABLE", message: adminErr.message };
    }

    if (!adminRow || adminRow.status !== "active") {
      return { ok: false, code: "FORBIDDEN", message: "Platform admin role revoked or suspended" };
    }

    const assignedRole = adminRow.role as PlatformRole;

    // Super Admin / Owner check requires exact canonical email match
    if (assignedRole === "owner") {
      if (email !== "velorahelperai@gmail.com") {
        return { ok: false, code: "FORBIDDEN", message: "Platform owner identity mismatch" };
      }
    }

    if (!allowedRoles.includes(assignedRole)) {
      return { ok: false, code: "FORBIDDEN", message: `Role ${assignedRole} is not permitted for this operation` };
    }

    return {
      ok: true,
      userId: user.id,
      email,
      role: assignedRole,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Access verification failed";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}
