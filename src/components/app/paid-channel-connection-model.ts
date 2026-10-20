import type {PaidBranchConnectionRead, PaidBranchConnectionScope, PaidBranchConnectionState} from "@/lib/tenancy/paid-branch-connection-contracts";

/** Read presentation only. Preserve server capabilities; do not derive permission
 * from a state name or interpret a successful start as connected. */
export function scopedChannelConnection(read: PaidBranchConnectionRead | null | undefined, scope: PaidBranchConnectionScope): PaidBranchConnectionRead | null {
  if (!read || read.schemaVersion !== 1 || read.expectedAccountId !== scope.expectedAccountId ||
      read.companyId !== scope.companyId || read.branchId !== scope.branchId || read.channel !== scope.channel) return null;
  if (read.sourceStatus !== "ready") return null;
  if (read.connection.flow && (scope.channel === "instagram" ? read.connection.flow !== "instagram_direct" : read.connection.flow === "instagram_direct")) return null;
  if (read.connection.verified && (read.connection.state !== "connected" || !read.connection.link || read.connection.link.generation < 1)) return null;
  return read;
}

const labels: Record<PaidBranchConnectionState, [string, string]> = {
  not_connected: ["غير مرتبط", "Not connected"],
  pending: ["الربط قيد الانتظار", "Connection pending"],
  connected: ["تم التحقق من ربط هذا الفرع", "Connection verified for this branch"],
  reconciliation_required: ["نتيجة الربط تحتاج تحققًا", "Connection result needs verification"],
  legacy_ambiguous: ["الربط الحالي غير محدد لهذا الفرع", "Existing connection is not assigned to this branch"],
  unavailable: ["حالة الربط غير متاحة", "Connection status unavailable"],
};
export function channelConnectionLabel(read: PaidBranchConnectionRead | null, locale: "ar" | "en"): string {
  const state = !read ? "unavailable" : read.connection.state === "connected" && !read.connection.verified ? "pending" : read.connection.state;
  return labels[state][locale === "ar" ? 0 : 1];
}
