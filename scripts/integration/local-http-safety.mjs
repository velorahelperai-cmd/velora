// Test tools only. No product settings, credentials or environment files are read.
import { readdir, access } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
const runtimeNames = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "SystemDrive", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
const SANDBOX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SANDBOX_CORRELATION_RE = /^[A-Za-z0-9._:-]{6,120}$/;
const SANDBOX_PIPE_NAME_RE = /^velora-paymob-test-[a-f0-9]{32}$/;
export const SANDBOX_REQUIRED_FIELD_NAMES = Object.freeze([
  "PAYMOB_SECRET_KEY_TEST",
  "PAYMOB_PUBLIC_KEY_TEST",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_INTEGRATION_ID_TEST",
  "PAYMOB_MERCHANT_OWNER_ID",
  "PAYMOB_OMR_UNITS_PER_OMR",
]);
const SANDBOX_SECRET_PATTERNS = [
  /(?:[a-z]{2,3}_)?sk_(?:test|live)_[A-Za-z0-9_-]+/gi,
  /(?:[a-z]{2,3}_)?pk_(?:test|live)_[A-Za-z0-9_-]+/gi,
  /(?:[a-z]{2,3}_)?csk_(?:test|live)_[A-Za-z0-9_-]+/gi,
  /(Token\s+)(?!\[REDACTED\])[A-Za-z0-9._~+/-]+=*/gi,
  /(Bearer\s+)(?!\[REDACTED\])[A-Za-z0-9._~+/-]+=*/gi,
  /(hmac=)(?!\[REDACTED\])[^&\s"']+/gi,
  /(clientSecret=)(?!\[REDACTED\])[^&\s"']+/gi,
  /("?(?:hmacSecret|secretKey|client_secret|clientSecret|authorization|Authorization)"?\s*:\s*"?)(?!(?:Token|Bearer)\s+\[REDACTED\]|\[REDACTED)[^",\s}]+/gi,
  /(\+\d{7,15})/g,
];

export function redactPaymobSandboxText(value) {
  let text = String(value ?? "");
  for (const pattern of SANDBOX_SECRET_PATTERNS) {
    text = text.replace(pattern, (full, prefix) => {
      if (typeof prefix === "string" && /^(hmac=|clientSecret=|Token\s+|Bearer\s+)/i.test(prefix)) {
        return `${prefix.replace(/\s+$/, " ")}[REDACTED]`;
      }
      if (typeof prefix === "string" && prefix.includes(":")) return `${prefix}[REDACTED]`;
      if (full.startsWith("+")) return "[REDACTED_PHONE]";
      return "[REDACTED]";
    });
  }
  return text;
}

export function sanitizePaymobSandboxCorrelationId(
  value,
  fallback = "paymob-sandbox-uncorrelated",
) {
  const raw = value != null ? String(value).trim() : "";
  if (!raw || !SANDBOX_CORRELATION_RE.test(raw)) return fallback;
  const redacted = redactPaymobSandboxText(raw);
  if (redacted !== raw || /\[REDACTED/i.test(redacted)) return fallback;
  return raw;
}

export function formatPaymobSandboxLogEntry(input) {
  const correlationId = sanitizePaymobSandboxCorrelationId(
    input?.correlationId,
    "paymob-sandbox-uncorrelated",
  );
  const entry = {
    timestamp: new Date().toISOString(),
    scope: "paymob_sandbox",
    correlationId,
    stage: redactPaymobSandboxText(input?.stage ?? "unknown"),
    code: redactPaymobSandboxText(input?.code ?? "ok"),
  };
  if (input?.orderId) entry.orderId = redactPaymobSandboxText(input.orderId);
  if (input?.providerOrderId) entry.providerOrderId = redactPaymobSandboxText(input.providerOrderId);
  if (input?.status !== undefined) entry.status = Number(input.status);
  if (input?.detail) entry.detail = redactPaymobSandboxText(input.detail);
  return entry;
}

export function localEnvironment(source = process.env) {
  const env = { NEXT_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" };
  for (const name of runtimeNames) if (source[name] !== undefined) env[name] = source[name];
  return env;
}
export async function assertNoEnvironmentFiles(root) {
  const names = await readdir(root);
  if (names.some(name => (name === ".env" || name.startsWith(".env.")) && name !== ".env.example")) throw Error("LOCAL_TEST_ENV_FILES_PRESENT");
}
export async function assertPortsFree(ports) {
  const servers = [];
  try {
    for (const port of ports) {
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error("INVALID_LOCAL_TEST_PORT");
      const server = createServer(); servers.push(server);
      await new Promise((ok, fail) => { server.once("error", () => fail(Error(`LOCAL_TEST_PORT_BUSY_${port}`))); server.listen(port, "127.0.0.1", ok); });
    }
  } finally { await Promise.all(servers.map(server => new Promise(ok => server.listening ? server.close(ok) : ok()))); }
}
export function guardedEnvironment(root, extra) {
  // NODE_OPTIONS parses backslashes as escapes, unlike spawn's argv array.
  const guardPath = resolve(root, "scripts/integration/local-http-network-guard.cjs").replaceAll("\\", "/");
  return { ...localEnvironment(), ...extra, NODE_OPTIONS: `--require="${guardPath}"` };
}

/**
 * Isolated Sandbox runtime environment:
 * - Preserves local-http-network-guard.cjs untouched by loading paymob-sandbox-network-guard.cjs in a separate helper.
 * - Requires isolated test DB `c1_ui_integration`.
 * - Locks Live mode to false and rejects any live keys or flags.
 */
export function sandboxGuardedEnvironment(root, extra = {}, options = {}) {
  const database = String(options.database ?? extra.VELORA_SANDBOX_DATABASE ?? "c1_ui_integration").trim();
  if (database !== "c1_ui_integration") throw Error("SANDBOX_ISOLATED_DB_REQUIRED");
  const merged = { ...extra };
  const isTrue = v => ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
  if (
    isTrue(merged.BILLING_PAYMOB_LIVE_ENABLED) ||
    isTrue(merged.PAYMOB_LIVE_ENABLED) ||
    String(merged.PAYMOB_ENVIRONMENT ?? "test").trim().toLowerCase() === "live" ||
    Object.entries(merged).some(([k, v]) => /_LIVE($|_)/i.test(k) && String(v ?? "").trim() !== "" && !["false", "0"].includes(String(v).trim().toLowerCase())) ||
    Object.values(merged).some(v => /(^|_)(sk|pk|csk)_live_/i.test(String(v ?? "")))
  ) {
    throw Error("SANDBOX_LIVE_MODE_BLOCKED");
  }
  const guardPath = resolve(root, "scripts/integration/paymob-sandbox-network-guard.cjs").replaceAll("\\", "/");
  return {
    ...localEnvironment(),
    ...merged,
    VELORA_SANDBOX_DATABASE: "c1_ui_integration",
    VELORA_PAYMOB_SANDBOX_OUTBOUND: options.allowPaymobOutbound === false ? "false" : "true",
    BILLING_PAYMOB_LIVE_ENABLED: "false",
    PAYMOB_LIVE_ENABLED: "false",
    NODE_OPTIONS: `--require="${guardPath}"`,
  };
}

/**
 * Verifies the actual isolated test database (`c1_ui_integration`) identity at runtime.
 * Rejects any non-isolated database, non-internal Docker network, exposed Postgres host ports,
 * or active background cron jobs.
 */
export async function verifyPaymobSandboxDatabaseIdentity(options = {}) {
  const probeFn = typeof options.probe === "function"
    ? options.probe
    : async () => {
        const dockerBin = options.dockerBin ?? "C:/Users/DELL/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe";
        const dockerConfig = options.dockerConfig;
        const containerName = String(options.postgresContainer ?? "velora-es02-b3-postgres-2964b85e").trim();
        const expectedNetwork = options.networkName ? String(options.networkName).trim() : null;
        const baseArgs = dockerConfig ? ["--config", dockerConfig] : [];
        const inspectOut = (await exec(dockerBin, [...baseArgs, "inspect", containerName], {
          env: localEnvironment(),
          windowsHide: true,
          timeout: 20_000,
        })).stdout.trim();
        const [container] = JSON.parse(inspectOut);
        if (!container || !container.State?.Running) {
          throw Error("SANDBOX_ISOLATED_DB_NOT_RUNNING");
        }
        const netNames = Object.keys(container.NetworkSettings?.Networks ?? {});
        if (netNames.length !== 1 || (expectedNetwork && netNames[0] !== expectedNetwork)) {
          throw Error("SANDBOX_ISOLATED_DB_NETWORK_MISMATCH");
        }
        const netInspectOut = (await exec(dockerBin, [...baseArgs, "network", "inspect", netNames[0]], {
          env: localEnvironment(),
          windowsHide: true,
          timeout: 20_000,
        })).stdout.trim();
        const [network] = JSON.parse(netInspectOut);
        const hostPorts = Object.keys(container.HostConfig?.PortBindings ?? {}).length;
        const sqlQuery = "SELECT json_build_object('db', current_database(), 'cron', current_setting('cron.database_name', true), 'jobs', current_setting('cron.launch_active_jobs', true));";
        const sqlOut = (await exec(
          dockerBin,
          [...baseArgs, "exec", "-u", "postgres", containerName, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "c1_ui_integration", "-Atq", "-c", sqlQuery],
          {
            env: localEnvironment(),
            windowsHide: true,
            timeout: 20_000,
          },
        )).stdout.trim();
        const dbRow = JSON.parse(sqlOut);
        return {
          database: dbRow.db,
          cronDatabase: dbRow.cron,
          cronJobs: dbRow.jobs,
          internal: Boolean(network?.Internal),
          postgresHostPorts: hostPorts,
          postgresContainer: containerName,
          network: netNames[0],
        };
      };

  const identity = await probeFn();
  if (
    !identity ||
    typeof identity !== "object" ||
    identity.database !== "c1_ui_integration" ||
    identity.cronDatabase !== "c1_ui_integration" ||
    identity.cronJobs !== "off" ||
    identity.internal !== true ||
    identity.postgresHostPorts !== 0
  ) {
    throw Error("SANDBOX_ISOLATED_DB_REQUIRED");
  }
  return identity;
}

/**
 * Consumes in-memory Paymob Sandbox credentials only after explicit user Submit.
 * Unifies contract with `es02-paymob-secure-entry.ps1` / `es02-paymob-secure-config.cjs`:
 * - Rejects unsubmitted state, invalid/missing/expired `expiresAt`, and missing `requiredNames`
 *   BEFORE invoking `consumePipe`.
 * - Never reads pending UI fields before Submit and never writes secrets to disk or .env.
 */
export async function consumeSubmittedPaymobSandboxConfig(options = {}) {
  const status = options.statusSnapshot;
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw Error("SANDBOX_CREDENTIALS_NOT_SUBMITTED");
  }
  if (status.state !== "READY_FOR_LOCAL_PRIVATE_CONSUMER" || status.operatorTestOmrVerified !== true) {
    throw Error("SANDBOX_CREDENTIALS_NOT_SUBMITTED");
  }
  if (options.purpose && status.confirmedPurpose !== options.purpose) {
    throw Error("SANDBOX_CREDENTIALS_PURPOSE_MISMATCH");
  }
  if (
    (status.environment !== undefined && status.environment !== "Test") ||
    (status.currency !== undefined && status.currency !== "OMR")
  ) {
    throw Error("SANDBOX_TEST_CREDENTIALS_INVALID");
  }
  if (typeof status.pipeName !== "string" || !SANDBOX_PIPE_NAME_RE.test(status.pipeName)) {
    throw Error("SANDBOX_CREDENTIALS_PIPE_INVALID");
  }
  const requiredNames = Array.isArray(status.requiredNames)
    ? status.requiredNames.map(v => String(v).trim()).sort().join(",")
    : "";
  const expectedNames = [...SANDBOX_REQUIRED_FIELD_NAMES].sort().join(",");
  if (requiredNames !== expectedNames) {
    throw Error("SANDBOX_CREDENTIALS_MISSING_REQUIRED_FIELDS");
  }
  const rawExpiry = status.expiresAt ?? status.expiresAtUtc;
  const expiryMs = typeof rawExpiry === "string" && rawExpiry.trim() !== ""
    ? Date.parse(rawExpiry.trim())
    : NaN;
  if (!Number.isFinite(expiryMs)) {
    throw Error("SANDBOX_CREDENTIALS_EXPIRY_INVALID");
  }
  if (expiryMs <= Date.now()) {
    throw Error("SANDBOX_CREDENTIALS_PIPE_EXPIRED");
  }
  if (typeof options.consumePipe !== "function") {
    throw Error("SANDBOX_CREDENTIALS_CONSUME_CALLBACK_REQUIRED");
  }

  const payload = await options.consumePipe(status);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Error("SANDBOX_CREDENTIALS_NOT_SUBMITTED");
  }
  if (
    Object.keys(payload).some(k => /_LIVE($|_)/i.test(k)) ||
    /(^|_)(sk|pk|csk)_live_/i.test(String(payload.PAYMOB_SECRET_KEY_TEST ?? payload.secretKey ?? "")) ||
    /(^|_)(sk|pk|csk)_live_/i.test(String(payload.PAYMOB_PUBLIC_KEY_TEST ?? payload.publicKey ?? ""))
  ) {
    throw Error("SANDBOX_LIVE_MODE_BLOCKED");
  }

  const payloadKeys = Object.keys(payload).sort().join(",");
  if (payloadKeys !== expectedNames) {
    throw Error("TEST_SETTING_FIELDS_INVALID");
  }
  for (const fieldName of SANDBOX_REQUIRED_FIELD_NAMES) {
    const val = payload[fieldName];
    if (typeof val !== "string" || !val.trim() || val.length > 4096) {
      throw Error("TEST_SETTINGS_MISSING");
    }
  }

  const secretKey = payload.PAYMOB_SECRET_KEY_TEST.trim();
  const publicKey = payload.PAYMOB_PUBLIC_KEY_TEST.trim();
  const hmacSecret = payload.PAYMOB_HMAC_SECRET.trim();
  const integrationRaw = payload.PAYMOB_INTEGRATION_ID_TEST.trim();
  const merchantOwnerId = payload.PAYMOB_MERCHANT_OWNER_ID.trim();
  const omrUnitsRaw = payload.PAYMOB_OMR_UNITS_PER_OMR.trim();

  if (
    !/^(?:[a-z]{2,3}_)?sk_test_[A-Za-z0-9_-]+$/.test(secretKey) ||
    !/^(?:[a-z]{2,3}_)?pk_test_[A-Za-z0-9_-]+$/.test(publicKey)
  ) {
    throw Error("TEST_KEYS_REQUIRED");
  }
  if (!/^[1-9][0-9]*$/.test(merchantOwnerId)) {
    throw Error("TEST_OWNER_ID_INVALID");
  }
  const integration = Number(integrationRaw);
  const units = Number(omrUnitsRaw);
  if (
    !/^[1-9][0-9]*$/.test(integrationRaw) ||
    !Number.isSafeInteger(integration) ||
    integration < 1 ||
    integration > 2147483647 ||
    !/^[1-9][0-9]*$/.test(omrUnitsRaw) ||
    !Number.isSafeInteger(units) ||
    units < 1 ||
    units > 1000000
  ) {
    throw Error("TEST_NUMERIC_CONFIG_INVALID");
  }

  return {
    PAYMOB_SECRET_KEY_TEST: secretKey,
    PAYMOB_PUBLIC_KEY_TEST: publicKey,
    PAYMOB_HMAC_SECRET: hmacSecret,
    PAYMOB_INTEGRATION_ID_TEST: String(integration),
    PAYMOB_MERCHANT_OWNER_ID: merchantOwnerId,
    PAYMOB_OMR_UNITS_PER_OMR: String(units),
    BILLING_PAYMOB_CREATE_ENABLED: "true",
    BILLING_PAYMOB_WEBHOOK_ENABLED: "true",
    BILLING_PAYMOB_SETTLE_ENABLED: "true",
    BILLING_PAYMOB_LIVE_ENABLED: "false",
    PAYMOB_LIVE_ENABLED: "false",
    PAYMOB_OMR_CONVERSION_VERIFIED: "true",
    PAYMOB_API_BASE_URL: "https://oman.paymob.com",
    PAYMOB_CHECKOUT_BASE_URL: "https://om.checkout.paymob.com",
  };
}

/**
 * Deny-by-default ingress policy for Paymob Sandbox testing.
 * Allows ONLY:
 * 1) POST /api/billing/paymob/webhook (with optional ?hmac=... query)
 * 2) GET return for the single pinned test order (`/app/subscription/orders/<pinnedOrderId>` and
 *    `/api/billing/paymob/return?order_id=<pinnedOrderId>`).
 * Denies foreign absolute URIs, pre-normalization path traversal, `/admin`, `/login`, `/setup`,
 * other orders, Server Actions (`POST` to pages / `next-action`), and all other routes.
 */
export function evaluatePaymobSandboxIngressRequest(input) {
  const method = String(input?.method ?? "GET").toUpperCase();
  const rawUrl = String(input?.url ?? "/");
  const headers = input?.headers ?? {};
  const pinnedOrderId = input?.pinnedOrderId ? String(input.pinnedOrderId).trim() : "";
  const hasValidPinnedOrder = SANDBOX_UUID_RE.test(pinnedOrderId);

  if (
    rawUrl.length > 2048 ||
    !rawUrl.startsWith("/") ||
    rawUrl.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl) ||
    rawUrl.includes("\\") ||
    rawUrl.includes("\0") ||
    rawUrl.includes("#")
  ) {
    return { allow: false, status: 403, code: "SANDBOX_INGRESS_MALFORMED_URI" };
  }

  const rawPath = rawUrl.split("?")[0];
  if (
    rawPath.includes("//") ||
    rawPath.includes("..") ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(rawPath) ||
    /%2e|%2f|%5c|%00/i.test(rawPath)
  ) {
    return { allow: false, status: 403, code: "SANDBOX_INGRESS_PATH_TRAVERSAL_BLOCKED" };
  }

  let decodedRawPath;
  try {
    decodedRawPath = decodeURIComponent(rawPath);
  } catch {
    return { allow: false, status: 403, code: "SANDBOX_INGRESS_MALFORMED_URI" };
  }
  if (
    decodedRawPath.includes("..") ||
    decodedRawPath.includes("\\") ||
    decodedRawPath.includes("\0") ||
    decodedRawPath.includes("//") ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(decodedRawPath)
  ) {
    return { allow: false, status: 403, code: "SANDBOX_INGRESS_PATH_TRAVERSAL_BLOCKED" };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl, "http://127.0.0.1");
  } catch {
    return { allow: false, status: 403, code: "SANDBOX_INGRESS_MALFORMED_URI" };
  }
  if (parsed.origin !== "http://127.0.0.1" || parsed.pathname !== rawPath) {
    return { allow: false, status: 403, code: "SANDBOX_INGRESS_PATH_TRAVERSAL_BLOCKED" };
  }

  const nextActionHeader = headers["next-action"] ?? headers["Next-Action"];
  if (nextActionHeader !== undefined) {
    return { allow: false, status: 403, code: "SANDBOX_INGRESS_SERVER_ACTION_BLOCKED" };
  }

  // 1. Webhook endpoint: POST /api/billing/paymob/webhook
  if (parsed.pathname === "/api/billing/paymob/webhook") {
    if (method !== "POST") {
      return { allow: false, status: 405, code: "SANDBOX_INGRESS_WEBHOOK_METHOD_NOT_ALLOWED" };
    }
    for (const key of parsed.searchParams.keys()) {
      if (key !== "hmac") {
        return { allow: false, status: 403, code: "SANDBOX_INGRESS_WEBHOOK_QUERY_BLOCKED" };
      }
    }
    return { allow: true, route: "webhook", stripCookies: true };
  }

  // 2. Pinned test order return page & display-only return API & safe static assets
  if (hasValidPinnedOrder) {
    // The local display reads durable DB evidence, never provider query claims.
    const buildSafeReturnPath = () => parsed.pathname === "/api/billing/paymob/return"
      ? "/api/billing/paymob/return?order_id=" + encodeURIComponent(pinnedOrderId)
      : parsed.pathname;

    const exactOrderPath = `/app/subscription/orders/${pinnedOrderId}`;
    if (parsed.pathname === exactOrderPath) {
      if (method !== "GET" && method !== "HEAD") {
        return { allow: false, status: 405, code: "SANDBOX_INGRESS_RETURN_METHOD_NOT_ALLOWED" };
      }
      return {
        allow: true,
        route: "order_return_page",
        orderId: pinnedOrderId,
        stripCookies: true,
        canonicalReturnPath: buildSafeReturnPath(),
      };
    }
    if (parsed.pathname === "/api/billing/paymob/return") {
      if (method !== "GET") {
        return { allow: false, status: 405, code: "SANDBOX_INGRESS_RETURN_METHOD_NOT_ALLOWED" };
      }
      const requestedOrderId = parsed.searchParams.get("order_id")?.trim() ?? "";
      if (requestedOrderId !== pinnedOrderId) {
        return { allow: false, status: 403, code: "SANDBOX_INGRESS_FOREIGN_ORDER_BLOCKED" };
      }
      return {
        allow: true,
        route: "order_return_api",
        orderId: pinnedOrderId,
        stripCookies: true,
        canonicalReturnPath: buildSafeReturnPath(),
      };
    }
    if (parsed.pathname.startsWith("/_next/static/")) {
      if (method !== "GET" && method !== "HEAD") {
        return { allow: false, status: 405, code: "SANDBOX_INGRESS_STATIC_METHOD_NOT_ALLOWED" };
      }
      if (decodedRawPath.endsWith(".map")) {
        return { allow: false, status: 403, code: "SANDBOX_INGRESS_SOURCEMAP_BLOCKED" };
      }
      return { allow: true, route: "return_static_asset", orderId: pinnedOrderId, stripCookies: true };
    }
  }

  return { allow: false, status: 403, code: "SANDBOX_INGRESS_PATH_BLOCKED" };
}

export function createPaymobSandboxIngressHandler(options = {}) {
  const upstreamHost = "127.0.0.1";
  const upstreamPort = Number(options.upstreamPort ?? 3720);
  if (!Number.isSafeInteger(upstreamPort) || [3730, 3740, 3741, 3840, 3841, 5432].includes(upstreamPort)) {
    throw Error("SANDBOX_INGRESS_INVALID_UPSTREAM_PORT");
  }
  const maxWebhookBodyBytes = Number(options.maxWebhookBodyBytes ?? 262_144);
  const timeoutMs = Number(options.timeoutMs ?? 15_000);
  const onLog = typeof options.onLog === "function" ? options.onLog : entry => console.info(JSON.stringify(entry));

  return (req, res) => {
    const pinnedOrderId = typeof options.getPinnedOrderId === "function"
      ? options.getPinnedOrderId()
      : options.pinnedOrderId;
    const defaultCorrelation = sanitizePaymobSandboxCorrelationId(
      options.correlationId,
      `paymob-sbx-${Date.now()}`,
    );
    const correlationId = sanitizePaymobSandboxCorrelationId(
      req.headers["x-velora-correlation-id"],
      defaultCorrelation,
    );

    const decision = evaluatePaymobSandboxIngressRequest({
      method: req.method,
      url: req.url,
      headers: req.headers,
      pinnedOrderId,
    });

    if (!decision.allow) {
      onLog(formatPaymobSandboxLogEntry({
        correlationId,
        stage: "ingress_blocked",
        code: decision.code,
        status: decision.status,
        orderId: SANDBOX_UUID_RE.test(String(pinnedOrderId ?? "")) ? String(pinnedOrderId) : undefined,
      }));
      res.writeHead(decision.status, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-velora-correlation-id": correlationId,
      });
      res.end(decision.code);
      req.resume();
      return;
    }

    // Browser return on tunnel domain: never trust or forward foreign-domain cookies,
    // and never bypass order ownership. Redirect (303) to the canonical local app origin
    // (`http://127.0.0.1:<upstreamPort>`) where the browser's first-party 127.0.0.1 cookie
    // is evaluated by the app's own owner/order authorization gates.
    if (decision.route === "order_return_page" || decision.route === "order_return_api") {
      const localRedirectLocation = `http://${upstreamHost}:${upstreamPort}${decision.canonicalReturnPath}`;
      onLog(formatPaymobSandboxLogEntry({
        correlationId,
        stage: "return",
        code: "redirect_to_local_origin",
        status: 303,
        orderId: decision.orderId,
      }));
      res.writeHead(303, {
        location: localRedirectLocation,
        "cache-control": "no-store",
        "x-velora-correlation-id": correlationId,
      });
      res.end();
      req.resume();
      return;
    }

    onLog(formatPaymobSandboxLogEntry({
      correlationId,
      stage: `ingress_${decision.route}`,
      code: "allowed",
      orderId: decision.orderId,
    }));

    const forwardHeaders = {
      host: `${upstreamHost}:${upstreamPort}`,
      "x-velora-correlation-id": correlationId,
      "x-velora-sandbox-ingress": "1",
    };
    if (req.headers["content-type"]) forwardHeaders["content-type"] = req.headers["content-type"];
    if (req.headers["accept"]) forwardHeaders["accept"] = req.headers["accept"];
    if (req.headers["user-agent"]) forwardHeaders["user-agent"] = req.headers["user-agent"];

    const chunks = [];
    let received = 0;
    let settled = false;
    let proxyReq = null;

    const failTimeout = () => {
      if (settled) return;
      settled = true;
      if (proxyReq) {
        proxyReq.destroy(Error("SANDBOX_INGRESS_UPSTREAM_TIMEOUT"));
      }
      req.destroy();
      onLog(formatPaymobSandboxLogEntry({
        correlationId,
        stage: `ingress_${decision.route}_timeout`,
        code: "SANDBOX_INGRESS_UPSTREAM_TIMEOUT",
        status: 504,
        orderId: decision.orderId,
      }));
      if (!res.headersSent) {
        res.writeHead(504, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          connection: "close",
          "x-velora-correlation-id": correlationId,
        });
        res.end("SANDBOX_INGRESS_UPSTREAM_TIMEOUT");
      } else {
        res.destroy();
      }
    };

    const timer = setTimeout(failTimeout, timeoutMs);
    res.once("close", () => clearTimeout(timer));
    req.setTimeout(timeoutMs, failTimeout);

    req.on("data", chunk => {
      if (settled) return;
      received += chunk.length;
      if (received > maxWebhookBodyBytes) {
        settled = true;
        clearTimeout(timer);
        onLog(formatPaymobSandboxLogEntry({
          correlationId,
          stage: `ingress_${decision.route}`,
          code: "SANDBOX_INGRESS_PAYLOAD_TOO_LARGE",
          status: 413,
        }));
        res.writeHead(413, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end("SANDBOX_INGRESS_PAYLOAD_TOO_LARGE");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      const bodyBuffer = Buffer.concat(chunks);
      if (bodyBuffer.length > 0) {
        forwardHeaders["content-length"] = String(bodyBuffer.length);
      }
      proxyReq = httpRequest(
        {
          hostname: upstreamHost,
          port: upstreamPort,
          method: req.method,
          path: req.url,
          headers: forwardHeaders,
          timeout: timeoutMs,
        },
        proxyRes => {
          if (settled) {
            proxyRes.destroy();
            return;
          }
          const outHeaders = {
            "cache-control": "no-store",
            "x-velora-correlation-id": correlationId,
          };
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (v !== undefined && !["transfer-encoding", "connection"].includes(k.toLowerCase())) {
              outHeaders[k] = v;
            }
          }
          res.writeHead(proxyRes.statusCode ?? 502, outHeaders);
          proxyRes.pipe(res);
          proxyRes.on("end", () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            onLog(formatPaymobSandboxLogEntry({
              correlationId,
              stage: `ingress_${decision.route}_done`,
              code: `http_${proxyRes.statusCode ?? 502}`,
              status: proxyRes.statusCode ?? 502,
              orderId: decision.orderId,
            }));
          });
        },
      );

      proxyReq.on("timeout", failTimeout);

      proxyReq.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        onLog(formatPaymobSandboxLogEntry({
          correlationId,
          stage: `ingress_${decision.route}_error`,
          code: "SANDBOX_INGRESS_UPSTREAM_UNAVAILABLE",
          status: 502,
          orderId: decision.orderId,
        }));
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        }
        res.end("SANDBOX_INGRESS_UPSTREAM_UNAVAILABLE");
      });

      if (bodyBuffer.length > 0) proxyReq.write(bodyBuffer);
      proxyReq.end();
    });
  };
}

export async function startPaymobSandboxIngress(options = {}) {
  const listenPort = Number(options.listenPort ?? 3725);
  if (!Number.isSafeInteger(listenPort) || (listenPort !== 0 && (listenPort < 1024 || listenPort > 65535))) {
    throw Error("INVALID_SANDBOX_INGRESS_PORT");
  }
  let pinnedOrderId = options.pinnedOrderId ? String(options.pinnedOrderId).trim() : null;
  if (pinnedOrderId && !SANDBOX_UUID_RE.test(pinnedOrderId)) {
    throw Error("INVALID_PINNED_ORDER_ID");
  }
  const server = createHttpServer(
    createPaymobSandboxIngressHandler({
      ...options,
      getPinnedOrderId: () => pinnedOrderId,
    }),
  );
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(listenPort, "127.0.0.1", ok);
  });
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : listenPort,
    setPinnedOrderId(orderId) {
      if (orderId !== null && !SANDBOX_UUID_RE.test(String(orderId))) {
        throw Error("INVALID_PINNED_ORDER_ID");
      }
      pinnedOrderId = orderId ? String(orderId) : null;
    },
    getPinnedOrderId() {
      return pinnedOrderId;
    },
    async close() {
      server.closeAllConnections?.();
      await new Promise(ok => server.listening ? server.close(ok) : ok());
    },
  };
}

/**
 * End-to-end local Sandbox test runner wiring:
 * 1) `assertNoEnvironmentFiles(root)`
 * 2) `verifyPaymobSandboxDatabaseIdentity` (live `c1_ui_integration` check)
 * 3) `consumeSubmittedPaymobSandboxConfig` (post-Submit one-shot pipe consumer)
 * 4) `sandboxGuardedEnvironment` verified in a live child process preloaded with `paymob-sandbox-network-guard.cjs`
 * 5) `startPaymobSandboxIngress` wired to the local upstream app for the pinned test order
 */
export async function startPaymobSandboxTestRunner(options = {}) {
  const root = resolve(options.root ?? ".");
  const stack = options.localStack;
  if (!stack || typeof stack.verify !== "function" || !stack.url || !stack.anonKey || !stack.serviceRoleKey) {
    throw Error("SANDBOX_NATIVE_STACK_BINDING_REQUIRED");
  }
  const appPort = Number(options.appPort ?? 3720);
  const listenPort = Number(options.listenPort ?? 3725);
  if (![3120, 3320, 3720].includes(appPort) || appPort === listenPort) throw Error("SANDBOX_APP_PORT_INVALID");
  // Refuse borrowed listeners before consuming a one-shot submission. Never kill by port.
  await assertPortsFree([appPort, ...(listenPort === 0 ? [] : [listenPort])]);
  await assertNoEnvironmentFiles(root);
  const nextBin = resolve(root, "node_modules/next/dist/bin/next");
  await access(nextBin);
  const databaseIdentity = await verifyPaymobSandboxDatabaseIdentity(options.databaseIdentity);
  const bound = await stack.verify();
  const url = new URL(stack.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
      bound?.database !== databaseIdentity.database || bound?.network !== databaseIdentity.network ||
      bound?.postgresContainer !== databaseIdentity.postgresContainer || bound?.url !== url.origin || bound?.internal !== true || bound?.postgresHostPorts !== 0) {
    throw Error("SANDBOX_APP_DATABASE_BINDING_MISMATCH");
  }
  // Only the local fixture issuer/roles are permitted in the actual Next environment.
  for (const [key, role] of [[stack.anonKey,"anon"],[stack.serviceRoleKey,"service_role"]]) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()); } catch { throw Error("SANDBOX_LOCAL_STACK_KEY_INVALID"); }
    if (claims.role !== role || claims.iss !== url.origin + "/auth/v1" || claims.exp * 1000 <= Date.now()) throw Error("SANDBOX_LOCAL_STACK_KEY_INVALID");
  }
  const consumedConfig = await consumeSubmittedPaymobSandboxConfig(options.consumer);
  const origin = "http://127.0.0.1:" + appPort;
  const runtimeEnv = sandboxGuardedEnvironment(root, {
    ...consumedConfig,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SITE_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: url.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey,
    VELORA_SESSION_BROKER_KEY: randomBytes(32).toString("base64"),
    VELORA_MASTER_JOURNEY_ENABLED: "true",
    VELORA_SMART_ONBOARDING_ENABLED: "false",
    VELORA_ENTERPRISE_LIFECYCLE_ENABLED: "false",
  }, { database: databaseIdentity.database, allowPaymobOutbound: options.allowPaymobOutbound === true });
  runtimeEnv.NODE_OPTIONS += " --max-old-space-size=1024";
  let child, ingress, closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (ingress) await ingress.close();
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") {
        // PID belongs to our unreaped ChildProcess, not a discovered/listener PID.
        await exec("taskkill.exe", ["/PID",String(child.pid),"/T","/F"], {env:localEnvironment(),windowsHide:true,timeout:15_000}).catch(() => {});
      } else child.kill("SIGTERM");
      await Promise.race([new Promise(ok=>child.exitCode!==null||child.signalCode!==null?ok():child.once("exit",ok)),new Promise(ok=>setTimeout(ok,5000))]);
    }
  };
  try {
    child = spawn(process.execPath, [nextBin,"dev","--webpack","--hostname","127.0.0.1","--port",String(appPort)], {cwd:root,env:runtimeEnv,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    // Only structured, allowlisted payment diagnostics leave the owned process.
    // Other Next/Auth output is drained, never persisted or forwarded.
    for (const stream of [child.stdout, child.stderr]) {
      let partial = "";
      stream.on("data", data => {
        const lines=(partial+String(data)).split(/\r?\n/);partial=lines.pop().slice(-32768);
        if(typeof options.onLog!=="function")return;
        for(const line of lines){try{const value=JSON.parse(line);if(!["paymob_sandbox","paymob_webhook"].includes(value.scope))continue;
          options.onLog(formatPaymobSandboxLogEntry({correlationId:value.correlationId,stage:value.stage,code:value.code,orderId:value.orderId,providerOrderId:value.providerOrderId,status:value.status}));
        }catch{/* Non-JSON diagnostics are not payment receipts. */}}
      });
    }
    let spawnFailed=false;child.once("error",()=>{spawnFailed=true;});
    const deadline=Date.now()+Number(options.startupTimeoutMs??120_000);
    let ready=false;
    while(Date.now()<deadline) {
      if(spawnFailed||child.exitCode!==null||child.signalCode!==null)throw Error("SANDBOX_OWNED_NEXT_EXITED");
      try {
        const response=await fetch(origin+"/auth/broker/continuity",{redirect:"manual",headers:{Origin:origin},signal:AbortSignal.timeout(5000)});
        const status=response.status;await response.body?.cancel();if(status===200){ready=true;break;}
      }catch { /* bounded startup only; never a provider retry */ }
      await new Promise(ok=>setTimeout(ok,250));
    }
    if(!ready)throw Error("SANDBOX_OWNED_NEXT_START_TIMEOUT");
    await assertOwnedListener(child,appPort);
    const rechecked=await stack.verify();
    if(rechecked.database!==bound.database||rechecked.network!==bound.network||rechecked.postgresContainer!==bound.postgresContainer||rechecked.url!==bound.url)throw Error("SANDBOX_APP_DATABASE_BINDING_MISMATCH");
    const correlationId=sanitizePaymobSandboxCorrelationId(options.correlationId,"paymob-sbx-"+Date.now());
    ingress=await startPaymobSandboxIngress({listenPort,upstreamPort:appPort,pinnedOrderId:options.pinnedOrderId,timeoutMs:options.timeoutMs??15000,correlationId,onLog:options.onLog});
    return {databaseIdentity,correlationId,ingress,app:{pid:child.pid,origin,port:appPort},close};
  } catch(error) {await close();throw error;}
}

/** Never submit fixture credentials to a listener outside our live Next subtree. */
export async function assertOwnedListener(child, port) {
  if (!child?.pid || child.exitCode !== null || child.killed) throw Error("LOCAL_NEXT_PROCESS_EXITED");
  if (process.platform !== "win32") throw Error("LOCAL_LISTENER_OWNERSHIP_PLATFORM_NOT_VERIFIED");
  const pid = Number(child.pid);
  const script = `$taskIds=[Collections.Generic.HashSet[int]]::new();[void]$taskIds.Add(${pid});$taskProcesses=@(Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId);for($taskI=0;$taskI -lt 8;$taskI++){foreach($taskP in $taskProcesses){if($taskIds.Contains([int]$taskP.ParentProcessId)){[void]$taskIds.Add([int]$taskP.ProcessId)}}};$taskListeners=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop);if($taskListeners.Count -eq 0 -or @($taskListeners|Where-Object{!$taskIds.Contains([int]$_.OwningProcess)}).Count -gt 0){exit 2};Write-Output 'OWNED';`;
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: localEnvironment(), windowsHide: true, timeout: 30000 });
  if (stdout.trim() !== "OWNED") throw Error("LOCAL_LISTENER_NOT_OWNED");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--run-sandbox-harness")) {
    console.error("SANDBOX_HARNESS_OPT_IN_REQUIRED: use --run-sandbox-harness");
    process.exitCode = 1;
  }
}
