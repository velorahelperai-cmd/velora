import {redirect, notFound} from "next/navigation";
import {getCompanyAccess, loginPathForReturn} from "@/lib/tenancy/access";
import {authFlowHref} from "@/lib/auth/auth-journey";
import {whatsappSetupPath} from "@/lib/auth/setup-return";
import {readOwnedPaidBranchSetupAction} from "@/lib/tenancy/paid-setup-actions";
import {readOwnedPaidBranchConnectionAction} from "@/lib/tenancy/paid-branch-connection-actions";
import {AccessGate} from "@/components/app/access-gate";
import {PaidWhatsappRoute} from "@/components/app/paid-whatsapp-route";

export default async function Page({params}:{params:Promise<{branchId:string}>}) {
  const {branchId:rawBranchId}=await params;
  const returnTo=whatsappSetupPath(rawBranchId);
  if(!returnTo)notFound();
  const branchId=rawBranchId.toLowerCase();
  const access=await getCompanyAccess("owner");
  if(!access.ok) {
    if(access.code==="UNVERIFIED")redirect(authFlowHref("/verify-email",returnTo));
    if(access.code==="FORBIDDEN"||access.code==="UNAVAILABLE")return <AccessGate code={access.code}/>;
    redirect(loginPathForReturn(returnTo));
  }
  if(access.context.needsCompanyContext)redirect(`/app?next=${encodeURIComponent(returnTo)}`);
  const {company,membership,userId}=access.context;
  if(!company||membership?.role!=="owner")return <AccessGate code="FORBIDDEN"/>;
  const scope={expectedAccountId:userId,companyId:company.id,branchId};
  const connectionScope={...scope,channel:"whatsapp" as const};
  const before=await readOwnedPaidBranchConnectionAction(connectionScope);
  const read=await readOwnedPaidBranchSetupAction(scope);
  if(read.sourceStatus!=="ready"||read.companyId!==company.id||read.selectedBranchId!==branchId||
    !read.entitlement||!read.branches.some(branch=>branch.id===branchId)||!read.selectedChannels?.includes("whatsapp")) {
    return <AccessGate code={read.sourceStatus==="unavailable"?"UNAVAILABLE":"FORBIDDEN"}/>;
  }
  // B1 does not expose generation. Bracket its projection with the same B3
  // revision/link/generation before permitting a success return.
  const connectionRead=before.connection.verified
    ?await readOwnedPaidBranchConnectionAction(connectionScope):before;
  const confirmedGeneration=before.sourceStatus==="ready"&&connectionRead.sourceStatus==="ready"&&
    before.expectedAccountId===userId&&before.companyId===company.id&&before.branchId===branchId&&before.channel==="whatsapp"&&
    before.connection.state==="connected"&&before.connection.verified&&!!before.revision&&
    before.revision===connectionRead.revision&&!!before.connection.link&&
    before.connection.link.id===connectionRead.connection.link?.id&&
    before.connection.link.generation===connectionRead.connection.link.generation
    ?before.connection.link.generation:null;
  // Read only: no start/complete/recover/cancel action or provider SDK is mounted.
  return <PaidWhatsappRoute scope={scope} read={read} connectionRead={connectionRead} confirmedGeneration={confirmedGeneration}/>;
}
