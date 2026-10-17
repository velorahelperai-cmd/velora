import {IdentityRecoveryPage} from "@/components/app/identity-recovery-page";
import {readIdentityRecoveryReviewsAction} from "@/lib/tenancy/identity-recovery-actions";

export const metadata={title:"Recovery review · Velora"};

export default async function Page(){
 const result=await readIdentityRecoveryReviewsAction();
 const key=result.ok
  ?`${result.data.actorUserId}:${result.data.boundaryFingerprint||"tip"}`
  :"unavailable";
 return <IdentityRecoveryPage key={key} initialResult={result}/>;
}
