/**
 * Knowledge file background worker rollout.
 * Default OFF: upload/reprocess keep the existing in-request prepare path.
 * Enable only after attempt SQL is installed, native-accepted, and cost/privacy policy approved.
 * Permanent Gemini/PDF provider extract must stay off until this gate is production-ready.
 * Local offline text/plain extract may run while the worker is on and the provider gate is off.
 */
export function knowledgeFileWorkerEnabled(): boolean {
  return process.env.VELORA_KNOWLEDGE_FILE_WORKER_ENABLED === "true";
}

export function knowledgeFileWorkerSecretConfigured(): boolean {
  const secret = process.env.VELORA_KNOWLEDGE_FILE_WORKER_SECRET?.trim() ?? "";
  return secret.length >= 32;
}

/** Paid/provider extract inside the worker — separate from queue + local txt extract. */
export function knowledgeFileWorkerProviderExtractEnabled(): boolean {
  return (
    knowledgeFileWorkerEnabled()
    && process.env.VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT === "true"
  );
}
