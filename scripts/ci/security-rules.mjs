// Bounded signatures: this is a local/PR baseline, not a complete secret audit.
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[A-Za-z0-9_-]{35}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
];
// Exact pre-existing redaction fixtures only, bound to their source file. New
// signatures in these same tests still fail; never blanket-exempt test files.
const redactionFixtures = {
  "src/lib/answers/adapters/p3-readiness.test.ts": ["sk-" + "example_key_abcdefghijklmnopqrstuvwxyz", "AIza" + "12345678901234567890123456789012345"],
  "src/lib/answers/ledger/p3-ledger.test.ts": ["sk-" + "proj-test-12345678901234567890", "sk-" + "proj-fixture-12345678901234567890"],
};
function containsAccessJwt(content, allowPublicAnon) {
  const tokens = content.matchAll(/\b[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{8,8192}\b/g);
  for (const [token] of tokens) {
    try {
      const [head, body] = token.split(".");
      const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!header || typeof header.alg !== "string" || !payload || typeof payload !== "object") continue;
      const userBearing = ["sub", "user_id", "session_id"].some(key => typeof payload[key] === "string" && payload[key].trim());
      if (allowPublicAnon && payload.role === "anon" && !userBearing) continue;
      return true;
    } catch { /* Ordinary dotted references and malformed examples are not JWTs. */ }
  }
  return false;
}
const reference = "[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*";
const passwordReference = new RegExp("^\\$\\{\\s*(?:" + reference + "|encodeURIComponent\\(\\s*" + reference + "\\s*\\))\\s*\\}$");
const dbScheme = "(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\\+srv)?|mssql|redis(?:s)?)";
function containsDatabasePassword(content) {
  // libpq accepts multi-host URIs that WHATWG URL rejects. Parse authority and
  // query text independently; do not let invalid host syntax hide credentials.
  const authorities = new RegExp("\\b" + dbScheme + ":\\/\\/[^:/@\\r\\n]{0,256}:([^@\\r\\n]{1,2048})@", "gi");
  for (const match of content.matchAll(authorities)) if (!passwordReference.test(match[1])) return true;
  const urls = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|mssql|redis(?:s)?):\/\/(?:\$\{[^{}\r\n]*\}|[^\s"'<>`])+/gi;
  const passwordNames = new Set(["password", "passwd", "pwd", "sslpassword"]);
  for (const [candidate] of content.matchAll(urls)) {
    const queryIndex = candidate.indexOf("?");
    if (queryIndex < 0) continue;
    const query = candidate.slice(queryIndex + 1).split("#")[0];
    for (const pair of query.split("&")) {
      const rawValue = pair.slice(pair.indexOf("=") + 1);
      for (const [name, value] of new URLSearchParams(pair)) {
        if (passwordNames.has(name.toLowerCase()) && value && !passwordReference.test(rawValue)) return true;
      }
    }
  }
  return false;
}
export function containsSecret(content, file, { allowPublicAnon = false } = {}) {
  const fixtures = new Set(redactionFixtures[file] ?? []);
  return secretPatterns.some(pattern => Array.from(content.matchAll(new RegExp(pattern.source, "g"))).some(match => !fixtures.has(match[0])))
    || containsAccessJwt(content, allowPublicAnon) || containsDatabasePassword(content);
}
export function forbiddenTrackedPath(file) {
  return /(?:^|\/)(?:\.env(?:\..*)?|\.vercel|\.auth|\.sessions|\.ssh|\.aws)(?:\/|$)/.test(file) && !/(?:^|\/)\.env\.example$/.test(file)
    || /\.(?:pem|key|p8|p12|pfx)$/.test(file)
    || /(?:^|\/)(?:credentials[^/]*|[^/]*service[-_]account[^/]*)\.json$/.test(file);
}
