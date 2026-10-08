import { sql, rows, lit } from "./postgres.mjs";
import { overlap } from "./concurrency.mjs";

const assert = (ok, message) => { if (!ok) throw Error(message); };
const json = output => JSON.parse(output.split("\n").find(line => line.startsWith("{")));

async function contenders(cap, budget) {
  const f = json(await sql(`SET ROLE service_role;SELECT test_fixture.company(true,${cap});`));
  const conversation = crypto.randomUUID();
  await sql(`SET ROLE service_role;
    SELECT test_fixture.ai_budget(${lit(f.company)}::uuid,${budget});
    INSERT INTO whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id,automation_allowed)
    SELECT ${lit(conversation)}::uuid,company_id,phone_number_id,${lit(`synthetic-atomic-${conversation}`)},true
    FROM whatsapp_conversations WHERE id=${lit(f.conversation)}::uuid;`);
  const jobs = [];
  for (const fixture of [f, { ...f, conversation }]) {
    const job = (await sql(`SET ROLE service_role;SELECT test_fixture.job(${lit(JSON.stringify(fixture))}::jsonb);`)).trim();
    const claim = json(await sql(`SET ROLE service_role;SELECT claim_whatsapp_inbound_job(${lit(job)}::uuid,120);`));
    assert(claim.ok === true, "Synthetic atomic contender claim failed");
    jobs.push({ job, claim: claim.claim_token, id: crypto.randomUUID() });
  }
  return { f, jobs };
}

function reserve(f, contender) {
  const citations = [{ sourceId: f.knowledge, title: "Synthetic knowledge", contentVersion: 1 }];
  return `SELECT ai_reserve_whatsapp_capacity_cost_attempt(${lit(contender.id)}::uuid,${lit(contender.job)}::uuid,${lit(contender.claim)}::uuid,
    1,'gpt-6-luna','openai',1,'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}'::jsonb,
    ${lit(JSON.stringify(citations))}::jsonb,'noura',${lit(f.plan_version)}::uuid)`;
}

async function assertSingleReservation(f, winner, loser) {
  const state = (await rows(`SELECT
    (SELECT count(*) FROM whatsapp_inbound_jobs WHERE company_id=${lit(f.company)}::uuid AND usage_status='reserved') AS messages,
    (SELECT count(*) FROM ai_usage_ledger WHERE company_id=${lit(f.company)}::uuid) AS costs,
    held_baisa,spent_baisa FROM ai_budget_accounts WHERE company_id=${lit(f.company)}::uuid`))[0];
  assert(state.messages === 1 && state.costs === 1 && state.held_baisa === 1 && state.spent_baisa === 0,
    "Concurrent atomic reservations overspent message capacity or held AI cost");
  const jobs = await rows(`SELECT id,usage_status FROM whatsapp_inbound_jobs WHERE id IN (${lit(winner.job)}::uuid,${lit(loser.job)}::uuid)`);
  assert(jobs.find(row => row.id === winner.job)?.usage_status === "reserved", "Winning atomic job lost message reservation");
  if (winner.job !== loser.job) assert(jobs.find(row => row.id === loser.job)?.usage_status === null, "Losing atomic job retained capacity");
}

export async function runAtomicConcurrency() {
  const results = [];
  const test = async (name, body) => {
    try { await body(); results.push({ name, status: "PASS" }); console.log(`PASS|${name}`); }
    catch (error) { results.push({ name, status: "FAIL", error: error.message }); console.log(`FAIL|${name}|${error.message}`); }
  };
  for (const [cap, budget, denial, name] of [
    [1, 10, "usage_limit_reached", "atomic contenders serialize the last message slot without extra held AI cost"],
    [2, 1, "BUDGET_EXCEEDED", "atomic contenders serialize the last AI cost allocation and roll back losing quota"],
  ]) {
    await test(name, async () => {
      const { f, jobs } = await contenders(cap, budget);
      const [first, second] = await overlap(reserve(f, jobs[0]), reserve(f, jobs[1]));
      assert(json(first).ok === true && json(second).code === denial, "Concurrent atomic winner or denial incorrect");
      await assertSingleReservation(f, jobs[0], jobs[1]);
    });
  }
  await test("atomic concurrent replay cannot reserve duplicate message capacity or paid cost", async () => {
    const { f, jobs } = await contenders(2, 10);
    const duplicate = { ...jobs[0], id: crypto.randomUUID() };
    const [first, second] = await overlap(reserve(f, jobs[0]), reserve(f, duplicate));
    assert(json(first).ok === true && json(second).code === "DUPLICATE_REQUEST", "Atomic concurrent replay was accepted");
    await assertSingleReservation(f, jobs[0], duplicate);
  });
  console.log("ATOMIC_CONCURRENCY_RESULTS", JSON.stringify({ passed: results.filter(row => row.status === "PASS").length,
    failed: results.filter(row => row.status === "FAIL").length, notRun: 0, results }));
  if (results.some(row => row.status === "FAIL")) process.exitCode = 1;
  return results;
}
