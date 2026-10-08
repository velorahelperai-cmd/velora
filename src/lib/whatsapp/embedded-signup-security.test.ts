import {afterEach, describe, expect, it, vi} from "vitest";
import {createEmbeddedSignupAttempt, embeddedSignupClientConfig} from "./embedded-signup";

function configure() {
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP", "true");
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_APP_ID", "123");
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID", "456");
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION", "v25.0");
  vi.stubEnv("WHATSAPP_APP_SECRET", "app-secret");
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN", "system-token");
}
afterEach(() => vi.unstubAllEnvs());
describe("Embedded Signup attempt security", () => {
  it("creates independent unpredictable attempt and nonce identities at the same timestamp", () => {
    configure();
    const input = {companyId:"company",userId:"owner",sessionId:"session",keepOnPhone:false,now:"2026-10-08T01:00:00.000Z"};
    const first=createEmbeddedSignupAttempt(input), second=createEmbeddedSignupAttempt(input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.attempt.id).not.toBe(second.attempt.id);
    expect(first.attempt.nonce).not.toBe(second.attempt.nonce);
    expect(first.attempt.nonce).not.toContain("company");
    expect(first.attempt).toMatchObject({sessionId:"session",expiresAt:"2026-10-08T01:10:00.000Z"});
  });
  it("requires an explicit Graph version instead of silently changing API versions", () => {
    configure(); vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION", "");
    expect(embeddedSignupClientConfig()).toEqual({ok:false,code:"NEEDS_SETUP"});
  });
});
