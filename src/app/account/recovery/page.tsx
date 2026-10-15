import {IdentityRecoveryPage} from "@/components/app/identity-recovery-page";
import {readIdentityRecoveryReviewsAction} from "@/lib/tenancy/identity-recovery-actions";
export const metadata={title:"Recovery review · Velora"};
export default async function Page(){const result=await readIdentityRecoveryReviewsAction();return <IdentityRecoveryPage key={result.ok?result.data.actorUserId:"unavailable"} initialResult={result}/>;}
