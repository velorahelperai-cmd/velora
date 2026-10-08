import {bootstrap,file,sql,rows,verify,lit} from "./postgres.mjs";
import {runConcurrency} from "./concurrency.mjs";
import {runMetaConcurrency} from "./meta-concurrency.mjs";
import {runAtomicConcurrency} from "./atomic-concurrency.mjs";
import {runInboxConcurrency} from "./inbox-concurrency.mjs";
import {runRecoveryConcurrency} from "./recovery-concurrency.mjs";
console.log("ISOLATED_POSTGRES",await verify());let legacyPass=0;
if(process.argv.includes("--legacy-preflight")){
 console.log("LEGACY_BASE_FILES",await bootstrap("20261008120000_vel_billing_lifecycle_evidence_acceptance.sql"));await file("scripts/whatsapp-integration/fixtures.sql");
 const a=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(false);")),b=JSON.parse(await sql("SET ROLE service_role;SELECT test_fixture.company(false);"));const id=crypto.randomUUID();
 await sql(`SET ROLE service_role;INSERT INTO whatsapp_messages(id,company_id,conversation_id,wa_message_id,body,direction,sender,received_at) VALUES(${lit(id)}::uuid,${lit(b.company)}::uuid,${lit(a.conversation)}::uuid,'synthetic-preflight-'||${lit(id)},'Synthetic inconsistent legacy row','inbound','customer',clock_timestamp());`);
 try{await file("supabase/migrations/20261008130000_vel_wa_identity_delivery_integration.sql");throw Error("UNSAFE_LEGACY_MIGRATION_ACCEPTED");}
 catch(e){if(!/wa_identity_preflight_messages/.test(e.message))throw e;}
 const retained=await rows(`SELECT company_id,conversation_id FROM whatsapp_messages WHERE id=${lit(id)}::uuid`);
 if(retained.length!==1||retained[0].company_id!==b.company||retained[0].conversation_id!==a.conversation)throw Error("LEGACY_EVIDENCE_CHANGED");
 legacyPass=1;console.log("PASS|D1 populated inconsistent legacy migration aborts without deleting or reassigning history");
}
console.log("MIGRATIONS_APPLIED",await bootstrap());
await sql("CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;");
await file("scripts/whatsapp-integration/fixtures.sql");
let passed=legacyPass,failed=0,notRun=0;
for(const path of ["identity-delivery-cases.sql","ai-cost-cases.sql","workflow-cases.sql","fair-batch-cases.sql","repair-cases.sql","meta-onboarding.sql","meta-policy.sql","meta-knowledge.sql","meta-token-error.sql","inbox-contracts.sql","atomic-capacity-cost.sql"]){
 try{const output=await file(`scripts/whatsapp-integration/${path}`);console.log(output);passed+=output.split("\n").filter(x=>x.startsWith("PASS|")).length;}
 catch(e){failed++;console.log(`FAIL|${path}|${e.message}`);}
}
await sql("CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;");
try{console.log(await file("scripts/whatsapp-integration/vault-cases.sql"));passed++;}
catch(e){if(/no server secret key defined/.test(e.message)){notRun++;console.log("NOT_RUN|Vault encryption/decryption prerequisites: local server encryption key unavailable");}else{failed++;console.log(`FAIL|Vault|${e.message}`);}}
const concurrency=await runConcurrency();passed+=concurrency.filter(x=>x.status==="PASS").length;failed+=concurrency.filter(x=>x.status==="FAIL").length;
const metaConcurrency=await runMetaConcurrency();passed+=metaConcurrency.filter(x=>x.status==="PASS").length;failed+=metaConcurrency.filter(x=>x.status==="FAIL").length;
const atomicConcurrency=await runAtomicConcurrency();passed+=atomicConcurrency.filter(x=>x.status==="PASS").length;failed+=atomicConcurrency.filter(x=>x.status==="FAIL").length;
const inboxConcurrency=await runInboxConcurrency();passed+=inboxConcurrency.filter(x=>x.status==="PASS").length;failed+=inboxConcurrency.filter(x=>x.status==="FAIL").length;
const recoveryConcurrency=await runRecoveryConcurrency();passed+=recoveryConcurrency.filter(x=>x.status==="PASS").length;failed+=recoveryConcurrency.filter(x=>x.status==="FAIL").length;
console.log("POSTGRES_INTEGRATION_RESULTS",JSON.stringify({passed,failed,notRun}));if(failed)process.exitCode=1;
