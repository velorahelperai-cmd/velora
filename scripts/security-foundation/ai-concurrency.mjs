// Real PostgreSQL contention, with an observed lock barrier; no bootstrap/model calls.
// Run exclusively against the labelled C1 DB after other AI fixture suites finish.
import { spawn } from "node:child_process";
import { CONTAINER, DB, verify, sql, rows, session, lit } from "../whatsapp-integration/postgres.mjs";

const assert = (ok, message) => { if (!ok) throw Error(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function coordinator(name) {
  const child = spawn("docker", ["exec", "-i", "-u", "postgres", CONTAINER, "psql", "-X", "-U", "supabase_admin", "-d", DB, "-Atq", "-v", "ON_ERROR_STOP=1"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "", closed = false;
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { errors += data; });
  child.on("close", () => { closed = true; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(Error(errors || `coordinator exited ${code}`)));
  });
  done.catch(() => {});
  async function send(query) {
    const marker = `c1_barrier_${crypto.randomUUID().replaceAll("-", "")}`;
    child.stdin.write(`${query}\n\\echo ${marker}\n`);
    const until = Date.now() + 10_000;
    while (!output.split(/\r?\n/).includes(marker)) {
      if (closed || Date.now() > until) throw Error(errors || `coordinator timeout: ${name}`);
      await delay(20);
    }
  }
  return { send, close: async () => { child.stdin.end(); await done; }, abort: () => child.stdin.end("ROLLBACK;\n") };
}

async function lockedRace(name, queries) {
  const lock = coordinator(`${name}_coordinator`);
  const names = queries.map((_, index) => `${name}_${index}`);
  let contenders = [], released = false;
  try {
    await lock.send(`SET application_name=${lit(`${name}_coordinator`)}; BEGIN; SELECT id FROM public.ai_budget_accounts WHERE scope='admin_test' FOR UPDATE;`);
    contenders = queries.map((query, index) => {
      const contender = session(`SET statement_timeout='12s'; SET ROLE service_role; ${query}`, names[index]);
      contender.done.catch(() => {});
      return contender;
    });
    const until = Date.now() + 8_000;
    let observed = [];
    while (Date.now() < until) {
      observed = await rows(`SELECT application_name,wait_event_type,wait_event FROM pg_stat_activity WHERE application_name IN (${names.map(lit).join(",")})`);
      if (observed.length === names.length && observed.every(row => row.wait_event_type === "Lock")) break;
      await delay(25);
    }
    assert(observed.length === names.length && observed.every(row => row.wait_event_type === "Lock"), `${name}: contenders did not reach a real PostgreSQL lock barrier`);
    console.log(`BARRIER|${name}|${JSON.stringify(observed)}`);
    await lock.send("COMMIT;");
    released = true;
    return await Promise.all(contenders.map(item => item.done));
  } finally {
    if (!released) lock.abort();
    else await lock.close();
    await Promise.allSettled(contenders.map(item => item.done));
  }
}

await verify();
const original = (await rows("SELECT id,limit_baisa,spent_baisa,held_baisa,enabled FROM public.ai_budget_accounts WHERE scope='admin_test'"))[0];
assert(original, "C1 admin singleton missing");
const actor = (await rows("SELECT user_id FROM public.platform_admins WHERE role='owner' AND status='active'"))[0]?.user_id;
assert(actor, "C1 synthetic owner missing");
const fixture = { companies: [crypto.randomUUID(), crypto.randomUUID()], session: crypto.randomUUID() };
const reserve = (id, execution = id, company = fixture.companies[0], amount = 600) => `SELECT public.ai_reserve_attempt(${lit(id)}::uuid,${lit(execution)}::uuid,1,${lit(company)}::uuid,${lit(actor)}::uuid,${lit(fixture.session)}::uuid,'gpt-6-luna','openai',${amount},'synthetic-c1','{"modelId":"gpt-6-luna","version":"synthetic-c1"}','admin_test');`;
const known = id => `SELECT public.ai_settle_admin_attempt(${lit(id)}::uuid,'success',0.0026008,1,'{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"reasoningTokens":4,"cacheWriteTokens":3,"totalTokens":30}','synthetic-request',null,12,'synthetic-response','gpt-6-luna');`;
async function clearAttempts() {
  await sql(`DELETE FROM public.ai_usage_ledger WHERE company_id IN (${fixture.companies.map(id => `${lit(id)}::uuid`).join(",")}); UPDATE public.ai_budget_accounts SET limit_baisa=1000,spent_baisa=0,held_baisa=0,enabled=true WHERE id=${lit(original.id)}::uuid;`);
}
try {
  await sql(`INSERT INTO public.companies(id,display_name,status,created_by) VALUES ${fixture.companies.map(id => `(${lit(id)}::uuid,'Synthetic C1 admin contention','active',${lit(actor)}::uuid)`).join(",")}; INSERT INTO auth.sessions(id,user_id) VALUES(${lit(fixture.session)}::uuid,${lit(actor)}::uuid); INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(fixture.session)}::uuid,${lit(actor)}::uuid,clock_timestamp());`);
  await clearAttempts();
  let ids = [crypto.randomUUID(), crypto.randomUUID()];
  let result = (await lockedRace("c1_ai_global_cap", ids.map((id, index) => reserve(id, id, fixture.companies[index])))).map(JSON.parse);
  assert(result.filter(row => row.ok).length === 1 && result.filter(row => row.code === "BUDGET_EXCEEDED").length === 1, "global cap contenders did not produce one approval and one denial");
  let budget = (await rows("SELECT spent_baisa,held_baisa FROM public.ai_budget_accounts WHERE scope='admin_test'"))[0];
  assert(Number(budget.spent_baisa) === 0 && Number(budget.held_baisa) === 600, "global cap durable accounting wrong");
  console.log("PASS|AI real two-session global cap serializes across tenants");

  await clearAttempts();
  ids = [crypto.randomUUID(), crypto.randomUUID()];
  const execution = crypto.randomUUID();
  result = (await lockedRace("c1_ai_duplicate_execution", ids.map(id => reserve(id, execution)))).map(JSON.parse);
  assert(result.filter(row => row.ok).length === 1 && result.filter(row => row.code === "DUPLICATE_REQUEST").length === 1, "same execution reserved twice");
  assert(Number((await rows("SELECT held_baisa FROM public.ai_budget_accounts WHERE scope='admin_test'"))[0].held_baisa) === 600, "duplicate execution charged two holds");
  console.log("PASS|AI real two-session duplicate execution has one durable reservation");

  await clearAttempts();
  const id = crypto.randomUUID();
  await sql(`SET ROLE service_role; ${reserve(id, id, fixture.companies[0], 10)}`);
  result = await lockedRace("c1_ai_single_start", [0, 1].map(() => `SELECT public.ai_start_attempt(${lit(id)}::uuid);`));
  assert(result.filter(value => value === "t").length === 1 && result.filter(value => value === "f").length === 1, "attempt start capability consumed twice");
  console.log("PASS|AI real two-session start consumes one execution capability");

  result = await lockedRace("c1_ai_known_settlement", [known(id), known(id)]);
  assert(result.every(value => value === "t"), "identical known settlement retries were not acknowledged");
  budget = (await rows("SELECT spent_baisa,held_baisa FROM public.ai_budget_accounts WHERE scope='admin_test'"))[0];
  assert(Number(budget.spent_baisa) === 1 && Number(budget.held_baisa) === 0, "known settlement duplicated cost or hold release");
  console.log("PASS|AI real two-session known settlement charges once");

  await clearAttempts();
  const unknown = crypto.randomUUID();
  await sql(`SET ROLE service_role; ${reserve(unknown, unknown, fixture.companies[0], 10)} SELECT public.ai_start_attempt(${lit(unknown)}::uuid); SELECT public.ai_settle_attempt(${lit(unknown)}::uuid,'uncertain',null,null,'{}','synthetic-request','TIMEOUT',20);`);
  const reconciliation = `SELECT public.ai_reconcile_attempt(${lit(unknown)}::uuid,0.0026008,1,'{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"reasoningTokens":4,"cacheWriteTokens":3,"totalTokens":30}','synthetic-provider-lookup');`;
  result = await lockedRace("c1_ai_reconciliation", [reconciliation, reconciliation]);
  assert(result.every(value => value === "t"), "identical reconciliations were not acknowledged");
  budget = (await rows("SELECT spent_baisa,held_baisa FROM public.ai_budget_accounts WHERE scope='admin_test'"))[0];
  assert(Number(budget.spent_baisa) === 1 && Number(budget.held_baisa) === 0, "reconciliation duplicated cost or hold release");
  console.log("PASS|AI real two-session reconciliation charges once");
} finally {
  await sql(`DELETE FROM public.ai_usage_ledger WHERE company_id IN (${fixture.companies.map(id => `${lit(id)}::uuid`).join(",")}); DELETE FROM private.app_session_activity WHERE session_id=${lit(fixture.session)}::uuid; DELETE FROM auth.sessions WHERE id=${lit(fixture.session)}::uuid; DELETE FROM public.companies WHERE id IN (${fixture.companies.map(id => `${lit(id)}::uuid`).join(",")}); UPDATE public.ai_budget_accounts SET limit_baisa=${original.limit_baisa},spent_baisa=${original.spent_baisa},held_baisa=${original.held_baisa},enabled=${original.enabled} WHERE id=${lit(original.id)}::uuid;`);
}
