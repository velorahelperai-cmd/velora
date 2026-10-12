/** Parent Meta App Settings > Basic webhook secret, NOT Instagram Login OAuth secret. */
export type ParentWebhookSecret = Readonly<{ source: "parent_webhook_app"; value: string }>;
export type RawProviderTimestamp = string | number | null;
type EventBinding = Readonly<{
  professionalAccountId: string; senderId: string; recipientId: string; messageId: string;
  rawTimestamp?: RawProviderTimestamp; rawEntryTimestamp?: RawProviderTimestamp;
}>;
export type InstagramWebhookEvent = EventBinding & (
  | Readonly<{ kind: "message"; direction: "inbound" | "outbound"; isEcho: boolean | null;
      content: Readonly<{ kind: "text"; text: string }> | Readonly<{ kind: "non_text" }> }>
  | Readonly<{ kind: "read" }>
);
export type IgnoredWebhookReason = "UNSUPPORTED_OBJECT" | "MALFORMED_ENTRY" | "MALFORMED_EVENT" | "UNSUPPORTED_EVENT" | "ACCOUNT_MISMATCH";
/** No company, authorization generation, universal event ID, HTML or window claims. */
export type InstagramWebhookParseResult =
  | Readonly<{ ok: true; events: readonly InstagramWebhookEvent[]; ignored: readonly Readonly<{ reason: IgnoredWebhookReason }>[] }>
  | Readonly<{ ok: false; code: "INVALID_PAYLOAD" | "INVALID_SIGNATURE" | "INVALID_JSON" }>;
