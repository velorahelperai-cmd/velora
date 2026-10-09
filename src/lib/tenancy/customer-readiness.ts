/**
 * Customer readiness checklist — derived from the same server sources admin uses.
 * Review approval ≠ WhatsApp ≠ billing ≠ AI. Unimplemented integrations stay not_configured.
 */

import type { KnowledgeApprovalFoundation, KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { isApprovedForAnswers } from "@/lib/knowledge/types";
import type { CompanyRole, CompanyStatus, ReviewStatus } from "@/lib/tenancy/types";
import type { WhatsappLinkStatus } from "@/lib/whatsapp/connection";

export type ReadinessTone =
  | "complete"
  | "incomplete"
  | "pending"
  | "blocked"
  | "load_failed"
  | "not_configured";

export type CustomerReadinessItemId =
  | "account"
  | "company"
  | "knowledge"
  | "whatsapp"
  | "review"
  | "subscription";

export type ReadinessDetail =
  | "ok"
  | "needs_name"
  | "no_company"
  | "company_setup"
  | "company_active"
  | "company_suspended"
  | "knowledge_empty"
  | "knowledge_unapproved"
  | "knowledge_ready"
  | "knowledge_foundation_unavailable"
  | "wa_not_connected"
  | "wa_request_saved"
  | "wa_needs_external"
  | "wa_verified"
  | "wa_error"
  | "wa_disconnected"
  | "wa_verified_not_live"
  | "review_none"
  | "review_pending"
  | "review_changes"
  | "review_approved"
  | "review_owner_only"
  | "subscription_unimplemented"
  | "subscription_active"
  | "subscription_inactive"
  | "subscription_owner_only"
  | "load_failed";

export type ReadinessAction = "continue" | "review" | "edit" | "none";

export type CustomerReadinessItem = {
  id: CustomerReadinessItemId;
  tone: ReadinessTone;
  detail: ReadinessDetail;
  href: string | null;
  action: ReadinessAction;
};

export type CustomerReadinessSnapshot = {
  fullName: string;
  email: string;
  role: CompanyRole | null;
  companyId: string | null;
  companyName: string | null;
  companyStatus: CompanyStatus | null;
  items: CustomerReadinessItem[];
  /** First actionable incomplete/pending/blocked item (owners prefer setup CTAs). */
  nextItemId: CustomerReadinessItemId | null;
};

function waDetail(status: WhatsappLinkStatus): ReadinessDetail {
  switch (status) {
    case "not_connected":
      return "wa_not_connected";
    case "request_saved":
      return "wa_request_saved";
    case "needs_external_action":
      return "wa_needs_external";
    case "verified":
      return "wa_verified";
    case "error":
      return "wa_error";
    case "disconnected":
      return "wa_disconnected";
  }
}

function waTone(status: WhatsappLinkStatus): ReadinessTone {
  if (status === "verified") return "complete";
  if (status === "request_saved" || status === "needs_external_action") return "pending";
  if (status === "error") return "blocked";
  return "incomplete";
}

function reviewDetail(status: ReviewStatus | null): ReadinessDetail {
  if (status === "pending_review") return "review_pending";
  if (status === "changes_requested") return "review_changes";
  if (status === "approved") return "review_approved";
  return "review_none";
}

function reviewTone(status: ReviewStatus | null): ReadinessTone {
  if (status === "approved") return "complete";
  if (status === "pending_review") return "pending";
  if (status === "changes_requested") return "incomplete";
  return "incomplete";
}

/** Pure builder — callers pass already-fetched server payloads (or load-fail flags). */
/** Setup step 1 — same knowledge semantics as dashboard readiness (not “any uploaded row”). */
export function evaluateSetupKnowledgeProgress(input: {
  loadFailed: boolean;
  sources: KnowledgeSourceRecord[];
  approvalFoundation: KnowledgeApprovalFoundation;
}): {
  detail: ReadinessDetail;
  /** At least one source is technically ready (prepared text). */
  stepComplete: boolean;
  canAdvance: boolean;
} {
  if (input.loadFailed) {
    return { detail: "load_failed", stepComplete: false, canAdvance: false };
  }
  if (input.sources.length === 0) {
    return { detail: "knowledge_empty", stepComplete: false, canAdvance: false };
  }
  const hasReady = input.sources.some((s) => s.status === "ready");
  if (!hasReady) {
    return { detail: "knowledge_unapproved", stepComplete: false, canAdvance: false };
  }
  if (input.approvalFoundation === "unavailable") {
    return {
      detail: "knowledge_foundation_unavailable",
      stepComplete: true,
      canAdvance: true,
    };
  }
  const approved = input.sources.some(isApprovedForAnswers);
  return {
    detail: approved ? "knowledge_ready" : "knowledge_unapproved",
    stepComplete: true,
    canAdvance: true,
  };
}

export function buildCustomerReadiness(input: {
  fullName: string;
  email: string;
  needsProfileName: boolean;
  role: CompanyRole | null;
  companyId: string | null;
  companyName: string | null;
  companyStatus: CompanyStatus | null;
  knowledge: {
    loadFailed: boolean;
    sources: KnowledgeSourceRecord[];
    approvalFoundation: "ready" | "unavailable";
  } | null;
  whatsapp: {
    loadFailed: boolean;
    status: WhatsappLinkStatus | null;
    suspended: boolean;
    liveOpsReady: boolean;
  } | null;
  review: {
    loadFailed: boolean;
    status: ReviewStatus | null;
  } | null;
  subscription?: {loadFailed:boolean;status:string|null;paidThrough:string|null}|null;
}): CustomerReadinessSnapshot {
  const isOwner = input.role === "owner";
  const hasCompany = Boolean(input.companyId);

  const account: CustomerReadinessItem = input.needsProfileName
    ? {
      id: "account",
      tone: "incomplete",
      detail: "needs_name",
      href: "/complete-profile",
      action: "continue",
    }
    : {
      id: "account",
      tone: "complete",
      detail: "ok",
      href: "/account",
      action: "review",
    };

  let company: CustomerReadinessItem;
  if (!hasCompany) {
    company = {
      id: "company",
      tone: "incomplete",
      detail: "no_company",
      href: isOwner ? "/setup" : null,
      action: isOwner ? "continue" : "none",
    };
  } else if (input.companyStatus === "suspended") {
    company = {
      id: "company",
      tone: "blocked",
      detail: "company_suspended",
      href: "/app/settings?tab=business",
      action: "review",
    };
  } else if (input.companyStatus === "setup") {
    company = {
      id: "company",
      tone: "incomplete",
      detail: "company_setup",
      href: isOwner ? "/setup" : "/app/settings?tab=business",
      action: isOwner ? "continue" : "review",
    };
  } else {
    company = {
      id: "company",
      tone: "complete",
      detail: "company_active",
      href: isOwner ? "/app/settings?tab=business" : "/app/settings?tab=account",
      action: "edit",
    };
  }

  let knowledge: CustomerReadinessItem;
  if (!hasCompany) {
    knowledge = {
      id: "knowledge",
      tone: "incomplete",
      detail: "no_company",
      href: isOwner ? "/setup" : null,
      action: isOwner ? "continue" : "none",
    };
  } else if (!input.knowledge || input.knowledge.loadFailed) {
    knowledge = {
      id: "knowledge",
      tone: "load_failed",
      detail: "load_failed",
      href: "/app/knowledge",
      action: "review",
    };
  } else if (input.knowledge.sources.length === 0) {
    knowledge = {
      id: "knowledge",
      tone: "incomplete",
      detail: "knowledge_empty",
      href: isOwner ? "/app/knowledge" : "/app/knowledge",
      action: isOwner ? "continue" : "review",
    };
  } else if (input.knowledge.approvalFoundation === "unavailable") {
    knowledge = {
      id: "knowledge",
      tone: "incomplete",
      detail: "knowledge_foundation_unavailable",
      href: "/app/knowledge",
      action: "review",
    };
  } else {
    const approved = input.knowledge.sources.filter(isApprovedForAnswers).length;
    if (approved > 0) {
      knowledge = {
        id: "knowledge",
        tone: "complete",
        detail: "knowledge_ready",
        href: "/app/knowledge",
        action: "edit",
      };
    } else {
      knowledge = {
        id: "knowledge",
        tone: "incomplete",
        detail: "knowledge_unapproved",
        href: "/app/knowledge",
        action: isOwner ? "continue" : "review",
      };
    }
  }

  let whatsapp: CustomerReadinessItem;
  if (!hasCompany) {
    whatsapp = {
      id: "whatsapp",
      tone: "incomplete",
      detail: "no_company",
      href: isOwner ? "/setup" : null,
      action: isOwner ? "continue" : "none",
    };
  } else if (input.whatsapp?.suspended || input.companyStatus === "suspended") {
    whatsapp = {
      id: "whatsapp",
      tone: "blocked",
      detail: "company_suspended",
      href: "/app/settings?tab=whatsapp",
      action: "review",
    };
  } else if (!input.whatsapp || input.whatsapp.loadFailed || !input.whatsapp.status) {
    whatsapp = {
      id: "whatsapp",
      tone: "load_failed",
      detail: "load_failed",
      href: "/app/settings?tab=whatsapp",
      action: "review",
    };
  } else {
    const status = input.whatsapp.status;
    if (status === "verified" && !input.whatsapp.liveOpsReady) {
      whatsapp = {
        id: "whatsapp",
        tone: "not_configured",
        detail: "wa_verified_not_live",
        href: "/app/settings?tab=whatsapp",
        action: "review",
      };
    } else {
      whatsapp = {
        id: "whatsapp",
        tone: waTone(status),
        detail: waDetail(status),
        href: "/app/settings?tab=whatsapp",
        action: status === "verified" ? "review" : isOwner ? "continue" : "review",
      };
    }
  }

  let review: CustomerReadinessItem;
  if (!isOwner) {
    review = {
      id: "review",
      tone: "not_configured",
      detail: "review_owner_only",
      href: null,
      action: "none",
    };
  } else if (!hasCompany) {
    review = {
      id: "review",
      tone: "incomplete",
      detail: "no_company",
      href: "/setup",
      action: "continue",
    };
  } else if (!input.review || input.review.loadFailed) {
    review = {
      id: "review",
      tone: "load_failed",
      detail: "load_failed",
      href: "/setup",
      action: "review",
    };
  } else {
    const status = input.review.status;
    review = {
      id: "review",
      tone: reviewTone(status),
      detail: reviewDetail(status),
      href: "/setup",
      action: status === "approved" || status === "pending_review" ? "review" : "continue",
    };
  }

  const subscription: CustomerReadinessItem = {
    id: "subscription",
    tone: input.subscription?.loadFailed?"blocked":input.subscription&&["active","cancel_at_period_end"].includes(input.subscription.status??"")&&Date.parse(input.subscription.paidThrough??"")>Date.now()?"complete":"not_configured",
    detail: !isOwner?"subscription_owner_only":input.subscription?.loadFailed?"load_failed":input.subscription&&["active","cancel_at_period_end"].includes(input.subscription.status??"")&&Date.parse(input.subscription.paidThrough??"")>Date.now()?"subscription_active":"subscription_inactive",
    href: isOwner ? "/app/settings?tab=plan" : null,
    action: isOwner ? "review" : "none",
  };

  const items = [account, company, knowledge, whatsapp, review, subscription];

  const nextItemId =
    items.find((item) =>
      item.action !== "none"
      && (item.tone === "incomplete" || item.tone === "pending" || item.tone === "blocked" || item.tone === "load_failed")
    )?.id ?? null;

  return {
    fullName: input.fullName,
    email: input.email,
    role: input.role,
    companyId: input.companyId,
    companyName: input.companyName,
    companyStatus: input.companyStatus,
    items,
    nextItemId,
  };
}
