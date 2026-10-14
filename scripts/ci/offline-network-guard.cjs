// Preload before application/test imports. Unit tests may replace transports with
// explicit synthetic mocks; any real outbound transport always fails locally.
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require entry point. */
function denied() { throw Error("CI_EXTERNAL_NETWORK_BLOCKED"); }
globalThis.fetch = denied;
for (const name of ["node:http", "node:https"]) {
  const transport = require(name);
  transport.request = denied;
  transport.get = denied;
}
require("node:net").Socket.prototype.connect = denied;
require("node:tls").connect = denied;
require("node:dgram").createSocket = denied;
for (const name of ["node:dns", "node:dns/promises"]) {
  const dns = require(name);
  for (const key of Object.keys(dns)) if (key === "lookup" || key.startsWith("resolve") || key === "reverse") dns[key] = denied;
}
require("node:module").syncBuiltinESMExports();
