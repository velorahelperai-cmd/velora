// Preloaded ONLY by the opt-in local harness, before Next/Vitest/app imports.
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require must initialize this guard before application ESM. */
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const httpPorts = new Set([3120, 3130, 3140, 3141, 3320, 3330, 3340, 3341, 3430, 3440, 3441, 3450, 3630, 3640, 3641, 3650, 3720, 3730, 3740, 3741]);
function denied() { throw Error("LOCAL_TEST_EXTERNAL_NETWORK_BLOCKED"); }
function checkUrl(value) {
  const u = new URL(value instanceof Request ? value.url : String(value));
  if (u.protocol !== "http:" || !localHosts.has(u.hostname) || !httpPorts.has(Number(u.port)) || u.username || u.password) denied();
}
function checkOptions(options, defaultPort) {
  if (!localHosts.has(String(options.hostname ?? options.host ?? "localhost")) || !httpPorts.has(Number(options.port ?? defaultPort))) denied();
}
function wrapRequest(original, defaultPort) {
  return function (...args) {
    if (typeof args[0] === "string" || args[0] instanceof URL) {
      checkUrl(args[0]);
      if (args[1] && typeof args[1] === "object") {
        const u = new URL(args[0]); checkOptions({ hostname: u.hostname, port: u.port, ...args[1] }, defaultPort);
      }
    } else checkOptions(args[0] ?? {}, defaultPort);
    return Reflect.apply(original, this, args);
  };
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { checkUrl(input); return nativeFetch(input, { ...init, redirect: "error" }); };
http.request = wrapRequest(http.request, 80); http.get = wrapRequest(http.get, 80);
https.request = wrapRequest(https.request, 443); https.get = wrapRequest(https.get, 443);
function checkSocket(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === "object" && first?.path) {
    if (!String(first.path).startsWith("\\\\.\\pipe\\") && !String(first.path).startsWith("/")) denied();
    return;
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) {
    if (!first.startsWith("\\\\.\\pipe\\") && !first.startsWith("/")) denied(); return;
  }
  const host = typeof first === "object" ? first?.host ?? first?.hostname ?? "localhost" : typeof args[1] === "string" ? args[1] : "localhost";
  // Next may use dynamically assigned loopback worker/IPC TCP ports. External
  // TCP hosts are always denied; public HTTP transports use the fixed ports above.
  if (!localHosts.has(String(host))) denied();
}
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { checkSocket(args); return Reflect.apply(socketConnect, this, args); };
const tlsConnect = tls.connect;
tls.connect = function (...args) { checkSocket(args); return Reflect.apply(tlsConnect, this, args); };
process.env.NEXT_TELEMETRY_DISABLED = "1";
require("node:module").syncBuiltinESMExports();
