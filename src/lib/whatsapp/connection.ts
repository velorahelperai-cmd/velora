/**
 * Per-company WhatsApp link registry (VEL-WA-TENANT-CONNECTION-01).
 * Request ≠ connected. Review approval ≠ WhatsApp / AI / billing.
 */

export type WhatsappLinkStatus =
  | "not_connected"
  | "request_saved"
  | "needs_external_action"
  | "verified"
  | "error"
  | "disconnected";

/** Client-safe snapshot — never includes secrets (none are stored on the link row). */
export type WhatsappCompanyLink = {
  id: string | null;
  companyId: string;
  requestedDisplayNumber: string;
  keepOnPhone: boolean;
  status: WhatsappLinkStatus;
  verifiedDisplayNumber: string | null;
  inboundTestedAt: string | null;
  outboundTestedAt: string | null;
  /**
   * True only for an active verified binding with both tested timestamps.
   * Never true for a new request_saved that still carries prior-link timestamps.
   */
  receptionSendTested: boolean;
  /**
   * When status is not verified, leftover verified/tested/provider fields are
   * historical evidence of a prior link — not proof the current request is tested.
   */
  priorLinkEvidence: boolean;
  lastErrorCode: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Admin-only fields when loaded via admin RPC. */
  adminNote?: string | null;
  providerPhoneNumberId?: string | null;
};

export function isWhatsappLinkStatus(value: string): value is WhatsappLinkStatus {
  return (
    value === "not_connected"
    || value === "request_saved"
    || value === "needs_external_action"
    || value === "verified"
    || value === "error"
    || value === "disconnected"
  );
}

export function mapWhatsappCompanyLink(
  raw: Record<string, unknown>,
  opts?: { includeAdmin?: boolean },
): WhatsappCompanyLink | null {
  const companyId = typeof raw.company_id === "string" ? raw.company_id : null;
  if (!companyId) return null;
  const statusRaw = String(raw.status ?? "not_connected");
  const status = isWhatsappLinkStatus(statusRaw) ? statusRaw : "not_connected";
  const inboundTestedAt = typeof raw.inbound_tested_at === "string" ? raw.inbound_tested_at : null;
  const outboundTestedAt = typeof raw.outbound_tested_at === "string" ? raw.outbound_tested_at : null;
  const verifiedDisplayNumber =
    typeof raw.verified_display_number === "string" ? raw.verified_display_number : null;
  const providerPhoneNumberId =
    typeof raw.provider_phone_number_id === "string" ? raw.provider_phone_number_id : null;
  // Prefer server flag; harden client-side so a stale/miscomputed snapshot cannot mark
  // a non-verified request as currently tested.
  const receptionSendTested = status === "verified"
    && Boolean(raw.reception_send_tested)
    && inboundTestedAt != null
    && outboundTestedAt != null;
  const priorLinkEvidence = typeof raw.prior_link_evidence === "boolean"
    ? raw.prior_link_evidence
    : (
      status !== "verified"
      && (
        verifiedDisplayNumber != null
        || inboundTestedAt != null
        || outboundTestedAt != null
        || (opts?.includeAdmin === true && providerPhoneNumberId != null)
      )
    );
  const link: WhatsappCompanyLink = {
    id: typeof raw.id === "string" ? raw.id : null,
    companyId,
    requestedDisplayNumber: typeof raw.requested_display_number === "string" ? raw.requested_display_number : "",
    keepOnPhone: Boolean(raw.keep_on_phone),
    status,
    verifiedDisplayNumber,
    inboundTestedAt,
    outboundTestedAt,
    receptionSendTested,
    priorLinkEvidence,
    lastErrorCode: typeof raw.last_error_code === "string" ? raw.last_error_code : null,
    createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
  };
  if (opts?.includeAdmin) {
    link.adminNote = typeof raw.admin_note === "string" ? raw.admin_note : null;
    link.providerPhoneNumberId = providerPhoneNumberId;
  }
  return link;
}
