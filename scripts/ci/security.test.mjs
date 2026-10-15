import { test } from "node:test";
import assert from "node:assert/strict";
import { forbiddenTrackedPath, containsSecret } from "./security-rules.mjs";

test("tracked runtime env and private credential stores are denied", () => {
  for (const file of [".env.local", "nested/.env.production", "private/key.pem", ".vercel/project.json", ".auth/state.json"]) assert.equal(forbiddenTrackedPath(file), true);
  for (const file of [".env.example", "src/lib/auth/session.ts", "scripts/ci/security.mjs"]) assert.equal(forbiddenTrackedPath(file), false);
});
test("recognizable private secrets are detected without returning values", () => {
  for (const value of ["sk-" + "A1b2".repeat(12), "ghp_" + "a".repeat(36), "sb_secret_" + "x".repeat(32), "-----BEGIN " + "RSA PRIVATE KEY-----"]) assert.equal(containsSecret(value), true);
  assert.equal(containsSecret('apiKey: "synthetic-key"'), false);
  assert.equal(containsSecret("-----BEGIN PUBLIC KEY-----"), false);
  const fixture = "sk-" + "example_key_abcdefghijklmnopqrstuvwxyz";
  const path = "src/lib/answers/adapters/p3-readiness.test.ts";
  assert.equal(containsSecret(fixture, path), false);
  assert.equal(containsSecret(fixture), true);
  assert.equal(containsSecret(fixture + "REALSUFFIX", path), true);
  assert.equal(containsSecret(fixture + " sk-" + "a".repeat(48), path), true);
});
const jwt = payload => [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"),
  "synthetic_signature_for_offline_tests",
].join(".");
test("legacy access JWTs are private; only explicitly allowed public anon is exempt", () => {
  for (const payload of [{ role: "service_role" }, { role: "authenticated" }, { sub: "synthetic-user" }, { user_id: "synthetic-user" }, { role: "anon", sub: "synthetic-user" }]) {
    assert.equal(containsSecret(jwt(payload)), true);
    assert.equal(containsSecret(jwt(payload), undefined, { allowPublicAnon: true }), true);
  }
  const anon = jwt({ role: "anon", iss: "supabase" });
  assert.equal(containsSecret(anon), true);
  assert.equal(containsSecret(anon, undefined, { allowPublicAnon: true }), false);
  assert.equal(containsSecret("ordinary.dotted.reference"), false);
});
test("password-bearing database URLs are rejected, including percent-encoded credentials", () => {
  for (const protocol of ["postgresql", "postgres", "mysql", "mongodb+srv", "redis", "rediss"]) {
    assert.equal(containsSecret(protocol + ":" + "//ci_user:ci_pass@database.invalid/db"), true);
    assert.equal(containsSecret(protocol + ":" + "//ci_user:ci%40pass@database.invalid/db"), true);
    assert.equal(containsSecret(protocol + ":" + "//database.invalid/db"), false);
  }
});
test("runtime password references are allowed only as complete structured expressions", () => {
  for (const password of ["${databasePassword}", "${encodeURIComponent(databasePassword)}", "${process.env.DB_PASSWORD}"]) {
    assert.equal(containsSecret("postgresql:" + "//authenticator:" + password + "@owned-db:5432/postgres"), false);
  }
  for (const password of ["literal${databasePassword}", "${databasePassword}literal", '${"literal"}', '${encodeURIComponent("literal")}', '${databasePassword || "literal"}', "%24%7BdatabasePassword%7D"]) {
    assert.equal(containsSecret("postgresql:" + "//authenticator:" + password + "@owned-db:5432/postgres"), true);
  }
});
test("query passwords are rejected, including encoded parameter names and values", () => {
  for (const query of ["user=ci&password=ci_pass", "password=ci%40pass", "%70assword=ci_pass", "password=${databasePassword}literal"]) {
    assert.equal(containsSecret("postgresql:" + "//database.invalid/db?" + query), true);
  }
  assert.equal(containsSecret("postgresql:" + "//database.invalid/db?password=${databasePassword}"), false);
});
test("libpq multi-host grammar cannot bypass password detection", () => {
  assert.equal(containsSecret("postgresql:" + "//ci_user:ci_pass@host1.invalid:5432,host2.invalid:5432/db"), true);
  assert.equal(containsSecret("postgresql:" + "//host1.invalid:5432,host2.invalid:5432/db?password=ci%40pass"), true);
  assert.equal(containsSecret("postgresql:" + "//host1.invalid:5432,host2.invalid:5432/db"), false);
});
