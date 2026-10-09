/**
 * Meta + AI are integration-ready: server hooks exist, live stays off.
 * Flip live only after migrations apply + Vault/provider approval.
 */

import { answerRuntimeSetup } from "@/lib/answers/runtime-setup";
import { isLiveAnsweringEnabled } from "@/lib/answers/guards";
import { getAnswerProvider } from "@/lib/answers/provider";
import {
  AI_INTEGRATION_HOOKS,
  LAUNCH_SCOPE,
  META_INTEGRATION_HOOKS,
} from "@/lib/ops/launch-scope";
import { PENDING_DECISIONS } from "@/lib/ops/pending-decisions";
import { whatsappSecretBackend, WHATSAPP_SECRET_BACKEND_CANDIDATE } from "@/lib/whatsapp/access-secrets";
import {
  embeddedSignupEnabled,
} from "@/lib/whatsapp/embedded-signup";
import { externalSendAllowed, whatsappLiveOpsReady, whatsappRoutingMode } from "@/lib/whatsapp/config";

/** Env keys required later to enable Meta live — not set by this package. */
export const META_LIVE_ENV_CONTRACT = [
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_ROUTING_MODE",
  "WHATSAPP_ALLOW_EXTERNAL_SEND",
  "WHATSAPP_EMBEDDED_SIGNUP",
  "WHATSAPP_EMBEDDED_SIGNUP_APP_ID",
  "WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID",
  "WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION",
  "WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN",
] as const;

export type IntegrationReadinessSnapshot = {
  meta: {
    pathReady: true;
    liveReady: false;
    hooks: typeof META_INTEGRATION_HOOKS;
    routingMode: ReturnType<typeof whatsappRoutingMode>;
    liveOps: boolean;
    externalSend: boolean;
    embeddedSignup: boolean;
    /** Environment snapshots cannot verify deployed SQL/Vault. Owner setup reads the actual RPC. */
    persistReady: null;
    secretBackend: ReturnType<typeof whatsappSecretBackend>;
    secretCandidate: typeof WHATSAPP_SECRET_BACKEND_CANDIDATE;
    applyChain: typeof PENDING_DECISIONS.applyChain;
  };
  ai: {
    pathReady: true;
    liveReady: false;
    hooks: typeof AI_INTEGRATION_HOOKS;
    liveAnswering: boolean;
    providerWired: boolean;
    runtime: ReturnType<typeof answerRuntimeSetup>;
  };
  launch: typeof LAUNCH_SCOPE;
};

export function readIntegrationReadiness(): IntegrationReadinessSnapshot {
  const runtime = answerRuntimeSetup();
  return {
    meta: {
      pathReady: true,
      liveReady: false,
      hooks: META_INTEGRATION_HOOKS,
      routingMode: whatsappRoutingMode(),
      liveOps: whatsappLiveOpsReady(),
      externalSend: externalSendAllowed(),
      embeddedSignup: embeddedSignupEnabled(),
      persistReady: null,
      secretBackend: whatsappSecretBackend(),
      secretCandidate: WHATSAPP_SECRET_BACKEND_CANDIDATE,
      applyChain: PENDING_DECISIONS.applyChain,
    },
    ai: {
      pathReady: true,
      liveReady: false,
      hooks: AI_INTEGRATION_HOOKS,
      liveAnswering: isLiveAnsweringEnabled(),
      providerWired: getAnswerProvider() != null,
      runtime,
    },
    launch: LAUNCH_SCOPE,
  };
}
