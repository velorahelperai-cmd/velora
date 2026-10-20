"use server";

import {getCompanyAccess} from "./access";
import {readOwnedPaidBranchSetupAction,type ReadOwnedPaidBranchSetupInput} from "./paid-setup-actions";
import {readOwnedPaidBranchConnectionAction} from "./paid-branch-connection-actions";
import type {PaidBranchSetupRead,PaidSetupChannel} from "./paid-setup-contracts";
import type {PaidBranchConnectionRead} from "./paid-branch-connection-contracts";

/** Read composition only, not a new persistence/readiness contract. */
export type PaidSetupWorkspaceRead={
  scope:ReadOwnedPaidBranchSetupInput;
  read:PaidBranchSetupRead;
  connectionReads:Partial<Record<PaidSetupChannel,PaidBranchConnectionRead>>;
  confirmedChannels:PaidSetupChannel[];
};
export async function readOwnedPaidSetupWorkspaceAction(input:ReadOwnedPaidBranchSetupInput):Promise<PaidSetupWorkspaceRead|null> {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!input||[input.expectedAccountId,input.companyId,input.branchId].some(value=>typeof value!=="string"||value.length!==36||!uuid.test(value)))return null;
  const access=await getCompanyAccess("owner");
  if(!access.ok||access.context.needsCompanyContext||access.context.membership?.role!=="owner"||
    access.context.userId!==input.expectedAccountId||access.context.company?.id!==input.companyId)return null;
  const scope={expectedAccountId:access.context.userId,companyId:access.context.company.id,branchId:input.branchId};
  const initial=await readOwnedPaidBranchSetupAction(scope);
  if(initial.companyId!==scope.companyId||initial.selectedBranchId!==scope.branchId)return null;
  if(initial.sourceStatus!=="ready"||!initial.selectedChannels?.length)return {scope,read:initial,connectionReads:{},confirmedChannels:[]};
  const channels=initial.selectedChannels;
  if(new Set(channels).size!==channels.length||channels.some(channel=>channel!=="whatsapp"&&channel!=="instagram"))return null;
  const before=await Promise.all(channels.map(channel=>readOwnedPaidBranchConnectionAction({...scope,channel})));
  const read=await readOwnedPaidBranchSetupAction(scope);
  if(read.sourceStatus!=="ready"||read.companyId!==scope.companyId||read.selectedBranchId!==scope.branchId||
    JSON.stringify(read.selectedChannels)!==JSON.stringify(channels)||JSON.stringify(read.entitlement)!==JSON.stringify(initial.entitlement))return null;
  const after=await Promise.all(channels.map(channel=>readOwnedPaidBranchConnectionAction({...scope,channel})));
  const connectionReads:PaidSetupWorkspaceRead["connectionReads"]={},confirmedChannels:PaidSetupChannel[]=[];
  for(let index=0;index<channels.length;index++){
    const channel=channels[index]!,first=before[index]!,last=after[index]!;
    const matches=(value:PaidBranchConnectionRead)=>value.expectedAccountId===scope.expectedAccountId&&value.companyId===scope.companyId&&value.branchId===scope.branchId&&value.channel===channel;
    if(!matches(first)||!matches(last))return null;
    connectionReads[channel]=last;
    const stepId=channel==="whatsapp"?"connect_whatsapp":"connect_instagram";
    const projected=read.steps.filter(step=>step.id===stepId);
    const confirmed=first.sourceStatus==="ready"&&last.sourceStatus==="ready"&&
      first.connection.state==="connected"&&last.connection.state==="connected"&&first.connection.verified&&last.connection.verified&&
      first.connection.reasonCodes.length===0&&last.connection.reasonCodes.length===0&&
      !!first.revision&&first.revision===last.revision&&!!first.connection.link&&
      first.connection.link.id===last.connection.link?.id&&first.connection.link.generation===last.connection.link.generation&&
      Number.isSafeInteger(last.connection.link.generation)&&last.connection.link.generation>=1&&
      projected.length===1&&projected[0]!.status==="verified"&&projected[0]!.reasonCodes.length===0;
    // Never expose completed B1 progress without stable corroborating channel proof.
    if(projected.some(step=>step.status==="verified")&&!confirmed)return null;
    if(confirmed)confirmedChannels.push(channel);
  }
  return {scope,read,connectionReads,confirmedChannels};
}
