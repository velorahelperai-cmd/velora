"use server";

import { getCompanyAccess } from "@/lib/tenancy/access";
import { readOwnedPaidBranchSetupEntryAction } from "@/lib/tenancy/paid-setup-actions";
import { readOwnedBranchLaunchSummaryAction } from "@/lib/tenancy/paid-launch-actions";
import type { LaunchSummarySnapshot } from "@/components/app/paid-launch-summary";

export type DashboardBranchLoad =
  | { status: "unavailable" | "forbidden" | "scope_changed" }
  | { status: "ready"; companyId: string; asOf: string; branches: { id: string; label: string }[]; selectedId: string | null; summary: LaunchSummarySnapshot | null };

/** Read the paid branch's existing receipt. This action never launches or connects. */
export async function readDashboardBranch(input: { expectedCompanyId: string; branchId?: string }): Promise<DashboardBranchLoad> {
  try {
    const access = await getCompanyAccess("owner");
    if (!access.ok) return { status: access.code === "FORBIDDEN" ? "forbidden" : "unavailable" };
    const { company, userId, membership } = access.context;
    if (!company || company.id !== input?.expectedCompanyId || membership?.role !== "owner") return { status: "scope_changed" };
    const entry = await readOwnedPaidBranchSetupEntryAction({ expectedAccountId: userId, companyId: company.id });
    if (entry.sourceStatus === "unavailable" || entry.companyId !== company.id) return { status: "unavailable" };
    // A single branch is unambiguous for display; multiple branches require a selection.
    const selectedId = input.branchId ?? (entry.branches.length === 1 ? entry.branches[0].id : null);
    if (selectedId && !entry.branches.some(branch => branch.id === selectedId)) return { status: "forbidden" };
    const summary = selectedId ? await readOwnedBranchLaunchSummaryAction({ expectedAccountId: userId, companyId: company.id, branchId: selectedId }) : null;
    if (summary && (summary.scope.companyId !== company.id || summary.scope.expectedAccountId !== userId || summary.scope.branchId !== selectedId)) return { status: "scope_changed" };
    return { status: "ready", companyId: company.id, asOf: new Date().toISOString(), branches: entry.branches.map(({ id, label }) => ({ id, label })), selectedId, summary };
  } catch { return { status: "unavailable" }; }
}
