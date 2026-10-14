import {IdentityRecoveryAdminPanel} from "@/components/admin/identity-recovery-panel";
import {readIdentityRecoveryReviewsAction} from "@/lib/tenancy/identity-recovery-actions";
export const metadata={title:"Identity recovery · Velora Admin"};
export default async function Page(){const result=await readIdentityRecoveryReviewsAction(undefined,true);return <IdentityRecoveryAdminPanel key={result.ok?result.data.actorUserId:"unavailable"} initialResult={result}/>;}
