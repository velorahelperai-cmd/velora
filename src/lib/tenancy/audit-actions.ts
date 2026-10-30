"use server";

import { redactSensitiveData } from "./audit-redaction";
import { logEvent } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformOwner } from "@/lib/tenancy/access";
import type {
  AdminAuditFilter,
  AdminAuditLogEntry,
  AdminAuditOverviewData,
  AuditCategory,
} from "./audit-types";

export type AdminAuditResult =
  | {
      ok: true;
      data: AdminAuditOverviewData;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE";
      message?: string;
    };

const CATEGORY_PATTERNS: Record<Exclude<AuditCategory, "system">, string> = {
  security: "^(access|auth|security)[.]|role|grant",
  support: "^support_|^ticket[.]|ticket",
  billing: "^(billing|payment|order)[.]|settlement",
  company: "^(company|member|review)[.]|setup",
  channel: "^(channel|whatsapp|instagram)[.]|webhook",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapePattern = (text: string) => text.replace(/[\\%_]/g, match => "\\" + match);

function determineAuditCategory(action: string): AuditCategory {
  const a = action.toLowerCase();
  if (a.startsWith("access.") || a.startsWith("auth.") || a.startsWith("security.") || a.includes("role") || a.includes("grant")) {
    return "security";
  }
  if (a.startsWith("support_") || a.startsWith("ticket.") || a.includes("ticket")) {
    return "support";
  }
  if (a.startsWith("billing.") || a.startsWith("payment.") || a.startsWith("order.") || a.includes("settlement")) {
    return "billing";
  }
  if (a.startsWith("company.") || a.startsWith("member.") || a.startsWith("review.") || a.includes("setup")) {
    return "company";
  }
  if (a.startsWith("channel.") || a.startsWith("whatsapp.") || a.startsWith("instagram.") || a.includes("webhook")) {
    return "channel";
  }
  return "system";
}

export async function adminGetAuditLogsOverview(
  filter?: AdminAuditFilter
): Promise<AdminAuditResult> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED" || admin.code === "UNAUTHENTICATED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (admin.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN" };
  }

  try {
    const supabase = await createClient();
    const limit = Number.isSafeInteger(filter?.limit) ? Math.min(Math.max(filter!.limit!, 1), 100) : 50;
    const offset = Number.isSafeInteger(filter?.offset) ? Math.max(filter!.offset!, 0) : 0;
    let query = supabase.from("admin_audit_logs")
      .select("id, actor_user_id, company_id, action, before_data, after_data, created_at", { count: "exact" });
    const action = filter?.action?.trim();
    const category = filter?.category?.trim().toLowerCase();
    const companyId = filter?.companyId?.trim();
    const search = filter?.search?.trim();
    if (action && action !== "all") query = query.ilike("action", "%" + escapePattern(action) + "%");
    if (companyId) {
      if (!UUID.test(companyId)) return { ok: false, code: "UNAVAILABLE", message: "INVALID_COMPANY_FILTER" };
      query = query.eq("company_id", companyId);
    }
    if (category && category !== "all") {
      if (!["security", "support", "billing", "company", "channel", "system"].includes(category)) {
        return { ok: false, code: "UNAVAILABLE", message: "INVALID_CATEGORY_FILTER" };
      }
      // Exclude earlier categories so SQL filtering matches category precedence.
      for (const [name, pattern] of Object.entries(CATEGORY_PATTERNS)) {
        if (name === category) { query = query.filter("action", "imatch", pattern); break; }
        query = query.not("action", "imatch", pattern);
      }
    }
    if (search) {
      if (search.length > 120) return { ok: false, code: "UNAVAILABLE", message: "INVALID_SEARCH_FILTER" };
      const { data: matchingCompanies, error: companyError, count: companyCount } = await supabase
        .from("companies").select("id", { count: "exact" })
        .ilike("display_name", "%" + escapePattern(search) + "%").limit(1000);
      if (companyError || companyCount === null || companyCount > 1000 || !matchingCompanies) throw Error("AUDIT_COMPANY_SEARCH_UNAVAILABLE");
      const terms = ['action.ilike.' + JSON.stringify("%" + escapePattern(search) + "%")];
      if (UUID.test(search)) terms.push("actor_user_id.eq." + search, "company_id.eq." + search);
      if (matchingCompanies.length) terms.push("company_id.in.(" + matchingCompanies.map(c => c.id).join(",") + ")");
      query = query.or(terms.join(","));
    }
    const [page, total, recent] = await Promise.all([
      query.order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + limit - 1),
      supabase.from("admin_audit_logs").select("id", { count: "exact", head: true }),
      supabase.from("admin_audit_logs").select("id", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 86400000).toISOString()),
    ]);
    const { data: rows, error: auditErr, count: filteredCount } = page;
    if (auditErr || filteredCount === null || !rows) throw Error("AUDIT_READ_UNAVAILABLE");
    if (total.error || recent.error || total.count === null || recent.count === null) throw Error("AUDIT_COUNT_UNAVAILABLE");

    const rawLogs = Array.isArray(rows) ? rows : [];

    // 2. Query company names if any company_ids exist
    const companyIds = [...new Set(rawLogs.map((r) => r.company_id).filter((c): c is string => Boolean(c)))];
    const companyNameMap = new Map<string, string>();
    if (companyIds.length > 0) {
      try {
        const { data: compRows } = await supabase
          .from("companies")
          .select("id, display_name").in("id", companyIds);
        if (Array.isArray(compRows)) {
          for (const c of compRows) {
            companyNameMap.set(c.id, c.display_name);
          }
        }
      } catch {
        // Ignored
      }
    }

    // 3. Assemble and filter log entries
    const allEntries: AdminAuditLogEntry[] = rawLogs.map((r) => {
      const category = determineAuditCategory(r.action);
      return {
        id: r.id,
        actorUserId: r.actor_user_id,
        actorEmail: r.actor_user_id === admin.context?.userId ? "velorahelperai@gmail.com" : null,
        companyId: r.company_id,
        companyName: r.company_id ? companyNameMap.get(r.company_id) ?? null : null,
        action: r.action,
        category,
        beforeData: r.before_data && typeof r.before_data === "object"
          ? (redactSensitiveData(r.before_data) as Record<string, unknown>)
          : null,
        afterData: r.after_data && typeof r.after_data === "object"
          ? (redactSensitiveData(r.after_data) as Record<string, unknown>)
          : null,
        createdAt: r.created_at,
      };
    });

    // 5. Distinct actions list for filtering
    const availableActions = [...new Set(allEntries.map((e) => e.action))].sort();

    const data: AdminAuditOverviewData = {
      kpis: {
        totalLogsCount: total.count,
        recent24hCount: recent.count,
        immutabilityGate: "UNKNOWN",
        retentionPolicy: "UNCONFIGURED",
      },
      logs: allEntries,
      availableActions,
      pagination: {
        totalCount: filteredCount,
        limit,
        offset,
        hasMore: offset + rows.length < filteredCount,
      },
    };

    return { ok: true, data };
  } catch (err: unknown) {
    logEvent("error", "admin.audit.read_failed", { stage: "audit_read", error_code: "ADMIN_AUDIT_READ_UNAVAILABLE", error_type: err instanceof Error ? err.name : "Unknown" });
    const message = "ADMIN_AUDIT_READ_UNAVAILABLE";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}
