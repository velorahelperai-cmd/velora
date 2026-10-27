import type {
  PaidBranchConnectionFlow,
  PaidBranchConnectionRead,
  PaidBranchConnectionReason,
  PaidBranchConnectionScope,
  PaidBranchConnectionState,
} from "@/lib/tenancy/paid-branch-connection-contracts";

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

export type PaidChannelUiState =
  | "not_connected"
  | "authorizing"
  | "action_required"
  | "connected_unverified"
  | "ready"
  | "expired"
  | "reconnect_ready"
  | "recoverable_failure"
  | "unavailable";

const uiStateBadges: Record<PaidChannelUiState, [string, string]> = {
  not_connected: ["غير مربوط", "Not connected"],
  authorizing: ["جاري التفويض", "Authorizing"],
  action_required: ["يحتاج إجراء", "Action required"],
  connected_unverified: ["مربوط لكن غير جاهز", "Connected but not ready"],
  ready: ["جاهز", "Ready"],
  expired: ["صلاحيات منتهية", "Authorization expired"],
  reconnect_ready: ["إعادة ربط", "Reconnect available"],
  recoverable_failure: ["فشل قابل للاسترداد", "Recoverable failure"],
  unavailable: ["حالة الربط غير متاحة", "Connection status unavailable"],
};

const reasonGuidanceTable: Partial<Record<PaidBranchConnectionReason, [string, string]>> = {
  conflict: [
    "هذه القناة مرتبطة بفرع آخر في نفس الشركة أو توجد محاولة ربط نشطة. لا يمكن مشاركة نفس سجل القناة على مستوى الشركة.",
    "This channel is already linked to another branch in the same company or has an active attempt. Company-level provider links cannot be shared.",
  ],
  legacy_ambiguous: [
    "يوجد ربط سابق على مستوى الشركة غير مخصص لهذا الفرع. يلزم تحديد الفرع أو مراجعة الربط قبل المتابعة.",
    "An existing company-level connection is not assigned to this branch. Branch assignment must be resolved before continuing.",
  ],
  reconciliation_required: [
    "لم تكتمل خطوة التحقق النهائي بعد تفويض المزود. اضغط «استرداد والتحقق من الربط» لمطابقة حالة المزود بأمان دون إعادة التفويض.",
    "Final verification did not finish after provider authorization. Use “Recover and verify connection” to reconcile safely without re-authorizing.",
  ],
  setup_required: [
    "الحساب الذي تم تفويضه لا يطابق متطلبات الحساب الاحترافي أو الصلاحيات المطلوبة لهذه القناة.",
    "The authorized account does not meet the professional account or permission requirements for this channel.",
  ],
  expired: [
    "انتهت صلاحية محاولة التفويض السابقة. يمكنك بدء عملية ربط جديدة لهذا الفرع.",
    "The previous authorization attempt expired. You can start a new connection for this branch.",
  ],
  stale_scope: [
    "تغيرت بيانات حالة الربط على الخادم. حدّث الحالة ثم أعد المحاولة.",
    "The connection state changed on the server. Refresh status and try again.",
  ],
};

export type PaidChannelConnectionViewModel = {
  uiState: PaidChannelUiState;
  badgeLabel: string;
  headlineLabel: string;
  guidance: string | null;
  canStart: boolean;
  canRecover: boolean;
  canCancel: boolean;
  isReady: boolean;
  isConnectedUnverified: boolean;
  isAuthorizing: boolean;
  isRecoverable: boolean;
  isExpired: boolean;
  canStartFlow: (flow: PaidBranchConnectionFlow) => boolean;
};

export function derivePaidChannelConnectionViewModel(
  read: PaidBranchConnectionRead | null,
  locale: "ar" | "en",
  options?: { inFlight?: "starting" | "completing" | "recovering" | "cancelling" | null },
): PaidChannelConnectionViewModel {
  const idx = locale === "ar" ? 0 : 1;
  const inFlight = options?.inFlight ?? null;
  if (!read || read.sourceStatus !== "ready" || read.connection.state === "unavailable") {
    return {
      uiState: "unavailable",
      badgeLabel: uiStateBadges.unavailable[idx],
      headlineLabel: channelConnectionLabel(null, locale),
      guidance: null,
      canStart: false,
      canRecover: false,
      canCancel: false,
      isReady: false,
      isConnectedUnverified: false,
      isAuthorizing: false,
      isRecoverable: false,
      isExpired: false,
      canStartFlow: () => false,
    };
  }

  const { state, verified, attempt, link, reasonCodes } = read.connection;
  const { canStart, canRecover, canCancel, allowedFlows } = read.capabilities;
  const hasRevision = typeof read.revision === "string" && read.revision.length > 0;
  const pendingExpired = attempt?.status === 'pending' && Number.isFinite(Date.parse(read.asOf))
    && Date.parse(attempt.expiresAt) <= Date.parse(read.asOf);

  let uiState: PaidChannelUiState = "not_connected";
  if (state === "connected" && verified && link && link.generation >= 1) {
    uiState = "ready";
  } else if (state === "connected" && !verified) {
    uiState = "connected_unverified";
  } else if (inFlight === "starting" || inFlight === "completing") {
    uiState = "authorizing";
  } else if (pendingExpired) {
    uiState = 'expired';
  } else if (state === "reconciliation_required" || state === "legacy_ambiguous" || canRecover || reasonCodes.includes("conflict")) {
    uiState = "recoverable_failure";
  } else if (state === "pending" || attempt?.status === "pending" || attempt?.status === "claimed") {
    uiState = "authorizing";
  } else if (attempt?.status === "expired" || reasonCodes.includes("expired")) {
    uiState = "expired";
  } else if (reasonCodes.some((code) => code === "setup_required" || code === "selection_required" || code === "channel_not_selected" || code === "unpaid")) {
    uiState = "action_required";
  } else if (canStart && (attempt?.status === "cancelled" || attempt?.status === "rejected")) {
    uiState = "reconnect_ready";
  } else {
    uiState = "not_connected";
  }

  let guidance: string | null = null;
  if (pendingExpired) guidance = locale === 'ar'
    ? 'انتهت مهلة محاولة الربط. ألغِ المحاولة الحالية بأمان قبل إعادة التفويض؛ لم يتم تأكيد الاتصال.'
    : 'This connection attempt has expired. Safely cancel the current attempt before authorizing again; connection has not been verified.';
  for (const code of reasonCodes) {
    if (guidance) break;
    const entry = reasonGuidanceTable[code];
    if (entry) {
      guidance = entry[idx];
      break;
    }
  }
  if (!guidance) {
    if (uiState === "connected_unverified") {
      guidance = locale === "ar"
        ? "تم ربط القناة مبدئيًا، لكن يلزم إتمام التحقق من الاستقبال والإرسال قبل اعتبار الفرع جاهزًا."
        : "The channel link is recorded, but inbound and outbound verification is still required before this branch is ready.";
    } else if (uiState === "ready") {
      guidance = locale === "ar"
        ? "تم التحقق من ربط القناة وحفظها لهذا الفرع بنجاح."
        : "Channel connection is verified and bound to this branch.";
    } else if (uiState === "reconnect_ready") {
      guidance = locale === "ar"
        ? "لم تكتمل المحاولة السابقة. يمكنك إعادة بدء الربط الآن."
        : "The previous attempt did not complete. You can restart the connection now.";
    }
  }

  const effectiveCanStart = canStart && hasRevision && !inFlight;
  const effectiveCanRecover = canRecover && !pendingExpired && !!attempt && !!read.connection.flow && !inFlight;
  const effectiveCanCancel = canCancel && !!attempt && !!read.connection.flow && !inFlight;

  return {
    uiState,
    badgeLabel: uiStateBadges[uiState][idx],
    headlineLabel: channelConnectionLabel(read, locale),
    guidance,
    canStart: effectiveCanStart,
    canRecover: effectiveCanRecover,
    canCancel: effectiveCanCancel,
    isReady: uiState === "ready",
    isConnectedUnverified: uiState === "connected_unverified",
    isAuthorizing: uiState === "authorizing",
    isRecoverable: uiState === "recoverable_failure",
    isExpired: uiState === "expired",
    canStartFlow: (flow: PaidBranchConnectionFlow) => effectiveCanStart && allowedFlows.includes(flow),
  };
}
