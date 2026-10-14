// LOCAL ONLY: declared native baseline + actual minimum Smart dependencies.
// Not a full production history replay. No environment files/provider execution.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {startStack,lit} from './local-http-stack.mjs';
await import('./local-http-network-guard.cjs');
const baseline='20261009215520_g03_verified_review.sql';
const bundle=[
 '20261013225246_vel_setup_drafts.sql',
 '20261014080108_smart_setup_foundation.sql',
 '20261014080155_smart_profile_and_branch_attempts_v2.sql',
];
console.log('NATIVE_REDUCED_BASELINE:'+baseline+'; SMART_DEPENDENCIES:'+bundle.join(','));
const stack=await startStack({gatewayPort:3330,authPort:3340,restPort:3341,appOrigin:'http://127.0.0.1:3320',throughMigration:baseline,progress:console.log});
try{
 for(const file of bundle)await stack.sql(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
 await stack.sql("notify pgrst,'reload schema';");
 for(let attempt=1;;attempt++){
  const owner=await stack.adminCreateUser(),otherOwner=await stack.adminCreateUser(),newOwner=await stack.adminCreateUser(),company=randomUUID(),otherCompany=randomUUID();
  for(const user of [owner,otherOwner,newOwner])await stack.sql(`insert into public.profiles(user_id,full_name) values(${lit(user.id)},'Synthetic Smart owner') on conflict(user_id) do update set full_name=excluded.full_name;`);
  for(const [user,id,name] of [[owner,company,'Synthetic existing business'],[otherOwner,otherCompany,'Synthetic other business']])await stack.sql(`insert into public.companies(id,display_name,business_type,country,reply_language,status,created_by) values(${lit(id)},${lit(name)},'retail','OM','en','setup',${lit(user.id)});insert into public.company_members(company_id,user_id,role,status) values(${lit(id)},${lit(user.id)},'owner','active');`);
  try{
   const {runSmartAutosaveJourney}=await import(new URL('../internal-ui/smart-autosave-journey.mjs',import.meta.url).href+'?attempt='+attempt);
   await runSmartAutosaveJourney(stack,{owner,company,otherOwner,otherCompany,newOwner});break;
  }catch(error){
   console.error(stack.redact(error.message));
   console.log('OWNED_NATIVE_BACKEND_RETAINED: inspect sanitized capture, fix source/harness, then explicitly enter retry; enter stop to dispose. No automatic loop or SQL history replay.');
   const input=createInterface({input:process.stdin,output:process.stdout});
   let answer;try{answer=await input.question('LOCAL_DIAGNOSTIC_ACTION: ');}finally{input.close();}
   if(answer.trim()!=='retry'){process.exitCode=1;break;}
   console.log('EXPLICIT_BROWSER_RETRY:'+attempt+'; same owned native backend, fresh synthetic accounts, latest actual product sources');
  }
 }
}finally{await stack.close();}
