/**
 * Focused definitions for hosted primary-compat (trigger-absent PhaseB profile).
 * Codex executes against owned local fixture / SQL — Cursor does not run these.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const primarySql = readFileSync(
  join(root, "supabase/migrations/20261017160000_es02_hosted_primary_compat.sql"),
  "utf8",
);
const c2Sql = readFileSync(
  join(root, "supabase/migrations/20261017140000_es02_c2_atomicity_ledger_snapshot.sql"),
  "utf8",
);
const c3Sql = readFileSync(
  join(root, "supabase/migrations/20261017150000_es02_c3_exact_client_op_unique.sql"),
  "utf8",
);

describe("es02 hosted primary compat SQL contract", () => {
  it("preserves C2/C3 predecessors and only replaces provision for primary insert-or-reuse", () => {
    expect(c2Sql).toContain("ES02_PRIMARY_BRANCH_MISSING");
    expect(c3Sql).toContain("es02_has_exact_client_op_unique");
    expect(primarySql).toContain("create or replace function public.es02_provision_owned_purchase");
    expect(primarySql).toContain("Hosted PhaseB");
    expect(primarySql).toMatch(
      /insert into public\.company_branches\(company_id, name, city, is_primary, status\)\s*values\s*\(\s*created\.id/i,
    );
    expect(primarySql).toContain("is_primary = true");
    const primaryCode = primarySql.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(primaryCode).not.toMatch(/create\s+(?:constraint\s+)?trigger\s+enterprise_primary_branch\b/i);
    expect(primaryCode).not.toMatch(/create\s+(?:or\s+replace\s+)?function\s+private\.enterprise_new_company\b/i);
  });

  it("keeps paid ownership, ledger bind failure, and foreign denial surfaces", () => {
    expect(primarySql).toContain("FOREIGN_OWNER");
    expect(primarySql).toContain("NOT_SETTLED");
    expect(primarySql).toContain("ES02_LEDGER_BIND_FAILED");
    expect(primarySql).toContain("es02_require_active_actor");
    expect(primarySql).toContain("RECONCILIATION_REQUIRED");
  });

  it("documents trigger-present reuse and trigger-absent insert without unpaid path", () => {
    // Reuse path: select existing primary then update name/city
    expect(primarySql).toMatch(/where company_id = created\.id and is_primary = true/);
    expect(primarySql).toMatch(/update public\.company_branches set/);
    // No unpaid company creation helper
    expect(primarySql).not.toMatch(/create company without.*settled/i);
    expect(primarySql).toContain("o.status is distinct from 'settled'");
  });
});

describe("es02-hosted-compat package surface", () => {
  const pkg = join(root, "supabase/upgrade-packages/es02-hosted-compat");

  it("ships concrete upgrade + preflight/postflight/deny-rollback/manifest", () => {
    for (const name of [
      "upgrade.sql",
      "preflight.sql",
      "postflight.sql",
      "deny-rollback.sql",
      "manifest.json",
      "README.md",
    ]) {
      const text = readFileSync(join(pkg, name), "utf8");
      expect(text.length).toBeGreaterThan(100);
    }
    const upgradeText = readFileSync(join(pkg, "upgrade.sql"), "utf8");
    const upgradeLower = upgradeText.toLowerCase();
    expect(upgradeLower).toContain("es02_settle_account_order_synthetic");
    expect(upgradeLower).toContain("revoke all on function public.es02_settle_account_order_synthetic");
    expect(upgradeLower).toContain("from public, anon, authenticated, service_role");
    expect(upgradeLower).toContain("hosted phaseb");
    expect(upgradeText).toContain("final footprint already installed");
    expect(upgradeText).toContain("RELEASE_POSTFLIGHT: synthetic settle must be denied");
    expect(upgradeText).toContain("pg_get_functiondef");
    const pre = readFileSync(join(pkg, "preflight.sql"), "utf8");
    expect(pre).toContain("pg_get_functiondef");
    expect(pre).toContain("5f3313dbaee67b8366fef2b55150d067");
    expect(pre).toContain("7d7b359732de20ea37d383b579a45d38");
    expect(pre).toContain("b42c28f54d05778fcc994156c6ce4086");
    expect(pre).toMatch(/informational_prosrc|prosrc_md5_not_used|NOT prosrc/i);
    expect(pre).not.toMatch(/md5\(replace\(prosrc/);
    const post = readFileSync(join(pkg, "postflight.sql"), "utf8");
    expect(post).toContain("grantee = 0");
    const postCode = post.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(postCode).not.toContain("has_function_privilege('public'");
  });
});
