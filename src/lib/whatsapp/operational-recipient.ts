import "server-only";

/** The service worker supplies configuration; PostgreSQL binds it to the stored
 * inbound message. No browser input or recipient flag authorizes this snapshot. */
export async function bindOperationalRecipient(
  invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  binding: { jobId: string; claimToken: string },
): Promise<void> {
  const value = await invoke("es02_classify_claimed_reply", {
    p_job_id: binding.jobId,
    p_claim_token: binding.claimToken,
    p_configuration_mode: process.env.WHATSAPP_CONFIGURATION_MODE?.trim() || "live",
    p_test_phone_number_id: process.env.WHATSAPP_TEST_PHONE_NUMBER_ID?.trim() || null,
    p_test_recipients: (process.env.WHATSAPP_TEST_RECIPIENTS ?? "").split(",").map(x => x.trim()).filter(Boolean),
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("RECIPIENT_CLASSIFICATION_UNAVAILABLE");
  const result = value as Record<string, unknown>;
  if (result.ok !== true || !["real_customer", "test_number", "legacy"].includes(String(result.recipientClass))) {
    throw Error("RECIPIENT_CLASSIFICATION_UNAVAILABLE");
  }
}
