import {isolatedPostgres} from '../g03-review-acceptance/postgres.mjs';
import {stage2Baseline,captureBaseline,directory} from './stage2b-fixture-replay.mjs';
let db;try{db=await isolatedPostgres();await stage2Baseline(db);try{await db.file('supabase/migrations/20261010053446_service_entitlement_read_contract.sql');throw Error('UNEXPECTED_CANONICAL_INSTALL');}catch(e){if(!e.message.includes('SERVICE_IMMUTABLE_RECEIPT_PREREQUISITE_MISMATCH'))throw e;console.log('RED canonical service contract rejects corrected Stage1 guard as expected');}
 const b=await captureBaseline(db,process.env.VELORA_STAGE2B_BASELINE);console.log('CUMULATIVE_BASELINE',b.functions.length,Object.keys(b.service_relations).length,b.tables.length);
 const read=JSON.parse(await db.file(directory+'preflight.readonly.sql'));if(JSON.stringify(read.functions)!==JSON.stringify(b.functions)||JSON.stringify(read.service_relations)!==JSON.stringify(b.service_relations)||JSON.stringify(read.auth_namespace)!==JSON.stringify(b.auth_namespace))throw Error('READONLY_DELIVERABLE_MISMATCH');console.log('READONLY_PREFLIGHT_MATCH');}
 finally{if(db)await db.close();}
