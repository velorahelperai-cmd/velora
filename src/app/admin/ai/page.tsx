import {AdminAIConsole} from "@/components/app/admin-ai-console";
import {AccessGate} from "@/components/app/access-gate";
import {readAdminAIState} from "@/lib/answers/runtime/admin-actions";
import {readSyntheticGeminiFreeState} from "@/lib/answers/runtime/synthetic-gemini-actions";
export const metadata={title:"Velora - Real AI trials"};
export default async function Page(){
 // Both reads enforce their own owner/session gates. Disabled readiness needs no second remote gate.
 const [result,free]=await Promise.all([
  readAdminAIState(),
  process.env.VELORA_GEMINI_FREE_ENABLED==="true"
   ? readSyntheticGeminiFreeState()
   : Promise.resolve({ok:true as const,data:{ready:false,code:"FREE_SYNTHETIC_NEEDS_SETUP"}}),
 ]);
 if(!result.ok)return <AccessGate code={result.error==="OWNER_REQUIRED"?"FORBIDDEN":"UNAVAILABLE"}/>;
 return <AdminAIConsole initial={result.data} freeState={free.ok?free.data:{ready:false,code:free.error}}/>;
}
