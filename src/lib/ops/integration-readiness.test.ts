import { describe, expect, it } from "vitest";
import { readIntegrationReadiness, META_LIVE_ENV_CONTRACT } from "@/lib/ops/integration-readiness";

describe("integration readiness", () => {
  it("marks Meta and AI path-ready with live off", () => {
    const snap = readIntegrationReadiness();
    expect(snap.meta.pathReady).toBe(true);
    expect(snap.meta.liveReady).toBe(false);
    expect(snap.meta.liveOps).toBe(false);
    expect(snap.meta.externalSend).toBe(false);
    expect(snap.meta.embeddedSignup).toBe(false);
    expect(snap.meta.secretBackend).toBe("unconfigured");
    expect(snap.meta.secretCandidate).toBe("supabase_vault");
    expect(snap.ai.pathReady).toBe(true);
    expect(snap.ai.liveReady).toBe(false);
    expect(snap.ai.liveAnswering).toBe(false);
    expect(snap.ai.providerWired).toBe(false);
    expect(snap.ai.runtime.code).toBe("NEEDS_SETUP");
    expect(snap.launch.metaIntegrationReady).toBe(true);
    expect(snap.launch.aiIntegrationReady).toBe(true);
    expect(snap.launch.liveWhatsapp).toBe(false);
    expect(snap.launch.liveAi).toBe(false);
    expect(META_LIVE_ENV_CONTRACT).toContain("WHATSAPP_EMBEDDED_SIGNUP");
  });
});
