// Preloaded ONLY by the isolated Paymob Sandbox test runtime.
// Preserves local-http-network-guard.cjs unmodified while permitting only
// verified Test-mode HTTPS calls to https://oman.paymob.com on port 443.
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require must initialize this guard before application ESM. */
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const httpPorts = new Set([
  3120, 3130, 3140, 3141,
  3320, 3330, 3340, 3341,
  3430, 3440, 3441, 3450,
  3630, 3640, 3641, 3650,
  3720, 3725, 3730, 3740, 3741,
  3840, 3841,
]);
const allowedPaymobHost = "oman.paymob.com";
const allowedPaymobPaths = new Set([
  "/v1/intention/",
  "/v1/intention",
  "/api/acceptance/transactions",
  "/api/ecommerce/orders/transaction_inquiry",
  "/api/auth/tokens",
]);

function denied(code = "LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED") {
  throw Error(code);
}

function envEnabled(value) {
  return ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function assertSandboxOutboundPermitted() {
  if (!envEnabled(process.env.VELORA_PAYMOB_SANDBOX_OUTBOUND)) {
    denied("LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED");
  }
  if ((process.env.VELORA_SANDBOX_DATABASE ?? "").trim() !== "c1_ui_integration") {
    denied("SANDBOX_ISOLATED_DB_REQUIRED");
  }
  if (
    envEnabled(process.env.PAYMOB_LIVE_ENABLED) ||
    envEnabled(process.env.BILLING_PAYMOB_LIVE_ENABLED) ||
    (process.env.PAYMOB_SECRET_KEY_LIVE ?? "").trim() !== "" ||
    (process.env.PAYMOB_PUBLIC_KEY_LIVE ?? "").trim() !== "" ||
    (process.env.PAYMOB_INTEGRATION_ID_LIVE ?? "").trim() !== "" ||
    /(^|_)sk_live_|(^|_)pk_live_/i.test(process.env.PAYMOB_SECRET_KEY_TEST ?? "") ||
    /(^|_)sk_live_|(^|_)pk_live_/i.test(process.env.PAYMOB_PUBLIC_KEY_TEST ?? "")
  ) {
    denied("SANDBOX_LIVE_MODE_BLOCKED");
  }
}

function isAllowedPaymobUrl(u) {
  return (
    u.protocol === "https:" &&
    u.hostname.toLowerCase() === allowedPaymobHost &&
    (u.port === "" || u.port === "443") &&
    !u.username &&
    !u.password &&
    !u.hash &&
    allowedPaymobPaths.has(u.pathname)
  );
}

function checkUrl(value) {
  const u = new URL(value instanceof Request ? value.url : String(value));
  if (
    u.protocol === "http:" &&
    localHosts.has(u.hostname) &&
    httpPorts.has(Number(u.port)) &&
    !u.username &&
    !u.password
  ) {
    return;
  }
  if (isAllowedPaymobUrl(u)) {
    assertSandboxOutboundPermitted();
    return;
  }
  denied();
}

function normalizeHost(value) {
  return String(value ?? "").trim().replace(/:\d+$/, "").toLowerCase();
}

function checkOptions(options, defaultPort) {
  if (!options || typeof options !== "object" || options.lookup !== undefined) {
    denied();
  }
  const hasHost = options.host !== undefined && options.host !== null && String(options.host).trim() !== "";
  const hasHostname = options.hostname !== undefined && options.hostname !== null && String(options.hostname).trim() !== "";
  if (hasHost && hasHostname && normalizeHost(options.host) !== normalizeHost(options.hostname)) {
    denied();
  }
  const rawHost = normalizeHost(options.hostname ?? options.host ?? "localhost");
  const servername = options.servername !== undefined && options.servername !== null
    ? normalizeHost(options.servername)
    : "";
  if (servername !== "" && servername !== rawHost) {
    denied();
  }
  const headerHost = options.headers?.Host ?? options.headers?.host;
  if (headerHost !== undefined && normalizeHost(headerHost) !== rawHost) {
    denied();
  }
  const port = Number(options.port || defaultPort);
  if (defaultPort === 80 && localHosts.has(rawHost) && httpPorts.has(port)) {
    return;
  }
  if (defaultPort === 443 && rawHost === allowedPaymobHost && port === 443) {
    const rawPath = String(options.path ?? "/").split("?")[0];
    if (allowedPaymobPaths.has(rawPath) && !options.auth) {
      assertSandboxOutboundPermitted();
      return;
    }
  }
  denied();
}

function wrapRequest(original, defaultPort) {
  return function (...args) {
    if (typeof args[0] === "string" || args[0] instanceof URL) {
      const u = new URL(args[0]);
      checkUrl(u);
      if (args[1] && typeof args[1] === "object") {
        const override = args[1];
        if (
          (override.host !== undefined && normalizeHost(override.host) !== normalizeHost(u.hostname)) ||
          (override.hostname !== undefined && normalizeHost(override.hostname) !== normalizeHost(u.hostname)) ||
          (override.servername !== undefined && normalizeHost(override.servername) !== normalizeHost(u.hostname))
        ) {
          denied();
        }
        checkOptions(
          {
            hostname: u.hostname,
            port: u.port || defaultPort,
            path: u.pathname,
            ...override,
          },
          defaultPort,
        );
      }
    } else {
      checkOptions(args[0] ?? {}, defaultPort);
    }
    return Reflect.apply(original, this, args);
  };
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  checkUrl(input);
  return nativeFetch(input, { ...init, redirect: "error" });
};
http.request = wrapRequest(http.request, 80);
http.get = wrapRequest(http.get, 80);
https.request = wrapRequest(https.request, 443);
https.get = wrapRequest(https.get, 443);

function checkPipePath(pipePath) {
  const normalized = String(pipePath);
  if (!normalized.startsWith("\\\\.\\pipe\\") && !normalized.startsWith("/")) {
    denied();
  }
  if (
    normalized.toLowerCase().includes("velora-paymob-test-") &&
    process.env.VELORA_ALLOW_SECURE_PIPE_CONSUME !== "true"
  ) {
    denied("SANDBOX_SECURE_PIPE_ACCESS_BLOCKED");
  }
}

function checkSocket(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === "object" && first?.path) {
    checkPipePath(first.path);
    return;
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) {
    checkPipePath(first);
    return;
  }
  const opts =
    typeof first === "object" && first !== null
      ? first
      : typeof args[1] === "object" && args[1] !== null
        ? args[1]
        : typeof args[2] === "object" && args[2] !== null
          ? args[2]
          : {};
  if (opts.lookup !== undefined) {
    denied();
  }
  const hasOptHost = opts.host !== undefined && opts.host !== null && String(opts.host).trim() !== "";
  const hasOptHostname = opts.hostname !== undefined && opts.hostname !== null && String(opts.hostname).trim() !== "";
  if (hasOptHost && hasOptHostname && normalizeHost(opts.host) !== normalizeHost(opts.hostname)) {
    denied();
  }
  let rawHost;
  if (typeof first === "object" && first !== null) {
    // Never fall back to `servername` when `host`/`hostname` is absent.
    rawHost = hasOptHostname ? opts.hostname : hasOptHost ? opts.host : opts.servername !== undefined ? "" : "localhost";
  } else if (typeof args[1] === "string") {
    rawHost = args[1];
    if ((hasOptHost && normalizeHost(opts.host) !== normalizeHost(rawHost)) || (hasOptHostname && normalizeHost(opts.hostname) !== normalizeHost(rawHost))) {
      denied();
    }
  } else {
    rawHost = hasOptHostname ? opts.hostname : hasOptHost ? opts.host : opts.servername !== undefined ? "" : "localhost";
  }
  const host = normalizeHost(rawHost);
  const servername = opts.servername !== undefined && opts.servername !== null
    ? normalizeHost(opts.servername)
    : "";
  const port = Number(typeof first === "object" && first !== null ? first.port : args[0]);
  if (localHosts.has(host) && (servername === "" || servername === host)) {
    return;
  }
  if (
    port === 443 &&
    host === allowedPaymobHost &&
    (servername === "" || servername === allowedPaymobHost)
  ) {
    assertSandboxOutboundPermitted();
    return;
  }
  denied();
}

const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  checkSocket(args);
  return Reflect.apply(socketConnect, this, args);
};
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  checkSocket(args);
  return Reflect.apply(tlsConnect, this, args);
};
process.env.NEXT_TELEMETRY_DISABLED = "1";
require("node:module").syncBuiltinESMExports();
