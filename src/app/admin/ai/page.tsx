import {AdminAIConsole} from "@/components/app/admin-ai-console";
import {AccessGate} from "@/components/app/access-gate";
import {readAdminAIState} from "@/lib/answers/runtime/admin-actions";
export const metadata={title:"Velora — Real AI trials"};
export default async function Page(){const result=await readAdminAIState();if(!result.ok)return <AccessGate code={result.error==="OWNER_REQUIRED"?"FORBIDDEN":"UNAVAILABLE"}/>;return <AdminAIConsole initial={result.data}/>;}
