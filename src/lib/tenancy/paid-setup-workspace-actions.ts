"use server";

import {setupTiming} from "@/lib/diagnostics/setup-timing";
import {getCompanyAccess} from "./access";
import {readOwnedPaidBranchSetupShellAction,type ReadOwnedPaidBranchSetupInput} from "./paid-setup-actions";
import {readOwnedPaidBranchConnectionAction} from "./paid-branch-connection-actions";
import type {PaidBranchSetupRead,PaidSetupChannel} from "./paid-setup-contracts";
import {mergePaidBranchChannelProof} from './paid-setup-contracts';
import type {PaidBranchConnectionRead} from "./paid-branch-connection-contracts";
import {readOwnedBranchLaunchSummaryAction} from './paid-launch-actions';
import {composePaidSetupProgress} from './paid-setup-progress';
import {readEs02ActivationFoundationAction} from '@/lib/billing/es02/account-order-actions';
import {paidSetupActivation,type PaidSetupActivation} from './paid-setup-activation';

/** Read composition only, not a new persistence/readiness contract. */
export type PaidSetupWorkspaceRead={
  scope:ReadOwnedPaidBranchSetupInput;
  read:PaidBranchSetupRead;
  connectionReads:Partial<Record<PaidSetupChannel,PaidBranchConnectionRead>>;
  confirmedChannels:PaidSetupChannel[];
  activation?:PaidSetupActivation|null;
};
/** A fresh binding grants navigation, never verification or provider capabilities. */
export async function readOwnedPaidSetupShellAction(input:ReadOwnedPaidBranchSetupInput):Promise<PaidSetupWorkspaceRead|null> {
 const read=await readOwnedPaidBranchSetupShellAction(input);
 if(read.companyId!==input?.companyId||read.selectedBranchId!==input?.branchId||read.sourceStatus==='unavailable')return null;
 return {scope:{expectedAccountId:input.expectedAccountId,companyId:input.companyId,branchId:input.branchId},read,connectionReads:{},confirmedChannels:[],activation:null};
}
export async function readOwnedPaidSetupWorkspaceAction(input:ReadOwnedPaidBranchSetupInput&{connectionFirst?:boolean}):Promise<PaidSetupWorkspaceRead|null> {
 return readPaidWorkspace(input);
}
async function readPaidWorkspace(input:ReadOwnedPaidBranchSetupInput&{connectionFirst?:boolean}):Promise<PaidSetupWorkspaceRead|null> {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!input||[input.expectedAccountId,input.companyId,input.branchId].some(value=>typeof value!=="string"||value.length!==36||!uuid.test(value)))return null;
  const endOwner=setupTiming('owner');
  const access=await getCompanyAccess("owner");
  endOwner();
  if(!access.ok||access.context.needsCompanyContext||access.context.membership?.role!=="owner"||
    access.context.userId!==input.expectedAccountId||access.context.company?.id!==input.companyId)return null;
  const scope={expectedAccountId:access.context.userId,companyId:access.context.company.id,branchId:input.branchId};
  const endInitial=setupTiming('initial');
  const initial=await readOwnedPaidBranchSetupShellAction(scope);
  endInitial();
  if(initial.companyId!==scope.companyId||initial.selectedBranchId!==scope.branchId)return null;
  if(initial.sourceStatus!=="ready"||!initial.selectedChannels?.length)return {scope,read:initial,connectionReads:{},confirmedChannels:[]};
  const channels=initial.selectedChannels;
  if(new Set(channels).size!==channels.length||channels.some(channel=>channel!=="whatsapp"&&channel!=="instagram"))return null;
  const endBefore=setupTiming('connections_before');
  const before=await Promise.all(channels.map(channel=>readOwnedPaidBranchConnectionAction({...scope,channel})));
  endBefore();
  // A zero-progress, disconnected branch may show its real connection controls now.
  // No completed proof is exposed; start actions still recheck authority and revision.
  if(input.connectionFirst===true&&initial.progress.verified===0&&initial.steps.every(step=>step.status!=='verified')&&before.every((value,index)=>value.sourceStatus==='ready'&&value.expectedAccountId===scope.expectedAccountId&&value.companyId===scope.companyId&&value.branchId===scope.branchId&&value.channel===channels[index]&&value.connection.state==='not_connected'&&!value.connection.verified&&!value.connection.attempt&&!value.connection.link)){
    return {scope,read:initial,connectionReads:Object.fromEntries(channels.map((channel,index)=>[channel,before[index]])),confirmedChannels:[],activation:null};
  }
  const endRecheck=setupTiming('recheck');
  let read=await readOwnedPaidBranchSetupShellAction(scope);
  endRecheck();
  if(read.sourceStatus!=="ready"||read.companyId!==scope.companyId||read.selectedBranchId!==scope.branchId||
    JSON.stringify(read.selectedChannels)!==JSON.stringify(channels)||JSON.stringify(read.entitlement)!==JSON.stringify(initial.entitlement))return null;
  const endAfter=setupTiming('connections_after');
  const after=await Promise.all(channels.map(channel=>readOwnedPaidBranchConnectionAction({...scope,channel})));
  endAfter();
  // The two explicit channel observations already provide the fresh proof.
  // Binding reads must not issue two additional copies of every channel RPC.
  read=mergePaidBranchChannelProof(read,after.map((value,index)=>({
    channel:channels[index],companyId:value.companyId,branchId:value.branchId,
    verified:value.sourceStatus==='ready'&&value.connection.state==='connected'&&value.connection.verified&&!!value.connection.link,
    generation:value.connection.link?.generation??null,revoked:false,
    stale:value.connection.reasonCodes.includes('stale_scope'),
  })));
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
  if(input.connectionFirst===true)return {scope,read,connectionReads,confirmedChannels,activation:null};
  const [summary,clock]=await Promise.all([readOwnedBranchLaunchSummaryAction(scope),readEs02ActivationFoundationAction({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId}).catch(()=>null)]);
  const activation=clock?.ok?paidSetupActivation(clock.data,scope.companyId,read.entitlement?.orderGroupId):null;
  return {scope,read:composePaidSetupProgress(read,summary),connectionReads,confirmedChannels,activation};
}

/** Optional launch/knowledge/hours and clock metadata must not block connection controls. */
export async function readOwnedPaidSetupDetailsAction(input:ReadOwnedPaidBranchSetupInput,orderGroupId:string){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!input||[input.expectedAccountId,input.companyId,input.branchId].some(value=>typeof value!=='string'||!uuid.test(value))||typeof orderGroupId!=='string'||!orderGroupId||orderGroupId.length>128)return null;
 const access=await getCompanyAccess('owner');
 if(!access.ok||access.context.needsCompanyContext||access.context.membership?.role!=='owner'||access.context.userId!==input.expectedAccountId||access.context.company?.id!==input.companyId)return null;
 const scope={expectedAccountId:input.expectedAccountId,companyId:input.companyId,branchId:input.branchId};
 const [summary,clock]=await Promise.all([readOwnedBranchLaunchSummaryAction(scope).catch(()=>null),readEs02ActivationFoundationAction({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId}).catch(()=>null)]);
 return {scope,summary,activation:clock?.ok?paidSetupActivation(clock.data,scope.companyId,orderGroupId):null};
}
