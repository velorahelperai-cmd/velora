import { bootstrap, file, rows, sql, verifyLocalContainer } from "./postgres.mjs";
import { runPostgresCases } from "./postgres-cases.mjs";

// This runner never starts/reuses another container or connects to any URL.
// Owner creates this task-labelled ephemeral, network-disabled PG instance.
// Execute serially; bootstrap must not race another suite against this database.
const results = [];
const runCase = async (name, operation) => {
  try { await operation(); results.push({ name, status: "PASS" }); console.log(`PASS|${name}`); }
  catch (error) { results.push({ name, status: "FAIL", error: error.message }); console.error(`FAIL|${name}|${error.message}`); }
};

console.log("LOCAL_POSTGRES_IMAGE", await verifyLocalContainer());
if (process.argv.includes("--baseline")) {
  const applied = await bootstrap({ preP1Fixture: "scripts/billing-acceptance/upgrade-fixtures.sql", postP1Fixture: "scripts/billing-acceptance/upgrade-post-p1-fixtures.sql", includeForward: false });
  console.log("BASELINE_MIGRATIONS", JSON.stringify(applied));
  console.log("BASELINE_EXISTING_DATA", JSON.stringify(await rows("SELECT c.display_name,s.environment,s.status FROM billing_subscriptions s JOIN companies c ON c.id=s.company_id ORDER BY c.display_name")));
  try { await file("scripts/billing-acceptance/upgrade-assertions.sql"); console.log("UNEXPECTED_BASELINE_UPGRADE_PASS"); process.exitCode=1; }
  catch (error) { console.log("EXPECTED_BASELINE_UPGRADE_FAILURE", error.message); }
  try { await file("scripts/billing-acceptance/reversal-cases.sql"); console.log("UNEXPECTED_BASELINE_REVERSAL_PASS"); process.exitCode=1; }
  catch (error) { console.log("EXPECTED_BASELINE_REVERSAL_FAILURE", error.message); }
} else {
  const applied = await bootstrap({ preP1Fixture: "scripts/billing-acceptance/upgrade-fixtures.sql", postP1Fixture: "scripts/billing-acceptance/upgrade-post-p1-fixtures.sql" });
  console.log("FINAL_MIGRATIONS", JSON.stringify(applied));
  console.log("POSTGRES_VERSION", await sql("SELECT version();"));
  await runCase("populated legacy subscription upgrade (18 scenarios, 20 assertions)", () => file("scripts/billing-acceptance/upgrade-assertions.sql"));
  console.log("UPGRADED_EXISTING_DATA", JSON.stringify(await rows("SELECT c.display_name,s.environment,s.status FROM billing_subscriptions s JOIN companies c ON c.id=s.company_id ORDER BY c.display_name")));
  try {
    const output = await file("scripts/billing-acceptance/reversal-cases.sql");
    for (const line of output.split("\n").filter((x) => x.startsWith("PASS|"))) {
      results.push({ name: line.slice(5), status: "PASS" }); console.log(line);
    }
  } catch (error) {
    // Transaction suite aborts on first failed assertion: never count subsequent
    // unexecuted SQL blocks as successes.
    results.push({ name: "SQL lifecycle suite", status: "FAIL", error: error.message });
    console.error("FAIL|SQL lifecycle suite|", error.message);
  }
  await runPostgresCases(runCase);
  const summary = { category: "actual PostgreSQL", passed: results.filter((x) => x.status === "PASS").length, failed: results.filter((x) => x.status === "FAIL").length, notRun: 0, results };
  console.log("POSTGRES_RESULTS", JSON.stringify(summary));
  if (summary.failed) process.exitCode = 1;
}
