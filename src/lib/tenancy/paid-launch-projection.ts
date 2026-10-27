import type {LaunchScope,LaunchSummarySnapshot} from '@/components/app/paid-launch-summary';
import type {PaidBranchSetupRead,PaidSetupStepStatus} from './paid-setup-contracts';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length<200)&&new Set(v).size===v.length;
function summaryItem(value:unknown,team=false){
 const row=object(value);if(!row||typeof row.detail!=='string'||row.detail.length>2000)return null;
 const status=row.status==='deferred'&&team?'skipped_optional':row.status;
 if(!['verified','pending','blocked','skipped_optional','unavailable'].includes(String(status)))return null;
 return {detail:row.detail,status:status as PaidSetupStepStatus};
}
/** Repairs the flat B1/nested presentation mismatch without changing native readiness. */
export function normalizePaidLaunchSnapshot(value:unknown,scope:LaunchScope,read:PaidBranchSetupRead):LaunchSummarySnapshot|null{
 const row=object(value),rScope=object(row?.scope),setup=object(row?.setup),launch=object(setup?.launch),ready=object(row?.readiness),summary=object(row?.summary),activation=object(row?.activation);
 if(!row||!rScope||!setup||!launch||!ready||!summary||!activation||read.sourceStatus!=='ready'||!read.entitlement||!read.selectedChannels?.length)return null;
 if(rScope.expectedAccountId!==scope.expectedAccountId||rScope.companyId!==scope.companyId||rScope.branchId!==scope.branchId||read.companyId!==scope.companyId||read.selectedBranchId!==scope.branchId||setup.companyId!==scope.companyId||setup.selectedBranchId!==scope.branchId)return null;
 if(row.version!==1||typeof row.branchLabel!=='string'||row.branchLabel.length>200||typeof ready.revision!=='string'||!/^[0-9a-f]{32}$/.test(ready.revision)||!strings(ready.blockers)||!strings(launch.blockedReasons))return null;
 if(!['ready','blocked'].includes(String(ready.status))||(ready.status==='ready')!==(ready.blockers.length===0)||JSON.stringify(launch.blockedReasons)!==JSON.stringify(ready.blockers)||launch.confirmationRequired!==true||typeof launch.confirmed!=='boolean'||launch.canRequest!==(ready.status==='ready'))return null;
 const channels=summary.channels;if(!Array.isArray(channels)||channels.length!==read.selectedChannels.length)return null;
 const channelItems:LaunchSummarySnapshot['summary']['channels']=[];
 for(const channel of read.selectedChannels){
  const matching=channels.filter(v=>object(v)?.channel===channel);if(matching.length!==1)return null;
  const item=summaryItem(matching[0]);if(!item)return null;
  const proof=read.steps.find(s=>s.id===(channel==='whatsapp'?'connect_whatsapp':'connect_instagram'));
  if(item.status==='verified'&&(proof?.status!=='verified'||proof.reasonCodes.length))return null;
  channelItems.push({channel,...item});
 }
 const hours=summaryItem(summary.hours),knowledge=summaryItem(summary.knowledge),persona=summaryItem(summary.persona),team=summaryItem(summary.team,true);
 if(!hours||!knowledge||!persona||!team||!uuid(row.operationId))return null;
 persona.detail={level_1:'نورا',level_2:'لينا',level_3:'دانا'}[read.entitlement.persona];
 if(ready.status==='ready'&&[...channelItems,hours,knowledge,persona].some(v=>v.status!=='verified'))return null;
 if(activation.status==='launched'){
  if(!uuid(activation.receiptId)||activation.operationId!==row.operationId||launch.confirmed!==true)return null;
 }else if(activation.status!=='not_started'||activation.receiptId!==null||activation.operationId!==null||launch.confirmed!==false)return null;
 // A conflicting populated binding is never silently replaced with a new one.
 if(setup.sourceStatus!=null&&setup.sourceStatus!=='ready')return null;
 if(setup.selectedChannels!=null&&JSON.stringify(setup.selectedChannels)!==JSON.stringify(read.selectedChannels))return null;
 if(setup.entitlement!=null&&JSON.stringify(setup.entitlement)!==JSON.stringify(read.entitlement))return null;
 return {scope:{...scope},version:1,branchLabel:row.branchLabel,setup:{companyId:read.companyId,selectedBranchId:read.selectedBranchId,sourceStatus:'ready',selectedChannels:[...read.selectedChannels],entitlement:{...read.entitlement},launch:{confirmationRequired:true,confirmed:launch.confirmed,canRequest:launch.canRequest,blockedReasons:[...ready.blockers]}},readiness:{status:ready.status as 'ready'|'blocked',revision:ready.revision,blockers:[...ready.blockers]},summary:{channels:channelItems,hours,knowledge,persona,team},operationId:row.operationId,activation:{status:activation.status as 'not_started'|'launched',receiptId:activation.receiptId as string|null,operationId:activation.operationId as string|null}};
}
