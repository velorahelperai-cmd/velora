/**
 * Fail-closed copy of the coexistence server predicate.
 * The provider module stays unchanged; this helper matches its required flags and distinct config id.
 */
const assetId = (value: string) => /^[1-9]\d{0,31}$/.test(value);

export type PaidBranchCoexistenceConfig = {
  enabled: true;
  appId: string;
  configId: string;
  graphVersion: string;
  appSecret: string;
};

export function coexistenceServerConfig(env: NodeJS.ProcessEnv = process.env): PaidBranchCoexistenceConfig | null {
  const read = (name: string) => env[name]?.trim() ?? "";
  const appId = read("WHATSAPP_EMBEDDED_SIGNUP_APP_ID");
  const configId = read("WHATSAPP_COEXISTENCE_CONFIG_ID");
  const embeddedConfigId = read("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID");
  const graphVersion = read("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION");
  const appSecret = read("WHATSAPP_APP_SECRET");
  if (
    read("WHATSAPP_COEXISTENCE") !== "true"
    || read("WHATSAPP_ROUTING_MODE") !== "tenant_registry"
    || !assetId(appId)
    || !assetId(configId)
    || configId === embeddedConfigId
    || !/^v\d+\.0$/.test(graphVersion)
    || !appSecret
  ) return null;
  return { enabled: true, appId, configId, graphVersion, appSecret };
}
